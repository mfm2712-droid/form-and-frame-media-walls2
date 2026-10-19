-- Owner Desk redesign: one coherent enquiry → quotation → job → invoice workflow.
--
-- NOT APPLIED. Apply to the Form & Frame project (otqzhocismdjbvvsjnpe) only after
-- Mark explicitly authorises this migration and the pre-flight checks below pass.
-- The redesigned Owner Desk detects whether this migration is present and keeps
-- quotation saving disabled (with an explanation) until it is.
--
-- What it adds, without rewriting existing records:
--   1. Structured quotation lines, discount and terms, validated in pence by the database.
--   2. An owner-managed catalogue of standard items. Names only: no prices are invented.
--   3. Explicit revisions: one open draft and one accepted quotation per enquiry, and
--      older sent versions are superseded automatically when a revision is sent.
--   4. A customer portal: view, accept, decline or request changes through a single-use,
--      expiring link. Requests for changes notify staff and return to revision.
--   5. Recoverable soft deletion of unwanted enquiries.
--   6. Sensible backward steps for jobs, and discarding of unsent drafts.
--   7. A customer address and owner-set default quotation terms.

-- Pre-flight: these indexes cannot be created over conflicting historic rows.
do $$
begin
  if exists (select 1 from public.quotes where status = 'accepted' group by request_id having count(*) > 1) then
    raise exception 'Pre-flight failed: an enquiry has more than one accepted quotation. Resolve it with the owner before applying.';
  end if;
end;
$$;

-- 1. Quotation lines ----------------------------------------------------------
alter table public.quotes
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists items_subtotal_pence bigint check (items_subtotal_pence >= 0),
  add column if not exists discount_type text not null default 'none' check (discount_type in ('none', 'percent', 'fixed')),
  add column if not exists discount_basis_points integer not null default 0 check (discount_basis_points between 0 and 10000),
  add column if not exists discount_pence bigint not null default 0 check (discount_pence >= 0),
  add column if not exists exclusions text not null default '' check (char_length(exclusions) <= 6000),
  add column if not exists terms text not null default '' check (char_length(terms) <= 8000),
  add column if not exists revision_of uuid references public.quotes(id) on delete restrict,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists customer_message text not null default '' check (char_length(customer_message) <= 2000),
  add column if not exists responded_at timestamptz;

-- Every money figure is recomputed here, so a browser cannot save totals that
-- disagree with the lines. Quantities allow two decimals (metres, hours).
create or replace function public.validate_quote_lines()
returns trigger language plpgsql set search_path = '' as $$
declare
  line jsonb;
  quantity numeric;
  unit_price bigint;
  line_total bigint;
  computed bigint := 0;
  expected_discount bigint;
