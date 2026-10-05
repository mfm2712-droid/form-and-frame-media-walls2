-- Queue privacy-minimal app alerts for meaningful shared-workflow changes.
-- Delivery uses the existing retry worker and requires the retry migration.

create or replace function public.claim_notification_event(p_event_id uuid)
returns table(event_id uuid, claimed boolean, current_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_status text;
  notification_claim_until timestamptz;
  notification_next_attempt timestamptz;
begin
  select delivery_status, claim_until, next_attempt_at
    into notification_status, notification_claim_until, notification_next_attempt
  from public.notification_events
  where id = p_event_id and event_type = 'workflow_update' and channel = 'push'
  for update;

  if not found then
    return query select p_event_id, false, 'missing'::text;
    return;
  end if;
  if notification_status = 'sent' or notification_status = 'not_configured'
    or (notification_claim_until is not null and notification_claim_until > now())
    or (notification_next_attempt is not null and notification_next_attempt > now()) then
    return query select p_event_id, false, notification_status;
    return;
  end if;

  update public.notification_events
  set delivery_status = 'pending',
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      claim_until = now() + interval '1 minute',
      next_attempt_at = now() + interval '1 minute' * power(2, least(attempt_count + 1, 4)),
      error = null
  where id = p_event_id
  returning delivery_status into notification_status;

  return query select p_event_id, true, notification_status;
end;
$$;

revoke all on function public.claim_notification_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_event(uuid) to service_role;
comment on function public.claim_notification_event(uuid)
  is 'Atomically claim one workflow push outbox event for delivery by a trusted server worker.';

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
  status_label text;
begin
  if tg_table_name = 'quotes' then
    if tg_op <> 'UPDATE' or new.status is not distinct from old.status then return new; end if;
    status_label := replace(new.status::text, '_', ' ');
    alert_title := 'Quote ' || initcap(status_label);
    alert_body := 'A customer quote moved to ' || status_label || '.';
    target_view := 'work';
  elsif tg_table_name = 'work_orders' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status
      and new.assigned_to is not distinct from old.assigned_to
      and new.planned_start is not distinct from old.planned_start
      and new.target_completion is not distinct from old.target_completion then return new; end if;
    status_label := replace(new.status::text, '_', ' ');
    alert_title := 'Build schedule updated';
    alert_body := case when tg_op = 'INSERT' then 'An accepted media wall is ready to plan.'
      when new.status is distinct from old.status then 'A build moved to ' || status_label || '.'
      else 'A build assignment or target date changed.' end;
    target_view := 'work';
  elsif tg_table_name = 'appointments' then
    if tg_op = 'UPDATE' and new.status is not distinct from old.status
      and new.starts_at is not distinct from old.starts_at
      and new.ends_at is not distinct from old.ends_at then return new; end if;
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
    alert_title := case when new.status = 'sent' then 'Invoice sent' else 'Invoice voided' end;
    alert_body := case when new.status = 'sent' then 'An invoice is now awaiting payment.' else 'An invoice was marked void.' end;
    target_view := 'money';
  elsif tg_table_name = 'invoice_payments' then
    alert_title := 'Payment recorded';
    alert_body := 'A customer payment was added to the accounts.';
    target_view := 'money';
  else
    return new;
  end if;

  insert into public.notification_events (request_id, channel, event_type, payload, delivery_status, next_attempt_at)
  values (
    null,
    'push',
    'workflow_update',
    jsonb_build_object(
      'title', left(alert_title, 80),
      'body', left(alert_body, 180),
      'view', target_view,
      'exclude_user_id', auth.uid()
    ),
    'pending',
    now()
  );
  return new;
end;
$$;

revoke all on function public.queue_workflow_push_notification() from public, anon, authenticated;

create trigger quote_queue_push after update of status on public.quotes
for each row execute function public.queue_workflow_push_notification();
create trigger work_order_queue_push after insert or update of status, assigned_to, planned_start, target_completion on public.work_orders
for each row execute function public.queue_workflow_push_notification();
create trigger appointment_queue_push after insert or update of status, starts_at, ends_at on public.appointments
for each row execute function public.queue_workflow_push_notification();
create trigger invoice_queue_push after insert or update of status on public.invoices
for each row execute function public.queue_workflow_push_notification();
create trigger payment_queue_push after insert on public.invoice_payments
for each row execute function public.queue_workflow_push_notification();

create index if not exists notification_events_workflow_retry_idx
  on public.notification_events (next_attempt_at, created_at)
  where event_type = 'workflow_update' and channel = 'push' and delivery_status in ('pending', 'failed');
