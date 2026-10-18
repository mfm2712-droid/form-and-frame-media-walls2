-- DRAFT / NOT APPLIED. DO NOT APPLY / not for `supabase db push`.
-- Lives in supabase/drafts/ on purpose (outside supabase/migrations/). When Mark approves,
-- move it to supabase/migrations/ and drop _DRAFT from the name in a separate reviewed PR.
-- Issue: #14 (payment void/correction). Verified only on a local throwaway PGlite database
-- (supabase/payment-reversals.pglite.test.mjs).
--
-- Design (append-only; the original payment row is never modified or deleted)
--   * invoice_payment_reversals: one reversal per payment (unique payment_id), with a mandatory
--     reason, a client idempotency key and the acting owner. Amount/invoice are copied from the
--     payment by trigger, so a client cannot reverse a different amount.
--   * Insert is OWNER ONLY (profiles.role = 'owner'; same rule business_settings already uses).
--     Everyone on the team may read. No UPDATE / DELETE / TRUNCATE for anybody (trigger + revoke).
--   * Net paid = payments - reversals. The overpayment guard, the void guard and the
--     "invoice total cannot drop below payments" guard now use the net amount, so a fully
--     reversed invoice can be voided and a corrected invoice issued (#34).
--   * invoice_balances / work_order_financial_summary: same columns, paid_pence is now net.
--   * A reversal is logged in workflow_activity (entity 'payment', event 'payment_reversed').
--   * A correction of an amount = reversal + a new payment (two append-only rows), never an edit.
-- Not covered: refunds of real card money (future Stripe, provider refund ids), push/email
-- notification for reversals, any UI beyond the owner-only hook in operations/app.js.
--
-- Compatibility: independent of the permissions draft (PR #23). It uses an inline owner check,
-- not is_owner(), so it applies on main as-is and keeps working if #23 is applied before or
-- after. If #23 is applied, the invoice_payments SELECT policy there (managers/owners only) also
-- governs who sees payments; reversals stay readable by any team member (amounts only, no PII).
-- Rollback: drop the two triggers/functions on the table, restore the previous versions of
-- prevent_invoice_overpayment, protect_paid_invoice_balance and the two views from
-- 20261005130000, then drop table invoice_payment_reversals (only while it is empty).

create table public.invoice_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  reversal_key uuid not null unique default gen_random_uuid(),
  payment_id uuid not null unique references public.invoice_payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_pence bigint not null check (amount_pence > 0),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  reversed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index invoice_payment_reversals_invoice_idx on public.invoice_payment_reversals(invoice_id);

-- Net paid helper for trigger use only (not callable by clients).
create or replace function public.invoice_net_paid_pence(target uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount_pence) from public.invoice_payments where invoice_id = target), 0)
       - coalesce((select sum(amount_pence) from public.invoice_payment_reversals where invoice_id = target), 0);
$$;
revoke all on function public.invoice_net_paid_pence(uuid) from public, anon, authenticated;

create or replace function public.prepare_payment_reversal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  original public.invoice_payments%rowtype;
begin
  select * into original from public.invoice_payments where id = new.payment_id for update;
  if not found then
    raise exception 'The payment to reverse does not exist.' using errcode = '23503';
  end if;
  new.invoice_id := original.invoice_id;
  new.amount_pence := original.amount_pence;
  if auth.uid() is not null then new.reversed_by := auth.uid(); end if;
  return new;
end;
$$;
create trigger payment_reversals_prepare before insert on public.invoice_payment_reversals
for each row execute function public.prepare_payment_reversal();

create or replace function public.reject_payment_reversal_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Payment reversals are append-only.' using errcode = '42501';
end;
$$;
create trigger payment_reversals_append_only before update or delete on public.invoice_payment_reversals
for each row execute function public.reject_payment_reversal_change();

create or replace function public.log_payment_reversal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workflow_activity(entity_type, entity_id, event_type, actor_id, details)
  values ('payment', new.payment_id, 'payment_reversed', auth.uid(), jsonb_build_object('reversal_id', new.id));
  return new;
end;
$$;
create trigger payment_reversal_logged after insert on public.invoice_payment_reversals
for each row execute function public.log_payment_reversal();

alter table public.invoice_payment_reversals enable row level security;
create policy "staff read payment reversals" on public.invoice_payment_reversals for select using (public.is_staff());
create policy "owners reverse payments" on public.invoice_payment_reversals for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
revoke all on public.invoice_payment_reversals from anon;
revoke update, delete, truncate on public.invoice_payment_reversals from authenticated;

