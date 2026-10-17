// Real Row Level Security test on a LOCAL throwaway in-memory Postgres (PGlite,
// WASM). Nothing connects to Supabase. Skipped automatically when PGlite is not
// installed. Run with:  PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test
// or install it outside the repo and set NODE_PATH-style resolution via that env var.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PERMISSION_MATRIX, ROLES, allows } from "./permission-matrix.mjs";

let PGlite = null;
try {
  const mod = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
  PGlite = mod.PGlite;
} catch { /* optional dependency */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE); static policy tests still run";

const dir = new URL("./migrations/", import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort();
const draftsDir = new URL("./drafts/", import.meta.url);
const draftFile = (await readdir(draftsDir)).find(f => f.includes("least_privilege_roles"));
const ID = {
  owner: "00000000-0000-4000-8000-000000000001", manager: "00000000-0000-4000-8000-000000000002",
  staff: "00000000-0000-4000-8000-000000000003", nobody: "00000000-0000-4000-8000-000000000009"
};

let db;
async function bootstrap() {
  db = new PGlite();
  // Minimal stand-ins for Supabase platform objects (test scaffolding only).
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
  for (const f of files) await db.exec((await readFile(new URL(f, dir), "utf8")).replace(/create extension if not exists pgcrypto;/, ""));
  await db.exec(`
    insert into auth.users(id, email) values
      ('${ID.owner}','owner@test.invalid'),('${ID.manager}','manager@test.invalid'),('${ID.staff}','staff@test.invalid'),('${ID.nobody}','nobody@test.invalid');
    insert into public.profiles(id, full_name, role) values ('${ID.owner}','Test Owner','owner'),('${ID.staff}','Test Staff','staff');`);
}
async function seed() {
  // Seed as superuser with triggers off so rows can start in any state (test data only).
  await db.exec(`set session_replication_role = replica;
    insert into public.consultation_requests(id, reference, customer_name, postcode) values
      ('10000000-0000-4000-8000-000000000001','REQ-T1','Test Customer One','AA1 1AA'),
      ('10000000-0000-4000-8000-000000000002','REQ-T2','Test Customer Two','AA1 1AB');
    insert into public.quotes(id, request_id, quote_number, status, subtotal_pence, tax_rate_basis_points, tax_pence, scope, sent_at, accepted_at) values
      ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Q-T1','accepted',100000,2000,20000,'scope','2026-01-01','2026-01-02'),
      ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Q-T2','accepted',50000,0,0,'scope','2026-01-01','2026-01-02');
    insert into public.quotes(id, request_id, quote_number, version, status, subtotal_pence, tax_rate_basis_points, tax_pence, scope) values
      ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Q-T3',5,'draft',1000,0,0,'scope');
    insert into public.work_orders(id, request_id, accepted_quote_id, work_order_number, title, agreed_total_pence) values
      ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','WO-T1','Test job',120000);
    insert into public.invoices(id, work_order_id, invoice_number, status, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence, sent_at) values
      ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','INV-T1','sent','Test Customer','1 Test Street Testville','2026-01-01','2026-02-01',100000,2000,20000,'2026-01-01');
    insert into public.invoices(id, work_order_id, invoice_number, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence) values
      ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','INV-T2','Test Customer','1 Test Street Testville','2026-01-01','2026-02-01',100,0,0);
    insert into public.invoice_payments(id, invoice_id, amount_pence, method) values ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1000,'bank_transfer');
    insert into public.request_uploads(request_id, storage_path, file_name, mime_type, bytes) values ('10000000-0000-4000-8000-000000000001','p/x.jpg','x.jpg','image/jpeg',10);
    insert into public.availability_blocks(starts_at, ends_at, title) values ('2026-05-01','2026-05-02','Test block');
    insert into public.appointments(request_id, kind, starts_at, ends_at) values ('10000000-0000-4000-8000-000000000001','survey','2026-05-03T09:00Z','2026-05-03T10:00Z');
    insert into public.follow_up_tasks(request_id, title, due_at) values ('10000000-0000-4000-8000-000000000001','Call back','2026-05-04');
    insert into public.workflow_activity(entity_type, entity_id, event_type) values ('request','10000000-0000-4000-8000-000000000001','seed');
    set session_replication_role = origin;`);
}

// Runs sql as the given DB role/user inside a transaction that is always rolled back.
async function attempt(who, sql, setup = "") {
  await db.exec("begin");
  try {
    if (setup) await db.exec(setup);
    if (who === "anon") await db.exec("set local role anon");
    else if (who === "service") await db.exec("set local role service_role");
    else await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${ID[who]}', true)`);
    const res = await db.query(sql);
    return { ok: true, rows: res.rows, count: res.affectedRows ?? res.rows.length };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { await db.exec("rollback"); }
}

const SELECT_SQL = t => `select * from public.${t}`;
const INSERTS = {
  consultation_requests: `insert into public.consultation_requests(reference, customer_name, postcode) values ('REQ-N','New Customer','AA2 2AA') returning id`,
  quotes: `insert into public.quotes(request_id, quote_number, version, subtotal_pence, tax_rate_basis_points, tax_pence, scope) values ('10000000-0000-4000-8000-000000000002','Q-N',2,1000,0,0,'x') returning id`,
  work_orders: `insert into public.work_orders(request_id, accepted_quote_id, work_order_number, title, agreed_total_pence) values ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','WO-N','New job',50000) returning id`,
  invoices: `insert into public.invoices(work_order_id, invoice_number, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence) values ('30000000-0000-4000-8000-000000000001','INV-N','Test Customer','1 Test Street Testville','2026-03-01','2026-04-01',1000,0,0) returning id`,
  invoice_payments: `insert into public.invoice_payments(invoice_id, amount_pence, method) values ('40000000-0000-4000-8000-000000000001',500,'cash') returning id`,
  business_settings: `insert into public.business_settings(legal_name, billing_address, contact_email) values ('Test Ltd','1 Test Street Testville','a@b.invalid') returning singleton`
};
const UPDATES = {
  consultation_requests: `update public.consultation_requests set staff_notes='n' where id='10000000-0000-4000-8000-000000000001' returning id`,
  quotes: `update public.quotes set assumptions='a' where id='20000000-0000-4000-8000-000000000003' returning id`,
  work_orders: `update public.work_orders set staff_notes='n' where id='30000000-0000-4000-8000-000000000001' returning id`,
  invoices: `update public.invoices set bill_to_name='Renamed Customer' where id='40000000-0000-4000-8000-000000000002' returning id`,
  business_settings: `update public.business_settings set legal_name='Changed Ltd' returning singleton`
};
const BS_SETUP = `insert into public.business_settings(legal_name, billing_address, contact_email) values ('Test Ltd','1 Test Street Testville','a@b.invalid')`;

test("baseline (existing migrations): any staff account can read and write money tables", { skip }, async () => {
  await bootstrap(); await seed();
  for (const table of ["quotes", "work_orders", "invoices", "invoice_payments"]) {
    const r = await attempt("staff", SELECT_SQL(table));
    assert.ok(r.ok && r.rows.length > 0, `BASELINE exposure confirmed: staff can read ${table}`);
  }
  assert.ok((await attempt("staff", INSERTS.invoice_payments)).ok, "BASELINE: staff can record a payment");
  assert.equal((await attempt("staff", UPDATES.business_settings, BS_SETUP)).count, 0, "baseline: business_settings update already owner-only");
});

test("corrective draft migration applies cleanly on top of the existing migrations", { skip }, async () => {
  await db.exec((await readFile(new URL(draftFile, draftsDir), "utf8")));
  await db.exec(`insert into public.profiles(id, full_name, role) values ('${ID.manager}','Test Manager','manager')`);
  const roles = (await db.query("select id, role from public.profiles order by role")).rows;
  assert.deepEqual(roles.map(r => r.role), ["manager", "owner", "staff"]);
});

for (const role of ROLES) {
  test(`policy matrix is enforced by RLS for ${role}`, { skip }, async () => {
    for (const table of Object.keys(PERMISSION_MATRIX)) {
      const sel = await attempt(role, SELECT_SQL(table), table === "business_settings" ? BS_SETUP : "");
      if (allows(table, role, "s")) assert.ok(sel.ok && sel.rows.length > 0, `${role} should read ${table}: ${sel.error || sel.rows?.length}`);
      else assert.ok(sel.ok && sel.rows.length === 0 || !sel.ok, `${role} must not read ${table}`);
      if (INSERTS[table]) {
        const ins = await attempt(role, INSERTS[table]);
        assert.equal(ins.ok, allows(table, role, "i"), `${role} insert ${table}: ${ins.error || "allowed"}`);
      }
      if (UPDATES[table]) {
        const upd = await attempt(role, UPDATES[table], table === "business_settings" ? BS_SETUP : "");
        assert.equal(upd.ok && upd.count > 0, allows(table, role, "u"), `${role} update ${table}: ${upd.error || upd.count}`);
      }
    }
  });
}

test("staff see operational history but not quote/invoice/payment history rows", { skip }, async () => {
  const setup = `insert into public.workflow_activity(entity_type, entity_id, event_type) values ('invoice','40000000-0000-4000-8000-000000000001','t'),('request','10000000-0000-4000-8000-000000000001','t')`;
  const staff = await attempt("staff", "select entity_type from public.workflow_activity where event_type='t'", setup);
  assert.deepEqual(staff.rows.map(r => r.entity_type), ["request"]);
  const manager = await attempt("manager", "select entity_type from public.workflow_activity where event_type='t' order by 1", setup);
  assert.deepEqual(manager.rows.map(r => r.entity_type), ["invoice", "request"]);
});

test("money-free job view hides cost columns and is empty for outsiders", { skip }, async () => {
  const staff = await attempt("staff", "select * from public.work_orders_staff_view");
  assert.equal(staff.rows.length, 1);
  assert.equal("agreed_total_pence" in staff.rows[0], false);
  assert.equal("actual_cost_pence" in staff.rows[0], false);
  assert.equal((await attempt("nobody", "select * from public.work_orders_staff_view")).rows?.length ?? 0, 0);
  assert.equal((await attempt("anon", "select * from public.work_orders_staff_view")).ok, false);
});

test("only the owner may send or void an invoice, set job cost, or record payments", { skip }, async () => {
  const draftInv = `insert into public.invoices(id, work_order_id, invoice_number, bill_to_name, bill_to_address, issue_date, due_date, subtotal_pence, tax_rate_basis_points, tax_pence) values ('40000000-0000-4000-8000-0000000000aa','30000000-0000-4000-8000-000000000001','INV-D','Test Customer','1 Test Street Testville','2026-03-01','2026-04-01',1000,0,0)`;
  const send = `update public.invoices set status='sent', sent_at=now() where id='40000000-0000-4000-8000-0000000000aa' returning id`;
  const mgr = await attempt("manager", send, draftInv);
  assert.equal(mgr.ok, false); assert.match(mgr.error, /Only the owner can send or void/);
  assert.ok((await attempt("owner", send, draftInv)).ok, "owner keeps the ability to send");
  const edit = `update public.invoices set bill_to_name='Edited Name' where id='40000000-0000-4000-8000-0000000000aa' returning id`;
  assert.ok((await attempt("manager", edit, draftInv)).ok, "manager can edit a draft");
  const cost = `update public.work_orders set actual_cost_pence=500 where id='30000000-0000-4000-8000-000000000001' returning id`;
  assert.match((await attempt("manager", cost)).error, /Only the owner can record the actual cost/);
  assert.ok((await attempt("owner", cost)).ok);
  assert.equal((await attempt("manager", INSERTS.invoice_payments)).ok, false);
  assert.ok((await attempt("owner", INSERTS.invoice_payments)).ok);
});

test("payments stay append-only for every role (no update, no delete)", { skip }, async () => {
  for (const who of ["owner", "manager", "staff"]) {
    assert.equal((await attempt(who, "update public.invoice_payments set amount_pence=1 returning id")).count || 0, 0, `${who} update`);
    assert.equal((await attempt(who, "delete from public.invoice_payments returning id")).count || 0, 0, `${who} delete`);
  }
});

test("owner keeps existing behaviour; unassigned and anonymous users get nothing; no role can profile-escalate", { skip }, async () => {
  for (const table of ["quotes", "invoices", "invoice_payments", "consultation_requests", "profiles", "business_settings"]) {
    for (const who of ["nobody", "anon"]) {
      const r = await attempt(who, SELECT_SQL(table), table === "business_settings" ? BS_SETUP : "");
      assert.ok(!r.ok || r.rows.length === 0, `${who} must not read ${table}`);
    }
  }
  for (const who of ["owner", "manager", "staff"]) {
    const r = await attempt(who, `update public.profiles set role='owner' where id='${ID.staff}' returning id`);
    assert.equal(r.count || 0, 0, `${who} cannot change roles`);
    const ins = await attempt(who, `insert into public.profiles(id, role) values ('${ID.nobody}','owner')`);
    assert.equal(ins.ok, false, `${who} cannot create profiles`);
  }
  const bad = await attempt("service", `update public.profiles set role='superuser' where id='${ID.staff}'`);
  assert.equal(bad.ok, false, "role check rejects unknown roles");
});

test("service role (edge functions) still inserts enquiries and is unaffected", { skip }, async () => {
  const r = await attempt("service", INSERTS.consultation_requests);
  assert.ok(r.ok, r.error);
  const anon = await attempt("anon", INSERTS.consultation_requests);
  assert.equal(anon.ok, false, "anonymous REST insert is still refused");
});
