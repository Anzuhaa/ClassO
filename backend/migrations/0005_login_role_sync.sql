-- ============================================================================
-- ClassO — migration: role determined at login (admin-set role, synced)
--
-- Registration always creates a student. An admin sets a user's role via
-- Supabase Auth user metadata (user_metadata.role = 'instructor'), and the
-- backend syncs that role into profiles.role on each authenticated request.
-- This redeclares handle_new_user() to honor the metadata role.
-- ============================================================================

-- Redeclare the auth trigger so new signups persist an admin-set role.
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

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Re-attach the trigger idempotently (in case it was dropped previously).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();