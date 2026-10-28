-- ============================================================================
-- ClassO — migration: course join codes + profile roles
--
-- Feature 2 ("Course Join Code & Member Roster") needs a short, human-friendly
-- unique code on each course so students can join without an instructor
-- manually enrolling them. Feature 1 ("Profiles & Fast Demo Switcher") needs a
-- role column on profiles so the UI can distinguish instructors from students
-- at a glance, independent of any particular course enrollment.
-- ============================================================================

-- join_code: 6-character upper-case alphanumeric, unique per course.
-- Existing rows are backfilled with a random code so the column can be NOT NULL.
alter table public.courses
  add column if not exists join_code text;

-- Backfill any pre-existing rows with a unique random 6-char code.
update public.courses
  set join_code = upper(substr(md5(id::text || random()::text), 1, 6))
  where join_code is null or join_code = '';

-- Now enforce NOT NULL and uniqueness.
alter table public.courses
  alter column join_code set not null;

-- Idempotent unique constraint (drop+add, since ADD CONSTRAINT has no IF NOT EXISTS).
alter table public.courses
  drop constraint if exists courses_join_code_unique;
alter table public.courses
  add constraint courses_join_code_unique unique (join_code);

-- role: "instructor" or "student" (demo profile switcher).
alter table public.profiles
  add column if not exists role text not null default 'student'
  check (role in ('instructor', 'student'));