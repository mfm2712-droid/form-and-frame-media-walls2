# FRAME-008 — Stripe: design and pending decisions (NO implementation)

Status: **design only**. The repository contains no Stripe code, no Stripe library, no keys and no webhook endpoint (verified: `scripts/stripe-absence.test.mjs` fails if any appears). Nothing here may be built until Mark approves the commercial flow (section 2). No real payment, key, account or webhook may be created by an agent.

## 1. What exists today (real code, main @ 31a08f6)
- `invoices` (`draft|sent|void`) with `total_pence`, tax in basis points, `currency`; view `invoice_balances` (`paid_pence`, `outstanding_pence`, `overdue`).
- `invoice_payments`: `amount_pence > 0`, `method in ('bank_transfer','card','cash','stripe','other')`, `recording_key uuid unique` (client idempotency), **`external_payment_id text unique`**, **`provider_event_id text unique`**, `recorded_by`. The provider-facing columns and the `stripe` method value are already provisioned, but nothing writes them.
- Guards: `prevent_invoice_overpayment` (row-locks the invoice; only `sent` invoices accept payment; sum cannot exceed total), `protect_paid_invoice_balance` (sent invoice amounts frozen, void locked).
- Staff app records payments by hand, with a persisted per-intent idempotency key (`operations/payment-idempotency.mjs`).
- Gaps relevant to Stripe (audit findings): payments cannot be voided/corrected/refunded (issue draft 6); invoice numbers are generated in the browser (draft 7); any staff account can record payments until the FRAME-002 permission work lands; no privacy/terms text; sender/auth email unresolved.

## 2. Commercial decisions required from Mark (blocking)
| # | Decision | Why it matters / options |
|---|---|---|
| 1 | Do customers pay online at all, or is Stripe only for staff-initiated links? | Determines whether any public surface is needed. |
| 2 | What is collected: deposit on quote acceptance, stage payments, final balance, or invoice payments only? | Today payments hang off invoices only; deposits need a deposit-invoice or a new concept. |
| 3 | Deposit rule: fixed %, fixed £, per-job? Refundable? Terms wording | Legal copy must be supplied by Mark/solicitor. |
| 4 | Stripe product: Payment Links, Checkout Sessions, or Invoicing | Payment Links = least code, no custom UI; Checkout = per-invoice session created by a server function. |
| 5 | Payment methods: card only, Apple/Google Pay, bank debit, Klarna/other BNPL | Fees and UK availability differ; Mark to choose. |
| 6 | Who pays fees; any card surcharge | Affects invoice presentation; surcharge rules. |
| 7 | VAT: is the business VAT-registered, rate per line, show VAT on invoices | Existing code deliberately invents no tax treatment. |
| 8 | Refunds/chargebacks: who may refund, from where (Stripe dashboard only vs in-app), policy | Needs the void/correction model (draft 6) first. |
| 9 | Stripe account: legal entity, owner of the account, test vs live cut-over, who holds keys | Keys live only in Supabase secrets/Vercel; never in the repo or chat. |
| 10 | Receipts: Stripe-sent or app-sent; sender domain | Depends on email domain decision. |
| 11 | Data/privacy: what customer data is sent to Stripe; privacy notice | Must be on the site before taking money. |
| 12 | Who may start/see payments (role): owner only, manager, staff | Follows the FRAME-002 matrix; recommended owner+manager initiate, staff read-only. |

## 3. Proposed architecture (to be confirmed after section 2; independent of which product is chosen)
1. **Server-only secrets.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Supabase Edge Function secrets (names reserved here, values never in repo). Browser gets nothing but a redirect URL.
2. **`create-payment-link` function** (JWT-verified, role-checked): given `invoice_id`, loads the invoice with the caller's own privileges via RLS, refuses non-`sent` invoices, computes amount = `outstanding_pence` **server-side** (never trusts a client amount), creates a Checkout Session/Payment Link with `metadata.invoice_id`, an idempotency key derived from `invoice_id` + outstanding amount, and stores the Stripe object id on a new `payment_attempts` table (separate from `invoice_payments`, so unpaid attempts never look like money).
3. **`stripe-webhook` function** (`verify_jwt = false`, like the existing token-based functions): verify `Stripe-Signature` over the **raw body** with a timestamp tolerance before parsing; reject otherwise; handle only `checkout.session.completed` (async success events if bank debits are chosen), `charge.refunded`/`charge.dispute.*` later; ignore unknown events with 200.
4. **Idempotent recording.** Insert into `invoice_payments` with `method='stripe'`, `provider_event_id = event.id` (unique → replays are no-ops), `external_payment_id = payment_intent id` (unique), `recording_key` derived from the event id, amount from Stripe's confirmed amount, never from client data. The existing overpayment trigger remains the last line of defence; on overpayment or void invoice the webhook records the failure for manual review rather than discarding the event.
5. **Reconciliation.** A scheduled/owner-triggered read-only comparison of Stripe charges vs `invoice_payments` by `external_payment_id`, listing unmatched items either side. Test mode and live mode use separate keys/webhook secrets and must never share a database without a mode column.
6. **Refunds/corrections** only after the payment void/correction model exists (append-only reversal rows with reason and actor); no deletion of payment rows.
7. **Audit/notifications.** Webhook outcomes written to `workflow_activity` (entity `payment`) and the existing push outbox, using the generic no-money payload rule already enforced by `queue_workflow_push_notification`.
8. **Logging.** Never log keys, signatures, card data or full events; store event id and type only.

## 4. Test-mode scaffold: deliberately NOT built
Allowed by the brief only if trivially safe and not presupposing the flow. Assessment: even a signature-verifying webhook skeleton presupposes decision 4 (which events/objects) and decision 2 (what a payment is attached to), and a reserved route would be an unauthenticated public endpoint. So no code is added. The pure, product-independent building blocks that are safe to build later, once approved, are: (a) a `verifyStripeSignature(rawBody, header, secret, now, toleranceSeconds)` helper with test vectors computed locally from a fictional secret; (b) the idempotent `record_stripe_payment` SQL function; (c) the `payment_attempts` table. Each is test-only without any Stripe account.

## 5. Test plan (all with fictional data, local, no network)
Signature: valid / wrong secret / tampered body / stale timestamp / missing header / multiple `v1` signatures. Idempotency: same event twice → one payment; concurrent duplicates; event for void invoice; event exceeding outstanding. Authorisation: staff cannot create links; anon refused. Amount: tampered client amount ignored. PGlite tests for the recording function and constraints (as in FRAME-002/007). Later, with Mark's approval and a Stripe **test-mode** account only: end-to-end with Stripe CLI event forwarding.

## 6. Prerequisites before any build
FRAME-002 role model applied (Mark's approval); payment void/correction model (draft 6); server-side invoice numbering (draft 7); privacy notice; confirmed sender domain; Mark's answers to section 2.

## 7. NOT verified
Stripe API behaviour/versions and UK method availability (not consulted from live docs in this pass); fees; any legal/VAT/consumer-law wording (needs a professional); live Supabase schema matches the migrations.
