-- ============================================================
-- Revenue Recovery Desk — Supabase schema + security (v2)
-- Onboarding is now a business-reconnaissance + Hermes-training intake.
-- The Hermes agent does invoice discovery itself, so there is no
-- invoice table here — we capture the BUSINESS, its stack, its access,
-- and its recovery SOPs.
--
-- Paste this whole file into the Supabase SQL Editor and run it.
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- Table ----------
create table if not exists public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),

  -- identity (Step 1 headline fields, denormalized for quick display)
  company            text,
  contact_name       text,
  email              text not null,
  phone              text,
  industry           text,
  size               text,
  website            text,

  -- deep sections (flexible jsonb — full scope of the business)
  business_profile   jsonb not null default '{}'::jsonb,  -- model, customers, terms, volumes, approx AR
  payment_stack      jsonb not null default '{}'::jsonb,  -- platforms, accounting, access (NO secrets)
  crm_data           jsonb not null default '{}'::jsonb,  -- CRM, data location, access (NO secrets)
  recovery_process   jsonb not null default '{}'::jsonb,  -- existing SOP, cadence, channels, tone, escalation, templates
  outreach           jsonb not null default '{}'::jsonb,  -- channels, providers, sending domain, hours, approval prefs
  guardrails         jsonb not null default '{}'::jsonb,  -- approval model, batch size, do-not-contact, compliance, max discount
  goals              jsonb not null default '{}'::jsonb,  -- primary goal, target, KPIs, cross-sell interest
  documents          jsonb not null default '[]'::jsonb,  -- [{ name, path, type, size }] -> Storage bucket
  contacts           jsonb not null default '[]'::jsonb,  -- [{ name, role, email, phone, tags[] }]

  primary_contact    text,
  catalyst           text not null,
  urgency            text not null default 'Medium',
  anything_else      text,
  consent            boolean not null default false,

  -- denormalized rollups for fast dashboard / agent filtering
  payment_platforms  text[] not null default '{}',
  crm                text,
  has_sop            boolean not null default false,
  integration_ready  boolean not null default false,        -- payment API access AND crm API access
  approx_outstanding numeric not null default 0,
  priority           text                                    -- mirrors urgency
);

-- ---------- Indexes ----------
create index if not exists submissions_created_at_idx on public.submissions (created_at desc);
create index if not exists submissions_priority_idx    on public.submissions (priority);
create index if not exists submissions_industry_idx    on public.submissions (industry);
create index if not exists submissions_ready_idx       on public.submissions (integration_ready);
create index if not exists submissions_crm_idx         on public.submissions (crm);
create index if not exists submissions_platforms_idx   on public.submissions using gin (payment_platforms);

-- ---------- Staff allowlist ----------
-- Only emails in this table may READ the book, even if email signups are open.
-- This makes the data safe by design, independent of the auth signup toggle.
create table if not exists public.staff (
  email     text primary key,
  added_at  timestamptz not null default now()
);
alter table public.staff enable row level security;
insert into public.staff (email) values ('kofi@traqd.io') on conflict do nothing;

-- security-definer membership check (bypasses staff RLS to avoid recursion)
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where s.email = (auth.jwt() ->> 'email'));
$$;

drop policy if exists "staff can read staff" on public.staff;
create policy "staff can read staff"
  on public.staff for select to authenticated using (public.is_staff());

-- ---------- Row Level Security (submissions) ----------
alter table public.submissions enable row level security;

-- Public clients may SUBMIT the form (anon + logged-in), but cannot read.
drop policy if exists "public can submit" on public.submissions;
create policy "public can submit"
  on public.submissions for insert
  to anon, authenticated
  with check (true);

-- Only allowlisted staff may READ / manage submissions.
drop policy if exists "staff can read" on public.submissions;
create policy "staff can read"
  on public.submissions for select
  to authenticated
  using (public.is_staff());

drop policy if exists "staff can update" on public.submissions;
create policy "staff can update"
  on public.submissions for update
  to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff can delete" on public.submissions;
create policy "staff can delete"
  on public.submissions for delete
  to authenticated using (public.is_staff());

-- ---------- Storage: private bucket for uploaded SOPs / templates / sample docs ----------
insert into storage.buckets (id, name, public)
values ('onboarding-docs', 'onboarding-docs', false)
on conflict (id) do nothing;

-- Clients may UPLOAD (insert) into the bucket; only staff may READ.
drop policy if exists "anon upload onboarding docs" on storage.objects;
create policy "anon upload onboarding docs"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'onboarding-docs');

drop policy if exists "staff read onboarding docs" on storage.objects;
create policy "staff read onboarding docs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'onboarding-docs' and public.is_staff());