begin
  if jsonb_typeof(new.line_items) <> 'array' then
    raise exception 'Quotation lines must be a list.' using errcode = '23514';
  end if;
  if jsonb_array_length(new.line_items) > 100 then
    raise exception 'A quotation can have at most 100 lines.' using errcode = '23514';
  end if;
  if jsonb_array_length(new.line_items) = 0 then
    -- Quotations saved before itemised lines existed keep their single subtotal.
    if new.discount_type <> 'none' or new.discount_pence <> 0 then
      raise exception 'A discount needs itemised quotation lines.' using errcode = '23514';
    end if;
    return new;
  end if;
  for line in select value from jsonb_array_elements(new.line_items) loop
    if jsonb_typeof(line) <> 'object'
      or char_length(btrim(coalesce(line->>'description', ''))) not between 1 and 300
      or char_length(coalesce(line->>'unit', '')) > 30
      or coalesce(line->>'quantity', '') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
      or coalesce(line->>'unit_price_pence', '') !~ '^[0-9]{1,10}$'
      or coalesce(line->>'line_total_pence', '') !~ '^[0-9]{1,12}$' then
      raise exception 'Each quotation line needs a description, quantity, unit and unit price.' using errcode = '23514';
    end if;
    quantity := (line->>'quantity')::numeric;
    unit_price := (line->>'unit_price_pence')::bigint;
    line_total := (line->>'line_total_pence')::bigint;
    if quantity <= 0 or line_total <> round(quantity * unit_price)::bigint then
      raise exception 'A quotation line total does not match its quantity and unit price.' using errcode = '23514';
    end if;
    computed := computed + line_total;
  end loop;
  if new.items_subtotal_pence is distinct from computed then
    raise exception 'The items subtotal does not match the quotation lines.' using errcode = '23514';
  end if;
  expected_discount := case new.discount_type
    when 'percent' then round(computed::numeric * new.discount_basis_points / 10000)::bigint
    when 'fixed' then new.discount_pence
    else 0 end;
  if new.discount_type = 'none' and new.discount_basis_points <> 0 then
    raise exception 'Remove the discount rate or choose a discount type.' using errcode = '23514';
  end if;
  if new.discount_type = 'fixed' and new.discount_basis_points <> 0 then
    raise exception 'A fixed discount has no percentage.' using errcode = '23514';
  end if;
  if new.discount_pence <> expected_discount or expected_discount > computed then
    raise exception 'The discount does not match the quotation lines.' using errcode = '23514';
  end if;
  if new.subtotal_pence <> computed - expected_discount then
    raise exception 'The quotation subtotal must equal the items subtotal less the discount.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_validate_lines on public.quotes;
create trigger quotes_validate_lines before insert or update of line_items, items_subtotal_pence, discount_type, discount_basis_points, discount_pence, subtotal_pence
on public.quotes for each row execute function public.validate_quote_lines();

-- Issued quotations are immutable: the original lock covers price and scope;
-- this extends it to the new lines, discount and terms.
create or replace function public.protect_issued_quote_details()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (
    new.line_items is distinct from old.line_items
    or new.items_subtotal_pence is distinct from old.items_subtotal_pence
    or new.discount_type is distinct from old.discount_type
    or new.discount_basis_points is distinct from old.discount_basis_points
    or new.discount_pence is distinct from old.discount_pence
    or new.exclusions is distinct from old.exclusions
    or new.terms is distinct from old.terms
    or new.revision_of is distinct from old.revision_of
  ) then
    raise exception 'An issued quotation is locked; create a revision for changed terms.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_protect_issued_details on public.quotes;
create trigger quotes_protect_issued_details before update on public.quotes
for each row execute function public.protect_issued_quote_details();

