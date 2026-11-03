# ---- backend: build the Go server into a static binary ---------------------------------
FROM golang:1.27-alpine AS backend-build
WORKDIR /app/backend

# Cache module downloads separately from source changes.
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/classo-server ./cmd/server

# ---- frontend: build the static SPA ----------------------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Public Supabase values are baked into the JS bundle at build time. They are
# safe to expose (the anon key is public). ModelScope's `environment_variables`
# are runtime-only, so these must be set here as build-time ARGs with defaults
# rather than injected at runtime. Edit the defaults below to your real values.
ARG VITE_SUPABASE_URL=https://bulbdypqezbwpbnqyjem.supabase.co
ARG VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1bGJkeXBxZXpid3BibnF5amVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxOTYwODgsImV4cCI6MjEwODc3MjA4OH0.VHy0iuGzFft5mowcsiOZaSYyIwYEqaIiEFL16rlaCsQ
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

# Install dependencies from the lockfile for reproducible builds.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- runtime: nginx serves the SPA and proxies /v1, /healthz to the Go backend ---------
FROM nginx:1.27-alpine
COPY --from=backend-build /out/classo-server /usr/local/bin/classo-server
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# ModelScope `docker` mode requires the app on 0.0.0.0:7860. The Go backend is
# internal-only on :8081 (8080 is platform-reserved), proxied to by nginx.
EXPOSE 7860

# Start the Go backend (on :8081) and nginx (on :7860) in one container. If the
# backend exits (e.g. a bad DATABASE_URL), the container exits too so the
# platform's health/restart policies fire.
CMD ["sh", "-c", "PORT=8081 classo-server & exec nginx -g 'daemon off;'"]