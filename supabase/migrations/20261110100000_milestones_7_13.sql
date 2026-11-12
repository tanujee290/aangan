-- Angan milestones 7–13: teams & roles, reminders, invoices, utilities, deposits,
-- documents, audit log, archive and the tenant portal.
-- Safe to re-run: every object uses "if not exists" / "or replace" / "drop ... if exists".

-- ---------------------------------------------------------------- teams (M12)

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  role text not null default 'viewer' check (role in ('manager', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists members_user_idx on public.members (user_id);

-- The caller's workspace: the one they own, otherwise the first one they were invited to.
create or replace function public.my_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.workspaces where owner_id = auth.uid()),
    (select workspace_id from public.members where user_id = auth.uid() order by created_at limit 1)
  )
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.workspaces where owner_id = auth.uid()) then 'owner'
    else (select role from public.members where user_id = auth.uid() order by created_at limit 1)
  end
$$;

create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'manager'), false)
$$;

revoke execute on function public.my_workspace_id() from public, anon;
revoke execute on function public.my_role() from public, anon;
revoke execute on function public.can_write() from public, anon;
grant execute on function public.my_workspace_id() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.can_write() to authenticated;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  email text,
  role text not null default 'manager' check (role in ('manager', 'viewer')),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid
);

-- ------------------------------------------------------- workspace settings

alter table public.workspaces add column if not exists invoice_seq integer not null default 0;
alter table public.workspaces add column if not exists remind_before_days integer not null default 3;
alter table public.workspaces add column if not exists grace_days integer not null default 3;
alter table public.workspaces add column if not exists late_fee_type text not null default 'none';
alter table public.workspaces add column if not exists late_fee_value numeric(12, 2) not null default 0;
do $$ begin
  alter table public.workspaces add constraint workspaces_remind_chk check (remind_before_days between 0 and 15);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.workspaces add constraint workspaces_grace_chk check (grace_days between 0 and 31);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.workspaces add constraint workspaces_latefee_chk check (late_fee_type in ('none', 'flat', 'percent') and late_fee_value >= 0);
exception when duplicate_object then null; end $$;

create or replace function public.protect_receipt_seq()
returns trigger language plpgsql as $$
begin
  if current_setting('angan.allow_seq', true) is distinct from 'on' then
    new.receipt_seq := old.receipt_seq;
    new.invoice_seq := old.invoice_seq;
  end if;
  new.owner_id := old.owner_id;
  return new;
end $$;

alter table public.properties add column if not exists cover_path text;
alter table public.tenants add column if not exists portal_token text unique;
alter table public.tasks add column if not exists tenant_id uuid;
alter table public.tasks add column if not exists details text;
alter table public.tasks add column if not exists source text not null default 'landlord';
do $$ begin
  alter table public.tasks add constraint tasks_source_chk check (source in ('landlord', 'tenant'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_tenant_fk foreign key (tenant_id, workspace_id)
    references public.tenants (id, workspace_id) on delete set null (tenant_id);
exception when duplicate_object then null; end $$;

-- ------------------------------------------- invoices, utilities, deposits (M8)

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id(),
  lease_id uuid not null,
  invoice_no text not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  due_date date not null,
  rent numeric(12, 2) not null default 0,
  utilities numeric(12, 2) not null default 0,
  late_fee numeric(12, 2) not null default 0 check (late_fee >= 0),
  other numeric(12, 2) not null default 0,
  carried_forward numeric(12, 2) not null default 0,
  total numeric(12, 2) generated always as (rent + utilities + late_fee + other + carried_forward) stored,
  status text not null default 'open' check (status in ('open', 'void')),
  note text,
  created_at timestamptz not null default now(),
  unique (lease_id, period),
  unique (workspace_id, invoice_no),
  foreign key (lease_id, workspace_id) references public.leases (id, workspace_id) on delete cascade
);
create index if not exists invoices_workspace_idx on public.invoices (workspace_id, period);

create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id(),
  unit_id uuid not null,
  kind text not null check (kind in ('electric', 'water')),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  previous numeric(12, 2) not null check (previous >= 0),
  current numeric(12, 2) not null,
  rate numeric(12, 4) not null check (rate >= 0),
  amount numeric(12, 2) generated always as (round((current - previous) * rate, 2)) stored,
  created_at timestamptz not null default now(),
  check (current >= previous),
  unique (unit_id, kind, period),
  foreign key (unit_id, workspace_id) references public.units (id, workspace_id) on delete cascade
);
create index if not exists meter_workspace_idx on public.meter_readings (workspace_id, period);

