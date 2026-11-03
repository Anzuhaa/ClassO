# ClassO

> A collaborative workspace for university group projects — organize courses, split students into balanced groups, and work together in one place.

ClassO helps students and instructors manage the full group-project lifecycle:

- **Courses** — create a course, share a join code, and bring everyone in.
- **Smart groups** — split the roster into balanced, evenly-sized teams with a dead-simple random assignment.
- **Group workspace** — a Kanban task board, a realtime chat room (with typing indicators), and a shared file vault, all in one place.

## Features

| Area | What you get |
| --- | --- |
| 📚 Courses | Create / delete courses, shareable join codes (with expiry), member roster, lock courses to registration |
| 👥 Groups | Manual creation with capacity, random assignment, set a team lead, join requests with approve/reject |
| ✅ Tasks | Kanban board with assignees and live sync |
| 💬 Chat | Realtime messaging over SSE, typing indicators, and an instant in-room search filter |
| 📁 File vault | Upload, preview, rename, download, and share files via Supabase Storage |
| 🔐 Auth | Email/password sign-in via Supabase Auth, with instructor roles |

## Architecture

| Layer | Tech |
| --- | --- |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · Lucide · react-router-dom |
| Backend | Go (stdlib `net/http`) · pgx/v5 |
| Database | Supabase (PostgreSQL · Row-Level Security · Storage · Auth · Realtime) |

```
classo/
├── backend/
│   ├── cmd/server/main.go          # entrypoint + router
│   ├── migrations/schema.sql       # full Supabase schema + RLS
│   ├── .env.example
│   └── internal/
│       ├── config/                 # env loading
│       ├── database/               # pgx connection pool
│       ├── models/                 # domain structs
│       ├── repository/             # SQL access
│       ├── services/               # group formation logic
│       ├── handlers/               # thin HTTP handlers
│       └── middleware/             # auth, CORS, logging
└── frontend/
    └── src/
        ├── components/             # GlassCard, Button, Input, …
        ├── features/               # courses, groups, tasks, chat, vault, auth
        ├── lib/                    # api client + theme provider
        ├── styles/globals.css      # glassmorphism design system
        └── types/                  # API types
```

## Getting started

### 1. Database (Supabase)

1. Create a [Supabase](https://supabase.com) project.
2. In the **SQL editor**, run `backend/migrations/schema.sql` — this creates every table, index, trigger, and Row-Level Security policy.
3. Grab your **Postgres connection string** (Dashboard → Project Settings → Database).

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in DATABASE_URL + Supabase credentials
go run ./cmd/server         # listens on :8080
```

For local development without Supabase Auth, set `ALLOW_NO_AUTH=true` (seeds a demo user so the frontend works end-to-end).

### 3. Frontend

```bash
cd frontend
cp .env.example .env        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                 # http://localhost:5173 (proxies /v1 → :8080)
```

## API surface

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/healthz` | Health check |
| `GET` | `/v1/profiles/me` | Get the current profile |
| `PATCH` | `/v1/profiles/me` | Update the current profile |
| `POST` | `/v1/profiles/me/promote` | Self-promote to instructor |
| `POST` | `/v1/profiles/me/avatar` | Upload an avatar |
| `GET` | `/v1/courses` | List my courses |
| `POST` | `/v1/courses` | Create a course |
| `POST` | `/v1/courses/join` | Join by join code |
| `GET` | `/v1/courses/{id}` | Get a course |
| `DELETE` | `/v1/courses/{id}` | Delete a course |
| `POST` | `/v1/courses/{id}/join-code` | Regenerate the join code |
| `DELETE` | `/v1/courses/{id}/join-code` | Expire the join code |
| `POST` | `/v1/courses/{id}/random-assign` | Randomly split into groups |
| `POST` | `/v1/courses/{id}/lock` | Lock/unlock course registration |
| `GET` | `/v1/courses/{id}/groups` | List groups |
| `POST` | `/v1/courses/{id}/groups` | Create a group |
| `GET` | `/v1/courses/{id}/members` | List course members |
| `POST` | `/v1/courses/{id}/members` | Add a member |
| `DELETE` | `/v1/courses/{id}/members` | Remove a member |
| `GET` | `/v1/courses/{id}/my-group` | Get my group |
| `GET` | `/v1/courses/{id}/join-requests` | List join requests |
| `POST` | `/v1/courses/{id}/join-requests/{id}/approve` | Approve a join request |
| `POST` | `/v1/courses/{id}/join-requests/{id}/reject` | Reject a join request |
| `GET` | `/v1/groups/{id}` | Get a group |
| `PATCH` | `/v1/groups/{id}` | Rename a group |
| `DELETE` | `/v1/groups/{id}` | Delete a group |
| `GET` | `/v1/groups/{id}/members` | List group members |
| `POST` | `/v1/groups/{id}/join` | Join a group |
| `POST` | `/v1/groups/{id}/leave` | Leave a group |
| `DELETE` | `/v1/groups/{id}/members` | Remove a group member |
| `PUT` | `/v1/groups/{id}/lead` | Set the team lead |
| `GET` | `/v1/groups/{id}/messages` | List messages |
| `POST` | `/v1/groups/{id}/messages` | Send a message |
| `GET` | `/v1/groups/{id}/messages/stream` | Realtime message stream (SSE) |
| `POST` | `/v1/groups/{id}/typing` | Emit a typing indicator |
| `GET` | `/v1/groups/{id}/tasks` | List tasks |
| `POST` | `/v1/groups/{id}/tasks` | Create a task |
| `PATCH` | `/v1/groups/{id}/tasks/{taskId}` | Update task status |
| `PUT` | `/v1/groups/{id}/tasks/{taskId}/assignees` | Update task assignees |
| `POST` | `/v1/groups/{id}/files` | Upload a file |
| `GET` | `/v1/groups/{id}/files` | List files |
| `PATCH` | `/v1/groups/{id}/files/{fileId}` | Rename a file |
| `DELETE` | `/v1/groups/{id}/files/{fileId}` | Delete a file |
| `GET` | `/v1/groups/{id}/files/{fileId}/url` | Get a signed URL |
| `GET` | `/v1/groups/{id}/files/{fileId}/download` | Download a file |

## Design notes

- **Random assignment** — the roster is shuffled and dealt round-robin into `ceil(n / capacity)` groups in a single transaction, guaranteeing every student lands in exactly one group. No AI calls, nothing to go wrong.
- **Realtime chat** — messages stream to clients over Server-Sent Events; "is typing" presence is throttled to a couple of pings per active speak period.
- **UI** — an Apple-inspired frosted glassmorphism (backdrop blur, semi-transparent borders), System Blue accent (`#0071E3`), Montserrat typography, and full light/dark mode. High-contrast inputs and cards keep everything readable.
- **Roles** — instructors (course owners) form groups and manage membership; a group lead reassigns tasks; students collaborate within their group.

## License

[MIT](LICENSE)