-- 2. Catalogue of standard items -------------------------------------------------
create table if not exists public.quote_catalogue_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 120),
  category text not null default 'General' check (char_length(category) between 1 and 60),
  unit text not null default 'item' check (char_length(unit) between 1 and 30),
  default_unit_price_pence bigint check (default_unit_price_pence >= 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quote_catalogue_items enable row level security;
drop policy if exists "staff read quote catalogue" on public.quote_catalogue_items;
drop policy if exists "owners add quote catalogue items" on public.quote_catalogue_items;
drop policy if exists "owners update quote catalogue items" on public.quote_catalogue_items;
create policy "staff read quote catalogue" on public.quote_catalogue_items for select using (public.is_staff());
create policy "owners add quote catalogue items" on public.quote_catalogue_items for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
create policy "owners update quote catalogue items" on public.quote_catalogue_items for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
-- No delete policy: retire an item by switching it off, so old quotations stay explainable.

-- Starter names and units only. Prices stay empty until the owner enters real rates.
insert into public.quote_catalogue_items (name, category, unit, sort_order) values
  ('Design & planning', 'Services', 'item', 10),
  ('Site survey', 'Services', 'visit', 20),
  ('MDF', 'Materials', 'sheet', 30),
  ('Timber', 'Materials', 'metre', 40),
  ('Plasterboard', 'Materials', 'sheet', 50),
  ('LED strips', 'Lighting & electrical', 'metre', 60),
  ('Electrical work', 'Lighting & electrical', 'item', 70),
  ('TV mounting', 'Installation', 'item', 80),
  ('Fireplace installation', 'Installation', 'item', 90),
  ('Painting & decorating', 'Finishing', 'item', 100),
  ('Labour', 'Labour', 'day', 110),
  ('Delivery', 'Logistics', 'item', 120)
on conflict (name) do nothing;

-- 3. Revisions --------------------------------------------------------------------
create unique index if not exists quotes_one_accepted_per_request
  on public.quotes(request_id) where status = 'accepted';

-- Serialise version changes per enquiry. Only the newest issued version can be
-- accepted, an older version cannot be re-sent, and one draft is open at a time.
create or replace function public.guard_quote_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.consultation_requests where id = new.request_id for update;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.quotes where request_id = new.request_id and status = 'draft') then
      raise exception 'This enquiry already has a draft quotation. Edit that draft instead.' using errcode = '23514';
    end if;
    if exists (select 1 from public.quotes where request_id = new.request_id and status = 'accepted') then
      raise exception 'This enquiry already has an accepted quotation.' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status in ('sent', 'accepted') and new.status is distinct from old.status and exists (
    select 1 from public.quotes q
    where q.request_id = new.request_id and q.id <> new.id
      and q.version > new.version and q.status in ('sent', 'accepted')
  ) then
    raise exception 'A newer version of this quotation has already been issued.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_guard_versions on public.quotes;
create trigger quotes_guard_versions before insert or update of status on public.quotes
for each row execute function public.guard_quote_versions();

create or replace function public.supersede_older_quote_versions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes set status = 'superseded'
  where request_id = new.request_id and id <> new.id and status = 'sent' and version < new.version;
  update public.quote_response_links set used_at = now()
  where used_at is null and quote_id in (
    select id from public.quotes where request_id = new.request_id and id <> new.id and status = 'superseded'
  );
  return new;
end;
$$;

drop trigger if exists quotes_supersede_older_versions on public.quotes;
create trigger quotes_supersede_older_versions after update of status on public.quotes
for each row when (old.status = 'draft' and new.status = 'sent')
execute function public.supersede_older_quote_versions();

-- 4. Status rules, including sensible backward steps ------------------------------
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
      'draft>sent', 'draft>superseded', 'sent>accepted', 'sent>rejected', 'sent>expired', 'sent>superseded'
    )
    when 'work_orders' then v_transition in (
      'accepted>ready_to_build', 'accepted>in_progress', 'accepted>cancelled',
      'ready_to_build>accepted', 'ready_to_build>in_progress', 'ready_to_build>cancelled',
      'in_progress>ready_to_build', 'in_progress>quality_check', 'in_progress>cancelled',
      'quality_check>in_progress', 'quality_check>ready_for_install', 'quality_check>cancelled',
      'ready_for_install>in_progress', 'ready_for_install>installation_scheduled', 'ready_for_install>cancelled',
      'installation_scheduled>ready_for_install', 'installation_scheduled>installed', 'installation_scheduled>cancelled',
      'installed>completed'
    )
    when 'appointments' then v_transition in (
      'scheduled>confirmed', 'scheduled>cancelled', 'scheduled>completed',
      'confirmed>cancelled', 'confirmed>completed'
    )
    when 'invoices' then v_transition in ('draft>sent', 'draft>void', 'sent>void')
    else false
  end;

  if not coalesce(v_allowed, false) then
    raise exception 'Invalid status transition for %: %.', tg_table_name, v_transition using errcode = '23514';
  end if;
  return new;
end;
$$;

-- 5. Customer portal ----------------------------------------------------------------
alter table public.quote_response_links
  add column if not exists viewed_at timestamptz,
  add column if not exists decision text check (decision in ('accepted', 'rejected', 'changes_requested'));