drop policy if exists "staff delete onboarding docs" on storage.objects;
create policy "staff delete onboarding docs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'onboarding-docs' and public.is_staff());

-- ---------- Realtime (live dashboard) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
end $$;

-- ============================================================
-- Offboarding + 6-year retention + auto-delete
-- When a client leaves, offboard_submission() snapshots their record into
-- public.offboarded_clients and removes the active book entry. The snapshot
-- is retained 6 years (retain_until), then purge_expired_offboarded() deletes
-- it — run daily by pg_cron and by the harness/launchd fallback.
-- Full standalone copy: supabase/offboarding.sql
-- ============================================================
create table if not exists public.offboarded_clients (
  id                 uuid primary key,
  offboarded_at      timestamptz not null default now(),
  offboarded_by      text,
  reason             text,
  final_notes        text,
  recovered_total    numeric not null default 0,
  company            text,
  email              text,
  industry           text,
  approx_outstanding numeric not null default 0,
  snapshot           jsonb not null default '{}'::jsonb,
  retain_until       timestamptz not null default (now() + interval '6 years'),
  purged             boolean not null default false
);
create index if not exists offboarded_retain_idx     on public.offboarded_clients (retain_until);
create index if not exists offboarded_offboarded_idx on public.offboarded_clients (offboarded_at desc);
create index if not exists offboarded_company_idx    on public.offboarded_clients (company);

alter table public.offboarded_clients enable row level security;
drop policy if exists "staff read offboarded" on public.offboarded_clients;
create policy "staff read offboarded"   on public.offboarded_clients for select to authenticated using (public.is_staff());
drop policy if exists "staff insert offboarded" on public.offboarded_clients;
create policy "staff insert offboarded" on public.offboarded_clients for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update offboarded" on public.offboarded_clients;
create policy "staff update offboarded" on public.offboarded_clients for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete offboarded" on public.offboarded_clients;
create policy "staff delete offboarded" on public.offboarded_clients for delete to authenticated using (public.is_staff());

create or replace function public.offboard_submission(
  p_id uuid, p_reason text default null, p_notes text default null, p_recovered numeric default 0
) returns public.offboarded_clients
language plpgsql security definer set search_path = public as $$
declare s public.submissions%rowtype; result public.offboarded_clients%rowtype; actor text;
begin
  if not (public.is_staff() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not authorized to offboard';
  end if;
  select * into s from public.submissions where id = p_id;
  if not found then raise exception 'no submission with id %', p_id; end if;
  actor := coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'role', 'unknown');
  insert into public.offboarded_clients
    (id, offboarded_at, offboarded_by, reason, final_notes, recovered_total,
     company, email, industry, approx_outstanding, snapshot, retain_until, purged)
  values
    (s.id, now(), actor, p_reason, p_notes, coalesce(p_recovered, 0),
     s.company, s.email, s.industry, s.approx_outstanding, to_jsonb(s),
     now() + interval '6 years', false)
  on conflict (id) do update set
    offboarded_at = excluded.offboarded_at, offboarded_by = excluded.offboarded_by,
    reason = excluded.reason, final_notes = excluded.final_notes,
    recovered_total = excluded.recovered_total, company = excluded.company,
    email = excluded.email, industry = excluded.industry,
    approx_outstanding = excluded.approx_outstanding, snapshot = excluded.snapshot,
    retain_until = excluded.retain_until, purged = false
  returning * into result;
  delete from public.submissions where id = p_id;
  return result;
end; $$;

create or replace function public.purge_expired_offboarded()
returns table(id uuid, company text, offboarded_at timestamptz, retain_until timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
          or current_setting('request.jwt.claims', true) is null) then
    raise exception 'not authorized to purge';
  end if;
  return query
  delete from public.offboarded_clients oc where oc.retain_until < now()
  returning oc.id, oc.company, oc.offboarded_at, oc.retain_until;
end; $$;

revoke all on function public.offboard_submission(uuid, text, text, numeric)   from public, anon;
revoke all on function public.purge_expired_offboarded()                        from public, anon;
grant execute on function public.offboard_submission(uuid, text, text, numeric) to authenticated, service_role;
grant execute on function public.purge_expired_offboarded()                     to authenticated, service_role;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('rrd-purge-expired-offboarded', '17 3 * * *', 'select public.purge_expired_offboarded();');
exception when others then
  raise notice 'pg_cron not enabled (%) — rely on the harness/launchd purge instead', sqlerrm;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='offboarded_clients') then
    alter publication supabase_realtime add table public.offboarded_clients;
  end if;
end $$;

