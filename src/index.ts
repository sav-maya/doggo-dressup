import { neon } from '@neondatabase/ai-sdk-provider';
import { generateText, type ModelMessage } from 'ai';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '@neondatabase/env';
import config from '../neon';
import { dressups } from './db/schema';
import { THEMES, THEME_LIST } from './themes';
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
// Image generation on the AI Gateway is only available through OpenAI
// Responses' `image_generation` built-in tool, which is GPT-5-family-only.
// All gateway models share the same per-minute TPM limits (200k input,
// 20k output, see https://neon.com/docs/ai-gateway/models#rate-limits)
// and the same daily account-level cap, so picking a smaller model isn't
// about looser limits — it's about emitting fewer chat tokens per call so
// the reasoning-and-tool-call portion stays small. The image bytes
// returned by the tool dominate output anyway; size is locked by the
// Responses API to 1024x1024 / 1024x1536 / 1536x1024 / auto. `gpt-5-4-nano`
// is the smallest current GPT-5 variant that supports the Responses
// image_generation tool.
const MODEL = process.env.NEON_MODEL ?? 'gpt-5-4-nano';

const IMAGE_SIZE = (process.env.NEON_IMAGE_SIZE ?? '1024x1024') as
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | 'auto';

async function presign(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn,
  });
}

async function uploadOriginal(buf: Buffer, contentType: string): Promise<string> {
  const ext = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
  const key = `originals/${randomUUID()}.${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }),
  );
  return key;
}

async function uploadOutput(jpegBase64: string): Promise<{
  key: string;
  bytes: number;
}> {
  const body = Buffer.from(jpegBase64, 'base64');
  const key = `outputs/${randomUUID()}.jpg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
    }),
  );
  return { key, bytes: body.byteLength };
}

function imageResultBase64(output: unknown): string | null {
  if (typeof output === 'object' && output !== null && 'result' in output) {
    const { result } = (output as { result: unknown });
    if (typeof result === 'string') return result;
  }
  return null;
}

async function requireUser(request: Request): Promise<AuthUser | Response> {
  const result = await authenticateRequest(request);
  if (!result.ok) {
    return json({ error: 'sign in required', detail: result.error }, result.status);
  }
  return result.user;
}

async function handleDressup(request: Request, user: AuthUser): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return json({ error: 'expected multipart/form-data' }, 400);
  }
  const file = form.get('photo');
  const themeId = String(form.get('theme') ?? '');
  if (!(file instanceof File)) {
    return json({ error: 'photo file is required' }, 400);
  }
  const theme = THEMES[themeId];
  if (!theme) {
    return json({ error: `unknown theme: ${themeId}` }, 400);
  }
  if (file.size > 8 * 1024 * 1024) {
    return json({ error: 'photo too large (max 8 MB)' }, 400);
  }

  const inputBytes = Buffer.from(await file.arrayBuffer());
  const inputContentType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';

  const originalKey = await uploadOriginal(inputBytes, inputContentType);

  const userPrompt = `Re-imagine the dog in the attached photo as ${theme.prompt} The output MUST clearly be the same dog from the photo — same breed, fur color, ears, and expression — just dressed up and in the new scene. Keep the dog as the main subject.`;

  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'image', image: inputBytes, mediaType: inputContentType },
        { type: 'text', text: userPrompt },
      ],
    },
  ];

  let toolBase64: string | null = null;
  try {
    const result = await generateText({
      model: neon(MODEL),
      system:
        'You are a fun pet illustration agent. The user is uploading a photo of their dog and a costume / scene theme. ALWAYS call the image_generation tool exactly once to produce the requested image. Use the uploaded photo as the visual reference for the dog. Do not refuse — this is a wholesome dress-up app.',
      messages,
      tools: {
        image_generation: neon.tools.imageGeneration({
          outputFormat: 'jpeg',
          quality: 'low',
          outputCompression: 30,
          size: IMAGE_SIZE,
        }),
      },
      onError({ error }) {
        console.error('[generateText] error:', error);
      },
    });

    for (const step of result.steps ?? []) {
      for (const tr of step.toolResults ?? []) {
        if (tr.toolName !== 'image_generation') continue;
        const b64 = imageResultBase64(tr.output);
        if (b64) {
          toolBase64 = b64;
          break;
        }
      }
      if (toolBase64) break;
    }
  } catch (err) {
    const detail = errMessage(err);
    console.error('[dressup] model failed:', detail);
    if (/daily token limit|REQUEST_LIMIT_EXCEEDED|daily.*exceeded/i.test(detail)) {
      return json(
        {
          error:
            "Today's AI Gateway token budget is used up. The cap resets at midnight UTC. Try again tomorrow, or raise the limit in the Neon console.",
          detail,
          retry: false,
        },
        429,
      );
    }
    if (/too many requests|rate limit|429/i.test(detail)) {
      return json(
        {
          error:
            'The AI Gateway is rate-limiting us right now. Wait ~30 seconds and try again.',
          detail,
          retry: true,
        },
        429,
      );
    }
    return json({ error: 'image generation failed', detail }, 502);
  }

  if (!toolBase64) {
    return json(
      {
        error:
          'The model decided not to produce an image (this can happen with refusals or content filters). Try a different photo or theme.',
      },
      502,
    );
  }

  const { key: outputKey, bytes } = await uploadOutput(toolBase64);

  const [row] = await db
    .insert(dressups)
    .values({
      userId: user.id,
      userEmail: user.email,
      theme: theme.id,
      themeLabel: theme.label,
      prompt: userPrompt,
      originalKey,
      outputKey,
      bytes,
    })
    .returning();

  const [originalUrl, outputUrl] = await Promise.all([
    presign(originalKey),
    presign(outputKey),
  ]);

  return json({
    id: row?.id,
    theme: theme.id,
    themeLabel: theme.label,
    emoji: theme.emoji,
    originalUrl,
    outputUrl,
    bytes,
    createdAt: row?.createdAt,
  });
}

