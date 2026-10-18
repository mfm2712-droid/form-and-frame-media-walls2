-- DRAFT / NOT APPLIED. FRAME-002 corrective migration: role-based least privilege.
-- DO NOT APPLY / not for supabase db push. This file lives in supabase/drafts/ on purpose
-- (outside supabase/migrations/). When Mark approves, move it to supabase/migrations/
-- and drop _DRAFT from the name in a separate, reviewed PR.
-- Status: prepared locally for review by Mark. Applying it to any real Supabase
-- project needs Mark's explicit approval, a rollback plan, and the matching
-- Operations app change (staff must stop reading money tables; see
-- docs/PERMISSION_MATRIX.md "UI dependencies"). Verified only against a local
-- throwaway PGlite database (see supabase/permissions.rls.test.mjs).
--
-- Roles after this migration (profiles.role):
--   owner   - full access, as today.
--   manager - customers, quotes, jobs, draft invoices, read-only payments.
--   staff   - operational records (enquiries, calendar, follow-ups, job
--             tracking without money). No quotes, invoices, payments or finance.
-- No account is created or promoted here; roles are assigned by the owner via
-- service role / SQL after Mark decides who holds which role.
-- Not touched: submit-enquiry edge function (service role bypasses RLS),
-- notification claim RPCs, rate-limit tables, storage policies.

-- 1. Allow the new role value. Existing rows (owner/staff) stay valid.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'manager', 'staff'));

-- 2. Role helpers. is_staff() keeps meaning "any signed-in team member" so every
--    existing policy that still uses it keeps working.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'manager', 'staff'));
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

create or replace function public.is_manager_or_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'manager'));
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_manager_or_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;
grant execute on function public.is_manager_or_owner() to authenticated, service_role;

-- 3. Quotes: owner + manager only.
drop policy if exists "staff read quotes" on public.quotes;
drop policy if exists "staff create quotes" on public.quotes;
drop policy if exists "staff update quotes" on public.quotes;
create policy "managers read quotes" on public.quotes for select using (public.is_manager_or_owner());
create policy "managers create quotes" on public.quotes for insert with check (public.is_manager_or_owner());
create policy "managers update quotes" on public.quotes for update using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

-- 4. Work orders (agreed total, actual cost): owner + manager read/write.
--    Staff get a money-free view for job tracking.
drop policy if exists "staff read work orders" on public.work_orders;
drop policy if exists "staff create work orders" on public.work_orders;
drop policy if exists "staff update work orders" on public.work_orders;
create policy "managers read work orders" on public.work_orders for select using (public.is_manager_or_owner());
create policy "managers create work orders" on public.work_orders for insert with check (public.is_manager_or_owner());
create policy "managers update work orders" on public.work_orders for update using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

-- Only the owner records the real cost of a job (margin input).
create or replace function public.guard_work_order_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and not public.is_owner()
     and (tg_op = 'INSERT' and new.actual_cost_pence is not null
          or tg_op = 'UPDATE' and new.actual_cost_pence is distinct from old.actual_cost_pence) then
    raise exception 'Only the owner can record the actual cost of a job.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger work_orders_owner_only_cost before insert or update on public.work_orders
for each row execute function public.guard_work_order_cost();

-- Money-free job view for staff. Runs with the view owner's rights (no
-- security_invoker) but filters on the caller's role, so anon gets no rows.
create or replace view public.work_orders_staff_view as
select id, request_id, work_order_number, title, status, assigned_to,
       planned_start, target_completion, actual_started_at, completed_at,
       staff_notes, created_at, updated_at
from public.work_orders
where public.is_staff();
revoke all on public.work_orders_staff_view from public, anon;
grant select on public.work_orders_staff_view to authenticated;

-- 5. Invoices: owner + manager read/write drafts; only the owner may send or void.
drop policy if exists "staff read invoices" on public.invoices;
drop policy if exists "staff create invoices" on public.invoices;
drop policy if exists "staff update invoices" on public.invoices;
create policy "managers read invoices" on public.invoices for select using (public.is_manager_or_owner());
create policy "managers create invoices" on public.invoices for insert with check (public.is_manager_or_owner());
create policy "managers update invoices" on public.invoices for update using (public.is_manager_or_owner()) with check (public.is_manager_or_owner());

create or replace function public.guard_invoice_issue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_owner() and (
       tg_op = 'INSERT' and new.status <> 'draft'
       or tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('sent', 'void')) then
    raise exception 'Only the owner can send or void an invoice.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger invoices_owner_only_issue before insert or update on public.invoices
for each row execute function public.guard_invoice_issue();

-- 6. Payments: owner + manager read; only the owner records. Still insert-only.
drop policy if exists "staff read payments" on public.invoice_payments;
drop policy if exists "staff record payments" on public.invoice_payments;
create policy "managers read payments" on public.invoice_payments for select using (public.is_manager_or_owner());
create policy "owners record payments" on public.invoice_payments for insert with check (public.is_owner());

-- 7. Workflow history: staff must not read money history (quote/invoice/payment).
drop policy if exists "staff read workflow history" on public.workflow_activity;
create policy "staff read operational history" on public.workflow_activity for select
  using (public.is_staff() and (public.is_manager_or_owner() or entity_type not in ('quote', 'invoice', 'payment')));

-- 8. Business settings (VAT, bank/payment text): owner write (as today), manager read.
drop policy if exists "staff read business settings" on public.business_settings;
drop policy if exists "owners create business settings" on public.business_settings;
drop policy if exists "owners update business settings" on public.business_settings;
create policy "managers read business settings" on public.business_settings for select using (public.is_manager_or_owner());
create policy "owners create business settings" on public.business_settings for insert with check (public.is_owner());
create policy "owners update business settings" on public.business_settings for update using (public.is_owner()) with check (public.is_owner());

-- 9. Defence in depth: the anonymous role never needs the financial tables.
--    (RLS already denies it; this removes the table grant as well.)
revoke all on public.quotes, public.work_orders, public.invoices, public.invoice_payments,
  public.business_settings, public.workflow_activity from anon;

-- Unchanged on purpose: profiles (read by team), consultation_requests,
-- request_uploads, availability_blocks, appointments, follow_up_tasks,
-- notification_* and push_subscriptions (own rows), enquiry rate-limit tables.
--
-- ROLLBACK (manual, reviewed before use): recreate the original "staff ..."
-- policies from 20261005130000 and 20261009100000, drop the three triggers/
-- functions guard_*, drop work_orders_staff_view, restore the two-value role
-- check. Do not run while any profile has role 'manager'.