create table if not exists public.deposit_txns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id(),
  lease_id uuid not null,
  type text not null check (type in ('received', 'deduction', 'refund')),
  amount numeric(12, 2) not null check (amount > 0),
  txn_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  foreign key (lease_id, workspace_id) references public.leases (id, workspace_id) on delete cascade
);
create index if not exists deposit_workspace_idx on public.deposit_txns (workspace_id);

-- ------------------------------------------------------------ documents (M9)

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  property_id uuid,
  tenant_id uuid,
  kind text not null default 'other' check (kind in ('lease', 'id', 'inspection', 'invoice', 'photo', 'other')),
  name text not null check (length(trim(name)) > 0),
  path text not null unique,
  size bigint,
  mime text,
  created_at timestamptz not null default now(),
  foreign key (property_id, workspace_id) references public.properties (id, workspace_id) on delete set null (property_id),
  foreign key (tenant_id, workspace_id) references public.tenants (id, workspace_id) on delete set null (tenant_id)
);
create index if not exists documents_workspace_idx on public.documents (workspace_id);

-- ------------------------------------------------------------ reminders (M7)

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lease_id uuid not null,
  period text not null,
  kind text not null check (kind in ('upcoming', 'due', 'overdue')),
  for_date date not null,
  amount numeric(12, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  acted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lease_id, period, for_date),
  foreign key (lease_id, workspace_id) references public.leases (id, workspace_id) on delete cascade
);
create index if not exists reminders_workspace_idx on public.reminders (workspace_id, for_date);

-- --------------------------------------------------------------- audit (M10)

create table if not exists public.audit_events (
  id bigserial primary key,
  workspace_id uuid not null,
  actor uuid,
  actor_email text,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text,
  at timestamptz not null default now()
);
create index if not exists audit_workspace_idx on public.audit_events (workspace_id, at desc);

