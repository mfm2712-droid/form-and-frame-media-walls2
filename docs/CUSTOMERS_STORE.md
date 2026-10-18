# Saved customer records (issue #32)

Decision (Mark, 18 Oct 2026): a persistent customers table is wanted.

- **Database (not applied):** `supabase/drafts/20261018120000_customers_DRAFT.sql`. Header says DO NOT APPLY; it stays out of
  `supabase/migrations/` until an owner approves, and needs `is_owner()` from the least-privilege draft first.
  RLS: staff read; only owners insert/update (Thiago and Anthony identical); no delete policy; no Manager role.
- **App:** `operations/customer-store.mjs`. The dashboard tries to read `customers`. If the table is missing (PGRST205 / 42P01 / 404)
  or unreadable it silently keeps today's list derived from enquiries (`customers.mjs`); nothing is written. When present, the list merges
  saved records (owner-edited name, notes) with the derived customers, matched by lower-case email or normalised phone.
- **Writes:** owners see "Save to customer records" / "Edit saved record" (name, notes). `saveCustomerRecord` refuses non-owners before any
  query; RLS enforces the same in the database. Staff see notes read-only.
- **Not done on purpose:** no backfill, no `consultation_requests.customer_id` linking (the draft calls for an owner-reviewed dry run first).
- **Tests:** `operations/customer-store.test.mjs`, `operations/customers-store.app.test.mjs`, `supabase/customers.pglite.test.mjs` (PGlite RLS).
