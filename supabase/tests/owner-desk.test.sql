-- Behaviour tests for 20261020100000_owner_desk_workflow.sql, run by
-- scripts/test-migrations.sh on a throwaway local database. Fictional data only.
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.expect_error(statement text, fragment text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin
    execute statement;
  exception when others then
    failed := true;
    if position(fragment in sqlerrm) = 0 then
      raise exception 'expected "%" but got "%" from: %', fragment, sqlerrm, statement;
    end if;
  end;
  if not failed then raise exception 'expected an error containing "%" from: %', fragment, statement; end if;
end $$;

create function pg_temp.check(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;

-- Keys a closed response must never carry: customer details, prices, terms.
create function pg_temp.leaks(response jsonb) returns text[] language sql as $$
  select coalesce(array_agg(key order by key), '{}') from jsonb_object_keys(response) key
  where key in ('customer_name', 'reference', 'postcode', 'quote_number', 'version', 'status', 'scope', 'exclusions', 'terms', 'line_items',
                'items_subtotal_pence', 'discount_type', 'discount_basis_points', 'discount_pence', 'subtotal_pence', 'tax_rate_basis_points',
                'tax_pence', 'total_pence', 'valid_until', 'issued_at', 'link_expires_at', 'vat_number')
$$;

create function pg_temp.hash(token text) returns text language sql as $$ select encode(sha256(convert_to(token, 'UTF8')), 'hex') $$;

-- What the edge function does: call as the server role.
create function pg_temp.view(token text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  set local role service_role;
  result := public.get_quote_for_response(pg_temp.hash(token));
  reset role;
  return result;
end $$;
create function pg_temp.answer(token text, decision text, message text default '') returns jsonb language plpgsql as $$
declare result jsonb;
begin
  set local role service_role;
  result := public.record_customer_quote_decision(pg_temp.hash(token), decision, message);
  reset role;
  return result;
end $$;
-- What the Owner Desk does: call as the signed-in owner.
create function pg_temp.issue(quote uuid, token text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  perform public.issue_quote_response_link(quote, pg_temp.hash(token));
  reset role;
end $$;

-- Fixtures -------------------------------------------------------------------------
insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000a1');
insert into public.profiles(id, full_name, role) values ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner');
insert into public.business_settings(singleton, legal_name, billing_address, contact_email)
  values (true, 'Fictional Trading Ltd', '1 Test Street, Testtown', 'hello@example.com');
insert into public.consultation_requests(id, reference, customer_name, postcode, email) values
  ('00000000-0000-4000-8000-000000000101', 'FF-TEST-1', 'Fictional Test Customer', 'SL1 1AA', 'customer@example.com'),
  ('00000000-0000-4000-8000-000000000102', 'FF-TEST-2', 'Second Fictional Customer', 'SL2 2BB', 'second@example.com'),
  ('00000000-0000-4000-8000-000000000103', 'FF-TEST-3', 'Draft Only Customer', 'SL3 3CC', 'third@example.com');

-- Lines, discount and totals ---------------------------------------------------------
-- 12 × £38.50 + 3.5 × £240 = £1,302.00; 10% = £130.20; subtotal £1,171.80; VAT 20% = £234.36.
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope, line_items, items_subtotal_pence)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-BAD-1', 46201, 0, 0, 'x', '[{"description":"MDF","quantity":"12","unit":"sheet","unit_price_pence":3850,"line_total_pence":46201}]', 46201)$q$,
  'line total does not match');
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope, line_items, items_subtotal_pence, discount_type, discount_basis_points, discount_pence)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-BAD-2', 41580, 0, 0, 'x', '[{"description":"MDF","quantity":"12","unit":"sheet","unit_price_pence":3850,"line_total_pence":46200}]', 46200, 'percent', 1000, 4000)$q$,
  'discount does not match');
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope, line_items, items_subtotal_pence, discount_type, discount_pence)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-BAD-3', 0, 0, 0, 'x', '[{"description":"MDF","quantity":"1","unit":"sheet","unit_price_pence":100,"line_total_pence":100}]', 100, 'fixed', 200)$q$,
  'discount does not match');
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope, line_items, items_subtotal_pence)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-BAD-4', 46200, 2000, 1, 'x', '[{"description":"MDF","quantity":"12","unit":"sheet","unit_price_pence":3850,"line_total_pence":46200}]', 46200)$q$,
  'check constraint');
