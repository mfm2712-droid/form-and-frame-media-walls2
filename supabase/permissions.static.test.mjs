import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FINANCIAL_TABLES, PERMISSION_MATRIX, ROLES, allows } from "./permission-matrix.mjs";

const dir = new URL("./migrations/", import.meta.url);
const draftsDir = new URL("./drafts/", import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith(".sql")).sort(); // real migrations only
const draftFile = (await readdir(draftsDir)).find(f => f.includes("least_privilege_roles"));
const draft = await readFile(new URL(draftFile, draftsDir), "utf8");
const draftCode = draft.replace(/^\s*--.*$/gm, ""); // statements only, comments removed
const readSql = f => readFileSync(new URL(f, dir), "utf8");

test("the corrective migration lives outside supabase/migrations, is newer than every migration and is clearly marked as an unapplied draft", () => {
  assert.ok(!files.includes(draftFile), "draft must not be in supabase/migrations (db push would apply it)");
  assert.ok(draftFile > files.at(-1), "draft timestamp must sort after the newest real migration");
  assert.match(draft, /^-- DRAFT \/ NOT APPLIED/);
  assert.match(draft, /DO NOT APPLY \/ not for supabase db push/);
});

test("matrix: staff never get quotes, invoices, payments or finance; managers never write payments", () => {
  for (const table of FINANCIAL_TABLES) {
    for (const op of ["s", "i", "u", "d"]) assert.equal(allows(table, "staff", op), false, `staff must not ${op} ${table}`);
  }
  assert.equal(allows("invoice_payments", "manager", "i"), false);
  assert.equal(allows("business_settings", "manager", "u"), false);
  for (const table of Object.keys(PERMISSION_MATRIX)) assert.equal(allows(table, "owner", "s"), true, `owner keeps read access to ${table}`);
  for (const table of ["invoices", "invoice_payments", "quotes", "work_orders"]) assert.equal(allows(table, "owner", "d"), false, "no delete on financial tables");
  assert.deepEqual(ROLES, ["owner", "manager", "staff"]);
});

test("draft migration: no money-table policy is left on the broad is_staff() helper", () => {
  const policies = [...draft.matchAll(/create policy "([^"]+)" on public\.([a-z_]+)[\s\S]*?;/g)];
  assert.ok(policies.length >= 14);
  for (const [text, name, table] of policies) {
    if (FINANCIAL_TABLES.includes(table)) assert.doesNotMatch(text, /is_staff\(\)/, `policy "${name}" on ${table} must not use is_staff()`);
  }
});

test("draft migration: every original broad policy on a financial table is dropped before being replaced", () => {
  const original = files;
  const created = new Map();
  for (const f of original) {
    const sql = readSql(f);
    for (const m of sql.matchAll(/create policy "([^"]+)" on (?:public\.)?([a-z_]+)[^;]*?using|create policy "([^"]+)" on (?:public\.)?([a-z_]+)[^;]*?with check/g)) {
      const name = m[1] || m[3]; const table = m[2] || m[4];
      if (FINANCIAL_TABLES.includes(table)) created.set(`${table}:${name}`, true);
    }
  }
  assert.ok(created.size >= 10);
  for (const key of created.keys()) {
    const [table, name] = key.split(":");
    const dropped = draft.includes(`drop policy if exists "${name}" on public.${table};`);
    assert.ok(dropped, `original policy "${name}" on ${table} must be dropped by the draft`);
  }
});

test("draft migration keeps role guards, anon revoke and never grants to anon or public", () => {
  assert.match(draft, /guard_invoice_issue/);
  assert.match(draft, /guard_work_order_cost/);
  assert.match(draft, /check \(role in \('owner', 'manager', 'staff'\)\)/);
  assert.match(draft, /revoke all on public\.quotes[\s\S]*from anon;/);
  assert.doesNotMatch(draftCode, /grant [^;]*\bto (anon|public)\b/i);
  assert.doesNotMatch(draftCode, /drop table|truncate|delete from|disable row level security/i);
  assert.match(draft, /set search_path = ''/);
  for (const fn of ["is_owner", "is_manager_or_owner", "is_staff"]) assert.match(draft, new RegExp(`function public\\.${fn}\\(\\)[\\s\\S]*?security definer set search_path = ''`));
});

test("draft migration does not touch the anonymous enquiry path", () => {
  assert.doesNotMatch(draftCode, /consultation_requests|enquiry_rate_limit|submit-enquiry|claim_new_enquiry|notification_events/);
});

