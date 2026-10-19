-- One-time, expiring customer quotation response links. Only staff can issue links.
create table if not exists public.quote_response_links (
 id uuid primary key default gen_random_uuid(),
 quote_id uuid not null references public.quotes(id) on delete restrict,
 token_hash text not null unique,
 expires_at timestamptz not null,
 used_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.quote_response_links enable row level security;
create policy "staff read quote response links" on public.quote_response_links for select using (public.is_staff());
create or replace function public.issue_quote_response_link(p_quote_id uuid, p_token_hash text) returns void language plpgsql security definer set search_path = public as $$
begin
 if not public.is_staff() then raise exception 'Not authorised'; end if;
 if length(p_token_hash) <> 64 or p_token_hash !~ '^[a-f0-9]+$' then raise exception 'Invalid token hash'; end if;
 if not exists (select 1 from public.quotes where id=p_quote_id and status in ('draft','sent')) then raise exception 'Quotation not eligible'; end if;
 update public.quote_response_links set used_at=now() where quote_id=p_quote_id and used_at is null;
 insert into public.quote_response_links(quote_id,token_hash,expires_at) values(p_quote_id,p_token_hash,now()+interval '30 days');
end; $$;
revoke all on function public.issue_quote_response_link(uuid,text) from public, anon;
grant execute on function public.issue_quote_response_link(uuid,text) to authenticated;

create or replace function public.record_customer_quote_response(p_token_hash text,p_decision text) returns void language plpgsql security definer set search_path=public as $$
declare link_row public.quote_response_links%rowtype; current_status public.quote_status; request_uuid uuid;
begin
 if current_setting('role',true) <> 'service_role' then raise exception 'Not authorised'; end if;
 select * into link_row from public.quote_response_links where token_hash=p_token_hash for update;
 if not found or link_row.used_at is not null or link_row.expires_at<=now() or p_decision not in ('accepted','rejected') then raise exception 'Invalid or expired link'; end if;
 select status,request_id into current_status,request_uuid from public.quotes where id=link_row.quote_id for update;
 if current_status='draft' then
  update public.quotes set status='sent',sent_at=now() where id=link_row.quote_id;
 elsif current_status <> 'sent' then raise exception 'Quotation no longer open'; end if;
 update public.quotes set status=p_decision::public.quote_status,accepted_at=case when p_decision='accepted' then now() else null end where id=link_row.quote_id;
 update public.quote_response_links set used_at=now() where id=link_row.id;
 update public.consultation_requests set status=case when p_decision='accepted' then 'won'::public.request_status else 'lost'::public.request_status end where id=request_uuid;
end; $$;
revoke all on function public.record_customer_quote_response(text,text) from public, anon, authenticated;
grant execute on function public.record_customer_quote_response(text,text) to service_role;