-- ============================================================
-- Client Dashboard: accounts, events, notifications, provision queue
-- ============================================================
create table if not exists public.client_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  email text not null,
  company text,
  must_reset boolean not null default true,
  initial_set_at timestamptz,
  last_login_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists client_accounts_submission_uniq on public.client_accounts(submission_id);
create index if not exists client_accounts_email_idx on public.client_accounts(lower(email));

create or replace function public.client_submission_id()
returns uuid language sql stable as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'submission_id', auth.jwt() ->> 'submission_id'), '')::uuid
$$;

alter table public.client_accounts enable row level security;
drop policy if exists client_accounts_staff_all on public.client_accounts;
create policy client_accounts_staff_all on public.client_accounts for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists client_accounts_self_read on public.client_accounts;
create policy client_accounts_self_read on public.client_accounts for select to authenticated using (user_id = auth.uid());

drop policy if exists submissions_client_read on public.submissions;
create policy submissions_client_read on public.submissions for select to authenticated using (id = public.client_submission_id());

create table if not exists public.recovery_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  profile text not null,
  dedupe_key text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  invoice_id text,
  invoice_number text,
  customer_name text,
  customer_email text,
  amount_usd numeric(14,2),
  currency text,
  days_overdue int,
  channel text,
  rung text,
  outcome text,
  allowed boolean,
  requires_human boolean,
  violations text[],
  payment_url text,
  recovered_usd numeric(14,2),
  agreement jsonb,
  meta jsonb not null default '{}'::jsonb,
  constraint recovery_events_dedupe_uniq unique (dedupe_key)
);
create index if not exists recovery_events_sub_time_idx on public.recovery_events(submission_id, occurred_at desc);
create index if not exists recovery_events_type_idx on public.recovery_events(submission_id, event_type, occurred_at desc);
create index if not exists recovery_events_profile_idx on public.recovery_events(profile, occurred_at desc);
alter table public.recovery_events enable row level security;
drop policy if exists recovery_events_staff_all on public.recovery_events;
create policy recovery_events_staff_all on public.recovery_events for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists recovery_events_client_read on public.recovery_events;
create policy recovery_events_client_read on public.recovery_events for select to authenticated using (submission_id = public.client_submission_id());

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  event_id bigint references public.recovery_events(id) on delete set null,
  kind text not null,
  title text not null,
  body text,
  amount_usd numeric(14,2),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_event_kind_uniq unique (submission_id, event_id, kind)
);
create index if not exists notifications_sub_unread_idx on public.notifications(submission_id, created_at desc) where read_at is null;
create index if not exists notifications_sub_time_idx on public.notifications(submission_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_staff_all on public.notifications;
create policy notifications_staff_all on public.notifications for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists notifications_client_read on public.notifications;
create policy notifications_client_read on public.notifications for select to authenticated using (submission_id = public.client_submission_id());
drop policy if exists notifications_client_mark_read on public.notifications;
create policy notifications_client_mark_read on public.notifications for update to authenticated using (submission_id = public.client_submission_id()) with check (submission_id = public.client_submission_id());
grant update (read_at) on public.notifications to authenticated;

create table if not exists public.provision_jobs (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  profile text,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts int not null default 0,
  error text,
  requested_by text,
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  finished_at timestamptz
);
create index if not exists provision_jobs_open_idx on public.provision_jobs(status, created_at) where status in ('queued','error');
alter table public.provision_jobs enable row level security;
drop policy if exists provision_jobs_staff_all on public.provision_jobs;
create policy provision_jobs_staff_all on public.provision_jobs for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into storage.buckets (id, name, public) values ('letter-templates', 'letter-templates', false) on conflict (id) do nothing;
drop policy if exists letter_templates_client_rw on storage.objects;
create policy letter_templates_client_rw on storage.objects for all to authenticated
  using (bucket_id='letter-templates' and (storage.foldername(name))[1] = public.client_submission_id()::text)
  with check (bucket_id='letter-templates' and (storage.foldername(name))[1] = public.client_submission_id()::text);
drop policy if exists letter_templates_staff_all on storage.objects;
create policy letter_templates_staff_all on storage.objects for all to authenticated using (bucket_id='letter-templates' and public.is_staff()) with check (bucket_id='letter-templates' and public.is_staff());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='recovery_events') then
    alter publication supabase_realtime add table public.recovery_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================
-- After running this:
--   1. Auth → Providers → Email: enabled, "Allow new users to sign up" OFF.
--   2. Auth → Users → Add user: create kofi@traqd.io with a password.
--   3. Paste Project URL + anon key into the CONFIG block of
--      recovery-intake.html and recovery-desk.html.
--   4. Integration secrets (Stripe/CRM keys) are NEVER entered in the form.
--      They are connected later into the client's Hermes profile .env.
-- ============================================================
