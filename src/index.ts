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
import { desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { parseEnv } from '@neondatabase/env';
import config from '../neon';
import { dressups } from './db/schema';
import { THEMES, THEME_LIST } from './themes';
import { INDEX_HTML } from './web';

const env = parseEnv(config);

const pool = new Pool({ connectionString: env.postgres.databaseUrl, max: 5 });
const db = drizzle(pool);

const s3 = new S3Client({
  forcePathStyle:
    (process.env.NEON_STORAGE_FORCE_PATH_STYLE ?? 'true').toLowerCase() !==
    'false',
});

const BUCKET = 'dressups';
const MODEL = 'gpt-5-mini';

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

async function handleDressup(request: Request): Promise<Response> {
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
          size: '1024x1024',
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
    console.error('[dressup] model failed:', err);
    return json(
      { error: 'image generation failed', detail: errMessage(err) },
      502,
    );
  }

  if (!toolBase64) {
    return json({ error: 'model did not produce an image' }, 502);
  }

  const { key: outputKey, bytes } = await uploadOutput(toolBase64);

  const [row] = await db
    .insert(dressups)
    .values({
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

async function handleGallery(): Promise<Response> {
  const rows = await db
    .select()
    .from(dressups)
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
  return new Response(INDEX_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return handleIndex();
    }
    if (method === 'GET' && pathname === '/api/themes') {
      return handleThemes();
    }
    if (method === 'GET' && pathname === '/api/gallery') {
      return handleGallery();
    }
    if (method === 'POST' && pathname === '/api/dressup') {
      return handleDressup(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
