-- Make new-enquiry email and push delivery idempotent across client retries.
-- This migration assumes the base operations schema and enquiry hardening
-- migration have been reconciled and tracked before it is applied.

alter table public.notification_events
  add column if not exists claim_until timestamptz,
  add column if not exists next_attempt_at timestamptz default now();

update public.notification_events
set next_attempt_at = now()
where delivery_status in ('pending', 'failed') and next_attempt_at is null;

create unique index if not exists notification_events_new_enquiry_channel_idx
  on public.notification_events (request_id, channel)
  where request_id is not null and event_type = 'new_enquiry';

create or replace function public.claim_new_enquiry_notification(
  p_request_id uuid,
  p_channel text,
  p_payload jsonb,
  p_enabled boolean
)
returns table(event_id uuid, claimed boolean, current_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
  notification_status text;
  notification_claim_until timestamptz;
begin
  if p_channel not in ('email', 'push') then
    raise exception 'Unsupported enquiry notification channel.' using errcode = '22023';
  end if;

  insert into public.notification_events (request_id, channel, event_type, payload, delivery_status)
  values (p_request_id, p_channel, 'new_enquiry', coalesce(p_payload, '{}'::jsonb), 'pending')
  on conflict do nothing;

  select id, delivery_status, claim_until into notification_id, notification_status, notification_claim_until
  from public.notification_events
  where request_id = p_request_id and channel = p_channel and event_type = 'new_enquiry'
  for update;

  if not found then
    raise exception 'The enquiry notification event could not be created.' using errcode = 'P0001';
  end if;

  if not p_enabled then
    if notification_status <> 'sent'
      and (notification_claim_until is null or notification_claim_until <= now()) then
      update public.notification_events
      set delivery_status = 'not_configured',
          claim_until = null,
          next_attempt_at = null,
          error = 'Notification delivery is not configured.'
      where id = notification_id;
      notification_status := 'not_configured';
    end if;
    return query select notification_id, false, notification_status;
    return;
  end if;

  if notification_status = 'not_configured' then
    update public.notification_events
    set delivery_status = 'pending', next_attempt_at = now(), error = null
    where id = notification_id;
    notification_status := 'pending';
  end if;

  if notification_status = 'sent' then
    return query select notification_id, false, notification_status;
    return;
  end if;

  if notification_claim_until > now() then
    return query select notification_id, false, notification_status;
    return;
  end if;

  update public.notification_events
  set delivery_status = 'pending',
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      claim_until = now() + interval '1 minute',
      next_attempt_at = now() + interval '1 minute' * power(2, least(attempt_count + 1, 4)),
      error = null
  where id = notification_id
    and delivery_status in ('pending', 'failed')
    and (next_attempt_at is null or next_attempt_at <= now())
  returning delivery_status into notification_status;

  if not found then
    return query select notification_id, false, notification_status;
    return;
  end if;

  return query select notification_id, true, notification_status;
end;
$$;

revoke all on function public.claim_new_enquiry_notification(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.claim_new_enquiry_notification(uuid, text, jsonb, boolean) to service_role;

comment on function public.claim_new_enquiry_notification(uuid, text, jsonb, boolean)
  is 'Create or claim one new-enquiry delivery event atomically; callable by the server role only.';
