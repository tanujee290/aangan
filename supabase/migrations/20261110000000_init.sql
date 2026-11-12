-- Angan initial schema for Supabase (Postgres 15+).
-- Every business row belongs to a workspace; a workspace belongs to one Supabase Auth user.
-- Row-level security keeps each landlord's data private.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  currency text not null default 'INR',
  locale text not null default 'en-IN',
  upi_id text,
  invoice_prefix text not null default 'ANG',
  receipt_seq integer not null default 0,
  created_at timestamptz not null default now()
);

-- The signed-in user's workspace id. Security definer so RLS policies can call it cheaply.
create or replace function public.my_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.workspaces where owner_id = auth.uid()
$$;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  type text not null default 'Apartment'
    check (type in ('Apartment', 'Villa', 'House', 'Commercial', 'PG/Hostel', 'Other')),
  address text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id)
);
create index if not exists properties_workspace_idx on public.properties (workspace_id);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id(),
  property_id uuid not null,
  label text not null check (length(trim(label)) > 0),
  pass_colour text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id),
  foreign key (property_id, workspace_id) references public.properties (id, workspace_id) on delete cascade
);
create index if not exists units_workspace_idx on public.units (workspace_id);
create index if not exists units_property_idx on public.units (property_id);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone_whatsapp text,
  email text,
  upi_id text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id)
);
create index if not exists tenants_workspace_idx on public.tenants (workspace_id);

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id(),
  unit_id uuid not null,
  tenant_id uuid not null,
  rent numeric(12, 2) not null check (rent >= 0),
  deposit numeric(12, 2) not null default 0 check (deposit >= 0),
  due_day integer not null default 5 check (due_day between 1 and 28),
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (end_date is null or end_date >= start_date),
  foreign key (unit_id, workspace_id) references public.units (id, workspace_id) on delete cascade,
  foreign key (tenant_id, workspace_id) references public.tenants (id, workspace_id) on delete cascade
);
create index if not exists leases_workspace_idx on public.leases (workspace_id);
create index if not exists leases_unit_idx on public.leases (unit_id);
create index if not exists leases_tenant_idx on public.leases (tenant_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lease_id uuid not null,
  receipt_no text not null,
  verify_token text not null unique,
  amount numeric(12, 2) not null check (amount > 0),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  method text not null default 'upi' check (method in ('upi', 'bank', 'cash', 'cheque', 'card', 'other')),
  reference text,
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, receipt_no),
  foreign key (lease_id, workspace_id) references public.leases (id, workspace_id) on delete cascade
);
create index if not exists payments_workspace_idx on public.payments (workspace_id);
create index if not exists payments_lease_idx on public.payments (lease_id);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  property_id uuid,
  title text not null check (length(trim(title)) > 0),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  vendor text,
  created_at timestamptz not null default now(),
  foreign key (property_id, workspace_id) references public.properties (id, workspace_id) on delete set null (property_id)
);
create index if not exists tasks_workspace_idx on public.tasks (workspace_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  property_id uuid,
  category text not null,
  amount numeric(12, 2) not null check (amount > 0),
  spent_on date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  foreign key (property_id, workspace_id) references public.properties (id, workspace_id) on delete set null (property_id)
);
create index if not exists expenses_workspace_idx on public.expenses (workspace_id);

-- Row-level security -------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.properties enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.payments enable row level security;
alter table public.tasks enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "owner manages workspace" on public.workspaces;
create policy "owner manages workspace" on public.workspaces
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['properties', 'units', 'tenants', 'leases', 'tasks', 'expenses'] loop
    execute format('drop policy if exists "workspace members" on public.%I', t);
    execute format(
      'create policy "workspace members" on public.%I for all to authenticated
         using (workspace_id = public.my_workspace_id())
         with check (workspace_id = public.my_workspace_id())', t);
  end loop;
end $$;

-- Payments are read and deleted directly, but only created through record_payment()
-- so receipt numbers stay sequential and verification tokens are server-generated.
drop policy if exists "workspace members read payments" on public.payments;
create policy "workspace members read payments" on public.payments
  for select to authenticated using (workspace_id = public.my_workspace_id());
drop policy if exists "workspace members delete payments" on public.payments;
create policy "workspace members delete payments" on public.payments
  for delete to authenticated using (workspace_id = public.my_workspace_id());

-- Receipt numbers must not be edited from the client.
create or replace function public.protect_receipt_seq()
returns trigger language plpgsql as $$
begin
  if current_setting('angan.allow_seq', true) is distinct from 'on' then
    new.receipt_seq := old.receipt_seq;
  end if;
  new.owner_id := old.owner_id;
  return new;
end $$;
drop trigger if exists workspaces_protect_seq on public.workspaces;
create trigger workspaces_protect_seq before update on public.workspaces
  for each row execute function public.protect_receipt_seq();

-- RPC: record a payment and issue the next receipt number atomically.
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
  return r;
end $$;
revoke execute on function public.record_payment(uuid, numeric, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, text, text, text, timestamptz) to authenticated;

-- RPC: public receipt verification behind the QR code. Returns only what a receipt shows.
create or replace function public.verify_receipt(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'receipt_no', p.receipt_no,
    'amount', p.amount,
    'period', p.period,
    'method', p.method,
    'paid_at', p.paid_at,
    'tenant', t.name,
    'property', pr.name,
    'unit', u.label,
    'landlord', w.name,
    'currency', w.currency,
    'locale', w.locale
  )
  from public.payments p
  join public.leases l on l.id = p.lease_id
  join public.tenants t on t.id = l.tenant_id
  join public.units u on u.id = l.unit_id
  join public.properties pr on pr.id = u.property_id
  join public.workspaces w on w.id = p.workspace_id
  where p.verify_token = p_token and length(p_token) >= 32
$$;
grant execute on function public.verify_receipt(text) to anon, authenticated;

revoke execute on function public.my_workspace_id() from public, anon;
grant execute on function public.my_workspace_id() to authenticated;