-- Guards now use net payments.
create or replace function public.prevent_invoice_overpayment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invoice_total bigint;
  invoice_current_status public.invoice_status;
  already_paid bigint;
begin
  select total_pence, status into invoice_total, invoice_current_status from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'A payment requires an active invoice.' using errcode = '23514';
  end if;
  if invoice_current_status <> 'sent' then
    raise exception 'A payment can only be recorded against a sent invoice.' using errcode = '23514';
  end if;
  select public.invoice_net_paid_pence(new.invoice_id) -
         coalesce((select sum(amount_pence) from public.invoice_payments p
                   where p.id = new.id and not exists (select 1 from public.invoice_payment_reversals r where r.payment_id = p.id)), 0)
    into already_paid;
  if already_paid + new.amount_pence > invoice_total then
    raise exception 'The payment would exceed the outstanding invoice balance.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_paid_invoice_balance()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  already_paid bigint;
begin
  if old.status = 'draft' and new.status = 'sent' and (
    new.invoice_number is distinct from old.invoice_number
    or new.work_order_id is distinct from old.work_order_id
    or new.bill_to_name is distinct from old.bill_to_name
    or new.bill_to_address is distinct from old.bill_to_address
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.subtotal_pence is distinct from old.subtotal_pence
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_pence is distinct from old.tax_pence
  ) then
    raise exception 'Finalise invoice details before recording it as sent.' using errcode = '23514';
  end if;

  if old.status = 'void' then
    raise exception 'A void invoice is locked.' using errcode = '23514';
  end if;
  if old.status = 'sent' and (
    new.status not in ('sent', 'void')
    or new.invoice_number is distinct from old.invoice_number
    or new.work_order_id is distinct from old.work_order_id
    or new.bill_to_name is distinct from old.bill_to_name
    or new.bill_to_address is distinct from old.bill_to_address
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.sent_at is distinct from old.sent_at
    or new.subtotal_pence is distinct from old.subtotal_pence
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_pence is distinct from old.tax_pence
  ) then
    raise exception 'A sent invoice is locked; create a corrected invoice instead.' using errcode = '23514';
  end if;
  if new.status = 'void' and old.status <> 'void' then
    already_paid := public.invoice_net_paid_pence(old.id);
    if already_paid > 0 then
      raise exception 'An invoice with recorded payments cannot be voided; reverse the payments first.' using errcode = '23514';
    end if;
  elsif new.status <> 'void' and (new.subtotal_pence + new.tax_pence) is distinct from old.total_pence then
    already_paid := public.invoice_net_paid_pence(old.id);
    if new.subtotal_pence + new.tax_pence < already_paid then
      raise exception 'The invoice total cannot be reduced below the payments already recorded.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Same column list/order as before so CREATE OR REPLACE VIEW is valid; paid_pence is now net.
create or replace view public.invoice_balances with (security_invoker = true) as
select i.id, i.work_order_id, i.invoice_number, i.status, i.issue_date, i.due_date,
       i.currency, i.subtotal_pence, i.tax_pence, i.total_pence,
       n.net::bigint as paid_pence,
       case when i.status = 'sent' then greatest(i.total_pence - n.net, 0)::bigint else 0::bigint end as outstanding_pence,
       (i.status = 'sent' and i.due_date < current_date and n.net < i.total_pence) as overdue
from public.invoices i
cross join lateral (
  select coalesce((select sum(p.amount_pence) from public.invoice_payments p where p.invoice_id = i.id), 0)
       - coalesce((select sum(r.amount_pence) from public.invoice_payment_reversals r where r.invoice_id = i.id), 0) as net
) n
where i.status <> 'void';

create or replace view public.work_order_financial_summary with (security_invoker = true) as
with invoice_totals as (
  select work_order_id, sum(total_pence)::bigint as billed_pence
  from public.invoices where status = 'sent' group by work_order_id
), payment_totals as (
  select i.work_order_id,
         (coalesce(sum(p.amount_pence), 0) - coalesce(sum(r.amount_pence), 0))::bigint as paid_pence
  from public.invoice_payments p
  join public.invoices i on i.id = p.invoice_id
  left join public.invoice_payment_reversals r on r.payment_id = p.id
  where i.status = 'sent' group by i.work_order_id
)
select w.id, w.work_order_number, w.status, w.agreed_total_pence, w.actual_cost_pence,
       coalesce(i.billed_pence, 0)::bigint as billed_pence,
       coalesce(p.paid_pence, 0)::bigint as paid_pence,
       (w.actual_cost_pence is not null) as margin_is_calculable
from public.work_orders w
left join invoice_totals i on i.work_order_id = w.id
left join payment_totals p on p.work_order_id = w.id;