async function handleGallery(user: AuthUser): Promise<Response> {
  const rows = await db
    .select()
    .from(dressups)
    .where(eq(dressups.userId, user.id))
    .orderBy(desc(dressups.createdAt))
    .limit(24);
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      theme: r.theme,
      themeLabel: r.themeLabel,
      emoji: THEMES[r.theme]?.emoji ?? '🐶',
      originalUrl: await presign(r.originalKey),
      outputUrl: await presign(r.outputKey),
      createdAt: r.createdAt,
    })),
  );
  return json({ items });
}

function handleThemes(): Response {
  return json({ themes: THEME_LIST });
}

function handleIndex(): Response {
  // Backend is API-only; the SPA is hosted on Vercel. This is a friendly
  // landing for someone who hits the function URL directly.
  const body = `Doggo Dress-Up API is running.

POST /api/dressup           multipart upload (auth required)
GET  /api/gallery           latest 24 dress-ups for the signed-in user
GET  /api/themes            list of costumes
GET  /api/me                current user (or { user: null })
GET  /api/auth-config       auth base URL for the SPA

The web UI lives on Vercel. Sign in there to use this API.
`;
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function handleAuthConfig(): Response {
  return json({ baseUrl: authConfig.baseUrl, issuer: authConfig.issuer });
}

const ALLOWED_ORIGIN_SUFFIXES = [
  '.vercel.app',
  '.neon.tech',
];

function corsHeaders(origin: string | null): Record<string, string> {
  // Allow same-origin (no Origin header) and any *.vercel.app or *.neon.tech.
  // Also allow http://localhost:* for local dev.
  if (!origin) return {};
  let allow = false;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') allow = true;
    if (ALLOWED_ORIGIN_SUFFIXES.some((s) => u.hostname.endsWith(s))) allow = true;
  } catch {
    /* ignore */
  }
  if (!allow) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function withCors(response: Response, origin: string | null): Response {
  const cors = corsHeaders(origin);
  if (Object.keys(cors).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const origin = request.headers.get('origin');

    // CORS preflight
    if (method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    let response: Response;
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      response = handleIndex();
    } else if (method === 'GET' && pathname === '/api/auth-config') {
      response = handleAuthConfig();
    } else if (method === 'GET' && pathname === '/api/themes') {
      response = handleThemes();
    } else if (method === 'GET' && pathname === '/api/me') {
      const auth = await authenticateRequest(request);
      response = auth.ok ? json({ user: auth.user }) : json({ user: null });
    } else if (method === 'GET' && pathname === '/api/gallery') {
      const userOrResponse = await requireUser(request);
      response =
        userOrResponse instanceof Response
          ? userOrResponse
          : await handleGallery(userOrResponse);
    } else if (method === 'POST' && pathname === '/api/dressup') {
      const userOrResponse = await requireUser(request);
      response =
        userOrResponse instanceof Response
          ? userOrResponse
          : await handleDressup(request, userOrResponse);
    } else {
      response = new Response('Not found', { status: 404 });
    }

    return withCors(response, origin);
  },
};