insert into public.quotes(id, request_id, quote_number, version, subtotal_pence, tax_rate_basis_points, tax_pence, scope, terms, valid_until,
  line_items, items_subtotal_pence, discount_type, discount_basis_points, discount_pence)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'FFQ-TEST-1', 1, 117180, 2000, 23436, 'Fictional media wall', 'Fictional deposit terms', current_date + 30,
  '[{"description":"MDF","quantity":"12","unit":"sheet","unit_price_pence":3850,"line_total_pence":46200},{"description":"Labour","quantity":"3.5","unit":"day","unit_price_pence":24000,"line_total_pence":84000}]',
  130200, 'percent', 1000, 13020);
select pg_temp.check((select total_pence from public.quotes where id = '00000000-0000-4000-8000-000000000201') = 140616, 'valid lines, 10% discount and 20% VAT give £1,406.16');

-- One draft per enquiry -----------------------------------------------------------------
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, version, subtotal_pence, tax_rate_basis_points, tax_pence, scope)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-TEST-1-DUP', 2, 100, 0, 0, 'x')$q$, 'already has a draft');
select pg_temp.check((select count(*) from pg_indexes where indexname in ('quotes_one_draft_per_request', 'quotes_one_accepted_per_request')) = 2, 'unique indexes for one draft and one accepted quotation exist');

-- Issuing a link sends the draft and locks it ------------------------------------------
select pg_temp.issue('00000000-0000-4000-8000-000000000201', 'link-one-v1');
select pg_temp.check((select status::text from public.quotes where id = '00000000-0000-4000-8000-000000000201') = 'sent', 'issuing the customer link marks the draft as sent');
select pg_temp.expect_error($q$update public.quotes set terms = 'changed' where id = '00000000-0000-4000-8000-000000000201'$q$, 'locked');
select pg_temp.expect_error($q$update public.quotes set line_items = '[]', items_subtotal_pence = null, discount_type = 'none', discount_basis_points = 0, discount_pence = 0 where id = '00000000-0000-4000-8000-000000000201'$q$, 'locked');

-- A valid link shows the quotation ------------------------------------------------------
do $$
declare r jsonb := pg_temp.view('link-one-v1');
begin
  perform pg_temp.check((r->>'open')::boolean and r->>'state' = 'open', 'valid link is open');
  perform pg_temp.check(r->>'customer_name' = 'Fictional Test Customer' and (r->>'total_pence')::bigint = 140616 and jsonb_array_length(r->'line_items') = 2, 'valid link returns the quotation');
end $$;
select pg_temp.check((select viewed_at is not null from public.quote_response_links where token_hash = pg_temp.hash('link-one-v1')), 'opening a valid link records that it was viewed');

-- Only the server role can read it ---------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform pg_temp.expect_error($q$select public.get_quote_for_response(encode(sha256('link-one-v1'::bytea), 'hex'))$q$, 'permission denied');
  reset role;
  set local role anon;
  perform pg_temp.expect_error($q$select public.record_customer_quote_decision(encode(sha256('link-one-v1'::bytea), 'hex'), 'accepted', '')$q$, 'permission denied');
  reset role;
  perform pg_temp.check(true, 'staff and anonymous roles cannot call the customer functions');
end $$;
select pg_temp.expect_error($q$select public.get_quote_for_response(repeat('0', 64))$q$, 'Not authorised');

-- Unknown and malformed links -------------------------------------------------------------
select pg_temp.expect_error($q$select pg_temp.view('never-issued')$q$, 'Invalid or expired link');
do $$ begin
  set local role service_role;
  perform pg_temp.expect_error($q$select public.get_quote_for_response('not-a-hash')$q$, 'Invalid or expired link');
  reset role;
  perform pg_temp.check(true, 'unknown and malformed links raise a generic error');
end $$;

-- Requesting changes uses the link; reusing it shows nothing ------------------------------
select pg_temp.expect_error($q$select pg_temp.answer('link-one-v1', 'changes_requested', '')$q$, 'Describe the changes');
select pg_temp.expect_error($q$select pg_temp.answer('link-one-v1', 'paid', '')$q$, 'Invalid decision');
select pg_temp.check((pg_temp.answer('link-one-v1', 'changes_requested', 'Could the shelves be oak?'))->>'decision' = 'changes_requested', 'customer can request changes');
select pg_temp.check((select revision_requested_at is not null and customer_message = 'Could the shelves be oak?' and status = 'sent' from public.quotes where id = '00000000-0000-4000-8000-000000000201'), 'change request is stored and the quotation stays sent');
select pg_temp.check((select count(*) from public.notification_events where payload->>'title' = 'Changes requested' and payload->>'request_id' = '00000000-0000-4000-8000-000000000101') = 1, 'staff are notified of the change request');
do $$
declare r jsonb := pg_temp.view('link-one-v1');
begin
  perform pg_temp.check(not (r->>'open')::boolean and r->>'state' = 'answered' and r->>'decision' = 'changes_requested', 'used link reports it was answered');
  perform pg_temp.check(pg_temp.leaks(r) = '{}', 'used link returns no customer details, prices or terms: ' || pg_temp.leaks(r)::text);
