// Local throwaway PGlite test for the UNAPPLIED server-side numbering draft.
// Nothing connects to Supabase. Skipped when PGlite is not installed
// (set PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js).
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

let PGlite = null;
try { PGlite = (await import(process.env.PGLITE_MODULE || "@electric-sql/pglite")).PGlite; } catch { /* optional */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const migrations = new URL("./migrations/", import.meta.url);
const draftsDir = new URL("./drafts/", import.meta.url);
const draftFile = (await readdir(draftsDir)).find(f => f.includes("server_side_numbering"));
const STAFF = "00000000-0000-4000-8000-000000000003", NOBODY = "00000000-0000-4000-8000-000000000009";

test("draft sits outside supabase/migrations and is marked DO NOT APPLY", async () => {
  assert.ok(draftFile);
  assert.ok(!(await readdir(migrations)).some(f => /numbering/i.test(f)));
  assert.match(await readFile(new URL(draftFile, draftsDir), "utf8"), /DO NOT APPLY/);
});

async function bootstrap(applyDraft) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;`);
  for (const f of (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort()) {
    await db.exec((await readFile(new URL(f, migrations), "utf8")).replace(/create extension if not exists pgcrypto;/, ""));
  }
  if (applyDraft) await db.exec(await readFile(new URL(draftFile, draftsDir), "utf8"));
  await db.exec(`
    insert into auth.users(id, email) values ('${STAFF}','s@test.invalid'),('${NOBODY}','n@test.invalid');
    insert into public.profiles(id, full_name, role) values ('${STAFF}','Test Staff','staff');
    set session_replication_role = replica;
    insert into public.consultation_requests(id, reference, customer_name, postcode) values ('10000000-0000-4000-8000-000000000001','REQ-T1','Test Customer','AA1 1AA');
    insert into public.quotes(id, request_id, quote_number, status, subtotal_pence, tax_rate_basis_points, tax_pence, scope, sent_at, accepted_at)
      values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','FFQ-LEGACY-1','accepted',100000,2000,20000,'scope','2026-01-01','2026-01-02');
    set session_replication_role = origin;`);
  return db;
}
async function as(db, who, sql) {
  await db.exec("begin");
  try {
    await db.exec(who === "anon" ? "set local role anon" : `set local role authenticated; select set_config('request.jwt.claim.sub', '${who}', true)`);
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) { return { ok: false, error: e.message }; } finally { await db.exec("rollback"); }
}
const quoteInsert = number => `insert into public.quotes(request_id, quote_number, version, subtotal_pence, tax_rate_basis_points, tax_pence, scope)
  values ('10000000-0000-4000-8000-000000000001', ${number}, 9, 100, 0, 0, 's') returning quote_number`;

test("without the draft the RPC does not exist (client must fall back)", { skip }, async () => {
  const db = await bootstrap(false);
  const r = await as(db, STAFF, "select public.allocate_document_number('quote')");
  assert.equal(r.ok, false);
  assert.match(r.error, /allocate_document_number/);
  assert.equal((await as(db, STAFF, quoteInsert("'FFQ-20261017-ABCD'"))).ok, true, "browser-supplied numbers still insert");
});

test("RPC returns sequential, formatted numbers per kind", { skip }, async () => {
  const db = await bootstrap(true);
  await db.exec("set role authenticated; select set_config('request.jwt.claim.sub', '" + STAFF + "', false)");
  const q = [], j = [], i = [];
  for (let n = 0; n < 3; n++) {
    q.push((await db.query("select public.allocate_document_number('quote') as n")).rows[0].n);
    j.push((await db.query("select public.allocate_document_number('work_order') as n")).rows[0].n);
    i.push((await db.query("select public.allocate_document_number('invoice') as n")).rows[0].n);
  }
  assert.deepEqual(q, ["FFQ-000001", "FFQ-000002", "FFQ-000003"]);
  assert.deepEqual(j, ["FFJ-000001", "FFJ-000002", "FFJ-000003"]);
  assert.deepEqual(i, ["FFI-000001", "FFI-000002", "FFI-000003"]);
});

test("only team members can allocate; anon and profile-less users cannot; unknown kinds fail", { skip }, async () => {
  const db = await bootstrap(true);
  assert.equal((await as(db, "anon", "select public.allocate_document_number('quote')")).ok, false);
  assert.match((await as(db, NOBODY, "select public.allocate_document_number('quote')")).error, /team members/);
  assert.equal((await as(db, STAFF, "select public.allocate_document_number('nope')")).ok, false);
  assert.equal((await as(db, STAFF, "select public.next_document_number_unchecked('quote')")).ok, false, "unchecked helper is not callable by clients");
  assert.equal((await as(db, STAFF, "select nextval('public.quote_number_seq')")).ok, false, "sequences are not directly usable by clients");
});

test("concurrent allocations are unique", { skip }, async () => {
  const db = await bootstrap(true);
  const results = await Promise.all(Array.from({ length: 25 }, () => db.query("select public.next_document_number_unchecked('invoice') as n")));
  const numbers = results.map(r => r.rows[0].n);
  assert.equal(new Set(numbers).size, 25);
});

test("a row inserted without a number gets a server number; supplied numbers still work", { skip }, async () => {
  const db = await bootstrap(true);
  const none = await as(db, STAFF, quoteInsert("null"));
  assert.equal(none.ok, true, none.error);
  assert.match(none.rows[0].quote_number, /^FFQ-\d{6}$/);
  const blank = await as(db, STAFF, quoteInsert("''"));
  assert.equal(blank.ok, true, blank.error);
  assert.match(blank.rows[0].quote_number, /^FFQ-\d{6}$/);
  const supplied = await as(db, STAFF, quoteInsert("'FFQ-20261017-ABCD'"));
  assert.equal(supplied.ok, true, supplied.error);
  assert.equal(supplied.rows[0].quote_number, "FFQ-20261017-ABCD");
  assert.equal((await as(db, STAFF, quoteInsert("'FFQ-LEGACY-1'"))).ok, false, "unique constraint still protects legacy numbers");
});

test("work orders and invoices inserted without a number get server numbers", { skip }, async () => {
  const db = await bootstrap(true);
  const wo = await as(db, STAFF, `insert into public.work_orders(request_id, accepted_quote_id, work_order_number, title, agreed_total_pence)
    values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001', null, 'Test job', 120000) returning work_order_number`);
  assert.equal(wo.ok, true, wo.error);
  assert.match(wo.rows[0].work_order_number, /^FFJ-\d{6}$/);
  const inv = await as(db, STAFF, `with w as (
      insert into public.work_orders(id, request_id, accepted_quote_id, work_order_number, title, agreed_total_pence)
      values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','FFJ-X','Test job',120000) returning id)
    insert into public.invoices(work_order_id, invoice_number, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence)
    select id, null, 'Test Customer', '1 Test Street Testville', '2026-01-01', '2026-02-01', 100, 0, 0 from w returning invoice_number`);
  assert.equal(inv.ok, true, inv.error);
  assert.match(inv.rows[0].invoice_number, /^FFI-\d{6}$/);
});
