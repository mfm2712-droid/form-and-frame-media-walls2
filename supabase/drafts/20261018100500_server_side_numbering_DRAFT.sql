-- DRAFT / NOT APPLIED. DO NOT APPLY / not for `supabase db push`.
-- Lives in supabase/drafts/ on purpose (outside supabase/migrations/). When Mark approves,
-- move it to supabase/migrations/ and drop _DRAFT from the name in a separate reviewed PR.
-- Issues: #15 (invoice numbers), #29 (quote + work order numbers).
-- Verified only on a local throwaway PGlite database (supabase/numbering.pglite.test.mjs).
--
-- What it does
--   * One sequence per document kind; numbers look like FFQ-000001 / FFJ-000001 / FFI-000001.
--     PLACEHOLDER FORMAT: the real format, whether invoices must be gap-free (allocate at
--     "send" instead of at draft) and the legal wording need Mark / the accountant's decision.
--   * allocate_document_number(kind): RPC used by the Operations app when present.
--   * BEFORE INSERT trigger: if a row arrives without a number, the server assigns one.
-- What it does NOT do
--   * It does not rewrite existing numbers (old FFQ-YYYYMMDD-XXXX values stay valid).
--   * It does not reject browser-supplied numbers yet (so the previous app keeps working).
--     Strict enforcement is a deliberate second step once the new app is deployed.
--   * Sequences are not gap-free: a rolled-back insert or an unused allocation burns a number.
--
-- Deploy order: ship the app change first (it feature-detects the RPC), then apply this.
-- ROLLBACK: drop trigger quotes_assign_number/work_orders_assign_number/invoices_assign_number;
--   drop function assign_document_number(), allocate_document_number(text);
--   drop sequence quote_number_seq, work_order_number_seq, invoice_number_seq.
--   The app falls back to browser-generated numbers automatically.

create sequence if not exists public.quote_number_seq as bigint;
create sequence if not exists public.work_order_number_seq as bigint;
create sequence if not exists public.invoice_number_seq as bigint;

revoke all on sequence public.quote_number_seq, public.work_order_number_seq, public.invoice_number_seq from public, anon, authenticated;

create or replace function public.format_document_number(kind text, n bigint)
returns text language sql immutable set search_path = '' as $$
  select case kind when 'quote' then 'FFQ-' when 'work_order' then 'FFJ-' when 'invoice' then 'FFI-' end
         || lpad(n::text, 6, '0');
$$;

create or replace function public.next_document_number_unchecked(kind text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if kind = 'quote' then return public.format_document_number(kind, nextval('public.quote_number_seq'));
  elsif kind = 'work_order' then return public.format_document_number(kind, nextval('public.work_order_number_seq'));
  elsif kind = 'invoice' then return public.format_document_number(kind, nextval('public.invoice_number_seq'));
  end if;
  raise exception 'Unknown document kind.' using errcode = '22023';
end;
$$;
revoke all on function public.next_document_number_unchecked(text) from public, anon, authenticated;

-- Public RPC: team members only.
create or replace function public.allocate_document_number(kind text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Only team members can allocate document numbers.' using errcode = '42501';
  end if;
  return public.next_document_number_unchecked(kind);
end;
$$;
revoke all on function public.allocate_document_number(text) from public, anon;
grant execute on function public.allocate_document_number(text) to authenticated, service_role;

create or replace function public.assign_document_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Nested ifs on purpose: plpgsql does not guarantee short-circuit evaluation of `and`,
  -- and `new.<column>` does not exist for the other tables.
  if tg_table_name = 'quotes' then
    if coalesce(btrim(new.quote_number), '') = '' then new.quote_number := public.next_document_number_unchecked('quote'); end if;
  elsif tg_table_name = 'work_orders' then
    if coalesce(btrim(new.work_order_number), '') = '' then new.work_order_number := public.next_document_number_unchecked('work_order'); end if;
  elsif tg_table_name = 'invoices' then
    if coalesce(btrim(new.invoice_number), '') = '' then new.invoice_number := public.next_document_number_unchecked('invoice'); end if;
  end if;
  return new;
end;
$$;
revoke all on function public.assign_document_number() from public, anon, authenticated;

create trigger quotes_assign_number before insert on public.quotes
for each row execute function public.assign_document_number();
create trigger work_orders_assign_number before insert on public.work_orders
for each row execute function public.assign_document_number();
create trigger invoices_assign_number before insert on public.invoices
for each row execute function public.assign_document_number();
