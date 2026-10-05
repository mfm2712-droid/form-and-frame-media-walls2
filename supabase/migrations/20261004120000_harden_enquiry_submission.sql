-- Safe server-side enquiry retries and explicit notification outcomes.
-- Public table writes remain staff-only; the Edge Function uses service role.

alter table public.consultation_requests
  add column if not exists idempotency_key uuid;

create unique index if not exists consultation_requests_idempotency_key_idx
  on public.consultation_requests (idempotency_key)
  where idempotency_key is not null;

alter table public.notification_events
  add column if not exists delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'not_configured')),
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0),
  add column if not exists last_attempt_at timestamptz;

update public.notification_events
set delivery_status = case
  when sent_at is not null and error is null then 'sent'
  when error is not null then 'failed'
  else 'pending'
end
where delivery_status = 'pending';

create index if not exists notification_events_delivery_status_created_idx
  on public.notification_events (delivery_status, created_at)
  where delivery_status in ('pending', 'failed', 'not_configured');
