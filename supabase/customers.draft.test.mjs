// Issue #32: the customers draft is unapplied, additive, owner-write, and parses on a throwaway Postgres.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

let PGlite = null;
try { PGlite = (await import(process.env.PGLITE_MODULE || "@electric-sql/pglite")).PGlite; } catch { /* optional */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE); static draft tests still run";
const name = "20261018120000_customers_DRAFT.sql";
const draft = await readFile(new URL(`./drafts/${name}`, import.meta.url), "utf8");

test("draft stays out of supabase/migrations and is clearly marked", async () => {
  assert.equal((await readdir(new URL("./migrations/", import.meta.url))).some(n => /customers/i.test(n)), false);
  assert.match(draft, /^-- DRAFT — NOT APPLIED/);
  assert.match(draft, /Rollback/);
});

test("draft is additive: no drop/delete/truncate of data, RLS on, owner-only writes, no delete policy", () => {
  const code = draft.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
  assert.equal(/\b(drop\s+table|drop\s+column|delete\s+from|truncate|update\s+public\.)/i.test(code), false);
  assert.match(code, /enable row level security/);
  assert.equal(/for delete/i.test(code), false);
  assert.match(code, /for insert[^;]*is_owner\(\)/);
  assert.match(code, /for update[^;]*is_owner\(\)/);
  assert.equal(/\bmanager\b/i.test(code), false, "no Manager role (owners decision 2026-10-18)");
});

test("draft applies on a throwaway database and enforces identity uniqueness", { skip }, async () => {
  const db = new PGlite();
  await db.exec(`create role authenticated; create schema if not exists auth;
    create table public.consultation_requests (id uuid primary key default gen_random_uuid(), email text, phone text);
    create function public.is_staff() returns boolean language sql as $$ select true $$;
    create function public.is_owner() returns boolean language sql as $$ select true $$;`);
  await db.exec(draft);
  await db.exec(`insert into public.customers (full_name, email, phone_normalised) values ('A', 'a@example.test', '07700900123')`);
  await assert.rejects(() => db.exec(`insert into public.customers (full_name, email) values ('B', 'a@example.test')`), /unique|duplicate/i);
  await assert.rejects(() => db.exec(`insert into public.customers (full_name, email) values ('B', 'UPPER@example.test')`), /check/i);
  await assert.rejects(() => db.exec(`insert into public.customers (full_name, phone_normalised) values ('C', '07700900123')`), /unique|duplicate/i);
  await db.exec(`insert into public.customers (full_name) values ('No identity 1'), ('No identity 2')`);
  await db.close();
});
