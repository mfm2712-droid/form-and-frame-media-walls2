// FRAME-007: verifies the UNAPPLIED draft drafts/20261018100000_notification_retry_cap_DRAFT.sql
// on a throwaway in-memory Postgres (PGlite). Nothing touches Supabase. The static tests always
// run; the database tests skip unless PGLITE_MODULE (or an installed @electric-sql/pglite) exists.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

let PGlite = null;
try { PGlite = (await import(process.env.PGLITE_MODULE || "@electric-sql/pglite")).PGlite; } catch { /* optional */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE); static draft tests still run";

const migrationsDir = new URL("./migrations/", import.meta.url);
const draftName = "20261018100000_notification_retry_cap_DRAFT.sql";
const draft = await readFile(new URL(`./drafts/${draftName}`, import.meta.url), "utf8");
const OWNER = "00000000-0000-4000-8000-000000000001", STAFF = "00000000-0000-4000-8000-000000000003";
const REQ = "10000000-0000-4000-8000-000000000001";

test("the draft is kept out of supabase/migrations so it cannot be applied by accident", async () => {
  const names = await readdir(migrationsDir);
  assert.equal(names.some(n => /retry_cap/i.test(n)), false);
  assert.match(draft, /^-- DRAFT — NOT APPLIED/);
  assert.match(draft, /Rollback/);
});

