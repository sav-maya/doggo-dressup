# Doggo Dress-Up — frontend

Static SPA hosted on Vercel. Calls two backends:

- **API:** [Neon Function](../src/index.ts) at `https://br-ancient-dream-aj6ae96i-dressup.compute.c-3.us-east-2.aws.neon.tech` — `POST /api/dressup`, `GET /api/gallery`, etc.
- **Auth:** Neon Auth (Better Auth) at `https://ep-restless-surf-aj2m390k.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth` — sign-up / sign-in / `/token` for the JWT.

Set Vercel **Root Directory** to `web/`. No build step (pure static).

## Local dev

```bash
cd web
npx serve .   # or any static server
```

Override the API base on the fly:

```
http://localhost:3000/?api=http://127.0.0.1:8787
```

## Auth flow

1. `POST {AUTH_BASE}/sign-up/email` or `/sign-in/email` (cross-origin, `credentials: 'include'` — sets a cookie on the auth domain).
2. `GET {AUTH_BASE}/token` (cross-origin, `credentials: 'include'`) → returns a 15-minute JWT.
3. Send `Authorization: Bearer <jwt>` to every `/api/*` call. The Neon Function verifies it against the JWKS endpoint.
