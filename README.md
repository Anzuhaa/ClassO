# ClassO

An academic group-project & collaboration hub for university students. Create courses ("matkul"), auto-split students into balanced groups via the ModelScope AI (with a deterministic fallback), then collaborate in each group's workspace: a kanban task board, a discussion room with AI chat summaries, and a shared file vault.

## Architecture

| Layer       | Tech                                                              |
| ----------- | ----------------------------------------------------------------- |
| Frontend    | React 18 + TypeScript + Vite, Tailwind CSS, Lucide React, Montserrat |
| Backend     | Go 1.22+ (stdlib `net/http` routing), pgx/v5                       |
| Database    | Supabase (PostgreSQL + RLS + Realtime)                             |
| AI          | ModelScope `deepseek-ai/DeepSeek-V4-Pro-0813` (server-side only)   |

```
classo/
├── backend/
│   ├── cmd/server/main.go          # entrypoint + router
│   ├── migrations/schema.sql       # full Supabase schema + RLS
│   ├── .env.example
│   └── internal/
│       ├── config/                 # env loading
│       ├── database/                # pgx connection pool
│       ├── models/                 # domain structs (camelCase JSON)
│       ├── repository/             # SQL access (snake_case columns)
│       ├── services/               # AI client + formation/summary logic
│       ├── handlers/               # thin HTTP handlers
│       └── middleware/             # auth, CORS, logging
└── frontend/
    └── src/
        ├── components/             # GlassCard, Button, Input, …
        ├── features/               # courses, groups, tasks, chat, vault
        ├── lib/                    # api client + theme provider
        ├── styles/globals.css      # glassmorphism design system
        └── types/                  # API types (camelCase)
```

## Getting started

### 1. Database (Supabase)

1. Create a Supabase project.
2. Open the **SQL editor** and run `backend/migrations/schema.sql` — this creates all tables, foreign keys, indexes, triggers, and Row-Level Security policies.
3. Note your project's **Postgres connection string** (Dashboard → Project Settings → Database).

### 2. Backend

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL + MODELSCOPE_API_KEY
go run ./cmd/server       # listens on :8080
```

For local dev without Supabase Auth, set `ALLOW_NO_AUTH=true` (seeds a demo user). The ModelScope API key is used **only on the server** — it is never exposed to the browser.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173 (proxies /v1 → :8080)
```

## API surface

| Method | Path                              | Description                       |
| ------ | --------------------------------- | --------------------------------- |
| GET    | `/v1/courses`                     | List my courses                   |
| POST   | `/v1/courses`                     | Create a course                     |
| POST   | `/v1/courses/{id}/form`           | AI-form groups (course-wide)       |
| GET    | `/v1/courses/{id}/groups`         | List groups                        |
| POST   | `/v1/courses/{id}/members`        | Enroll a member                    |
| GET    | `/v1/groups/{id}/members`         | List group members                 |
| GET    | `/v1/groups/{id}/messages`        | List chat messages               |
| POST   | `/v1/groups/{id}/messages`        | Send a chat message              |
| GET    | `/v1/groups/{id}/tasks`           | List tasks                         |
| POST   | `/v1/groups/{id}/tasks`           | Create a task                      |
| PATCH  | `/v1/groups/{id}/tasks/{taskId}`  | Update task status               |
| POST   | `/v1/groups/{id}/files`           | Upload a vault file (multipart)    |
| GET    | `/v1/groups/{id}/files`           | List vault files                   |
| POST   | `/v1/groups/{id}/summary`         | Generate AI chat summary            |
| GET    | `/v1/groups/{id}/summary`         | Get latest AI summary               |

## Design notes

- **Naming**: `snake_case` for DB columns and JSON on the wire, idiomatic camelCase/PascalCase for Go and TypeScript.
- **Group balancing**: the backend builds a prompt from students' skills, calls ModelScope, validates the result (every student placed exactly once, correct group count), and persists transactionally. On any AI error it falls back to a deterministic skill-spread round-robin — formation never hard-blocks.
- **AI summary**: triggered by a manual "Summarize chat" button; summarizes the most recent ~50 messages and stores a snapshot.
- **UI**: Apple-inspired frosted glassmorphism (`backdrop-filter` blur, semi-transparent borders), Apple System Blue accent (#0071E3), Montserrat typography, full light/dark mode with smooth transitions. Inputs and cards keep high contrast for readability.
- **Auth roles**: instructor (course owner) → can form groups; group lead → can reassign tasks; student → collaborates within their group.