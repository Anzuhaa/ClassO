-- ============================================================================
-- ClassO — migration: allow demo/dev profiles without an auth.users row
--
-- The original schema gave profiles.id a hard FK to auth.users(id), which is
-- correct for production. But for local development with ALLOW_NO_AUTH=true
-- (no Supabase Auth), the backend seeds a synthetic demo user id that has no
-- corresponding auth.users row, so every INSERT into profiles fails with a
-- foreign-key violation (SQLSTATE 23503).
--
-- This migration drops that FK so profiles.id is a plain uuid. Real signups
-- are unaffected: the handle_new_user() trigger still populates profiles from
-- auth.users events with the exact auth user id.
-- ============================================================================

alter table public.profiles
  drop constraint if exists profiles_id_fkey;