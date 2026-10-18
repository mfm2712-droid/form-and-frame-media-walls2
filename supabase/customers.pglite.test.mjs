// Issue #32: RLS for the UNAPPLIED customers draft, on a throwaway PGlite database (no Supabase involved).
// Staff can read but not write; owners can insert and update; nobody can delete; anon sees nothing.
// Requires PGLITE_MODULE (or an installed @electric-sql/pglite); skipped otherwise.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

let PGlite = null;
try { PGlite = (await import(process.env.PGLITE_MODULE || "@electric-sql/pglite")).PGlite; } catch { /* optional */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";
const migrations = new URL("./migrations/", import.meta.url);
const drafts = new URL("./drafts/", import.meta.url);
const OWNER = "00000000-0000-4000-8000-000000000001", OWNER2 = "00000000-0000-4000-8000-000000000002", STAFF = "00000000-0000-4000-8000-000000000003";

test("the draft is outside supabase/migrations, marked DO NOT APPLY, and states its dependency", async () => {
  const text = await readFile(new URL("20261018120000_customers_DRAFT.sql", drafts), "utf8");
  assert.match(text, /DO NOT APPLY/);
  assert.match(text, /is_owner\(\)[^\n]*least-privilege/i);
  assert.equal((await readdir(migrations)).some(n => /customers/i.test(n)), false);
});

async function bootstrap({ draft }) {
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
  for (const f of (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort()) await db.exec((await readFile(new URL(f, migrations), "utf8")).replace(/create extension if not exists pgcrypto;/, ""));
  if (draft) {
    await db.exec(await readFile(new URL("20261017180000_least_privilege_roles_DRAFT.sql", drafts), "utf8"));
    await db.exec(await readFile(new URL("20261018120000_customers_DRAFT.sql", drafts), "utf8"));
  }
  await db.exec(`insert into auth.users(id, email) values ('${OWNER}','o1@test.invalid'),('${OWNER2}','o2@test.invalid'),('${STAFF}','s@test.invalid');
    insert into public.profiles(id, full_name, role) values ('${OWNER}','Thiago (test)','owner'),('${OWNER2}','Anthony (test)','owner'),('${STAFF}','Test Staff','staff');`);
  return db;
}
async function as(db, who, sql, { keep = false } = {}) {
  await db.exec("begin");
  try {
    await db.exec(who === "anon" ? "set local role anon" : `set local role authenticated; select set_config('request.jwt.claim.sub', '${who}', true)`);
    const res = await db.query(sql);
    if (keep) await db.exec("commit");
    return { ok: true, rows: res.rows };
  } catch (e) { if (keep) await db.exec("rollback"); return { ok: false, error: e.message }; }
  finally { if (!keep) await db.exec("rollback"); }
}
const insert = (name, email = "a@example.test", phone = "07700900123") => `insert into public.customers(full_name, email, phone_normalised, notes) values ('${name}', '${email}', '${phone}', 'n') returning id`;

test("before the draft: no customers table, so the app's derived-list fallback is what runs", { skip }, async () => {
  const db = await bootstrap({ draft: false });
  const r = await as(db, OWNER, "select 1 from public.customers");
  assert.equal(r.ok, false);
  assert.match(r.error, /does not exist/);
});

test("owners (both) insert and update; the second owner has identical rights", { skip }, async () => {
  const db = await bootstrap({ draft: true });
  const a = await as(db, OWNER, insert("Test One"), { keep: true });
  assert.equal(a.ok, true, a.error);
  const b = await as(db, OWNER2, `update public.customers set notes = 'by anthony' where id = '${a.rows[0].id}' returning notes`, { keep: true });
  assert.deepEqual(b.rows, [{ notes: "by anthony" }]);
  assert.equal((await as(db, OWNER2, insert("Test Two", "b@example.test", "07700900456"))).ok, true);
});

test("staff can read customers but cannot insert, update or delete", { skip }, async () => {
  const db = await bootstrap({ draft: true });
  const id = (await as(db, OWNER, insert("Test One"), { keep: true })).rows[0].id;
  assert.equal((await as(db, STAFF, "select count(*)::int c from public.customers")).rows[0].c, 1, "team can read");
  assert.match((await as(db, STAFF, insert("Staff Insert", "s@example.test"))).error, /row-level security/);
  const upd = await as(db, STAFF, `update public.customers set notes = 'staff edit' where id = '${id}' returning id`);
  assert.deepEqual(upd.ok ? upd.rows : [], [], "RLS hides the row from the update: zero rows changed");
  assert.equal((await as(db, OWNER, `select notes from public.customers where id = '${id}'`)).rows[0].notes, "n");
  const del = await as(db, OWNER, `delete from public.customers where id = '${id}' returning id`);
  assert.deepEqual(del.ok ? del.rows : [], [], "nobody deletes through the API");
  const staffDel = await as(db, STAFF, `delete from public.customers where id = '${id}' returning id`);
  assert.deepEqual(staffDel.ok ? staffDel.rows : [], []);
  assert.equal((await as(db, OWNER, "select count(*)::int c from public.customers")).rows[0].c, 1);
});

test("anon cannot read or write; identity rules are enforced (unique email/phone, lower-case email)", { skip }, async () => {
  const db = await bootstrap({ draft: true });
  assert.equal((await as(db, OWNER, insert("Test One"), { keep: true })).ok, true);
  const read = await as(db, "anon", "select * from public.customers");
  assert.equal(read.ok ? read.rows.length : 0, 0);
  assert.equal((await as(db, "anon", insert("Anon", "z@example.test"))).ok, false);
  assert.match((await as(db, OWNER, `insert into public.customers(full_name, email) values ('Dup','a@example.test')`)).error, /unique|duplicate/i);
  assert.match((await as(db, OWNER, `insert into public.customers(full_name, email) values ('Up','UPPER@example.test')`)).error, /check/i);
});
