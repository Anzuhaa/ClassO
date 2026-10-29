-- ============================================================================
-- ClassO — migration: v2 schema upgrade (backward-compatible)
--
-- Applied on top of an existing v1 database. Removes the skills/tags concept
-- and AI summaries, and introduces per-group capacity plus the one-group-per-
-- course unique constraint. All changes are guarded so re-running is safe.
-- ============================================================================

-- 1. Drop the skills/tags column from profiles (Feature 1 cleanup).
alter table public.profiles
  drop column if exists skills;

-- 2. Drop the AI summaries table entirely.
drop table if exists public.ai_summaries;

-- 3. Add a nullable join-code expiry column. NULL = never expires.
alter table public.courses
  add column if not exists join_code_expires_at timestamptz;

-- 4. Add per-group capacity, backfilled from the old courses.group_size.
alter table public.groups
  add column if not exists capacity int;

update public.groups g
  set capacity = c.group_size
  from public.courses c
  where c.id = g.course_id and g.capacity is null;

alter table public.groups
  alter column capacity set default 4,
  alter column capacity set not null;

-- 5. Denormalize course_id into group_members (equals the parent group's
--    course) so the one-group-per-course rule is a simple unique constraint.
alter table public.group_members
  add column if not exists course_id uuid;

update public.group_members gm
  set course_id = g.course_id
  from public.groups g
  where g.id = gm.group_id and gm.course_id is null;

alter table public.group_members
  alter column course_id set not null;

-- De-duplicate group_members before enforcing "one group per course". Repeated
-- local random-assign/group-creation runs can leave the same user enrolled in
-- several groups of one course (each a row in group_members). Keep only one
-- membership per (course_id, user_id), preferring the oldest group (lowest
-- created_at) and, within it, the 'lead' role; drop the rest. Without this the
-- unique constraint below fails on that duplicate data.
delete from public.group_members gm
using (
  select
    course_id,
    user_id,
    min(created_at) as first_created
  from public.group_members
  group by course_id, user_id
  having count(*) > 1
) dup
where gm.course_id = dup.course_id
  and gm.user_id = dup.user_id
  and (
    gm.created_at > dup.first_created
    or (
      gm.created_at = dup.first_created
      and gm.role <> 'lead'
      and exists (
        select 1
        from public.group_members peer
        where peer.course_id = gm.course_id
          and peer.user_id = gm.user_id
          and peer.created_at = dup.first_created
          and peer.role = 'lead'
          and peer.id <> gm.id
      )
    )
  );

-- Enforce "a user belongs to at most one group per course".
alter table public.group_members
  drop constraint if exists group_members_one_group_per_course;
alter table public.group_members
  add constraint group_members_one_group_per_course unique (course_id, user_id);

-- 6. Drop the now-unused courses.group_size column (capacity moved to groups).
alter table public.courses
  drop column if exists group_size;