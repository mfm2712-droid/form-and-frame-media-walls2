-- Limit anonymous enquiry submissions by a short-lived HMAC of the edge IP.
-- A short-lived idempotency reservation makes concurrent retries of the same
-- request consume one slot, even before either HTTP request has inserted it.
-- The raw IP is never stored; only service_role can call the atomic limiter.

create table public.enquiry_rate_limits (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count > 0),
  updated_at timestamptz not null
);

create index enquiry_rate_limits_updated_at_idx
  on public.enquiry_rate_limits (updated_at);

create table public.enquiry_rate_limit_keys (
  idempotency_key uuid primary key,
  created_at timestamptz not null default now()
);

create index enquiry_rate_limit_keys_created_at_idx
  on public.enquiry_rate_limit_keys (created_at);

alter table public.enquiry_rate_limits enable row level security;
alter table public.enquiry_rate_limit_keys enable row level security;
revoke all on table public.enquiry_rate_limits, public.enquiry_rate_limit_keys from public, anon, authenticated;

create or replace function public.consume_public_enquiry_slot(
  p_idempotency_key uuid,
  p_fingerprint text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_idempotency_key is null
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid public enquiry limit parameters.' using errcode = '22023';
  end if;

  -- Expire a reused key explicitly, then clear bounded batches of old keys.
  delete from public.enquiry_rate_limit_keys
  where idempotency_key = p_idempotency_key
    and created_at < v_now - interval '24 hours';
  delete from public.enquiry_rate_limit_keys
  where idempotency_key in (
    select idempotency_key from public.enquiry_rate_limit_keys
    where created_at < v_now - interval '24 hours'
    order by created_at
    limit 100
    for update skip locked
  );

  -- ON CONFLICT waits for a concurrent request with this key to commit. The
  -- duplicate then returns as already reserved without incrementing the IP
  -- counter again. A denied attempt removes its reservation below.
  insert into public.enquiry_rate_limit_keys (idempotency_key)
  values (p_idempotency_key)
  on conflict (idempotency_key) do nothing;
  if not found then
    return query select true, 0;
    return;
  end if;

  -- Keep only one day of pseudonymous abuse-prevention state.
  delete from public.enquiry_rate_limits
  where fingerprint in (
    select fingerprint from public.enquiry_rate_limits
    where updated_at < v_now - interval '24 hours'
    order by updated_at
    limit 100
    for update skip locked
  );

  insert into public.enquiry_rate_limits as limits
    (fingerprint, window_started_at, hit_count, updated_at)
  values (p_fingerprint, v_now, 1, v_now)
  on conflict (fingerprint) do update
    set window_started_at = case
          when limits.window_started_at <= v_now - (p_window_seconds * interval '1 second') then v_now
          else limits.window_started_at
        end,
        hit_count = case
          when limits.window_started_at <= v_now - (p_window_seconds * interval '1 second') then 1
          else limits.hit_count + 1
        end,
        updated_at = v_now
  returning window_started_at, hit_count into v_window_start, v_hits;

  if v_hits > p_limit then
    delete from public.enquiry_rate_limit_keys where idempotency_key = p_idempotency_key;
    return query select false, greatest(
      1,
      ceil(extract(epoch from v_window_start + (p_window_seconds * interval '1 second') - v_now))::integer
    );
    return;
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.consume_public_enquiry_slot(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_enquiry_slot(uuid, text, integer, integer) to service_role;

comment on table public.enquiry_rate_limits is 'One-day TTL of HMACed edge IP fingerprints and hourly public-enquiry counts; no raw IP or customer data is stored.';
comment on table public.enquiry_rate_limit_keys is 'One-day TTL of random enquiry idempotency keys reserved so concurrent delivery retries consume one IP allowance.';
comment on function public.consume_public_enquiry_slot(uuid, text, integer, integer)
  is 'Atomically consume one server-only public enquiry allowance per idempotency key and short-lived HMACed edge address.';

create or replace function public.cleanup_public_enquiry_rate_limits()
returns table(expired_fingerprints integer, expired_idempotency_keys integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := clock_timestamp() - interval '24 hours';
  v_fingerprints integer;
  v_keys integer;
begin
  delete from public.enquiry_rate_limits where updated_at < v_cutoff;
  get diagnostics v_fingerprints = row_count;
  delete from public.enquiry_rate_limit_keys where created_at < v_cutoff;
  get diagnostics v_keys = row_count;
  return query select v_fingerprints, v_keys;
end;
$$;

revoke all on function public.cleanup_public_enquiry_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_public_enquiry_rate_limits() to service_role;
comment on function public.cleanup_public_enquiry_rate_limits()
  is 'Delete one-day-expired public-enquiry fingerprints and idempotency reservations; schedule at one-minute intervals.';
