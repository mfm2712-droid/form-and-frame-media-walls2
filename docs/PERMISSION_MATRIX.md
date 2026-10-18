# Permission matrix: Owner / Manager / Staff (FRAME-002)

Status: **PROPOSAL + unapplied draft migration.** Nothing here has been applied to any Supabase project. Mark must confirm which roles exist and who holds them. No account is created or promoted by this work.

Evidence: derived from the real tables in `supabase/migrations/*` (main @ 31a08f6). The machine-readable matrix is `supabase/permission-matrix.mjs`; the draft migration is `supabase/drafts/20261017180000_least_privilege_roles_DRAFT.sql` (deliberately outside `supabase/migrations/`; DO NOT APPLY / not for `supabase db push`; tests are `supabase/permissions.static.test.mjs` (always run) and `supabase/permissions.rls.test.mjs` (real RLS on a local throwaway PGlite database; skipped if PGlite is not installed).

## Problem today (verified)
`profiles.role` allows `owner` and `staff`, but every policy except `business_settings` writes uses `is_staff()` (owner OR staff). Any account with a profile row can read all customer data, quotes, jobs (agreed total, actual cost), invoices and payments, and can create quotes/invoices and record payments. The test `baseline (existing migrations)` reproduces this on a local database.

## Proposed matrix
S select, I insert, U update, D delete, `s*` = filtered select.

| Object | Owner | Manager | Staff |
|---|---|---|---|
| profiles | S | S | S |
| consultation_requests (customer PII) | S I U | S I U | S I U (decision A) |
| request_uploads, availability_blocks | S I U D | S I U D | S I U D |
| appointments, follow_up_tasks | S I U | S I U | S I U |
| quotes | S I U | S I U | none |
| work_orders (agreed total, actual cost) | S I U | S I U (not actual cost) | none; money-free view `work_orders_staff_view` (S) |
| invoices | S I U (send/void) | S I U drafts only | none |
| invoice_payments | S I | S | none |
| invoice_balances, work_order_financial_summary (security_invoker views) | S | S | none (inherit base-table RLS) |
| workflow_activity | S | S | S excluding quote/invoice/payment rows |
| business_settings (VAT, bank text) | S I U | S | none |
| notification_events, push_subscriptions, preferences, reads | unchanged (own rows / team outbox) | same | same |
| DELETE on quotes, work_orders, invoices, payments | none | none | none |

## Open decisions for Mark
A. May Staff see customer phone/email? (Draft keeps today's behaviour; RLS cannot hide single columns, a view/RPC would be needed.)
B. Does the Manager role exist at all, and who holds it? (Without a Manager, Owner and Staff alone already close the P0.)
C. Who may send/void invoices and record payments (draft: owner only)?
D. Should Staff be able to update job status? (Draft: no direct write to `work_orders`; needs a narrow RPC or view-based update if wanted.)

## UI dependencies (must ship before applying)
The Operations app currently loads quotes, work orders, invoices, payments and business settings for every signed-in role, and `staff-access.mjs` only recognises `owner`/`staff`. Before the migration is applied the app must (1) accept `manager`, (2) skip money queries for `staff` and read `work_orders_staff_view` instead, (3) tolerate empty/denied money tables. The UI is not the security control; RLS is.

## Not verified
Real production policies, grants and profile rows (no live access). The local test uses stand-ins for Supabase `auth.uid()`, roles, `storage` and realtime; `pg_cron`/`pg_net`, Edge Functions and Realtime row filtering are not exercised. Column-level exposure through the Supabase REST API and the `profiles` realtime stream are unchanged by this draft.

## Payment void / correction design (proposal, not implemented)
Today `invoice_payments` is insert-only and an invoice with payments cannot be voided, so a mistaken payment can only be fixed with SQL. Proposal: append-only reversals.
- Add `invoice_payment_reversals(id, payment_id unique references invoice_payments, reason text not null, reversed_by, created_at)`; owner-only insert, no update/delete, never alters the original row.
- Balance views subtract reversed payments (`paid = sum(amount) - sum(reversed amount)`); keep `recording_key` idempotency for reversals too.
- `prevent_invoice_overpayment` and the void guard count only non-reversed payments, so a fully reversed invoice can be voided.
- Refunds of real card money (future Stripe) are a separate record type tied to a provider refund id; do not model them until the commercial flow is approved.
- Every reversal writes `workflow_activity` (entity `payment`). Tests: cannot reverse twice, cannot reverse others' invoices, balances recompute, staff/manager cannot reverse.
