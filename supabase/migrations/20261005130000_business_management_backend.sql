-- Core private business workflow: formal quotes, accepted work, reservations,
-- follow-ups, invoices, payments and an append-only status history.
-- Apply only after reconciling the existing manually-applied migrations.

create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');
create type public.work_order_status as enum ('accepted', 'ready_to_build', 'in_progress', 'quality_check', 'ready_for_install', 'installation_scheduled', 'installed', 'completed', 'cancelled');
create type public.appointment_kind as enum ('survey', 'installation');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'cancelled', 'completed');
create type public.invoice_status as enum ('draft', 'sent', 'void');

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.consultation_requests(id) on delete restrict,
  quote_number text not null unique,
  version integer not null default 1 check (version > 0),
  status public.quote_status not null default 'draft',
  currency char(3) not null default 'GBP' check (currency = 'GBP'),
  subtotal_pence bigint not null check (subtotal_pence >= 0),
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  tax_pence bigint not null check (tax_pence >= 0),
  total_pence bigint generated always as (subtotal_pence + tax_pence) stored,
  scope text not null check (char_length(scope) between 1 and 12000),
  assumptions text not null default '',
  valid_until date,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, version),
  unique (id, request_id),
  check ((status = 'sent') = (sent_at is not null) or status in ('accepted', 'rejected', 'expired', 'superseded')),
  check ((status = 'accepted') = (accepted_at is not null)),
  check (tax_pence = round(subtotal_pence::numeric * tax_rate_basis_points / 10000)::bigint)
);

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.consultation_requests(id) on delete restrict,
  accepted_quote_id uuid not null unique,
  work_order_number text not null unique,
  title text not null check (char_length(title) between 2 and 160),
  status public.work_order_status not null default 'accepted',
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  planned_start date,
  target_completion date,
  actual_started_at timestamptz,
  completed_at timestamptz,
  agreed_total_pence bigint not null check (agreed_total_pence >= 0),
  actual_cost_pence bigint check (actual_cost_pence >= 0),
  staff_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (accepted_quote_id, request_id) references public.quotes(id, request_id) on delete restrict,
  check (target_completion is null or planned_start is null or target_completion >= planned_start),
  check ((status = 'completed') = (completed_at is not null))
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.consultation_requests(id) on delete restrict,
  work_order_id uuid references public.work_orders(id) on delete restrict,
  kind public.appointment_kind not null,
  status public.appointment_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  assigned_to uuid references public.profiles(id),
  location text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (work_order_id is null or kind = 'installation'),
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('scheduled', 'confirmed'))
);

create table public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.consultation_requests(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  due_at timestamptz not null,
  assigned_to uuid references public.profiles(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (completed_at is null or cancelled_at is null)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  invoice_number text not null unique,
  status public.invoice_status not null default 'draft',
  currency char(3) not null default 'GBP' check (currency = 'GBP'),
  bill_to_name text not null check (char_length(bill_to_name) between 2 and 160),
  bill_to_address text not null check (char_length(bill_to_address) between 5 and 1200),
  issue_date date not null,
  due_date date not null,
  subtotal_pence bigint not null check (subtotal_pence >= 0),
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  tax_pence bigint not null check (tax_pence >= 0),
  total_pence bigint generated always as (subtotal_pence + tax_pence) stored,
  sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date >= issue_date),
  check (status <> 'sent' or sent_at is not null),
  check (tax_pence = round(subtotal_pence::numeric * tax_rate_basis_points / 10000)::bigint)
);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  recording_key uuid not null unique default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_pence bigint not null check (amount_pence > 0),
  received_at timestamptz not null default now(),
  method text not null check (method in ('bank_transfer', 'card', 'cash', 'stripe', 'other')),
  external_payment_id text unique,
  provider_event_id text unique,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.workflow_activity (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('request', 'quote', 'work_order', 'appointment', 'availability_block', 'invoice', 'payment', 'follow_up')),
  entity_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Each staff member can enable push separately on each trusted device.
-- Subscription endpoints and encryption keys are private delivery credentials.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 9 and 3000 and endpoint ~ '^https://[^[:space:]]+$'),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth_secret text not null check (char_length(auth_secret) between 1 and 128),
  user_agent text not null default '' check (char_length(user_agent) <= 500),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index quotes_request_status_idx on public.quotes(request_id, status, version desc);
