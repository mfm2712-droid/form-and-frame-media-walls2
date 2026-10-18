-- DRAFT — NOT APPLIED, NOT in supabase/migrations on purpose (so `supabase db push` cannot pick it up).
-- DO NOT APPLY without Mark's/an owner's explicit approval. Requires is_owner() from the least-privilege draft (20261017180000) to be applied first.
-- App side: operations/customer-store.mjs already reads/writes this table and falls back to the enquiry-derived list while it is absent.
-- Issue #32 (G7). Needs Mark's approval of the data model; ship in a SEPARATE PR with a real timestamp.
-- The staff app already shows a customer list DERIVED from enquiries (operations/customers.mjs) and does
-- NOT need this table; this is the persistent form, so later features (notes, GDPR export/erase) have a home.
--
-- Additive only: new table + nullable consultation_requests.customer_id. Nothing is deleted or rewritten.
-- Identity = lower(email) OR normalised phone, the same rule as the client (operations/customers.mjs).
-- Uses is_staff()/is_owner() (is_owner comes from the least-privilege draft, 20261017180000); the owners
-- (Thiago and Anthony, identical permissions) are the only writers. No Manager role is involved.
--
-- Rollback (manual): alter table public.consultation_requests drop column if exists customer_id;
--                    drop table if exists public.customers;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  email text check (email is null or email = lower(email)),
  phone_normalised text,
  postcode text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_email_key on public.customers (email) where email is not null;
create unique index if not exists customers_phone_key on public.customers (phone_normalised) where phone_normalised is not null;

alter table public.customers enable row level security;
create policy customers_staff_read on public.customers for select to authenticated using (public.is_staff());
create policy customers_owner_insert on public.customers for insert to authenticated with check (public.is_owner());
create policy customers_owner_update on public.customers for update to authenticated using (public.is_owner()) with check (public.is_owner());
-- no delete policy: erasure requests are handled deliberately by an owner in SQL, not by the app.

alter table public.consultation_requests add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists consultation_requests_customer_id_idx on public.consultation_requests (customer_id);

-- BACKFILL DRY RUN (read-only): shows how many distinct customers the rule would create.
-- Run it, review the numbers with an owner, and only then write a real backfill in the apply PR.
--   select count(distinct lower(email)) filter (where email is not null) as by_email,
--          count(distinct regexp_replace(phone, '\D', '', 'g')) filter (where phone is not null) as by_phone
--   from public.consultation_requests;
