// App-level role gating on the real operations/app.js (harness from PR #20), mocked Supabase only.
import assert from "node:assert/strict";
import test from "node:test";
import { bootStaffApp, mockClient } from "./test-support/app-harness.mjs";

const config = { supabaseUrl: "https://example.invalid", supabaseAnonKey: "fictional-anon-key" };
const MONEY_TABLES = ["quotes", "invoices", "invoice_balances", "invoice_payments", "invoice_payment_reversals", "business_settings"];
const JOB = { id: "w1", request_id: "r1", work_order_number: "FFJ-TEST", title: "Test job", status: "accepted", agreed_total_pence: 123456, actual_cost_pence: 99900, accepted_quote_id: "q1", created_at: "2026-01-01T00:00:00Z" };
const rows = data => ({ data, count: data.length, error: null });
const missing = { data: null, count: null, error: { code: "PGRST205", message: "relation not found" } };
const denied = { data: null, count: null, error: { code: "42501", message: "permission denied" } };

// Table-aware mock: every table returns an empty, count-verified page unless overridden.
function deskClient(role, overrides = {}) {
  const base = mockClient({ session: { access_token: "t" }, user: { id: "u1" }, role });
  const tables = { consultation_requests: rows([{ id: "r1", reference: "REQ-1", customer_name: "Test Customer", postcode: "AA1 1AA", status: "reviewing", created_at: "2026-01-01T00:00:00Z" }]), work_orders: rows([JOB]), ...overrides };
  base.from = table => {
    base.log.queries.push(table);
    const result = table === "profiles" ? { data: { role }, error: null } : (tables[table] || { data: [], count: 0, error: null });
    const list = table === "profiles" ? { data: [{ id: "u1", full_name: "Test User" }], error: null } : result;
    const q = { select: () => q, eq: () => q, gte: () => q, lte: () => q, lt: () => q, gt: () => q, in: () => q, is: () => q, not: () => q, or: () => q, order: () => q, limit: () => q, range: () => q,
      insert: () => q, update: () => q, delete: () => q, upsert: () => q, single: async () => result, maybeSingle: async () => result, then: (a, b) => Promise.resolve(list).then(a, b) };
    return q;
  };
  return base;
}
async function withDesk(role, overrides, run) {
  const client = deskClient(role, overrides);
  const app = await bootStaffApp({ config, client });
  try { return await run({ app, client }); } catch (e) { e.message += " | app errors: " + app.calls.errors.join(" || "); throw e; } finally { await app.restore(); }
}

test("owner: loads every money table, shows finance, cost entry and the invoice form", async () => {
  await withDesk("owner", {}, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, false);
    for (const table of ["quotes", "invoices", "invoice_balances", "business_settings"]) assert.ok(client.log.queries.includes(table), table);
    assert.equal(app.$("todayMoney").hidden, false);
    assert.match(app.$("businessTitle").textContent, /Quotes, work & money/);
    const html = app.$("workOrderList").innerHTML;
    assert.match(html, /1,234\.56/);
    assert.match(html, /data-actual-cost="w1"/);
    assert.match(html, /Create invoice draft/);
  });
});

test("manager: sees money and creates invoices but cannot enter actual cost or edit seller settings", async () => {
  await withDesk("manager", {}, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, false, "manager is a recognised team role");
    for (const table of ["quotes", "invoices", "invoice_balances"]) assert.ok(client.log.queries.includes(table), table);
    assert.equal(app.$("todayMoney").hidden, false);
    assert.equal(app.$("invoiceSettings").hidden, true);
    const html = app.$("workOrderList").innerHTML;
    assert.match(html, /1,234\.56/);
    assert.match(html, /actual cost £999\.00/);
    assert.doesNotMatch(html, /data-actual-cost/);
    assert.match(html, /Create invoice draft/);
  });
});

test("staff after the permissions draft: no money table is queried, the money-free job view is used", async () => {
  const view = rows([{ id: "w1", request_id: "r1", work_order_number: "FFJ-TEST", title: "Test job", status: "accepted" }]);
  await withDesk("staff", { work_orders_staff_view: view }, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, false);
    for (const table of MONEY_TABLES) assert.equal(client.log.queries.includes(table), false, `${table} must not be requested`);
    assert.equal(client.log.queries.includes("work_orders"), false, "base table with money is not requested when the view works");
    assert.ok(client.log.queries.includes("work_orders_staff_view"));
    assert.equal(app.$("todayMoney").hidden, true);
    assert.match(app.$("businessTitle").textContent, /Jobs, appointments/);
    const html = app.$("workOrderList").innerHTML;
    assert.match(html, /FFJ-TEST/);
    assert.doesNotMatch(html, /£|data-actual-cost|Create invoice draft|actual cost/);
  });
});

test("staff before the permissions draft (view missing): falls back to the job table but never displays money", async () => {
  await withDesk("staff", { work_orders_staff_view: missing }, async ({ app, client }) => {
    for (const table of MONEY_TABLES) assert.equal(client.log.queries.includes(table), false, `${table} must not be requested`);
    assert.ok(client.log.queries.includes("work_orders_staff_view"));
    assert.ok(client.log.queries.includes("work_orders"));
    const html = app.$("workOrderList").innerHTML;
    assert.match(html, /FFJ-TEST/);
    assert.doesNotMatch(html, /1,234|999|£|data-actual-cost|Create invoice draft/);
    assert.equal(app.$("todayMoney").hidden, true);
  });
});

test("staff: when neither the view nor the table can be read the desk fails closed instead of showing empty money", async () => {
  await withDesk("staff", { work_orders_staff_view: denied, work_orders: denied }, async ({ app }) => {
    assert.match(app.$("businessState").textContent, /could not be fully loaded/);
    assert.match(app.$("workOrderList").innerHTML, /could not be loaded completely/);
    assert.equal(app.$("todayMoney").innerHTML.includes("£1,234"), false);
  });
});

test("staff: money rows in the activity feed are hidden even before the database filters them", async () => {
  const activity = rows([
    { id: 1, entity_type: "payment", entity_id: "aaaaaaaa-0000", event_type: "payment_recorded", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, entity_type: "work_order", entity_id: "bbbbbbbb-0000", event_type: "record_created", created_at: "2026-01-01T00:00:00Z" }
  ]);
  await withDesk("staff", { workflow_activity: activity, work_orders_staff_view: missing }, async ({ app }) => {
    const html = app.$("activityList").innerHTML;
    assert.match(html, /record created/);
    assert.doesNotMatch(html, /payment recorded|payment/);
  });
  await withDesk("manager", { workflow_activity: activity }, async ({ app }) => {
    assert.match(app.$("activityList").innerHTML, /payment recorded/);
  });
});

test("unknown roles still reach no business record (unchanged fail-closed behaviour)", async () => {
  for (const role of ["admin", "customer", null]) {
    await withDesk(role, {}, async ({ app, client }) => {
      assert.equal(app.$("hub").hidden, true, String(role));
      assert.deepEqual(client.log.queries.filter(t => t !== "profiles"), [], String(role));
    });
  }
});
