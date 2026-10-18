-- DRAFT — NOT APPLIED, NOT in supabase/migrations on purpose (so `supabase db push` cannot pick it up).
-- FRAME-007 / issue draft 5. Needs Mark's approval; to ship it, move it into supabase/migrations/
-- with a real timestamp in a SEPARATE PR, test on a branch database first.
--
-- Goal: a permanently failing notification stops being retried forever.
--   * new terminal delivery_status 'dead' (+ dead_at)
--   * a failed event whose attempt_count reaches the cap becomes 'dead' (trigger, so the
--     deployed retry-notifications / submit-enquiry code needs NO change: the retry
--     selector and both claim RPCs only act on pending/failed rows)
--   * owner-only RPC to put a dead event back in the queue (audited when it belongs to an enquiry)
-- Cap = 8 attempts (backoff 2,4,8,16,16,16,16 min ≈ 1.5 h before the 8th). Mark's call.
--
-- Rollback (manual, in this order):
--   drop trigger if exists notification_events_dead_letter on public.notification_events;
--   drop function if exists public.notification_dead_letter();
--   drop function if exists public.retry_dead_notification(uuid);
--   drop function if exists public.notification_max_attempts();
--   update public.notification_events set delivery_status='failed', dead_at=null where delivery_status='dead';
--   (re-create the old check constraint without 'dead'; drop column dead_at)

alter table public.notification_events add column if not exists dead_at timestamptz;

alter table public.notification_events drop constraint if exists notification_events_delivery_status_check;
alter table public.notification_events add constraint notification_events_delivery_status_check
  check (delivery_status in ('pending', 'sent', 'failed', 'not_configured', 'dead'));

create or replace function public.notification_max_attempts()
returns integer language sql immutable set search_path = '' as $$ select 8 $$;

create or replace function public.notification_dead_letter()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.delivery_status = 'failed' and new.attempt_count >= public.notification_max_attempts() then
    new.delivery_status := 'dead';
    new.dead_at := now();
    new.next_attempt_at := null;
    new.claim_until := null;
    new.error := left(coalesce(new.error, 'Delivery failed.') || ' (gave up after ' || new.attempt_count || ' attempts)', 500);
  end if;
  return new;
end;
$$;

drop trigger if exists notification_events_dead_letter on public.notification_events;
create trigger notification_events_dead_letter
  before update of delivery_status on public.notification_events
  for each row execute function public.notification_dead_letter();

-- Existing backlog: anything already past the cap is dead-lettered once, at apply time.
update public.notification_events
set delivery_status = 'dead', dead_at = now(), next_attempt_at = null, claim_until = null
where delivery_status = 'failed' and attempt_count >= public.notification_max_attempts();

create index if not exists notification_events_dead_idx
  on public.notification_events (dead_at) where delivery_status = 'dead';

-- Owner-only "retry now". Staff/anon get nothing. Resets the budget, never touches 'sent' rows.
create or replace function public.retry_dead_notification(p_event_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ev public.notification_events;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner') then
    raise exception 'Only the owner can retry a dead notification.' using errcode = '42501';
  end if;
  select * into ev from public.notification_events where id = p_event_id and delivery_status = 'dead' for update;
  if not found then return false; end if;
  update public.notification_events
  set delivery_status = 'failed', attempt_count = 0, dead_at = null,
      next_attempt_at = now(), claim_until = null, error = null
  where id = p_event_id;
  if ev.request_id is not null then
    insert into public.workflow_activity (entity_type, entity_id, event_type, from_status, to_status, actor_id, details)
    values ('request', ev.request_id, 'notification_retry_requested', 'dead', 'failed', auth.uid(),
            jsonb_build_object('channel', ev.channel, 'event_type', ev.event_type));
  end if;
  return true;
end;
$$;
revoke all on function public.retry_dead_notification(uuid) from public, anon;
grant execute on function public.retry_dead_notification(uuid) to authenticated;
revoke all on function public.notification_dead_letter() from public, anon, authenticated;
