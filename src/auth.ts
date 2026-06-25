import { createRemoteJWKSet, jwtVerify } from 'jose';

// Hardcoded for the demo project; can be overridden by env (set automatically
// for branches/projects when `auth: true` is in neon.ts).
const NEON_AUTH_URL =
  process.env.NEON_AUTH_BASE_URL ??
  process.env.NEON_AUTH_URL ??
  'https://ep-restless-surf-aj2m390k.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth';

// Issuer in the JWT is just the origin of the auth URL (no /neondb/auth path),
// per the Neon Auth JWT docs.
const ISSUER = new URL(NEON_AUTH_URL).origin;

const JWKS = createRemoteJWKSet(new URL(`${NEON_AUTH_URL}/.well-known/jwks.json`));

export const authConfig = {
  /** Full auth base URL with the /neondb/auth path. */
  baseUrl: NEON_AUTH_URL,
  /** Origin used as the JWT issuer. */
  issuer: ISSUER,
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; error: string };

export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, error: 'missing bearer token' };
  }
  const token = header.slice('bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, error: 'empty bearer token' };
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ISSUER,
      audience: ISSUER,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return { ok: false, status: 401, error: 'token has no subject' };
    }
    const email = typeof payload.email === 'string' ? payload.email : '';
    const name = typeof payload.name === 'string' ? payload.name : undefined;
    return { ok: true, user: { id: payload.sub, email, name } };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: err instanceof Error ? err.message : 'invalid token',
    };
  }
}
