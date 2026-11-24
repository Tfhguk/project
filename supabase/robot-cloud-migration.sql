-- Apply in the SAME Supabase project as roi-site, after supabase/schema.sql.
-- Browser sessions can submit jobs for their own equipment only.
-- The local bridge uses a regular owner refresh token, NOT service_role.
begin;
create table if not exists public.robot_jobs (
  id uuid primary key default gen_random_uuid(),
  robot_id uuid not null references public.equipment(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  payload jsonb not null check (jsonb_typeof(payload)='object' and payload->>'action' in
    ('STOP','MOVE_TO','DUMP','DRIVE','MANUAL_ENABLE','MANUAL_DRIVE','RESET')),
  status text not null default 'pending' check(status in ('pending','claimed','queued','done','failed','cancelled')),
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists robot_jobs_owner_state on public.robot_jobs(user_id,status,created_at);
create index if not exists robot_jobs_robot on public.robot_jobs(robot_id,created_at desc);
alter table public.robot_jobs enable row level security;
drop policy if exists robot_jobs_owner_select on public.robot_jobs;
create policy robot_jobs_owner_select on public.robot_jobs for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
drop policy if exists robot_jobs_owner_insert on public.robot_jobs;
create policy robot_jobs_owner_insert on public.robot_jobs for insert to authenticated with check (
  user_id=(select auth.uid()) and status='pending'
  and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
drop policy if exists robot_jobs_owner_update on public.robot_jobs;
create policy robot_jobs_owner_update on public.robot_jobs for update to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
) with check (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
revoke all on public.robot_jobs from public,anon,authenticated;
grant select,insert,update on public.robot_jobs to authenticated;

create table if not exists public.robot_states (
  robot_id uuid primary key references public.equipment(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  mode text not null default 'OFFLINE',
  battery_v double precision,
  pose jsonb,
  fault jsonb,
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.robot_states enable row level security;
drop policy if exists robot_states_owner_select on public.robot_states;
create policy robot_states_owner_select on public.robot_states for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
drop policy if exists robot_states_owner_insert on public.robot_states;
create policy robot_states_owner_insert on public.robot_states for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
drop policy if exists robot_states_owner_update on public.robot_states;
create policy robot_states_owner_update on public.robot_states for update to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
) with check (
  user_id=(select auth.uid()) and exists(select 1 from public.equipment e where e.id=robot_id and e.user_id=(select auth.uid()))
);
revoke all on public.robot_states from public,anon,authenticated;
grant select,insert,update on public.robot_states to authenticated;
commit;
