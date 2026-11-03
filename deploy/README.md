# ClassO — Docker deployment

A single-container deployment: **nginx** serves the built React SPA and reverse-proxies `/v1` + `/healthz` to the **Go backend**, all in one image.

## Quick start

1. Create a `.env` at the repo root from the template:

   ```bash
   cp .env.docker.example .env
   # then edit .env and fill in your real Supabase values
   ```

2. Build and run:

   ```bash
   docker compose up --build -d
   ```

3. Open http://localhost:8080 (host `8080` → container `80`).

## Environment variables

| Variable | Kind | Where it's set | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | Runtime secret | `.env` → container env | Supabase Postgres connection string |
| `SUPABASE_URL` | Runtime secret | `.env` → container env | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Runtime secret | `.env` → container env | service-role key (server-side storage) |
| `SUPABASE_JWT_SECRET` | Runtime secret | `.env` → container env | HS256 JWT secret |
| `INSTRUCTOR_EMAILS` | Runtime | `.env` → container env | comma-separated allowlist |
| `ALLOW_NO_AUTH` | Runtime | `.env` → container env | `true` only for local dev |
| `VITE_SUPABASE_URL` | Public (build) | `.env` → **build arg** | baked into the JS bundle |
| `VITE_SUPABASE_ANON_KEY` | Public (build) | `.env` → **build arg** | baked into the JS bundle |

- **Runtime secrets** are injected at *container start* by `docker compose` — they are never baked into the image.
- **`VITE_SUPABASE_*`** are public and baked into the SPA at *build time* via `--build-arg` (the `build.args` block in `docker-compose.yml`). The anon key is safe to expose.

## Notes

- **No secrets in the image** — `.dockerignore` excludes all `.env` files, so runtime secrets never land in a layer.
- **Realtime works** — nginx disables buffering for `/v1/groups/` so Server-Sent Events (messages + typing) stream without delay.
- **SPA routing** — unknown paths fall back to `index.html`, so client-side routes (e.g. `/courses/…`) survive a hard refresh.
- **Production** — keep `ALLOW_NO_AUTH` empty/false, and put a TLS-terminating reverse proxy (Caddy, Traefik, or a load balancer) in front of `:8080`.