-- Revenue Recovery Desk canonical foundation tables.
-- Additive migration: does not drop or replace supabase/schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text,
  company text,
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions(id) on delete set null,
  profile_name text not null,
  company_name text not null,
  primary_contact_name text,
  primary_contact_email text,
  status text not null default 'submitted' check (status in ('submitted','provisioning','awaiting_client','readiness_blocked','ready','live','paused','offboarding','offboarded')),
  timezone text not null default 'UTC',
  go_live_at timestamptz,
  paused_at timestamptz,
  offboarded_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_profile_name_uniq on public.clients (lower(profile_name));
create unique index if not exists clients_submission_id_uniq on public.clients (submission_id) where submission_id is not null;
create index if not exists clients_status_idx on public.clients (status, updated_at desc);

create table if not exists public.client_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  approval_required boolean not null default true,
  authorized_channels text[] not null default '{}',
  business_hours jsonb not null default '{}'::jsonb,
  tone_rules jsonb not null default '{}'::jsonb,
  recovery_rules jsonb not null default '{}'::jsonb,
  do_not_contact_rules jsonb not null default '{}'::jsonb,
  discount_limits jsonb not null default '{}'::jsonb,
  escalation_rules jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_settings_one_per_client unique (client_id)
);

create table if not exists public.client_integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  category text not null check (category in ('payment','accounting','crm','email','sms','mail','other')),
  status text not null default 'needed' check (status in ('needed','link_sent','authorized','installed','failed','revoked')),
  external_account_id text,
  health_status text,
  last_probe_at timestamptz,
  last_error text,
  config jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_integrations_client_provider_category_uniq unique (client_id, provider, category)
);
create index if not exists client_integrations_client_status_idx on public.client_integrations (client_id, status);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  integration_id uuid references public.client_integrations(id) on delete set null,
  external_invoice_id text not null,
  invoice_number text,
  customer_ref text,
  customer_name text,
  customer_email text,
  currency text not null default 'USD',
  amount_due numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  due_date date,
  issued_date date,
  status text not null default 'open' check (status in ('open','overdue','in_recovery','payment_promised','paid','disputed','do_not_contact','escalated','written_off')),
  payment_url text,
  last_synced_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_client_external_uniq unique (client_id, external_invoice_id)
);
create index if not exists invoices_client_status_due_idx on public.invoices (client_id, status, due_date);
create index if not exists invoices_customer_email_idx on public.invoices (client_id, lower(customer_email));

create table if not exists public.recovery_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  customer_ref text,
  status text not null default 'new' check (status in ('new','drafting','awaiting_approval','scheduled','sent','replied','payment_promised','paid','blocked','escalated','closed')),
  stage text not null default 'preflight' check (stage in ('preflight','friendly_reminder','follow_up','firm_notice','pre_escalation','final_notice','handback')),
  next_action_at timestamptz,
  last_contact_at timestamptz,
  closed_at timestamptz,
  block_reason text,
  escalation_reason text,
  summary text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_threads_invoice_uniq unique (client_id, invoice_id)
);
create index if not exists recovery_threads_client_status_idx on public.recovery_threads (client_id, status, next_action_at);

create table if not exists public.recovery_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid references public.recovery_threads(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  idempotency_key text not null,
  stage text not null check (stage in ('preflight','friendly_reminder','follow_up','firm_notice','pre_escalation','final_notice','handback')),
  channel text not null check (channel in ('email','sms','letter','phone','portal','internal')),
  status text not null default 'drafted' check (status in ('drafted','queued_for_approval','approved','rejected','scheduled','sent','blocked','cancelled','failed')),
  subject text,
  body text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  gate_decision jsonb,
  provider_result jsonb,
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_actions_idempotency_uniq unique (client_id, idempotency_key),
  constraint recovery_actions_invoice_stage_channel_uniq unique (client_id, invoice_id, stage, channel)
);
create index if not exists recovery_actions_dispatch_idx on public.recovery_actions (status, scheduled_for) where status in ('approved','scheduled');
create index if not exists recovery_actions_thread_idx on public.recovery_actions (thread_id, created_at desc);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action_id uuid references public.recovery_actions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','edited')),
  requested_by text,
  decided_by text,
  decision_note text,
  edited_subject text,
  edited_body text,
  expires_at timestamptz,
  decided_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_one_open_action_uniq unique (action_id)
);
create index if not exists approval_requests_client_status_idx on public.approval_requests (client_id, status, created_at desc);

