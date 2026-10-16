import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("./migrations/20261016120000_notification_centre_and_preferences.sql", import.meta.url), "utf8");

test("notification tables are private to the signed-in staff member", () => {
  for (const table of ["notification_preferences", "notification_reads"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.equal((sql.match(/user_id = auth\.uid\(\) and public\.is_staff\(\)/g) || []).length >= 6, true);
  assert.match(sql, /revoke all on public\.notification_preferences, public\.notification_reads from anon/);
});

test("the migration is additive: nothing is dropped except the trigger it replaces", () => {
  assert.doesNotMatch(sql, /drop table|drop column|truncate|delete from/i);
  const drops = sql.match(/drop (trigger|policy)[^;]+;/gi) || [];
  assert.equal(drops.every(statement => /if exists/i.test(statement)), true);
});

test("workflow alerts carry the enquiry id and category but never contact or money details", () => {
  assert.match(sql, /'request_id', target_request/);
  assert.match(sql, /'category', alert_category/);
  assert.match(sql, /after insert or update of status on public\.quotes/);
  assert.doesNotMatch(sql, /total_pence|amount_pence|customer_name|email|phone|postcode/i);
});

test("identical alerts raised within seconds are suppressed", () => {
  assert.match(sql, /interval '30 seconds'/);
});
