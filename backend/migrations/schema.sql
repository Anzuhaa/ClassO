-- ============================================================================
-- ClassO — Supabase/PostgreSQL schema
-- Tables, foreign keys, indexes, triggers, and Row-Level Security (RLS).
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Notation: all column names are snake_case per project rules.
-- ============================================================================

-- Enable the pgcrypto extension for gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- PROFILES — mirrors Supabase Auth users so we can attach domain data
-- (skills, name) and enforce FKs to auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text not null unique,
  avatar_url text,
  skills     text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-populate a profile whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- COURSES — a course ("matkul") defines the grouping contract.
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  group_size int  not null check (group_size > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- COURSE_MEMBERS — enrollment with role (instructor | student).
-- ---------------------------------------------------------------------------
create table if not exists public.course_members (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'student' check (role in ('instructor','student')),
  created_at timestamptz not null default now(),
  unique (course_id, user_id)
);

-- ---------------------------------------------------------------------------
-- GROUPS — a group belongs to exactly one course.
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GROUP_MEMBERS — membership with role (lead | member).
-- ---------------------------------------------------------------------------
create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('lead','member')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- MESSAGES — group chat discussion room.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);

-- Rapid chat-scroll queries.
create index if not exists idx_messages_group_created
  on public.messages (group_id, created_at desc);

-- ---------------------------------------------------------------------------
-- FILES — file vault repository per group (bytes live in Supabase Storage).
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  uploader_id  uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  storage_path text not null,
  size         bigint not null default 0,
  mime_type    text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_files_group_created
  on public.files (group_id, created_at desc);

-- ---------------------------------------------------------------------------
-- TASKS — kanban task board with status and assignee.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  title       text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  status      text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date    timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tasks_group_status
  on public.tasks (group_id, status);

-- ---------------------------------------------------------------------------
-- AI_SUMMARIES — snapshots of AI-generated chat summaries.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_summaries (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups(id) on delete cascade,
  from_message_id uuid references public.messages(id) on delete set null,
  summary         text not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trigger to refresh updated_at automatically.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_courses_updated on public.courses;
create trigger trg_courses_updated
  before update on public.courses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_groups_updated on public.groups;
create trigger trg_groups_updated
  before update on public.groups
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- The database enforces that users can only see/act on data in their own
-- courses and groups, regardless of what the client requests.
-- ============================================================================

-- Helper: is the current user a member of the given group?
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

-- Helper: is the current user a member of the course that owns a group?
create or replace function public.is_course_member_of_group(gid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.groups g
    join public.course_members cm on cm.course_id = g.course_id
    where g.id = gid and cm.user_id = auth.uid()
  );
$$;

alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.course_members enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.messages       enable row level security;
alter table public.files          enable row level security;
alter table public.tasks          enable row level security;
alter table public.ai_summaries   enable row level security;

-- ---- PROFILES -----------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_select_course_peers" on public.profiles
  for select using (
    exists (
      select 1 from public.course_members cm
      join public.course_members me on me.course_id = cm.course_id
      where cm.user_id = profiles.id and me.user_id = auth.uid()
    )
  );
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- ---- COURSES ------------------------------------------------------------
create policy "courses_select_member" on public.courses
  for select using (
    owner_id = auth.uid() or exists (
      select 1 from public.course_members cm
      where cm.course_id = courses.id and cm.user_id = auth.uid()
    )
  );
create policy "courses_insert_owner" on public.courses
  for insert with check (owner_id = auth.uid());
create policy "courses_update_owner" on public.courses
  for update using (owner_id = auth.uid());
create policy "courses_delete_owner" on public.courses
  for delete using (owner_id = auth.uid());

-- ---- COURSE_MEMBERS -----------------------------------------------------
create policy "cm_select_member" on public.course_members
  for select using (
    user_id = auth.uid() or exists (
      select 1 from public.courses c
      where c.id = course_id and c.owner_id = auth.uid()
    )
  );
create policy "cm_insert_owner" on public.course_members
  for insert with check (
    exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid())
  );

-- ---- GROUPS -------------------------------------------------------------
create policy "groups_select_member" on public.groups
  for select using (
    exists (
      select 1 from public.course_members cm
      where cm.course_id = groups.course_id and cm.user_id = auth.uid()
    )
  );
create policy "groups_insert_owner" on public.groups
  for insert with check (
    exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid())
  );

-- ---- GROUP_MEMBERS ------------------------------------------------------
create policy "gm_select_member" on public.group_members
  for select using (
    public.is_group_member(group_id) or public.is_course_member_of_group(group_id)
  );

-- ---- MESSAGES -----------------------------------------------------------
create policy "messages_select_member" on public.messages
  for select using (public.is_group_member(group_id));
create policy "messages_insert_member" on public.messages
  for insert with check (public.is_group_member(group_id) and sender_id = auth.uid());

-- ---- FILES --------------------------------------------------------------
create policy "files_select_member" on public.files
  for select using (public.is_group_member(group_id));
create policy "files_insert_member" on public.files
  for insert with check (public.is_group_member(group_id) and uploader_id = auth.uid());

-- ---- TASKS --------------------------------------------------------------
create policy "tasks_select_member" on public.tasks
  for select using (public.is_group_member(group_id));
create policy "tasks_insert_member" on public.tasks
  for insert with check (public.is_group_member(group_id));
create policy "tasks_update_member" on public.tasks
  for update using (public.is_group_member(group_id));
create policy "tasks_delete_lead" on public.tasks
  for delete using (
    exists (
      select 1 from public.group_members
      where group_id = tasks.group_id and user_id = auth.uid() and role = 'lead'
    )
  );

-- ---- AI_SUMMARIES -------------------------------------------------------
create policy "summaries_select_member" on public.ai_summaries
  for select using (public.is_group_member(group_id));
create policy "summaries_insert_member" on public.ai_summaries
  for insert with check (public.is_group_member(group_id));

-- ============================================================================
-- Realtime: enable so the chat room receives live message inserts.
-- ============================================================================
alter publication supabase_realtime add table public.messages;