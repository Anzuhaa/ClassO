# ClassO Comprehensive Refactor Plan

## Confirmed decisions (from user)
- **Auth**: Supabase Auth via `@supabase/supabase-js` on the frontend (email/password). Backend verifies the Supabase JWT server-side.
- **Files**: Supabase Storage (upload + `createSignedUrl` for preview/download).
- **Task sync**: frontend polling every 4s.
- **Routing**: `react-router-dom` with real URL paths.
- Constraint: all files < 300 lines; ADHERE to existing Go/TS conventions; remove AI (DeepSeek/ModelScope) entirely.

---

## Part A — Backend (Go)

### A1. Remove AI / skills / summaries
- Delete `internal/services/ai_client.go`, `ai_group.go`, `ai_summary.go`, `summary_service.go`.
- Delete `internal/repository/message_repository.go`'s `ListRecentMessagesForSummary`, `CreateAISummary`, `GetLatestSummary`.
- Delete `models.AISummary`, `models.Profile.Skills` (and every SQL scan/column referencing `skills`).
- Remove `Form`, `RandomAssign` AI path → keep deterministic Random Assign only.

### A2. Schema (rewrite `migrations/schema.sql`, add new migrations)
1. **Drop** `skills text[]` from `profiles`.
2. **Drop** `ai_summaries` table.
3. **Drop** `group_size` from `courses` (capacity now per-group).
4. **Add** `groups.capacity int not null default 1 check (capacity > 0)`.
5. **Add** `courses.join_code_expires_at timestamptz` (nullable; null = active).
6. **Add** `UNIQUE (course_id, user_id)` on `group_members` (partial index / enforcement) — enforce one-group-per-course at DB level with a unique index on `(course_id, user_id)` via group join (see below).
7. Keep `unique (group_id, user_id)` (no duplicate in same group).
8. Update RLS to reflect dropped AI/skills.

> One-group-per-course enforcement: add a `UNIQUE` index on `group_members(course_id, user_id)` derived through `groups`. Simplest robust approach: add a `course_id` column to `group_members` (populated from parent group) with `UNIQUE (course_id, user_id)`. This is a small denormalization that makes the DB constraint exact and trivial, vs a partial unique index which Postgres cannot express easily.

### A3. Models (`internal/models/models.go`)
- Remove `Skills`, `AISummary`; add `Group.Capacity`, `Course.JoinCodeExpiresAt`.
- Add auth-oriented fields as needed.

### A4. Repository changes
- `course_repository.go`: add `DeleteCourse`, `RegenerateJoinCode`, `GetCourseByJoinCode` (respect expiry), `RemoveCourseMember`, `SetJoinCodeExpiry`.
- `group_repository.go`: add `CreateGroup` (manual, capacity), `DeleteGroup`, `RemoveGroupMember`, `LeaveGroup`, `GetGroup` (return capacity), enforce one-group-per-course + capacity in a transaction.
- `profile_repository.go`: remove skills columns; add `CreateProfileByEmail`, `GetProfileByEmail` (auth lookup).
- `file_repository.go`: store Supabase storage path; add `GetFile` (already there).
- Remove AI/summary methods.

### A5. Services
- Delete AI services. Keep `formation_service.go` → rename/rewrite as deterministic-only `RandomAssign` with strict one-group-one-user + capacity.
- Add `auth_service.go` / `token.go` (JWT HS256 verify using `SUPABASE_JWT_SECRET`).

### A6. Handlers
- `course_handler.go`: delete `Form`; add `Delete`, `RegenerateJoinCode`; keep `RandomAssign`, `JoinByCode`, `Members`.
- `group_handler.go`: remove `Summarize`, `LatestSummary`; add `DeleteGroup`, `RemoveMember`, `LeaveGroup`, `CreateGroup` (manual with capacity), keep messages/tasks.
- `profile_handler.go`: replace demo switcher with email/password register/login handlers.
- `auth_handler.go` (new): register, login, me, logout.
- `file_handler.go`: switch upload to Supabase Storage; add `GET .../files/{id}/url` (signed URL) and download.

### A7. Middleware
- Rewrite `auth.go`: verify Supabase JWT (HS256 via `SUPABASE_JWT_SECRET`), set user id in context. Keep optional `ALLOW_NO_AUTH` dev fallback. Remove `X-User-Id` header reliance.

### A8. Config
- Add `SUPABASE_JWT_SECRET`; drop ModelScope fields. Keep DB URL + storage credentials.

### A9. Router (`cmd/server/main.go`)
- Update routes for new endpoints; remove AI routes.

---

## Part B — Frontend (React + TypeScript)

### B1. Dependencies
- Add `@supabase/supabase-js`, `react-router-dom`.
- Remove nothing else (lucide/react/tailwind stay).

### B2. lib
- `lib/supabase.ts` (new): supabase client singleton with anon key + URL from env (`VITE_SUPABASE_*`).
- `lib/api.ts`: attach `Authorization: Bearer <token>` from localStorage; add new API methods; drop AI/summary/profile-switcher methods.

### B3. Auth
- New `features/auth/` — `AuthScreen.tsx` (login/register form), `useAuth.ts` hook. Persist token + user to localStorage. No email confirmation (Supabase auto-confirm).
- Replace `ProfileSwitcher` with a user menu (logout) in the sidebar.

### B4. Routing
- `App.tsx` → use `react-router-dom`:
  - `/` → redirect to `/courses`
  - `/courses` → `CourseList`
  - `/courses/:id` → `CourseDetail`
  - `/courses/:id/groups/:groupId` → `GroupWorkspace`
- `CourseList`/`CourseDetail` emit navigation via `useNavigate`.

### B5. Feature UI changes
- `CourseList.tsx`: add Paste-from-clipboard button (`navigator.clipboard.readText()`); add Delete Course (confirm modal).
- `CourseDetail.tsx`: remove AI button; add manual group creation (multiple empty groups + capacity), Regenerate join code, Delete Group, Remove Member (course/group), Leave Group.
- `GroupWorkspace.tsx`: keep tabs; wire task polling 4s (already polls messages/files).
- `ChatRoom.tsx`: remove summarize; add "Search messages" filter input filtering locally in real time.
- `TaskBoard.tsx`: ensure 4s polling (live sync).
- `FileVault.tsx`: add preview modal (image/PDF/text via signed URL) + download trigger.

### B6. Types (`types/index.ts`)
- Remove `skills`, `AISummary`; add `Capacity`, join-code expiry; add auth types.

---

## Part C — Migrations & Build

- Rewrite `schema.sql`; add new incremental migrations for clean upgrade of existing DB (backward-compatible: nullable new columns with defaults, backfill join_code expiry, drop skills/AI tables safely).
- Verify `go build ./...` and `npm run build` pass with zero errors.
- Keep all files < 300 lines.

---

## Key correctness guarantees
1. **One group per course per user**: `group_members.course_id` + `UNIQUE (course_id, user_id)` + transaction validation in `JoinGroup`/`RandomAssign`.
2. **Random assignment dedup**: shuffle roster, deal round-robin into `ceil(n/capacity)` groups, single INSERT transaction, assert each user once.
3. **UI join validation**: `myGroup` already returns active group; new UI shows "You are in Group X" + disables others.
4. **Auth**: no email confirmation (`shouldCreateUser` with auto-confirm / supabase default off).