create table if not exists public.customer_replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid references public.recovery_threads(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  provider text,
  external_message_id text,
  from_address text,
  received_at timestamptz not null default now(),
  classification text not null default 'unknown' check (classification in ('paid','promise_to_pay','dispute','hardship','stop_contact','wrong_person','needs_invoice_copy','question','angry','positive','unknown')),
  body text,
  triage_summary text,
  requires_human boolean not null default true,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_replies_external_uniq unique (client_id, provider, external_message_id)
);
create index if not exists customer_replies_client_class_idx on public.customer_replies (client_id, classification, received_at desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  integration_id uuid references public.client_integrations(id) on delete set null,
  external_payment_id text not null,
  amount numeric(14,2) not null,
  currency text not null default 'USD',
  paid_at timestamptz not null,
  status text not null default 'succeeded' check (status in ('pending','succeeded','failed','refunded','disputed')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payments_client_external_uniq unique (client_id, external_payment_id)
);
create index if not exists payments_client_paid_idx on public.payments (client_id, paid_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  report_type text not null default 'weekly' check (report_type in ('daily','weekly','monthly','ad_hoc')),
  period_start date not null,
  period_end date not null,
  status text not null default 'drafted' check (status in ('drafted','approved','sent','failed')),
  recovered_amount numeric(14,2) not null default 0,
  outstanding_amount numeric(14,2) not null default 0,
  blocked_amount numeric(14,2) not null default 0,
  body text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_client_period_uniq unique (client_id, report_type, period_start, period_end)
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  job_name text not null,
  agent_name text,
  idempotency_key text not null,
  status text not null default 'started' check (status in ('started','succeeded','failed','skipped','blocked')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  constraint agent_runs_idempotency_uniq unique (job_name, idempotency_key)
);
create index if not exists agent_runs_client_started_idx on public.agent_runs (client_id, started_at desc);
create index if not exists agent_runs_status_idx on public.agent_runs (status, started_at desc);

create table if not exists public.job_locks (
  lock_key text primary key,
  client_id uuid references public.clients(id) on delete cascade,
  owner text not null,
  locked_until timestamptz not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists job_locks_client_idx on public.job_locks (client_id, locked_until);
create index if not exists job_locks_expiry_idx on public.job_locks (locked_until);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  actor_type text not null check (actor_type in ('system','agent','operator','client','customer','provider')),
  actor_id text,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  idempotency_key text,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_idempotency_uniq unique (client_id, idempotency_key)
);
create index if not exists audit_events_client_created_idx on public.audit_events (client_id, created_at desc);
create index if not exists audit_events_type_idx on public.audit_events (event_type, created_at desc);

alter table public.submissions enable row level security;
alter table public.clients enable row level security;
alter table public.client_settings enable row level security;
alter table public.client_integrations enable row level security;
alter table public.invoices enable row level security;
alter table public.recovery_threads enable row level security;
alter table public.recovery_actions enable row level security;
alter table public.approval_requests enable row level security;
alter table public.customer_replies enable row level security;
alter table public.payments enable row level security;
alter table public.reports enable row level security;
alter table public.agent_runs enable row level security;
alter table public.job_locks enable row level security;
alter table public.audit_events enable row level security;

-- Staff/service-role policy names are table-specific to keep this migration idempotent.
do $$
declare t text;
begin
  foreach t in array array[
    'submissions','clients','client_settings','client_integrations','invoices','recovery_threads','recovery_actions',
    'approval_requests','customer_replies','payments','reports','agent_runs','job_locks','audit_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_staff_all', t);
  end loop;
end $$;
