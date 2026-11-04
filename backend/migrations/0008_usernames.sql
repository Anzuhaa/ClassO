-- ============================================================================
-- ClassO — migration: unique, case-insensitive usernames on profiles
--
-- Adds a display username to profiles plus a case-insensitive unique index so
-- pre-registration availability checks (LOWER(TRIM(username))) and the DB
-- constraint agree. The column is nullable to stay backward-compatible with
-- existing rows; a user may leave their username unset until they edit their
-- profile.
-- ============================================================================

alter table public.profiles
    add column if not exists username text;

-- Backfill existing rows with a deterministic placeholder derived from the id
-- so the unique index below can be created on databases that already have rows.
update public.profiles
   set username = 'user_' || replace(id::text, '-', '')
 where username is null
    or btrim(username) = '';

-- Case-insensitive uniqueness: "Alice" and "alice" resolve to the same slot.
create unique index if not exists profiles_username_ci_unique
    on public.profiles (lower(btrim(username)));

-- Redeclare the signup trigger so the username carried in user_metadata is
-- persisted to profiles.username (NULL when the client does not send one).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text := 'student';
begin
  if coalesce(new.raw_user_meta_data->>'role', '') in ('instructor','student') then
    v_role := new.raw_user_meta_data->>'role';
  end if;

  insert into public.profiles (id, email, full_name, role, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    v_role,
    nullif(btrim(new.raw_user_meta_data->>'username'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Re-attach the trigger idempotently (in case it was dropped previously).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();