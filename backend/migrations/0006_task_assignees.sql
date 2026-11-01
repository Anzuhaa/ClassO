-- ============================================================================
-- ClassO — migration: multiple task assignees (task_assignees join table)
--
-- Tasks previously had a single nullable assignee_id. This introduces a
-- many-to-many task_assignees table so a task can be assigned to several
-- group members at once. The legacy tasks.assignee_id column is retained and
-- kept in sync with the first assignee for backward compatibility, but the
-- canonical list now lives in task_assignees.
-- ============================================================================

create table if not exists public.task_assignees (
  task_id   uuid not null references public.tasks(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists idx_task_assignees_user
  on public.task_assignees (user_id);

-- Backfill: move any existing single assignee_id into the join table.
insert into public.task_assignees (task_id, user_id)
select id, assignee_id
from public.tasks
where assignee_id is not null
on conflict (task_id, user_id) do nothing;

-- Enable RLS on the join table (viewers must be group members).
alter table public.task_assignees enable row level security;

drop policy if exists "task_assignees_select_member" on public.task_assignees;
create policy "task_assignees_select_member" on public.task_assignees
  for select using (
    public.is_group_member(
      (select group_id from public.tasks t where t.id = task_id)
    )
  );