create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  o jsonb;
  ws uuid;
  act text := lower(tg_op);
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ws := coalesce((r ->> 'workspace_id')::uuid, case when tg_table_name = 'workspaces' then (r ->> 'id')::uuid end);
  if ws is null then return null; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if (o - 'receipt_seq' - 'invoice_seq') = (r - 'receipt_seq' - 'invoice_seq') then return null; end if;
    if (o ->> 'archived_at') is null and (r ->> 'archived_at') is not null then act := 'archive';
    elsif (o ->> 'archived_at') is not null and (r ->> 'archived_at') is null then act := 'restore';
    end if;
  end if;
  insert into public.audit_events (workspace_id, actor, actor_email, entity, entity_id, action, summary)
  values (
    ws, auth.uid(), auth.jwt() ->> 'email', tg_table_name, nullif(r ->> 'id', '')::uuid, act,
    left(coalesce(r ->> 'name', r ->> 'label', r ->> 'title', r ->> 'receipt_no', r ->> 'invoice_no', r ->> 'email',
      r ->> 'category', r ->> 'type', r ->> 'kind'), 140)
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['workspaces', 'properties', 'units', 'tenants', 'leases', 'payments', 'tasks', 'expenses',
    'invoices', 'meter_readings', 'deposit_txns', 'documents', 'members'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
      for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ------------------------------------------------------- row-level security

alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.invoices enable row level security;
alter table public.meter_readings enable row level security;
alter table public.deposit_txns enable row level security;
alter table public.documents enable row level security;
alter table public.reminders enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "owner manages workspace" on public.workspaces;
drop policy if exists "members read workspace" on public.workspaces;
drop policy if exists "owner creates workspace" on public.workspaces;
drop policy if exists "owner updates workspace" on public.workspaces;
drop policy if exists "owner deletes workspace" on public.workspaces;
create policy "members read workspace" on public.workspaces for select to authenticated
  using (owner_id = auth.uid() or id = public.my_workspace_id());
create policy "owner creates workspace" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "owner updates workspace" on public.workspaces for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes workspace" on public.workspaces for delete to authenticated
  using (owner_id = auth.uid());

-- Everyone in the workspace reads; owners and managers write; viewers are read-only.
do $$
declare t text;
begin
  foreach t in array array['properties', 'units', 'tenants', 'leases', 'tasks', 'expenses',
    'meter_readings', 'deposit_txns', 'documents', 'reminders'] loop
    execute format('drop policy if exists "workspace members" on public.%I', t);
    execute format('drop policy if exists "team reads" on public.%I', t);
    execute format('drop policy if exists "team inserts" on public.%I', t);
    execute format('drop policy if exists "team updates" on public.%I', t);
    execute format('drop policy if exists "team deletes" on public.%I', t);
    execute format('create policy "team reads" on public.%I for select to authenticated
      using (workspace_id = public.my_workspace_id())', t);
    execute format('create policy "team inserts" on public.%I for insert to authenticated
      with check (workspace_id = public.my_workspace_id() and public.can_write())', t);
    execute format('create policy "team updates" on public.%I for update to authenticated
      using (workspace_id = public.my_workspace_id() and public.can_write())
      with check (workspace_id = public.my_workspace_id() and public.can_write())', t);
    execute format('create policy "team deletes" on public.%I for delete to authenticated
      using (workspace_id = public.my_workspace_id() and public.can_write())', t);
  end loop;
end $$;

-- Invoices are created only by generate_invoices() so numbering stays sequential.
drop policy if exists "team reads" on public.invoices;
drop policy if exists "team updates" on public.invoices;
drop policy if exists "team deletes" on public.invoices;
create policy "team reads" on public.invoices for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "team updates" on public.invoices for update to authenticated
  using (workspace_id = public.my_workspace_id() and public.can_write())
  with check (workspace_id = public.my_workspace_id() and public.can_write());
create policy "team deletes" on public.invoices for delete to authenticated
  using (workspace_id = public.my_workspace_id() and public.can_write());

drop policy if exists "workspace members delete payments" on public.payments;
create policy "workspace members delete payments" on public.payments for delete to authenticated
  using (workspace_id = public.my_workspace_id() and public.can_write());

drop policy if exists "team reads audit" on public.audit_events;
create policy "team reads audit" on public.audit_events for select to authenticated
  using (workspace_id = public.my_workspace_id());

drop policy if exists "team reads members" on public.members;
drop policy if exists "owner updates members" on public.members;
drop policy if exists "owner or self removes member" on public.members;
create policy "team reads members" on public.members for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "owner updates members" on public.members for update to authenticated
  using (workspace_id in (select id from public.workspaces where owner_id = auth.uid()))
  with check (workspace_id in (select id from public.workspaces where owner_id = auth.uid()));
create policy "owner or self removes member" on public.members for delete to authenticated
  using (user_id = auth.uid() or workspace_id in (select id from public.workspaces where owner_id = auth.uid()));

drop policy if exists "owner manages invites" on public.invites;
create policy "owner manages invites" on public.invites for all to authenticated
  using (workspace_id in (select id from public.workspaces where owner_id = auth.uid()))
  with check (workspace_id in (select id from public.workspaces where owner_id = auth.uid()));

-- ----------------------------------------------------------------- RPCs

create or replace function public.record_payment(
  p_lease_id uuid,
  p_amount numeric,
  p_period text,
  p_method text default 'upi',
  p_reference text default null,
  p_note text default null,
  p_paid_at timestamptz default now()
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  l public.leases;
  ws public.workspaces;
  r public.payments;
begin
  if not public.can_write() then
    raise exception 'Your role can view this workspace but not record payments';
  end if;
  select * into l from public.leases where id = p_lease_id and workspace_id = public.my_workspace_id();
  if not found then
    raise exception 'Lease not found';
  end if;
  perform set_config('angan.allow_seq', 'on', true);
  update public.workspaces set receipt_seq = receipt_seq + 1
    where id = l.workspace_id returning * into ws;
  perform set_config('angan.allow_seq', 'off', true);
  insert into public.payments (workspace_id, lease_id, receipt_no, verify_token, amount, period, method, reference, note, paid_at)
  values (
    l.workspace_id, l.id,
    ws.invoice_prefix || '-' || lpad(ws.receipt_seq::text, 5, '0'),
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    p_amount, p_period, coalesce(p_method, 'upi'), nullif(trim(p_reference), ''), nullif(trim(p_note), ''),
    coalesce(p_paid_at, now())
  ) returning * into r;
  -- Clear today's pending reminder for this lease when the period is fully paid.
  delete from public.reminders rem
  where rem.lease_id = l.id
    and rem.period = p_period
    and rem.for_date = (now() at time zone 'Asia/Kolkata')::date
    and coalesce(rem.status, 'pending') = 'pending'
    and (
      select coalesce(
        (select total from public.invoices where lease_id = l.id and period = p_period and status = 'open'),
        l.rent
      ) - coalesce((select sum(amount) from public.payments where lease_id = l.id and period = p_period), 0)
    ) <= 0;
  return r;
end $$;
revoke execute on function public.record_payment(uuid, numeric, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, text, text, timestamptz) to authenticated;

-- Creates (or refreshes) the month's invoice for every lease active in the period:
-- rent + metered utilities + any unpaid balance carried forward from last month.
create or replace function public.generate_invoices(p_period text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  ws public.workspaces;
  l public.leases;
  n integer := 0;
  v_start date;
  v_end date;
  v_prev text;
  v_prev_total numeric;
  v_prev_paid numeric;
  v_util numeric;
  v_cf numeric;
begin
  if not public.can_write() then raise exception 'Not allowed'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid period'; end if;
  select * into ws from public.workspaces where id = public.my_workspace_id();
  if not found then raise exception 'No workspace'; end if;
  v_start := (p_period || '-01')::date;
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  v_prev := to_char(v_start - interval '1 month', 'YYYY-MM');

  for l in
    select * from public.leases
    where workspace_id = ws.id and start_date <= v_end
      and (end_date is null or end_date >= v_start)
      and (status = 'active' or end_date >= v_start)
  loop
    select coalesce(sum(amount), 0) into v_util from public.meter_readings
      where unit_id = l.unit_id and period = p_period;
    v_prev_total := null;
    select total into v_prev_total from public.invoices
      where lease_id = l.id and period = v_prev and status = 'open';
    v_cf := 0;
    if v_prev_total is not null then
      select coalesce(sum(amount), 0) into v_prev_paid from public.payments
        where lease_id = l.id and period = v_prev;
      v_cf := v_prev_total - v_prev_paid;
    end if;

    if exists (select 1 from public.invoices where lease_id = l.id and period = p_period) then
      update public.invoices set utilities = v_util, carried_forward = v_cf
        where lease_id = l.id and period = p_period and status = 'open';
    else
      perform set_config('angan.allow_seq', 'on', true);
      update public.workspaces set invoice_seq = invoice_seq + 1 where id = ws.id returning * into ws;
      perform set_config('angan.allow_seq', 'off', true);
      insert into public.invoices (workspace_id, lease_id, invoice_no, period, due_date, rent, utilities, carried_forward)
      values (
        ws.id, l.id, ws.invoice_prefix || '-INV-' || lpad(ws.invoice_seq::text, 5, '0'), p_period,
        (p_period || '-' || lpad(l.due_day::text, 2, '0'))::date, l.rent, v_util, v_cf
      );
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.generate_invoices(text) from public, anon;
grant execute on function public.generate_invoices(text) to authenticated;

-- Adds the workspace's late fee to open invoices still unpaid after the grace period.
create or replace function public.apply_late_fees(p_today date, p_workspace uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  ws public.workspaces;
  n integer;
begin
  select * into ws from public.workspaces where id = p_workspace;
  if not found or ws.late_fee_type = 'none' or ws.late_fee_value <= 0 then return 0; end if;
  update public.invoices i set late_fee = case
      when ws.late_fee_type = 'flat' then ws.late_fee_value
      else round(i.rent * ws.late_fee_value / 100, 2) end
  where i.workspace_id = ws.id and i.status = 'open' and i.late_fee = 0
    and i.due_date + ws.grace_days < p_today
    and i.total > (select coalesce(sum(p.amount), 0) from public.payments p
                   where p.lease_id = i.lease_id and p.period = i.period);
  get diagnostics n = row_count;
  return n;
end $$;

-- Builds the day's reminder list: every active lease with money owing from
-- (due date − remind_before_days) onwards. One row per lease per day.
create or replace function public.generate_reminders(p_today date, p_workspace uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  w public.workspaces;
  v_period text := to_char(p_today, 'YYYY-MM');
  total_n integer := 0;
  n integer;
begin
  for w in select * from public.workspaces where p_workspace is null or id = p_workspace loop
    perform public.apply_late_fees(p_today, w.id);
    insert into public.reminders (workspace_id, lease_id, period, kind, for_date, amount)
    select w.id, l.id, v_period,
      case when p_today < d.due then 'upcoming' when p_today = d.due then 'due' else 'overdue' end,
      p_today, o.owed - pp.paid
    from public.leases l
    cross join lateral (select (v_period || '-' || lpad(l.due_day::text, 2, '0'))::date as due) d
    left join public.invoices i on i.lease_id = l.id and i.period = v_period and i.status = 'open'
    cross join lateral (select coalesce(i.total, l.rent) as owed) o
    cross join lateral (
      select coalesce(sum(p.amount), 0) as paid from public.payments p
      where p.lease_id = l.id and p.period = v_period
    ) pp
    where l.workspace_id = w.id and l.status = 'active' and l.start_date <= p_today
      and (l.end_date is null or l.end_date >= date_trunc('month', p_today)::date)
      and p_today >= d.due - w.remind_before_days
      and o.owed - pp.paid > 0
    on conflict (lease_id, period, for_date) do update set amount = excluded.amount, kind = excluded.kind;
    get diagnostics n = row_count;
    total_n := total_n + n;
    -- Remove today's pending drafts that are no longer owed (e.g. after a payment).
    delete from public.reminders r
    where r.workspace_id = w.id
      and r.for_date = p_today
      and r.period = v_period
      and coalesce(r.status, 'pending') = 'pending'
      and not exists (
        select 1 from public.leases l
        cross join lateral (select (v_period || '-' || lpad(l.due_day::text, 2, '0'))::date as due) d
        left join public.invoices i on i.lease_id = l.id and i.period = v_period and i.status = 'open'
        cross join lateral (select coalesce(i.total, l.rent) as owed) o
        cross join lateral (
          select coalesce(sum(p.amount), 0) as paid from public.payments p
          where p.lease_id = l.id and p.period = v_period
        ) pp
        where l.id = r.lease_id and l.workspace_id = w.id and l.status = 'active'
          and l.start_date <= p_today
          and (l.end_date is null or l.end_date >= date_trunc('month', p_today)::date)
          and p_today >= d.due - w.remind_before_days
          and o.owed - pp.paid > 0
      );
  end loop;
  return total_n;
end $$;
revoke execute on function public.apply_late_fees(date, uuid) from public, anon, authenticated;
revoke execute on function public.generate_reminders(date, uuid) from public, anon, authenticated;

-- Lets the app build today's list on open, in the landlord's own time zone.
create or replace function public.my_reminders(p_today date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare ws uuid := public.my_workspace_id();
begin
  if ws is null then return 0; end if;
  if p_today not between current_date - 1 and current_date + 1 then p_today := current_date; end if;
  return public.generate_reminders(p_today, ws);
end $$;
revoke execute on function public.my_reminders(date) from public, anon;
grant execute on function public.my_reminders(date) to authenticated;

-- Daily schedule inside Supabase when pg_cron is available (06:00 IST).
-- The Netlify scheduled function "daily-reminders" does the same job as a fallback.
do $outer$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('angan-daily-reminders', '30 0 * * *',
      $job$select public.generate_reminders((now() at time zone 'Asia/Kolkata')::date)$job$);
  exception when others then
    raise notice 'pg_cron not available, relying on the Netlify scheduled function: %', sqlerrm;
  end;
end $outer$;

-- Team invites ------------------------------------------------------------

create or replace function public.invite_info(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('workspace', w.name, 'role', i.role, 'email', i.email,
    'valid', i.accepted_at is null and i.expires_at > now())
  from public.invites i join public.workspaces w on w.id = i.workspace_id
  where i.token = p_token and length(p_token) >= 32
$$;
grant execute on function public.invite_info(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into i from public.invites where token = p_token for update;
  if not found or i.accepted_at is not null or i.expires_at < now() then
    raise exception 'This invite link is invalid or has expired';
  end if;
  if exists (select 1 from public.workspaces where owner_id = auth.uid()) then
    raise exception 'This account already has its own workspace. Sign in with a different email to join as a team member.';
  end if;
  if i.email is not null and lower(i.email) <> v_email then
    raise exception 'This invite was sent to a different email address';
  end if;
  insert into public.members (workspace_id, user_id, email, role)
  values (i.workspace_id, auth.uid(), nullif(v_email, ''), i.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.workspace_id;
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- Tenant portal (M11) -------------------------------------------------------

create or replace function public.set_tenant_portal(p_tenant uuid, p_enabled boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not public.can_write() then raise exception 'Not allowed'; end if;
  if p_enabled then
    update public.tenants
      set portal_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
      where id = p_tenant and workspace_id = public.my_workspace_id()
      returning portal_token into v_token;
  else
    update public.tenants set portal_token = null
      where id = p_tenant and workspace_id = public.my_workspace_id();
  end if;
  return v_token;
end $$;
revoke execute on function public.set_tenant_portal(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_portal(uuid, boolean) to authenticated;

create or replace function public.tenant_portal(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tenant', json_build_object('name', t.name),
    'landlord', json_build_object('name', w.name, 'upi_id', w.upi_id, 'currency', w.currency, 'locale', w.locale),
    'leases', (
      select coalesce(json_agg(json_build_object(
        'id', l.id, 'property', pr.name, 'unit', u.label, 'pass_colour', u.pass_colour, 'rent', l.rent,
        'deposit', l.deposit, 'due_day', l.due_day, 'start_date', l.start_date, 'end_date', l.end_date,
        'status', l.status) order by l.start_date desc), '[]'::json)
      from public.leases l join public.units u on u.id = l.unit_id join public.properties pr on pr.id = u.property_id
      where l.tenant_id = t.id),
    'invoices', (
      select coalesce(json_agg(json_build_object(
        'invoice_no', i.invoice_no, 'lease_id', i.lease_id, 'period', i.period, 'due_date', i.due_date,
        'rent', i.rent, 'utilities', i.utilities, 'late_fee', i.late_fee, 'other', i.other,
        'carried_forward', i.carried_forward, 'total', i.total) order by i.period desc), '[]'::json)
      from public.invoices i join public.leases l on l.id = i.lease_id
      where l.tenant_id = t.id and i.status = 'open'),
    'payments', (
      select coalesce(json_agg(x order by x.paid_at desc), '[]'::json) from (
        select p.receipt_no, p.amount, p.period, p.method, p.paid_at, p.verify_token, p.lease_id
        from public.payments p join public.leases l on l.id = p.lease_id
        where l.tenant_id = t.id order by p.paid_at desc limit 36) x),
    'requests', (
      select coalesce(json_agg(x order by x.created_at desc), '[]'::json) from (
        select k.title, k.details, k.status, k.created_at from public.tasks k
        where k.tenant_id = t.id and k.source = 'tenant' order by k.created_at desc limit 20) x)
  )
  from public.tenants t join public.workspaces w on w.id = t.workspace_id
  where t.portal_token = p_token and length(p_token) >= 32 and t.archived_at is null
$$;
grant execute on function public.tenant_portal(text) to anon, authenticated;

create or replace function public.tenant_raise_request(p_token text, p_title text, p_details text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.tenants;
  v_property uuid;
begin
  select * into t from public.tenants where portal_token = p_token and length(p_token) >= 32 and archived_at is null;
  if not found then raise exception 'Portal link not found'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Please describe the issue'; end if;
  if (select count(*) from public.tasks where tenant_id = t.id and source = 'tenant' and status <> 'done') >= 10 then
    raise exception 'You have 10 open requests already. Please wait for some to be resolved.';
  end if;
  select u.property_id into v_property from public.leases l join public.units u on u.id = l.unit_id
    where l.tenant_id = t.id and l.status = 'active' order by l.start_date desc limit 1;
  insert into public.tasks (workspace_id, property_id, tenant_id, title, details, priority, status, source)
  values (t.workspace_id, v_property, t.id, left(trim(p_title), 140), left(nullif(trim(p_details), ''), 2000), 'medium', 'open', 'tenant');
end $$;
grant execute on function public.tenant_raise_request(text, text, text) to anon, authenticated;

-- Storage for documents and property photos (M9) ---------------------------
-- Files live under "<workspace_id>/..." in a private bucket.
do $outer$
begin
  insert into storage.buckets (id, name, public) values ('angan', 'angan', false) on conflict (id) do nothing;
  drop policy if exists "angan team reads files" on storage.objects;
  drop policy if exists "angan team uploads files" on storage.objects;
  drop policy if exists "angan team updates files" on storage.objects;
  drop policy if exists "angan team deletes files" on storage.objects;
  create policy "angan team reads files" on storage.objects for select to authenticated
    using (bucket_id = 'angan' and (storage.foldername(name))[1] = public.my_workspace_id()::text);
  create policy "angan team uploads files" on storage.objects for insert to authenticated
    with check (bucket_id = 'angan' and (storage.foldername(name))[1] = public.my_workspace_id()::text and public.can_write());
  create policy "angan team updates files" on storage.objects for update to authenticated
    using (bucket_id = 'angan' and (storage.foldername(name))[1] = public.my_workspace_id()::text and public.can_write());
  create policy "angan team deletes files" on storage.objects for delete to authenticated
    using (bucket_id = 'angan' and (storage.foldername(name))[1] = public.my_workspace_id()::text and public.can_write());
exception when others then
  raise notice 'Storage setup skipped (create the private "angan" bucket in the Supabase dashboard): %', sqlerrm;
end $outer$;