-- Issuing the customer link is what "Send to customer" means: a draft becomes
-- sent in the same transaction, so a customer can never answer an unsent draft.
create or replace function public.issue_quote_response_link(p_quote_id uuid, p_token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_status public.quote_status;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
  select status into current_status from public.quotes where id = p_quote_id for update;
  if not found or current_status not in ('draft', 'sent') then raise exception 'Quotation not eligible'; end if;
  if current_status = 'draft' then
    update public.quotes set status = 'sent', sent_at = now() where id = p_quote_id;
  end if;
  update public.quote_response_links set used_at = now() where quote_id = p_quote_id and used_at is null;
  insert into public.quote_response_links(quote_id, token_hash, expires_at)
  values (p_quote_id, p_token_hash, now() + interval '30 days');
end;
$$;
revoke all on function public.issue_quote_response_link(uuid, text) from public, anon;
grant execute on function public.issue_quote_response_link(uuid, text) to authenticated;

-- What the customer sees. Server role only: the edge function hashes the token.
create or replace function public.get_quote_for_response(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  link_row public.quote_response_links%rowtype;
  quote_row public.quotes%rowtype;
  request_row public.consultation_requests%rowtype;
  seller public.business_settings%rowtype;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'Not authorised'; end if;
  select * into link_row from public.quote_response_links where token_hash = p_token_hash;
  if not found then raise exception 'Invalid or expired link'; end if;
  select * into quote_row from public.quotes where id = link_row.quote_id;
  select * into request_row from public.consultation_requests where id = quote_row.request_id;
  select * into seller from public.business_settings where singleton;
  if link_row.viewed_at is null and link_row.used_at is null and link_row.expires_at > now() then
    update public.quote_response_links set viewed_at = now() where id = link_row.id;
  end if;
  return jsonb_build_object(
    'open', link_row.used_at is null and link_row.expires_at > now() and quote_row.status = 'sent'
      and (quote_row.valid_until is null or quote_row.valid_until >= current_date),
    'decision', link_row.decision,
    'link_expires_at', link_row.expires_at,
    'quote_number', quote_row.quote_number,
    'version', quote_row.version,
    'status', quote_row.status,
    'issued_at', quote_row.sent_at,
    'valid_until', quote_row.valid_until,
    'customer_name', request_row.customer_name,
    'reference', request_row.reference,
    'postcode', request_row.postcode,
    'scope', quote_row.scope,
    'exclusions', quote_row.exclusions,
    'terms', quote_row.terms,
    'line_items', quote_row.line_items,
    'items_subtotal_pence', quote_row.items_subtotal_pence,
    'discount_type', quote_row.discount_type,
    'discount_basis_points', quote_row.discount_basis_points,
    'discount_pence', quote_row.discount_pence,
    'subtotal_pence', quote_row.subtotal_pence,
    'tax_rate_basis_points', quote_row.tax_rate_basis_points,
    'tax_pence', quote_row.tax_pence,
    'total_pence', quote_row.total_pence,
    'seller_name', seller.legal_name,
    'seller_email', seller.contact_email,
    'seller_phone', seller.contact_phone,
    'vat_number', seller.vat_number
  );
end;
$$;
revoke all on function public.get_quote_for_response(text) from public, anon, authenticated;
grant execute on function public.get_quote_for_response(text) to service_role;

create or replace function public.record_customer_quote_decision(p_token_hash text, p_decision text, p_message text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  link_row public.quote_response_links%rowtype;
  quote_row public.quotes%rowtype;
  enquiry_reference text;
  note text := left(btrim(coalesce(p_message, '')), 2000);
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'Not authorised'; end if;
  if p_decision not in ('accepted', 'rejected', 'changes_requested') then raise exception 'Invalid decision'; end if;
  if p_decision = 'changes_requested' and char_length(note) < 3 then raise exception 'Describe the changes you would like'; end if;
  select * into link_row from public.quote_response_links where token_hash = p_token_hash for update;
  if not found or link_row.used_at is not null or link_row.expires_at <= now() then raise exception 'Invalid or expired link'; end if;
  select * into quote_row from public.quotes where id = link_row.quote_id for update;
  if quote_row.status <> 'sent' then raise exception 'Quotation no longer open'; end if;
  if quote_row.valid_until is not null and quote_row.valid_until < current_date then raise exception 'Quotation has expired'; end if;

  update public.quote_response_links set used_at = now(), decision = p_decision where id = link_row.id;
  if p_decision = 'changes_requested' then
    update public.quotes set revision_requested_at = now(), responded_at = now(), customer_message = note where id = quote_row.id;
    select reference into enquiry_reference from public.consultation_requests where id = quote_row.request_id;
    insert into public.notification_events (request_id, channel, event_type, payload, delivery_status, next_attempt_at)
    values (null, 'push', 'workflow_update', jsonb_strip_nulls(jsonb_build_object(
      'title', 'Changes requested',
      'body', left(coalesce(enquiry_reference || ' · ', '') || 'The customer asked for changes to the quotation.', 180),
      'view', 'work', 'category', 'quotations', 'request_id', quote_row.request_id
    )), 'pending', now());
  else
    update public.quotes set status = p_decision::public.quote_status,
      accepted_at = case when p_decision = 'accepted' then now() else null end,
      responded_at = now(), customer_message = note
    where id = quote_row.id;
    update public.consultation_requests
      set status = case when p_decision = 'accepted' then 'won'::public.request_status else 'lost'::public.request_status end
    where id = quote_row.request_id;
  end if;
  return jsonb_build_object('ok', true, 'decision', p_decision);
end;
$$;
revoke all on function public.record_customer_quote_decision(text, text, text) from public, anon, authenticated;
grant execute on function public.record_customer_quote_decision(text, text, text) to service_role;

-- Keep the earlier entry point for an already-deployed edge function, without its
-- old shortcut that silently sent a draft.
create or replace function public.record_customer_quote_response(p_token_hash text, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.record_customer_quote_decision(p_token_hash, p_decision, '');
end;
$$;
revoke all on function public.record_customer_quote_response(text, text) from public, anon, authenticated;
grant execute on function public.record_customer_quote_response(text, text) to service_role;

-- 6. Recoverable deletion of enquiries -------------------------------------------
alter table public.consultation_requests
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

create or replace function public.guard_enquiry_soft_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (select 1 from public.quotes where request_id = new.id and status <> 'draft' and not (status = 'superseded' and sent_at is null))
      or exists (select 1 from public.work_orders where request_id = new.id) then
      raise exception 'This enquiry has issued quotations or a job, so it must be archived instead of deleted.' using errcode = '23514';
    end if;
    new.deleted_at := now();
    new.deleted_by := auth.uid();
  elsif new.deleted_at is null then
    new.deleted_by := null;
  elsif new.deleted_at is distinct from old.deleted_at then
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
  end if;
  return new;
end;
$$;

drop trigger if exists consultation_requests_guard_soft_delete on public.consultation_requests;
create trigger consultation_requests_guard_soft_delete before update of deleted_at on public.consultation_requests
for each row execute function public.guard_enquiry_soft_delete();

-- 7. Customer address and default quotation wording ------------------------------
alter table public.consultation_requests
  add column if not exists address text check (char_length(address) <= 600);
alter table public.business_settings
  add column if not exists default_quote_terms text not null default '' check (char_length(default_quote_terms) <= 8000),
  add column if not exists default_quote_exclusions text not null default '' check (char_length(default_quote_exclusions) <= 6000);

-- 8. Live updates for the catalogue -----------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_catalogue_items'
    ) then
    execute 'alter publication supabase_realtime add table public.quote_catalogue_items';
  end if;
end;
$$;
