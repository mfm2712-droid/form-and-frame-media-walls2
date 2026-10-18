// App-level: saved customer records, with the real operations/app.js and a mocked Supabase client (issue #32).
import assert from "node:assert/strict";
import test from "node:test";
import { bootStaffApp, mockClient } from "./test-support/app-harness.mjs";

const config = { supabaseUrl: "https://example.invalid", supabaseAnonKey: "fictional-anon-key" };
const rows = data => ({ data, count: data.length, error: null });
const LEAD = { id: "r1", reference: "REQ-1", customer_name: "Test Customer", email: "test.customer@example.test", postcode: "AA1 1AA", status: "reviewing", created_at: "2026-01-01T00:00:00Z" };

function deskClient(role, customers) {
  const base = mockClient({ session: { access_token: "t" }, user: { id: "u1" }, role });
  const writes = [];
  base.writes = writes;
  base.from = table => {
    base.log.queries.push(table);
    const state = { table, op: "select" };
    const result = () => table === "profiles" ? { data: { role }, error: null }
      : table === "consultation_requests" ? rows([LEAD])
      : table === "customers" ? (state.op === "select" ? customers : { data: { id: "c1" }, error: null })
      : { data: [], count: 0, error: null };
    const q = { select: () => q, eq: (...a) => { state.eq = a; if (state.write) state.write.eq = a; return q; }, gte: () => q, lte: () => q, lt: () => q, gt: () => q, in: () => q, is: () => q, not: () => q, or: () => q, order: () => q, limit: () => q, range: () => q,
      insert: v => { state.op = "insert"; writes.push({ table, op: "insert", v }); return q; }, update: v => { state.op = "update"; state.write = { table, op: "update", v, eq: undefined }; writes.push(state.write); return q; }, delete: () => q, upsert: () => q,
      single: async () => result(), maybeSingle: async () => result(), then: (a, b) => Promise.resolve(table === "profiles" ? { data: [{ id: "u1", full_name: "T" }], error: null } : result()).then(a, b) };
    return q;
  };
  return base;
}
async function withDesk(role, customers, run) {
  const client = deskClient(role, customers);
  const app = await bootStaffApp({ config, client });
  try { return await run({ app, client }); } catch (e) { e.message += " | app errors: " + app.calls.errors.join(" || "); throw e; } finally { await app.restore(); }
}
const missing = { data: null, error: { code: "PGRST205", message: "relation not found" } };

test("table not migrated: derived list still renders, no record controls, no errors, nothing written", async () => {
  await withDesk("owner", missing, async ({ app, client }) => {
    const html = app.$("customerList").innerHTML;
    assert.match(html, /Test Customer/);
    assert.equal(/customer-record-form|SAVED RECORD/.test(html), false);
    assert.match(app.$("customerCount").textContent, /1 customer from recent enquiries/);
    assert.ok(client.log.queries.includes("customers"), "the app tried the table");
    assert.deepEqual(client.writes, []);
    assert.deepEqual(app.calls.errors, []);
  });
});

test("table present, owner: sees the save form and an owner submit writes a normalised insert, then refreshes", async () => {
  await withDesk("owner", rows([]), async ({ app, client }) => {
    const html = app.$("customerList").innerHTML;
    assert.match(html, /Save to customer records/);
    assert.match(app.$("customerCount").textContent, /saved records and recent enquiries/);
    const form = { dataset: { customerKey: "e:test.customer@example.test" }, elements: { fullName: { value: "Test Customer" }, notes: { value: "Call after 5pm" } }, closest() { return form; } };
    await app.$("customerList").fire("submit", { target: form });
    await app.settle();
    assert.deepEqual(client.writes, [{ table: "customers", op: "insert", v: { full_name: "Test Customer", email: "test.customer@example.test", phone_normalised: null, postcode: "AA1 1AA", notes: "Call after 5pm" } }]);
    assert.match(app.$("notice").textContent, /Customer record saved/);
  });
});

test("table present, saved record: merged view shows it and an owner update targets that record", async () => {
  const stored = rows([{ id: "c1", full_name: "Test Customer Ltd", email: "test.customer@example.test", phone_normalised: null, postcode: null, notes: "VIP" }]);
  await withDesk("owner", stored, async ({ app, client }) => {
    const html = app.$("customerList").innerHTML;
    assert.match(html, /Test Customer Ltd/); assert.match(html, /SAVED RECORD/); assert.match(html, /Edit saved record/);
    const form = { dataset: { customerKey: "e:test.customer@example.test" }, elements: { fullName: { value: "Test Customer Ltd" }, notes: { value: "VIP, mornings" } }, closest() { return form; } };
    await app.$("customerList").fire("submit", { target: form });
    await app.settle();
    assert.equal(client.writes.length, 1);
    assert.deepEqual([client.writes[0].op, client.writes[0].eq, client.writes[0].v.notes], ["update", ["id", "c1"], "VIP, mornings"]);
  });
});

test("staff: reads saved notes but gets no form and cannot write even if a submit is forced", async () => {
  const stored = rows([{ id: "c1", full_name: "Test Customer", email: "test.customer@example.test", notes: "VIP" }]);
  await withDesk("staff", stored, async ({ app, client }) => {
    const html = app.$("customerList").innerHTML;
    assert.match(html, /Notes: VIP/);
    assert.equal(/customer-record-form/.test(html), false);
    const form = { dataset: { customerKey: "e:test.customer@example.test" }, elements: { fullName: { value: "X" }, notes: { value: "Y" } }, closest() { return form; } };
    await app.$("customerList").fire("submit", { target: form });
    await app.settle();
    assert.deepEqual(client.writes, []);
    assert.match(app.$("notice").textContent, /Only an owner/);
  });
});
