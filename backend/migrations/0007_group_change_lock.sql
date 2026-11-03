-- 0007_group_change_lock.sql
-- Instructor-controlled lock on group membership, plus an instructor-approval
-- queue for group changes requested by students while the course is locked.

-- A locked course forbids students from joining, switching, or leaving groups
-- directly; any such change becomes a pending request the instructor approves
-- or rejects. Defaults to false so existing courses behave as before.
alter table public.courses
    add column if not exists locked boolean not null default false;

-- One request per (course, user), representing "this student wants to move to
-- <group_id>" (or, when group_id is null, to simply leave their current group).
-- Status is 'pending' -> 'approved' | 'rejected'.
create table if not exists public.group_join_requests (
    id          uuid primary key default gen_random_uuid(),
    course_id   uuid not null references public.courses(id) on delete cascade,
    group_id    uuid references public.groups(id) on delete cascade,
    user_id     uuid not null references public.profiles(id) on delete cascade,
    status      text not null default 'pending' check (status in ('pending','approved','rejected')),
    created_at  timestamptz not null default now(),
    resolved_at timestamptz,
    unique (course_id, user_id)
);

alter table public.group_join_requests enable row level security;