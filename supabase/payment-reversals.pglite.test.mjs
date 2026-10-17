// Local throwaway PGlite test for the UNAPPLIED payment reversal draft (#14).
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
const draftFile = (await readdir(draftsDir)).find(f => f.includes("payment_reversals"));
const OWNER = "00000000-0000-4000-8000-000000000001", STAFF = "00000000-0000-4000-8000-000000000003";
const INV = "40000000-0000-4000-8000-000000000001", PAY = "50000000-0000-4000-8000-000000000001", PAY2 = "50000000-0000-4000-8000-000000000002";

test("draft sits outside supabase/migrations and is marked DO NOT APPLY", async () => {
  assert.ok(draftFile);
  assert.ok(!(await readdir(migrations)).some(f => /reversal/i.test(f)));
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
    insert into auth.users(id, email) values ('${OWNER}','o@test.invalid'),('${STAFF}','s@test.invalid');
    insert into public.profiles(id, full_name, role) values ('${OWNER}','Test Owner','owner'),('${STAFF}','Test Staff','staff');
    set session_replication_role = replica;
    insert into public.consultation_requests(id, reference, customer_name, postcode) values ('10000000-0000-4000-8000-000000000001','REQ-T1','Test Customer','AA1 1AA');
    insert into public.quotes(id, request_id, quote_number, status, subtotal_pence, tax_rate_basis_points, tax_pence, scope, sent_at, accepted_at)
      values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Q-T1','accepted',100000,2000,20000,'scope','2026-01-01','2026-01-02');
    insert into public.work_orders(id, request_id, accepted_quote_id, work_order_number, title, agreed_total_pence)
      values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','WO-T1','Test job',120000);
    insert into public.invoices(id, work_order_id, invoice_number, status, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence, sent_at)
      values ('${INV}','30000000-0000-4000-8000-000000000001','INV-T1','sent','Test Customer','1 Test Street Testville','2026-01-01','2026-02-01',100000,2000,20000,'2026-01-01');
    insert into public.invoice_payments(id, invoice_id, amount_pence, method) values ('${PAY}','${INV}',50000,'bank_transfer'),('${PAY2}','${INV}',70000,'cash');
    set session_replication_role = origin;`);
  return db;
}
async function as(db, who, sql, { keep = false } = {}) {
  await db.exec("begin");
  try {
    await db.exec(who === "service" ? "set local role service_role" : who === "anon" ? "set local role anon" : `set local role authenticated; select set_config('request.jwt.claim.sub', '${who}', true)`);
    const res = await db.query(sql);
    if (keep) await db.exec("commit");
    return { ok: true, rows: res.rows };
  } catch (e) { if (keep) await db.exec("rollback"); return { ok: false, error: e.message }; }
  finally { if (!keep) await db.exec("rollback"); }
}
const reverse = (id, reason = "Wrong invoice selected", key = "gen_random_uuid()") =>
  `insert into public.invoice_payment_reversals(payment_id, reason, reversal_key, amount_pence, invoice_id) values ('${id}', '${reason}', ${key}, 1, '${INV}') returning amount_pence, invoice_id, reversed_by`;
const balance = `select paid_pence, outstanding_pence from public.invoice_balances where id = '${INV}'`;

test("baseline: without the draft a paid invoice cannot be corrected and no reversal table exists", { skip }, async () => {
  const db = await bootstrap(false);
  assert.equal((await as(db, OWNER, "select 1 from public.invoice_payment_reversals")).ok, false);
  assert.match((await as(db, OWNER, "update public.invoices set status = 'void' where id = '" + INV + "'")).error, /cannot be voided/);
  assert.equal((await as(db, OWNER, balance)).rows[0].paid_pence, 120000);
});

test("owner reverses a payment: amount and invoice come from the payment, balance recomputes", { skip }, async () => {
  const db = await bootstrap(true);
  const r = await as(db, OWNER, reverse(PAY), { keep: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows[0].amount_pence, 50000, "client-supplied amount (1) is ignored");
  assert.equal(r.rows[0].invoice_id, INV);
  assert.equal(r.rows[0].reversed_by, OWNER);
  assert.deepEqual((await as(db, OWNER, balance)).rows[0], { paid_pence: 70000, outstanding_pence: 50000 });
  const summary = await as(db, OWNER, "select paid_pence from public.work_order_financial_summary");
  assert.equal(summary.rows[0].paid_pence, 70000);
  const log = await as(db, OWNER, "select event_type, entity_type, actor_id from public.workflow_activity where event_type = 'payment_reversed'");
  assert.deepEqual(log.rows, [{ event_type: "payment_reversed", entity_type: "payment", actor_id: OWNER }]);
  assert.equal((await as(db, OWNER, "select count(*)::int c from public.invoice_payments")).rows[0].c, 2, "original payment rows are untouched");
});

test("only the owner can reverse; staff and anon cannot; reason is mandatory", { skip }, async () => {
  const db = await bootstrap(true);
  assert.match((await as(db, STAFF, reverse(PAY))).error, /row-level security/);
  assert.equal((await as(db, "anon", reverse(PAY))).ok, false);
  assert.match((await as(db, OWNER, reverse(PAY, "x"))).error, /check/i);
  assert.match((await as(db, OWNER, reverse(PAY, "     "))).error, /check/i);
  assert.equal((await as(db, STAFF, "select count(*)::int c from public.invoice_payment_reversals")).ok, true, "team can read reversals");
});

test("a payment can be reversed only once; the same key is idempotent", { skip }, async () => {
  const db = await bootstrap(true);
  const key = "'aaaaaaaa-0000-4000-8000-000000000001'";
  assert.equal((await as(db, OWNER, reverse(PAY, "Wrong invoice selected", key), { keep: true })).ok, true);
  const again = await as(db, OWNER, reverse(PAY, "Wrong invoice selected", key));
  assert.equal(again.ok, false);
  assert.match(again.error, /unique|duplicate/i);
  assert.match((await as(db, OWNER, reverse(PAY))).error, /unique|duplicate/i);
  assert.equal((await as(db, OWNER, "select count(*)::int c from public.invoice_payment_reversals")).rows[0].c, 1);
  assert.match((await as(db, OWNER, reverse("50000000-0000-4000-8000-0000000000ff"))).error, /does not exist|foreign|violates/i);
});

test("append-only: nobody can update, delete or truncate reversals", { skip }, async () => {
  const db = await bootstrap(true);
  await as(db, OWNER, reverse(PAY), { keep: true });
  for (const who of [OWNER, STAFF, "service"]) {
    assert.equal((await as(db, who, "update public.invoice_payment_reversals set reason = 'tampered reason'")).ok, false, `${who} update`);
    assert.equal((await as(db, who, "delete from public.invoice_payment_reversals")).ok, false, `${who} delete`);
  }
  // service_role bypasses RLS and grants, so the trigger itself must be what refuses it.
  for (const stmt of ["update public.invoice_payment_reversals set reason = 'tampered reason'", "delete from public.invoice_payment_reversals"]) {
    assert.match((await as(db, "service", stmt)).error, /append-only/);
  }
  assert.equal((await as(db, OWNER, "truncate public.invoice_payment_reversals")).ok, false);
  assert.equal((await as(db, OWNER, "select count(*)::int c from public.invoice_payment_reversals")).rows[0].c, 1);
});

test("overpayment guard counts net payments: re-recording after a reversal works, overpaying still fails", { skip }, async () => {
  const db = await bootstrap(true);
  const insertPayment = amount => `insert into public.invoice_payments(invoice_id, amount_pence, method) values ('${INV}', ${amount}, 'bank_transfer')`;
  assert.match((await as(db, OWNER, insertPayment(1))).error, /exceed/);
  await as(db, OWNER, reverse(PAY), { keep: true });
  assert.equal((await as(db, OWNER, insertPayment(50000))).ok, true, "correction = reversal + new payment");
  assert.match((await as(db, OWNER, insertPayment(50001))).error, /exceed/);
});

test("a fully reversed invoice can be voided; a partially reversed one cannot", { skip }, async () => {
  const db = await bootstrap(true);
  const voidIt = `update public.invoices set status = 'void' where id = '${INV}'`;
  await as(db, OWNER, reverse(PAY), { keep: true });
  assert.match((await as(db, OWNER, voidIt)).error, /reverse the payments first/);
  await as(db, OWNER, reverse(PAY2), { keep: true });
  assert.equal((await as(db, OWNER, voidIt)).ok, true);
});

test("the client-callable surface is limited: helper not executable, anon has no table access", { skip }, async () => {
  const db = await bootstrap(true);
  assert.equal((await as(db, STAFF, `select public.invoice_net_paid_pence('${INV}')`)).ok, false);
  assert.equal((await as(db, "anon", "select * from public.invoice_payment_reversals")).ok, false);
});
