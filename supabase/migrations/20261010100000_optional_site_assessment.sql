-- Anthony feedback: some enquiries require an on-site assessment before a formal quote.
-- Existing enquiries remain on the fast path unless staff explicitly enables the gate.
alter table public.consultation_requests
  add column if not exists assessment_required boolean not null default false;

create or replace function public.enforce_quote_assessment_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('sent', 'accepted') and exists (
    select 1 from public.consultation_requests r
    where r.id = new.request_id and r.assessment_required
  ) and not exists (
    select 1 from public.appointments a
    where a.request_id = new.request_id and a.kind = 'survey' and a.status = 'completed'
  ) then
    raise exception 'Complete the required site assessment before issuing this quote.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quotes_require_completed_assessment
before insert or update of status on public.quotes
for each row execute function public.enforce_quote_assessment_gate();