create index work_orders_status_start_idx on public.work_orders(status, planned_start);
create index appointments_active_time_idx on public.appointments(starts_at, ends_at) where status in ('scheduled', 'confirmed');
create index follow_up_tasks_due_idx on public.follow_up_tasks(due_at, assigned_to) where completed_at is null and cancelled_at is null;
create index invoices_due_idx on public.invoices(due_date, status) where status <> 'void';
create index invoice_payments_invoice_time_idx on public.invoice_payments(invoice_id, received_at);
create index workflow_activity_entity_idx on public.workflow_activity(entity_type, entity_id, created_at desc);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);

create or replace function public.validate_accepted_work_order_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  accepted_quote_status public.quote_status;
  accepted_quote_total bigint;
begin
  select status, total_pence into accepted_quote_status, accepted_quote_total
    from public.quotes where id = new.accepted_quote_id and request_id = new.request_id for key share;
  if not found or accepted_quote_status <> 'accepted' then
    raise exception 'A work order must reference an accepted quote for the same enquiry.' using errcode = '23514';
  end if;
  if accepted_quote_total <> new.agreed_total_pence then
    raise exception 'The work order agreed amount must match the accepted quote.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger work_orders_require_accepted_quote before insert or update of request_id, accepted_quote_id, agreed_total_pence
on public.work_orders for each row execute function public.validate_accepted_work_order_quote();

create or replace function public.protect_accepted_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft' and (
    new.request_id is distinct from old.request_id
    or new.quote_number is distinct from old.quote_number
    or new.version is distinct from old.version
    or new.currency is distinct from old.currency
    or new.subtotal_pence is distinct from old.subtotal_pence
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_pence is distinct from old.tax_pence
    or new.scope is distinct from old.scope
    or new.assumptions is distinct from old.assumptions
    or new.valid_until is distinct from old.valid_until
    or new.sent_at is distinct from old.sent_at
  ) then
    raise exception 'An issued quote is locked; create a new version for changed terms.' using errcode = '23514';
  end if;

  if old.status = 'accepted' and (
    new.status <> 'accepted'
    or new.accepted_at is distinct from old.accepted_at
  ) then
    raise exception 'An accepted quote is locked and cannot be changed or reopened.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quotes_lock_after_acceptance before update on public.quotes
for each row execute function public.protect_accepted_quote();

create or replace function public.protect_paid_invoice_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  already_paid bigint;
begin
  if old.status = 'draft' and new.status = 'sent' and (
    new.invoice_number is distinct from old.invoice_number
    or new.work_order_id is distinct from old.work_order_id
    or new.bill_to_name is distinct from old.bill_to_name
    or new.bill_to_address is distinct from old.bill_to_address
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.subtotal_pence is distinct from old.subtotal_pence
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_pence is distinct from old.tax_pence
  ) then
    raise exception 'Finalise invoice details before recording it as sent.' using errcode = '23514';
  end if;

  if old.status = 'void' then
    raise exception 'A void invoice is locked.' using errcode = '23514';
  end if;
  if old.status = 'sent' and (
    new.status not in ('sent', 'void')
    or new.invoice_number is distinct from old.invoice_number
    or new.work_order_id is distinct from old.work_order_id
    or new.bill_to_name is distinct from old.bill_to_name
    or new.bill_to_address is distinct from old.bill_to_address
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.sent_at is distinct from old.sent_at
    or new.subtotal_pence is distinct from old.subtotal_pence
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_pence is distinct from old.tax_pence
  ) then
    raise exception 'A sent invoice is locked; create a corrected invoice instead.' using errcode = '23514';
  end if;
  if new.status = 'void' and old.status <> 'void' then
    select coalesce(sum(amount_pence), 0) into already_paid from public.invoice_payments where invoice_id = old.id;
    if already_paid > 0 then
      raise exception 'An invoice with recorded payments cannot be voided.' using errcode = '23514';
    end if;
  elsif new.status <> 'void' and (new.subtotal_pence + new.tax_pence) is distinct from old.total_pence then
    select coalesce(sum(amount_pence), 0) into already_paid from public.invoice_payments where invoice_id = old.id;
    if new.subtotal_pence + new.tax_pence < already_paid then
      raise exception 'The invoice total cannot be reduced below the payments already recorded.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger invoices_preserve_payment_balance before update on public.invoices
for each row execute function public.protect_paid_invoice_balance();

create trigger quotes_touch_updated before update on public.quotes
for each row execute function public.touch_updated_at();
create trigger work_orders_touch_updated before update on public.work_orders
for each row execute function public.touch_updated_at();
create trigger appointments_touch_updated before update on public.appointments
for each row execute function public.touch_updated_at();
create trigger invoices_touch_updated before update on public.invoices
for each row execute function public.touch_updated_at();

