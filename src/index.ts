import { neon } from '@neondatabase/ai-sdk-provider';
import { generateText, type ModelMessage } from 'ai';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '@neondatabase/env';
import config from '../neon';
import { pets, generations } from './db/schema';
import { EXAMPLES } from './themes';
import { authenticateRequest, authConfig, type AuthUser } from './auth';

const env = parseEnv(config);

const pool = new Pool({ connectionString: env.postgres.databaseUrl, max: 5 });
const db = drizzle(pool);

const s3 = new S3Client({
  forcePathStyle:
    (process.env.NEON_STORAGE_FORCE_PATH_STYLE ?? 'true').toLowerCase() !==
    'false',
});

const BUCKET = 'dressups';

// gpt-5-4-nano is the smallest current GPT-5 variant that supports the
// OpenAI Responses image_generation built-in tool. Override at runtime
// with NEON_MODEL.
const MODEL = process.env.NEON_MODEL ?? 'gpt-5-4-nano';
const IMAGE_SIZE = (process.env.NEON_IMAGE_SIZE ?? '1024x1024') as
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | 'auto';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_PETS_PER_USER = 12;

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 32);
}

async function presign(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

async function uploadPhoto(buf: Buffer, contentType: string, prefix: 'pets' | 'originals'): Promise<string> {
  const ext = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
  const key = `${prefix}/${randomUUID()}.${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buf, ContentType: contentType,
  }));
  return key;
}

async function fetchPhotoBytes(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const arr = await r.Body?.transformToByteArray();
  if (!arr) throw new Error(`no body for ${key}`);
  return Buffer.from(arr);
}

function imageResultBase64(output: unknown): string | null {
  if (typeof output === 'object' && output !== null && 'result' in output) {
    const { result } = output as { result: unknown };
    if (typeof result === 'string') return result;
  }
  return null;
}

// Extract @-mentions from a free-form prompt. Returns lowercased slugs in
// order of first occurrence, deduplicated.
function parseMentions(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of prompt.matchAll(/@([\p{L}\p{N}_-]{2,32})/gu)) {
    const slug = slugify(m[1]);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// auth-aware routing
// ----------------------------------------------------------------------------

async function requireUser(request: Request): Promise<AuthUser | Response> {
  const result = await authenticateRequest(request);
  if (!result.ok) return json({ error: 'sign in required', detail: result.error }, result.status);
  return result.user;
}

// ----------------------------------------------------------------------------
// /api/pets — the user's "cast"
// ----------------------------------------------------------------------------

async function handleListPets(user: AuthUser): Promise<Response> {
  const rows = await db
    .select()
    .from(pets)
    .where(eq(pets.userId, user.id))
    .orderBy(desc(pets.createdAt));
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      photoUrl: await presign(r.bucketKey),
      createdAt: r.createdAt,
    })),
  );
  return json({ items });
}

async function handleCreatePet(request: Request, user: AuthUser): Promise<Response> {
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'expected multipart/form-data' }, 400); }

  const name = String(form.get('name') ?? '').trim();
  const file = form.get('photo');
  if (!name) return json({ error: 'name is required' }, 400);
  if (name.length > 32) return json({ error: 'name max 32 chars' }, 400);
  if (!(file instanceof File)) return json({ error: 'photo file is required' }, 400);
  if (file.size > MAX_PHOTO_BYTES) return json({ error: 'photo too large (max 8 MB)' }, 400);

  const slug = slugify(name);
  if (!slug) return json({ error: 'name must contain letters or numbers' }, 400);

  const existing = await db.select().from(pets).where(eq(pets.userId, user.id));
  if (existing.length >= MAX_PETS_PER_USER) {
    return json({ error: `max ${MAX_PETS_PER_USER} pets per user; delete one first` }, 400);
  }
  if (existing.some((p) => p.slug === slug)) {
    return json({ error: `you already have a pet named "@${slug}"` }, 409);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const contentType = file.type?.startsWith('image/') ? file.type : 'image/jpeg';
  const bucketKey = await uploadPhoto(buf, contentType, 'pets');

  const [row] = await db
    .insert(pets)
    .values({
      userId: user.id,
      userEmail: user.email,
      name,
      slug,
      bucketKey,
      contentType,
    })
    .returning();

  return json({
    id: row?.id,
    name: row?.name,
    slug: row?.slug,
    photoUrl: await presign(bucketKey),
    createdAt: row?.createdAt,
  });
}

async function handleDeletePet(petId: string, user: AuthUser): Promise<Response> {
  const [row] = await db
    .select()
    .from(pets)
    .where(and(eq(pets.id, petId), eq(pets.userId, user.id)));
  if (!row) return json({ error: 'pet not found' }, 404);

  await db.delete(pets).where(eq(pets.id, petId));
  // Best-effort delete the bucket object.
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: row.bucketKey }));
  } catch (err) {
    console.warn('[pets] delete object failed:', errMessage(err));
  }
  return json({ ok: true, id: petId });
}

// ----------------------------------------------------------------------------
// /api/generate — free-form prompt with @-mentions
// ----------------------------------------------------------------------------

async function handleGenerate(request: Request, user: AuthUser): Promise<Response> {
  let body: { prompt?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'expected JSON body' }, 400); }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'prompt is required' }, 400);
  if (prompt.length > 1000) return json({ error: 'prompt max 1000 chars' }, 400);

  const slugs = parseMentions(prompt);
  if (slugs.length === 0) {
    return json({
      error:
        '@-mention at least one of your pets in the prompt (e.g. "@bowie as a knight"). Add a pet first if you don\'t have one yet.',
    }, 400);
  }

  // Look up the user's pets matching the @-mentions, preserving prompt order.
  const userPets = await db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, user.id), inArray(pets.slug, slugs)));
  const bySlug = new Map(userPets.map((p) => [p.slug, p]));
  const orderedPets = slugs.map((s) => bySlug.get(s)).filter((p): p is typeof userPets[number] => !!p);
  if (orderedPets.length === 0) {
    return json({
      error: `none of your pets match those @-mentions: ${slugs.map((s) => '@' + s).join(', ')}. Add them first.`,
    }, 400);
  }
  const missing = slugs.filter((s) => !bySlug.has(s));

  // Compose multi-modal user message: prompt + each pet's photo as input image.
  const photos = await Promise.all(
    orderedPets.map(async (p) => ({
      pet: p,
      bytes: await fetchPhotoBytes(p.bucketKey),
    })),
  );

  const photoNote = orderedPets
    .map((p, i) => `Image ${i + 1} = @${p.slug} (${p.name})`)
    .join('. ');

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        ...photos.map((p) => ({
          type: 'image' as const,
          image: p.bytes,
          mediaType: p.pet.contentType,
        })),
        {
          type: 'text' as const,
          text:
            `${photoNote}.\n\nUser prompt: ${prompt}\n\n` +
            'Generate the image now using the image_generation tool. Use the photos above as the visual reference for each named pet — match their fur, breed, ears, expression, and distinguishing features. Keep them clearly recognizable.',
        },
      ],
    },
  ];

  let toolBase64: string | null = null;
  try {
    const result = await generateText({
      model: neon(MODEL),
      system:
        'You are a fun pet illustration agent. The user uploads photos of their pet(s) and writes a short prompt. ALWAYS call the image_generation tool exactly once to produce the requested image. Use the uploaded photos as the visual reference for each named pet. Do not refuse — this is a wholesome pet dress-up app.',
      messages,
      tools: {
        image_generation: neon.tools.imageGeneration({
          outputFormat: 'jpeg',
          quality: 'low',
          outputCompression: 30,
          size: IMAGE_SIZE,
        }),
      },
      onError({ error }) { console.error('[generateText] error:', error); },
    });

    for (const step of result.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName !== 'image_generation') continue;
        const b64 = imageResultBase64(tr.output);
        if (b64) { toolBase64 = b64; break; }
      }
      if (toolBase64) break;
    }
  } catch (err) {
    const detail = errMessage(err);
    console.error('[generate] model failed:', detail);
    if (/daily token limit|REQUEST_LIMIT_EXCEEDED|daily.*exceeded/i.test(detail)) {
      return json({
        error: "Today's AI Gateway token budget is used up. The cap resets at midnight UTC. Try again tomorrow, or raise the limit in the Neon console.",
        detail, retry: false,
      }, 429);
    }
    if (/too many requests|rate limit|429/i.test(detail)) {
      return json({
        error: 'The AI Gateway is rate-limiting us right now. Wait ~30 seconds and try again.',
        detail, retry: true,
      }, 429);
    }
    return json({ error: 'image generation failed', detail }, 502);
  }

  if (!toolBase64) {
    return json({
      error: 'The model decided not to produce an image (this can happen with refusals or content filters). Try a different prompt.',
    }, 502);
  }

  const outBuf = Buffer.from(toolBase64, 'base64');
  const outputKey = `outputs/${randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: outputKey, Body: outBuf, ContentType: 'image/jpeg',
  }));

  const [row] = await db
    .insert(generations)
    .values({
      userId: user.id,
      userEmail: user.email,
      prompt,
      petIds: orderedPets.map((p) => p.id),
      petNames: orderedPets.map((p) => p.name),
      outputKey,
      bytes: outBuf.byteLength,
    })
    .returning();

  return json({
    id: row?.id,
    prompt,
    petNames: orderedPets.map((p) => p.name),
    petSlugs: orderedPets.map((p) => p.slug),
    outputUrl: await presign(outputKey),
    bytes: outBuf.byteLength,
    createdAt: row?.createdAt,
    warnings: missing.length > 0 ? [`unknown pets ignored: ${missing.map((s) => '@' + s).join(', ')}`] : undefined,
  });
}