end $$;
select pg_temp.expect_error($q$select pg_temp.answer('link-one-v1', 'accepted')$q$, 'Invalid or expired link');

-- A revision replaces version 1 and closes its links ---------------------------------------
insert into public.quotes(id, request_id, quote_number, version, revision_of, subtotal_pence, tax_rate_basis_points, tax_pence, scope, valid_until, line_items, items_subtotal_pence)
values ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101', 'FFQ-TEST-1-R2', 2, '00000000-0000-4000-8000-000000000201', 128000, 0, 0, 'Fictional media wall in oak', current_date + 30,
  '[{"description":"Oak shelving","quantity":"1","unit":"item","unit_price_pence":128000,"line_total_pence":128000}]', 128000);
select pg_temp.issue('00000000-0000-4000-8000-000000000202', 'link-two-v2-first');
select pg_temp.check((select status::text from public.quotes where id = '00000000-0000-4000-8000-000000000201') = 'superseded', 'sending the revision supersedes version 1');
select pg_temp.expect_error($q$update public.quotes set status = 'accepted', accepted_at = now() where id = '00000000-0000-4000-8000-000000000201'$q$, 'newer version of this quotation');

-- Issuing a fresh link closes the previous one for the same version -------------------------
select pg_temp.issue('00000000-0000-4000-8000-000000000202', 'link-three-v2-second');
do $$
declare r jsonb := pg_temp.view('link-two-v2-first');
begin
  perform pg_temp.check(not (r->>'open')::boolean and r->>'state' = 'replaced' and pg_temp.leaks(r) = '{}', 'replaced link is closed and shows nothing');
end $$;
select pg_temp.expect_error($q$select pg_temp.answer('link-two-v2-first', 'accepted')$q$, 'Invalid or expired link');

-- An expired link shows nothing and cannot answer -----------------------------------------
update public.quote_response_links set expires_at = now() - interval '1 minute' where token_hash = pg_temp.hash('link-three-v2-second');
do $$
declare r jsonb := pg_temp.view('link-three-v2-second');
begin
  perform pg_temp.check(not (r->>'open')::boolean and r->>'state' = 'expired' and pg_temp.leaks(r) = '{}', 'expired link is closed and shows nothing');
end $$;
select pg_temp.expect_error($q$select pg_temp.answer('link-three-v2-second', 'accepted')$q$, 'Invalid or expired link');

-- A quotation past its validity date shows nothing and cannot be reissued ------------------
select pg_temp.issue('00000000-0000-4000-8000-000000000202', 'link-four-v2-third');
set session_replication_role = replica; -- fixture only: age the quotation past its validity date
update public.quotes set valid_until = current_date - 1 where id = '00000000-0000-4000-8000-000000000202';
set session_replication_role = origin;
do $$
declare r jsonb := pg_temp.view('link-four-v2-third');
begin
  perform pg_temp.check(not (r->>'open')::boolean and r->>'state' = 'expired' and pg_temp.leaks(r) = '{}', 'link to an out-of-date quotation is closed and shows nothing');
end $$;
select pg_temp.expect_error($q$select pg_temp.answer('link-four-v2-third', 'accepted')$q$, 'Quotation has expired');
select pg_temp.expect_error($q$select pg_temp.issue('00000000-0000-4000-8000-000000000202', 'link-five')$q$, 'passed its validity date');
set session_replication_role = replica;
update public.quotes set valid_until = current_date + 30 where id = '00000000-0000-4000-8000-000000000202';
set session_replication_role = origin;

-- Acceptance --------------------------------------------------------------------------------
select pg_temp.issue('00000000-0000-4000-8000-000000000202', 'link-six-v2-accept');
select pg_temp.check((pg_temp.answer('link-six-v2-accept', 'accepted', 'Go ahead'))->>'decision' = 'accepted', 'customer can accept the newest version');
select pg_temp.check((select status::text from public.quotes where id = '00000000-0000-4000-8000-000000000202') = 'accepted'
  and (select status::text from public.consultation_requests where id = '00000000-0000-4000-8000-000000000101') = 'won', 'acceptance updates the quotation and the enquiry');
select pg_temp.expect_error($q$select pg_temp.answer('link-six-v2-accept', 'rejected')$q$, 'Invalid or expired link');
do $$
declare r jsonb := pg_temp.view('link-six-v2-accept');
begin
  perform pg_temp.check(r->>'state' = 'answered' and r->>'decision' = 'accepted' and pg_temp.leaks(r) = '{}', 'accepted link is closed and shows nothing');