create or replace function public.prevent_calendar_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('form-and-frame-calendar', 0));
  if tg_table_name = 'appointments' then
    if new.status in ('scheduled', 'confirmed') and exists (
      select 1 from public.availability_blocks b
      where b.kind in ('blocked', 'booked')
        and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'The requested appointment overlaps blocked availability.' using errcode = '23P01';
    end if;
    return new;
  end if;

  if new.kind in ('blocked', 'booked') and exists (
    select 1 from public.appointments a
    where a.status in ('scheduled', 'confirmed')
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'The availability block overlaps a reserved appointment.' using errcode = '23P01';
  end if;
  return new;
end;
$$;

create trigger appointments_prevent_blocked_time before insert or update of starts_at, ends_at, status
on public.appointments for each row execute function public.prevent_calendar_overlap();
create trigger availability_prevent_reserved_time before insert or update of starts_at, ends_at, kind
on public.availability_blocks for each row execute function public.prevent_calendar_overlap();

create or replace function public.prevent_invoice_overpayment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invoice_total bigint;
  invoice_current_status public.invoice_status;
  already_paid bigint;
begin
  select total_pence, status into invoice_total, invoice_current_status from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'A payment requires an active invoice.' using errcode = '23514';
  end if;
  if invoice_current_status <> 'sent' then
    raise exception 'A payment can only be recorded against a sent invoice.' using errcode = '23514';
  end if;
  select coalesce(sum(amount_pence), 0) into already_paid
    from public.invoice_payments where invoice_id = new.invoice_id and id <> new.id;
  if already_paid + new.amount_pence > invoice_total then
    raise exception 'The payment would exceed the outstanding invoice balance.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invoice_payments_prevent_overpayment before insert or update of invoice_id, amount_pence
on public.invoice_payments for each row execute function public.prevent_invoice_overpayment();

-- Keep the same forward-only lifecycle enforced by the mobile app at the
-- database boundary, where direct authenticated REST calls cannot bypass it.
create or replace function public.enforce_workflow_status_transition()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_transition text;
  v_allowed boolean;
  v_initial_status text;
begin
  if tg_op = 'INSERT' then
    v_initial_status := case tg_table_name
      when 'quotes' then 'draft'
      when 'work_orders' then 'accepted'
      when 'appointments' then 'scheduled'
      when 'invoices' then 'draft'
      else null
    end;
    if new.status::text is distinct from v_initial_status then
      raise exception 'A new % must start in the % state.', tg_table_name, v_initial_status using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then return new; end if;
  v_transition := old.status::text || '>' || new.status::text;

  v_allowed := case tg_table_name
    when 'quotes' then v_transition in (
      'draft>sent', 'sent>accepted', 'sent>rejected', 'sent>expired', 'sent>superseded'
    )
    when 'work_orders' then v_transition in (
      'accepted>ready_to_build', 'accepted>in_progress', 'accepted>cancelled',
      'ready_to_build>in_progress', 'ready_to_build>cancelled',
      'in_progress>quality_check', 'in_progress>cancelled',
      'quality_check>in_progress', 'quality_check>ready_for_install', 'quality_check>cancelled',
      'ready_for_install>installation_scheduled', 'ready_for_install>cancelled',
      'installation_scheduled>installed', 'installation_scheduled>cancelled',
      'installed>completed'
    )
    when 'appointments' then v_transition in (
      'scheduled>confirmed', 'scheduled>cancelled', 'scheduled>completed',
      'confirmed>cancelled', 'confirmed>completed'
    )
    when 'invoices' then v_transition in ('draft>sent', 'sent>void')
    else false
  end;

  if not coalesce(v_allowed, false) then
    raise exception 'Invalid status transition for %: %.', tg_table_name, v_transition using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quotes_validate_status before insert or update of status on public.quotes
for each row execute function public.enforce_workflow_status_transition();
create trigger work_orders_validate_status before insert or update of status on public.work_orders
for each row execute function public.enforce_workflow_status_transition();
create trigger appointments_validate_status before insert or update of status on public.appointments
for each row execute function public.enforce_workflow_status_transition();
create trigger invoices_validate_status before insert or update of status on public.invoices
for each row execute function public.enforce_workflow_status_transition();

create or replace function public.log_workflow_record_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  before_status text;
  after_status text;
  kind text;
  identifier uuid;
  changed_fields text[];
  before_record jsonb;
  after_record jsonb;
begin
  before_record := to_jsonb(old);
  after_record := to_jsonb(new);
  before_status := before_record->>'status';
  after_status := after_record->>'status';
  select array_agg(current_field.key order by current_field.key)
    into changed_fields
    from jsonb_each(after_record) as current_field(key, value)
    join jsonb_each(before_record) as previous_field(key, value) using (key)
    where current_field.value is distinct from previous_field.value
      and current_field.key not in ('updated_at');
  if coalesce(cardinality(changed_fields), 0) = 0 then return new; end if;
  kind := case tg_table_name
    when 'consultation_requests' then 'request'
    when 'work_orders' then 'work_order'
    when 'appointments' then 'appointment'
    when 'availability_blocks' then 'availability_block'
    when 'quotes' then 'quote'
    when 'invoices' then 'invoice'
    when 'follow_up_tasks' then 'follow_up'
  end;
  identifier := (after_record->>'id')::uuid;
  insert into public.workflow_activity(entity_type, entity_id, event_type, from_status, to_status, actor_id, details)
  values (
    kind,
    identifier,
    case when before_status is distinct from after_status then 'status_changed' else 'record_updated' end,
    before_status,
    after_status,
    auth.uid(),
    jsonb_build_object('changed_fields', changed_fields)
  );
  return new;
end;
$$;

create trigger request_record_updated after update on public.consultation_requests
for each row execute function public.log_workflow_record_update();
create trigger quote_record_updated after update on public.quotes
for each row execute function public.log_workflow_record_update();
create trigger work_order_record_updated after update on public.work_orders
for each row execute function public.log_workflow_record_update();
create trigger appointment_record_updated after update on public.appointments
for each row execute function public.log_workflow_record_update();
create trigger availability_block_record_updated after update on public.availability_blocks
for each row execute function public.log_workflow_record_update();
create trigger invoice_record_updated after update on public.invoices
for each row execute function public.log_workflow_record_update();
create trigger follow_up_record_updated after update on public.follow_up_tasks
for each row execute function public.log_workflow_record_update();

create or replace function public.log_workflow_record_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  kind text;
  identifier uuid;
  current_status text;
begin
  kind := case tg_table_name
    when 'consultation_requests' then 'request'
    when 'quotes' then 'quote'
    when 'work_orders' then 'work_order'
    when 'appointments' then 'appointment'
    when 'availability_blocks' then 'availability_block'
    when 'invoices' then 'invoice'
    when 'invoice_payments' then 'payment'
    when 'follow_up_tasks' then 'follow_up'
  end;
  identifier := (to_jsonb(new)->>'id')::uuid;
  current_status := to_jsonb(new)->>'status';
  insert into public.workflow_activity(entity_type, entity_id, event_type, to_status, actor_id)
  values (kind, identifier, case when tg_table_name = 'invoice_payments' then 'payment_recorded' else 'record_created' end, current_status, auth.uid());
  return new;
end;
$$;

create trigger quote_record_created after insert on public.quotes
for each row execute function public.log_workflow_record_created();
create trigger work_order_record_created after insert on public.work_orders
for each row execute function public.log_workflow_record_created();
create trigger appointment_record_created after insert on public.appointments
for each row execute function public.log_workflow_record_created();
create trigger availability_block_record_created after insert on public.availability_blocks
for each row execute function public.log_workflow_record_created();
create trigger invoice_record_created after insert on public.invoices
for each row execute function public.log_workflow_record_created();
create trigger payment_record_created after insert on public.invoice_payments
for each row execute function public.log_workflow_record_created();
create trigger follow_up_record_created after insert on public.follow_up_tasks
for each row execute function public.log_workflow_record_created();
create trigger request_record_created after insert on public.consultation_requests
for each row execute function public.log_workflow_record_created();

create or replace function public.log_availability_block_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workflow_activity(entity_type, entity_id, event_type, actor_id, details)
  values ('availability_block', old.id, 'record_deleted', auth.uid(), jsonb_build_object('changed_fields', array['deleted']));
  return old;
end;
$$;

create trigger availability_block_record_deleted after delete on public.availability_blocks
for each row execute function public.log_availability_block_deleted();

alter table public.quotes enable row level security;
alter table public.work_orders enable row level security;
alter table public.appointments enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.workflow_activity enable row level security;
alter table public.push_subscriptions enable row level security;

-- Enquiries are archived rather than deleted; service-role intake bypasses RLS.
-- Staff may still create manual requests and update their workflow fields.
drop policy if exists "staff manage requests" on public.consultation_requests;
create policy "staff read requests" on public.consultation_requests for select using (public.is_staff());
create policy "staff create requests" on public.consultation_requests for insert with check (public.is_staff());
create policy "staff update requests" on public.consultation_requests for update using (public.is_staff()) with check (public.is_staff());

-- Preserve business and financial history: staff can change state but cannot
-- hard-delete quotes, jobs, appointments, follow-ups or invoices through REST.
create policy "staff read quotes" on public.quotes for select using (public.is_staff());
create policy "staff create quotes" on public.quotes for insert with check (public.is_staff());
create policy "staff update quotes" on public.quotes for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read work orders" on public.work_orders for select using (public.is_staff());
create policy "staff create work orders" on public.work_orders for insert with check (public.is_staff());
create policy "staff update work orders" on public.work_orders for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read appointments" on public.appointments for select using (public.is_staff());
create policy "staff create appointments" on public.appointments for insert with check (public.is_staff());
create policy "staff update appointments" on public.appointments for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read follow-ups" on public.follow_up_tasks for select using (public.is_staff());
create policy "staff create follow-ups" on public.follow_up_tasks for insert with check (public.is_staff());
create policy "staff update follow-ups" on public.follow_up_tasks for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read invoices" on public.invoices for select using (public.is_staff());
create policy "staff create invoices" on public.invoices for insert with check (public.is_staff());
create policy "staff update invoices" on public.invoices for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read payments" on public.invoice_payments for select using (public.is_staff());
create policy "staff record payments" on public.invoice_payments for insert with check (public.is_staff());
create policy "staff read workflow history" on public.workflow_activity for select using (public.is_staff());
create policy "staff read own push subscriptions" on public.push_subscriptions for select using (user_id = auth.uid() and public.is_staff());
create policy "staff manage own push subscriptions" on public.push_subscriptions for all using (user_id = auth.uid() and public.is_staff()) with check (user_id = auth.uid() and public.is_staff());

create view public.invoice_balances with (security_invoker = true) as
select i.id, i.work_order_id, i.invoice_number, i.status, i.issue_date, i.due_date,
       i.currency, i.subtotal_pence, i.tax_pence, i.total_pence,
       coalesce(sum(p.amount_pence), 0)::bigint as paid_pence,
       case when i.status = 'sent' then greatest(i.total_pence - coalesce(sum(p.amount_pence), 0), 0)::bigint else 0::bigint end as outstanding_pence,
       (i.status = 'sent' and i.due_date < current_date and coalesce(sum(p.amount_pence), 0) < i.total_pence) as overdue
from public.invoices i
left join public.invoice_payments p on p.invoice_id = i.id
where i.status <> 'void'
group by i.id;

create view public.work_order_financial_summary with (security_invoker = true) as
with invoice_totals as (
  select work_order_id, sum(total_pence)::bigint as billed_pence
  from public.invoices where status = 'sent' group by work_order_id
), payment_totals as (
  select i.work_order_id, sum(p.amount_pence)::bigint as paid_pence
  from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
  where i.status = 'sent' group by i.work_order_id
)
select w.id, w.work_order_number, w.status, w.agreed_total_pence, w.actual_cost_pence,
       coalesce(i.billed_pence, 0)::bigint as billed_pence,
       coalesce(p.paid_pence, 0)::bigint as paid_pence,
       (w.actual_cost_pence is not null) as margin_is_calculable
from public.work_orders w
left join invoice_totals i on i.work_order_id = w.id
left join payment_totals p on p.work_order_id = w.id;

comment on view public.invoice_balances is 'Outstanding is derived from recorded invoice payments; quote and guide prices are not invoices.';
comment on view public.work_order_financial_summary is 'Actual margin remains unavailable until actual_cost_pence is recorded; no margin is inferred from the website guide.';

-- Keep both owners' signed-in mobile desks current when either teammate changes
-- a customer, calendar, quote, build, invoice or recorded payment.
do $$
declare
  realtime_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The supabase_realtime publication is required for live Operations updates.';
  end if;

  foreach realtime_table in array array[
    'consultation_requests', 'availability_blocks', 'profiles', 'quotes',
    'work_orders', 'appointments', 'follow_up_tasks', 'invoices',
    'invoice_payments', 'workflow_activity'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end;
$$;
