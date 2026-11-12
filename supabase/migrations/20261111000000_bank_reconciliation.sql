-- Angan: bank statement reconciliation (rest of milestone 13).
-- Statement lines are uploaded from a bank CSV, then matched to receipts (credits)
-- or expenses (debits), or set aside. Safe to re-run.

-- Composite keys so a statement line can only point at rows in its own workspace.
do $$ begin
  alter table public.payments add constraint payments_id_workspace_key unique (id, workspace_id);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_id_workspace_key unique (id, workspace_id);
exception when duplicate_object or duplicate_table then null; end $$;

create table if not exists public.bank_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_workspace_id() references public.workspaces (id) on delete cascade,
  statement text not null default 'Statement',
  txn_date date not null,
  description text not null default '',
  reference text,
  -- Credits (money in) are positive, debits (money out) are negative.
  amount numeric(12, 2) not null check (amount <> 0),
  -- Stable hash of the line so uploading the same statement twice adds nothing new.
  fingerprint text not null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  payment_id uuid,
  expense_id uuid,
  matched_by text check (matched_by in ('auto', 'manual', 'ai')),
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, fingerprint),
  foreign key (payment_id, workspace_id) references public.payments (id, workspace_id) on delete set null (payment_id),
  foreign key (expense_id, workspace_id) references public.expenses (id, workspace_id) on delete set null (expense_id)
);
create index if not exists bank_lines_workspace_idx on public.bank_lines (workspace_id, txn_date desc);
create unique index if not exists bank_lines_payment_once on public.bank_lines (payment_id) where payment_id is not null;
create unique index if not exists bank_lines_expense_once on public.bank_lines (expense_id) where expense_id is not null;

-- Keep status consistent with links: deleting a receipt or expense puts its line back in the queue.
create or replace function public.bank_line_status()
returns trigger language plpgsql as $$
begin
  if new.payment_id is not null or new.expense_id is not null then
    new.status := 'matched';
    new.matched_at := coalesce(new.matched_at, now());
  elsif new.status = 'matched' then
    new.status := 'unmatched';
    new.matched_by := null;
    new.matched_at := null;
  end if;
  if new.status = 'unmatched' then
    new.matched_by := null;
    new.matched_at := null;
  end if;
  return new;
end $$;
drop trigger if exists bank_lines_status on public.bank_lines;
create trigger bank_lines_status before insert or update on public.bank_lines
  for each row execute function public.bank_line_status();

alter table public.bank_lines enable row level security;
drop policy if exists "team reads" on public.bank_lines;
drop policy if exists "team inserts" on public.bank_lines;
drop policy if exists "team updates" on public.bank_lines;
drop policy if exists "team deletes" on public.bank_lines;
create policy "team reads" on public.bank_lines for select to authenticated
  using (workspace_id = public.my_workspace_id());
create policy "team inserts" on public.bank_lines for insert to authenticated
  with check (workspace_id = public.my_workspace_id() and public.can_write());
create policy "team updates" on public.bank_lines for update to authenticated
  using (workspace_id = public.my_workspace_id() and public.can_write())
  with check (workspace_id = public.my_workspace_id() and public.can_write());
create policy "team deletes" on public.bank_lines for delete to authenticated
  using (workspace_id = public.my_workspace_id() and public.can_write());

-- Only matches are worth an audit entry; bulk imports would flood the log.
create or replace function public.audit_bank_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status = 'matched' then
    insert into public.audit_events (workspace_id, actor, actor_email, entity, entity_id, action, summary)
    values (new.workspace_id, auth.uid(), auth.jwt() ->> 'email', 'bank_lines', new.id, 'reconcile',
      left(new.txn_date::text || ' · ' || new.amount::text || ' · ' || new.description, 140));
  end if;
  return null;
end $$;
drop trigger if exists audit_bank_lines on public.bank_lines;
create trigger audit_bank_lines after update on public.bank_lines
  for each row execute function public.audit_bank_match();