end $$;
select pg_temp.expect_error($q$insert into public.quotes(request_id, quote_number, version, subtotal_pence, tax_rate_basis_points, tax_pence, scope)
  values ('00000000-0000-4000-8000-000000000101', 'FFQ-TEST-1-R3', 3, 100, 0, 0, 'x')$q$, 'already has an accepted quotation');
select pg_temp.expect_error($q$update public.quotes set status = 'rejected', accepted_at = null where id = '00000000-0000-4000-8000-000000000202'$q$, 'accepted quote is locked');

-- Declining on a second enquiry ------------------------------------------------------------
insert into public.quotes(id, request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope, valid_until)
values ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000102', 'FFQ-TEST-2', 50000, 0, 0, 'Legacy single-figure quotation', current_date + 10);
select pg_temp.issue('00000000-0000-4000-8000-000000000301', 'link-decline');
select pg_temp.check((pg_temp.answer('link-decline', 'rejected'))->>'decision' = 'rejected', 'customer can decline');
select pg_temp.check((select status::text from public.consultation_requests where id = '00000000-0000-4000-8000-000000000102') = 'lost'
  and (select status::text from public.quotes where id = '00000000-0000-4000-8000-000000000301') = 'rejected', 'declining closes the enquiry and the quotation');

-- Discarding drafts and jobs stepping back ---------------------------------------------------
insert into public.quotes(id, request_id, quote_number, subtotal_pence, tax_rate_basis_points, tax_pence, scope)
values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000103', 'FFQ-TEST-3', 100, 0, 0, 'Draft only');
update public.quotes set status = 'superseded' where id = '00000000-0000-4000-8000-000000000401';
select pg_temp.check((select status::text from public.quotes where id = '00000000-0000-4000-8000-000000000401') = 'superseded', 'an unsent draft can be discarded');
insert into public.work_orders(id, request_id, accepted_quote_id, work_order_number, title, agreed_total_pence)
values ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000202', 'FFJ-TEST-1', 'Fictional job', 128000);
update public.work_orders set status = 'in_progress' where id = '00000000-0000-4000-8000-000000000501';
update public.work_orders set status = 'ready_to_build' where id = '00000000-0000-4000-8000-000000000501';
select pg_temp.check((select status::text from public.work_orders where id = '00000000-0000-4000-8000-000000000501') = 'ready_to_build', 'a job can step back from in progress');
select pg_temp.expect_error($q$update public.work_orders set status = 'installed' where id = '00000000-0000-4000-8000-000000000501'$q$, 'Invalid status transition');

-- Soft delete -----------------------------------------------------------------------------
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  set local role authenticated;
  update public.consultation_requests set deleted_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000103';
  reset role;
end $$;
select pg_temp.check((select deleted_at > now() - interval '1 minute' and deleted_by = '00000000-0000-4000-8000-0000000000a1' from public.consultation_requests where id = '00000000-0000-4000-8000-000000000103'), 'an enquiry with only a discarded draft can be soft deleted; time and person are set by the database');
update public.consultation_requests set deleted_by = null, deleted_at = '2001-01-01' where id = '00000000-0000-4000-8000-000000000103';
select pg_temp.check((select deleted_by = '00000000-0000-4000-8000-0000000000a1' and deleted_at > '2001-01-02' from public.consultation_requests where id = '00000000-0000-4000-8000-000000000103'), 'deletion time and person cannot be rewritten');
update public.consultation_requests set deleted_at = null where id = '00000000-0000-4000-8000-000000000103';
select pg_temp.check((select deleted_at is null and deleted_by is null from public.consultation_requests where id = '00000000-0000-4000-8000-000000000103'), 'a deleted enquiry can be restored');
select pg_temp.expect_error($q$update public.consultation_requests set deleted_at = now() where id = '00000000-0000-4000-8000-000000000101'$q$, 'must be archived instead of deleted');
insert into public.consultation_requests(id, reference, customer_name, postcode, deleted_at) values ('00000000-0000-4000-8000-000000000104', 'FF-TEST-4', 'Inserted Customer', 'SL4 4DD', now());
select pg_temp.check((select deleted_at is null from public.consultation_requests where id = '00000000-0000-4000-8000-000000000104'), 'a new enquiry cannot be created already deleted');

-- Catalogue: names only, no invented prices ---------------------------------------------------
select pg_temp.check((select count(*) = 12 and count(default_unit_price_pence) = 0 from public.quote_catalogue_items), 'the catalogue starts with 12 named items and no prices');

select pg_temp.check(true, 'all owner desk database tests finished');