test("draft is additive and never loosens access", () => {
  assert.doesNotMatch(draft, /\bdrop table\b|\btruncate\b|\bdelete from\b|disable row level security/i);
  assert.match(draft, /revoke all on function public\.retry_dead_notification\(uuid\) from public, anon/);
  assert.match(draft, /p\.role = 'owner'/);
  assert.doesNotMatch(draft, /grant execute on function public\.retry_dead_notification\(uuid\) to (anon|public)/);
  for (const fn of ["notification_max_attempts", "notification_dead_letter", "retry_dead_notification"]) {
    assert.match(draft, new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[\\s\\S]*?set search_path = ''`), `${fn} must pin search_path`);
  }
});

let db;
async function bootstrap() {
  db = new PGlite();
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
  for (const f of (await readdir(migrationsDir)).filter(x => x.endsWith(".sql")).sort()) {
    await db.exec((await readFile(new URL(f, migrationsDir), "utf8")).replace(/create extension if not exists pgcrypto;/, ""));
  }
  await db.exec(`
    insert into auth.users(id, email) values ('${OWNER}','o@test.invalid'),('${STAFF}','s@test.invalid');
    insert into public.profiles(id, full_name, role) values ('${OWNER}','Test Owner','owner'),('${STAFF}','Test Staff','staff');
    insert into public.consultation_requests(id, reference, customer_name, postcode) values ('${REQ}','REQ-T1','Test Customer','AA1 1AA');
    insert into public.notification_events(id, request_id, channel, event_type, delivery_status, attempt_count, next_attempt_at) values
      ('a0000000-0000-4000-8000-000000000001','${REQ}','email','new_enquiry','failed',12,now() - interval '1 hour');`);
}
async function as(who, sql) {
  await db.exec("begin");
  try {
    await db.exec(who === "service" ? "set local role service_role" : who === "anon" ? "set local role anon" : `set local role authenticated; select set_config('request.jwt.claim.sub','${who}',true)`);
    const r = await db.query(sql); return { ok: true, rows: r.rows };
  } catch (e) { return { ok: false, error: e.message }; } finally { await db.exec("rollback"); }
}

test("BASELINE: without the draft a failing event is retried with no ceiling", { skip }, async () => {
  await bootstrap();
  const { rows } = await db.query(`select delivery_status from public.notification_events where delivery_status in ('pending','failed') and attempt_count >= 8`);
  assert.equal(rows.length, 1, "attempt_count 12 is still selectable by the retry handler today");
  const dead = await db.query("update public.notification_events set delivery_status='dead' where id='a0000000-0000-4000-8000-000000000001'").catch(e => e);
  assert.ok(dead instanceof Error, "'dead' is rejected by the current check constraint");
});

test("applying the draft dead-letters the existing over-cap backlog and nothing else", { skip }, async () => {
  await db.exec(`insert into public.notification_events(id, channel, event_type, delivery_status, attempt_count, next_attempt_at) values
    ('a0000000-0000-4000-8000-000000000002','push','workflow_update','failed',3,now()),
    ('a0000000-0000-4000-8000-000000000003','push','workflow_update','sent',20,null)`);
  await db.exec(draft);
  const { rows } = await db.query("select id, delivery_status, dead_at is not null as has_dead_at from public.notification_events order by id");
  assert.deepEqual(rows.map(r => r.delivery_status), ["dead", "failed", "sent"]);
  assert.equal(rows[0].has_dead_at, true);
  assert.equal((await db.query("select count(*)::int n from public.notification_events where delivery_status in ('pending','failed')")).rows[0].n, 1, "dead events are outside the retry selector");
  await db.exec(draft); // idempotent re-run
});

test("a permanently failing event gets exactly 8 delivery attempts, then stops", { skip }, async () => {
  await db.exec(`insert into public.consultation_requests(id, reference, customer_name, postcode) values ('10000000-0000-4000-8000-000000000002','REQ-T2','Test Customer Two','AA1 1AB')`);
  let attempts = 0;
  for (let i = 0; i < 30; i++) {
    const claim = await db.query(`select * from public.claim_new_enquiry_notification('10000000-0000-4000-8000-000000000002','email','{}'::jsonb,true)`);
    if (!claim.rows[0].claimed) {
      // Mimic backoff elapsing, as the real retry handler would between cron ticks.
      await db.exec(`update public.notification_events set next_attempt_at = now() - interval '1 second', claim_until = null where request_id='10000000-0000-4000-8000-000000000002' and delivery_status in ('pending','failed')`);
      const again = await db.query(`select * from public.claim_new_enquiry_notification('10000000-0000-4000-8000-000000000002','email','{}'::jsonb,true)`);
      if (!again.rows[0].claimed) {
        // Existing RPC quirk (not changed here): when its final UPDATE matches no row, current_status comes back NULL.
        // What matters: it refuses to claim, and the table says dead.
        assert.equal((await db.query(`select delivery_status from public.notification_events where request_id='10000000-0000-4000-8000-000000000002'`)).rows[0].delivery_status, "dead");
        break;
      }
    }
    attempts++;
    // Provider failed: handler's finish() writes failed + clears claim.
    await db.exec(`update public.notification_events set delivery_status='failed', error='Email provider returned HTTP 500.', claim_until=null where request_id='10000000-0000-4000-8000-000000000002'`);
  }
  assert.equal(attempts, 8);
  const ev = (await db.query(`select delivery_status, attempt_count, error, next_attempt_at from public.notification_events where request_id='10000000-0000-4000-8000-000000000002'`)).rows[0];
  assert.equal(ev.delivery_status, "dead");
  assert.equal(ev.attempt_count, 8);
  assert.equal(ev.next_attempt_at, null);
  assert.match(ev.error, /gave up after 8 attempts/);
});

test("success before the cap still ends sent; failures below the cap stay failed", { skip }, async () => {
  await db.exec(`insert into public.notification_events(id, channel, event_type, delivery_status, attempt_count) values
    ('b0000000-0000-4000-8000-000000000001','push','workflow_update','pending',7),
    ('b0000000-0000-4000-8000-000000000002','push','workflow_update','pending',6)`);
  await db.exec(`update public.notification_events set delivery_status='sent', sent_at=now() where id='b0000000-0000-4000-8000-000000000001'`);
  await db.exec(`update public.notification_events set delivery_status='failed' where id='b0000000-0000-4000-8000-000000000002'`);
  const rows = (await db.query(`select id, delivery_status from public.notification_events where id::text like 'b0%' order by id`)).rows;
  assert.deepEqual(rows.map(r => r.delivery_status), ["sent", "failed"]);
});

test("only the owner can put a dead event back in the queue (audited); staff, anon and unknown ids cannot", { skip }, async () => {
  const dead = "a0000000-0000-4000-8000-000000000001";
  assert.equal((await as(STAFF, `select public.retry_dead_notification('${dead}')`)).ok, false);
  assert.equal((await as("anon", `select public.retry_dead_notification('${dead}')`)).ok, false);
  const refused = await as(STAFF, `select public.retry_dead_notification('${dead}')`);
  assert.match(refused.error, /Only the owner|permission denied/i);
  assert.equal((await db.query(`select delivery_status from public.notification_events where id='${dead}'`)).rows[0].delivery_status, "dead", "refused calls changed nothing");
  const sent = await as(OWNER, `select public.retry_dead_notification('a0000000-0000-4000-8000-000000000003')`);
  assert.equal(sent.rows[0].retry_dead_notification, false, "a sent event is never resurrected");
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${OWNER}',false)`);
  const ok = await db.query(`select public.retry_dead_notification('${dead}') as ok`);
  await db.exec("reset role");
  assert.equal(ok.rows[0].ok, true);
  const ev = (await db.query(`select delivery_status, attempt_count, dead_at from public.notification_events where id='${dead}'`)).rows[0];
  assert.deepEqual([ev.delivery_status, ev.attempt_count, ev.dead_at], ["failed", 0, null]);
  const audit = (await db.query(`select actor_id, details from public.workflow_activity where event_type='notification_retry_requested'`)).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, OWNER);
  assert.deepEqual(audit[0].details, { channel: "email", event_type: "new_enquiry" }, "audit holds no customer data");
});