async function handleGallery(user: AuthUser): Promise<Response> {
  const rows = await db
    .select()
    .from(generations)
    .where(eq(generations.userId, user.id))
    .orderBy(desc(generations.createdAt))
    .limit(24);
  const items = await Promise.all(rows.map(async (r) => ({
    id: r.id,
    prompt: r.prompt,
    petNames: r.petNames,
    outputUrl: await presign(r.outputKey),
    createdAt: r.createdAt,
  })));
  return json({ items });
}

function handleExamples(): Response {
  return json({ examples: EXAMPLES });
}

function handleAuthConfig(): Response {
  return json({ baseUrl: authConfig.baseUrl, issuer: authConfig.issuer });
}

function handleIndex(): Response {
  const body = `Doggo Dress-Up API is running.

GET    /api/auth-config     auth base URL for the SPA
GET    /api/me              current user (or { user: null })
GET    /api/examples        starter prompt templates

GET    /api/pets            list your cast (auth required)
POST   /api/pets            multipart: name + photo (auth required)
DELETE /api/pets/:id        remove a cast member (auth required)

POST   /api/generate        JSON: { prompt } with @-mentions (auth required)
GET    /api/gallery         your latest 24 generations (auth required)

The web UI lives on Vercel.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

// ----------------------------------------------------------------------------
// CORS
// ----------------------------------------------------------------------------

const ALLOWED_ORIGIN_SUFFIXES = ['.vercel.app', '.neon.tech'];

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  let allow = false;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') allow = true;
    if (ALLOWED_ORIGIN_SUFFIXES.some((s) => u.hostname.endsWith(s))) allow = true;
  } catch { /* ignore */ }
  if (!allow) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function withCors(response: Response, origin: string | null): Response {
  const cors = corsHeaders(origin);
  if (Object.keys(cors).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

// ----------------------------------------------------------------------------
// router
// ----------------------------------------------------------------------------

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const origin = request.headers.get('origin');

    if (method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    let response: Response;
    try {
      // Public routes
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        response = handleIndex();
      } else if (method === 'GET' && pathname === '/api/auth-config') {
        response = handleAuthConfig();
      } else if (method === 'GET' && pathname === '/api/examples') {
        response = handleExamples();
      } else if (method === 'GET' && pathname === '/api/me') {
        const auth = await authenticateRequest(request);
        response = auth.ok ? json({ user: auth.user }) : json({ user: null });
      // Protected routes
      } else if (method === 'GET' && pathname === '/api/pets') {
        const u = await requireUser(request);
        response = u instanceof Response ? u : await handleListPets(u);
      } else if (method === 'POST' && pathname === '/api/pets') {
        const u = await requireUser(request);
        response = u instanceof Response ? u : await handleCreatePet(request, u);
      } else if (method === 'DELETE' && pathname.startsWith('/api/pets/')) {
        const u = await requireUser(request);
        if (u instanceof Response) {
          response = u;
        } else {
          const petId = pathname.slice('/api/pets/'.length);
          response = petId ? await handleDeletePet(petId, u) : json({ error: 'pet id required' }, 400);
        }
      } else if (method === 'POST' && pathname === '/api/generate') {
        const u = await requireUser(request);
        response = u instanceof Response ? u : await handleGenerate(request, u);
      } else if (method === 'GET' && pathname === '/api/gallery') {
        const u = await requireUser(request);
        response = u instanceof Response ? u : await handleGallery(u);
      } else {
        response = new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error('[router] unhandled:', err);
      response = json({ error: 'internal error', detail: errMessage(err) }, 500);
    }

    return withCors(response, origin);
  },
};
