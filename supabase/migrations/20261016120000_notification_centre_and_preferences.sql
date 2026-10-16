-- Notification centre, per-owner preferences and enquiry-aware workflow alerts.
-- Extends the existing notification_events outbox, retry worker and
-- push_subscriptions. Additive only: no existing data is changed or removed.
-- Requires 20261008120000_workflow_push_notifications.sql.

-- 1. Per-user category preferences. A missing row means every category is on.
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  new_enquiries boolean not null default true,
  quotations boolean not null default true,
  acceptances boolean not null default true,
  appointments boolean not null default true,
  jobs boolean not null default true,
  invoices_payments boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 2. Per-user read state for outbox events (the in-app notification centre).
create table if not exists public.notification_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.notification_events(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists notification_reads_event_idx on public.notification_reads(event_id);

alter table public.notification_preferences enable row level security;
alter table public.notification_reads enable row level security;

drop policy if exists "staff read own notification preferences" on public.notification_preferences;
drop policy if exists "staff write own notification preferences" on public.notification_preferences;
drop policy if exists "staff read own notification reads" on public.notification_reads;
drop policy if exists "staff write own notification reads" on public.notification_reads;

create policy "staff read own notification preferences" on public.notification_preferences
  for select using (user_id = auth.uid() and public.is_staff());
create policy "staff write own notification preferences" on public.notification_preferences
  for all using (user_id = auth.uid() and public.is_staff())
  with check (user_id = auth.uid() and public.is_staff());
create policy "staff read own notification reads" on public.notification_reads
  for select using (user_id = auth.uid() and public.is_staff());
create policy "staff write own notification reads" on public.notification_reads
  for all using (user_id = auth.uid() and public.is_staff())
  with check (user_id = auth.uid() and public.is_staff());

revoke all on public.notification_preferences, public.notification_reads from anon;
grant select, insert, update, delete on public.notification_preferences, public.notification_reads to authenticated;

create or replace function public.touch_notification_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch before update on public.notification_preferences
for each row execute function public.touch_notification_preferences();

-- 3. Workflow alerts now carry the enquiry id and a category so a tap lands in
-- the right command centre and each owner's preferences can be honoured.
-- Text stays privacy-minimal: enquiry reference only, never contact or money.
create or replace function public.queue_workflow_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_title text;
  alert_body text;
  target_view text := 'today';
  alert_category text;
  target_request uuid;
  enquiry_reference text;
  status_label text;
begin
  if tg_table_name = 'quotes' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
    if new.status = 'superseded' then return new; end if;
    target_request := new.request_id;
    status_label := replace(new.status::text, '_', ' ');
    if new.status = 'accepted' then
      alert_category := 'acceptances';
      alert_title := 'Customer accepted';
      alert_body := 'The customer accepted the quotation.';
    else
      alert_category := 'quotations';
      alert_title := case when tg_op = 'INSERT' and new.status = 'draft' then 'Quotation prepared'
        when new.status = 'sent' then 'Quotation sent'
        else 'Quotation ' || status_label end;
      alert_body := case when tg_op = 'INSERT' and new.status = 'draft' then 'A quotation draft is ready to review.'
        when new.status = 'sent' then 'A quotation was recorded as sent.'
        else 'A quotation moved to ' || status_label || '.' end;
    end if;
    target_view := 'work';
  elsif tg_table_name = 'work_orders' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status
      and new.assigned_to is not distinct from old.assigned_to
      and new.planned_start is not distinct from old.planned_start
      and new.target_completion is not distinct from old.target_completion then return new; end if;
    target_request := new.request_id;
    alert_category := 'jobs';
    status_label := replace(new.status::text, '_', ' ');
    alert_title := 'Job updated';
    alert_body := case when tg_op = 'INSERT' then 'An accepted media wall is ready to plan.'
      when new.status is distinct from old.status then 'The job moved to ' || status_label || '.'
      else 'A job assignment or target date changed.' end;
    target_view := 'work';
  elsif tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status
      and new.starts_at is not distinct from old.starts_at
      and new.ends_at is not distinct from old.ends_at then return new; end if;
    target_request := new.request_id;
    alert_category := 'appointments';
    alert_title := case when new.status = 'cancelled' then 'Visit cancelled'
      when tg_op = 'INSERT' then 'Visit booked' else 'Visit updated' end;
    alert_body := initcap(new.kind::text) || ' appointment ' || case
      when new.status = 'cancelled' then 'was cancelled.'
      when tg_op = 'INSERT' then 'was added to the calendar.'
      else 'details changed.' end;
    target_view := 'calendar';
  elsif tg_table_name = 'invoices' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
    if new.status not in ('sent', 'void') then return new; end if;
    select request_id into target_request from public.work_orders where id = new.work_order_id;
    alert_category := 'invoices_payments';
    alert_title := case when new.status = 'sent' then 'Invoice sent' else 'Invoice voided' end;
    alert_body := case when new.status = 'sent' then 'An invoice is now awaiting payment.' else 'An invoice was marked void.' end;
    target_view := 'money';
  elsif tg_table_name = 'invoice_payments' then
    select w.request_id into target_request
    from public.invoices i join public.work_orders w on w.id = i.work_order_id
    where i.id = new.invoice_id;
    alert_category := 'invoices_payments';
    alert_title := 'Payment recorded';
    alert_body := 'A customer payment was added to the accounts.';
    target_view := 'money';
  else
    return new;
  end if;

  if target_request is not null then
    select reference into enquiry_reference from public.consultation_requests where id = target_request;
    if enquiry_reference is not null then alert_body := left(enquiry_reference || ' · ' || alert_body, 180); end if;
  end if;

  -- Suppress an identical alert raised moments ago (double-click, trigger fan-out).
  if exists (
    select 1 from public.notification_events
    where event_type = 'workflow_update' and channel = 'push'
      and created_at > now() - interval '30 seconds'
      and payload->>'title' = left(alert_title, 80)
      and payload->>'body' = left(alert_body, 180)
      and coalesce(payload->>'request_id', '') = coalesce(target_request::text, '')
  ) then return new; end if;

  insert into public.notification_events (request_id, channel, event_type, payload, delivery_status, next_attempt_at)
  values (
    null,
    'push',
    'workflow_update',
    jsonb_strip_nulls(jsonb_build_object(
      'title', left(alert_title, 80),
      'body', left(alert_body, 180),
      'view', target_view,
      'category', alert_category,
      'request_id', target_request,
      'exclude_user_id', auth.uid()
    )),
    'pending',
    now()
  );
  return new;
end;
$$;

revoke all on function public.queue_workflow_push_notification() from public, anon, authenticated;

-- "Quotation prepared" needs the insert event as well as status changes.
drop trigger if exists quote_queue_push on public.quotes;
create trigger quote_queue_push after insert or update of status on public.quotes
for each row execute function public.queue_workflow_push_notification();
