import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesFor, filterActivityForCaps, loadWorkOrdersForCaps, roleAdjustedAction, stripWorkOrderMoney } from "./role-capabilities.mjs";
import { renderWorkspaceHtml } from "./enquiry-workspace-view.mjs";
import { checkStaffAccess } from "./staff-access.mjs";

test("capabilities: owner and manager see money, staff and unknown roles do not (fail closed)", () => {
  assert.equal(capabilitiesFor("owner").money, true);
  assert.equal(capabilitiesFor("manager").money, true);
  for (const role of ["staff", "admin", "customer", "", null, undefined, "OWNER"]) {
    const caps = capabilitiesFor(role);
    assert.equal(caps.money, false, String(role));
    assert.equal(caps.costEntry || caps.settingsRead || caps.settingsWrite || caps.reversePayments, false, String(role));
  }
});

test("capabilities: only the owner enters actual cost, edits settings and reverses payments; manager reads settings", () => {
  const owner = capabilitiesFor("owner"), manager = capabilitiesFor("manager");
  assert.deepEqual([owner.costEntry, owner.settingsWrite, owner.reversePayments], [true, true, true]);
  assert.deepEqual([manager.costEntry, manager.settingsWrite, manager.reversePayments, manager.settingsRead], [false, false, false, true]);
  assert.equal(Object.isFrozen(owner), true);
});

test("stripWorkOrderMoney blanks money and the quote link without mutating the input", () => {
  const row = { id: "w1", work_order_number: "J1", agreed_total_pence: 123456, actual_cost_pence: 999, accepted_quote_id: "q1", status: "accepted" };
  const out = stripWorkOrderMoney(row);
  assert.deepEqual([out.agreed_total_pence, out.actual_cost_pence, out.accepted_quote_id, out.work_order_number], [null, null, null, "J1"]);
  assert.equal(row.agreed_total_pence, 123456);
});

test("work orders: money roles read the base table; staff prefer the money-free view", async () => {
  const asked = [];
  const rows = table => { asked.push(table); return Promise.resolve({ data: [{ id: "w1", agreed_total_pence: 5 }], error: null }); };
  await loadWorkOrdersForCaps(rows, capabilitiesFor("manager"));
  await loadWorkOrdersForCaps(rows, capabilitiesFor("staff"));
  assert.deepEqual(asked, ["work_orders", "work_orders_staff_view"]);
});

test("work orders: before the permissions draft (view missing) staff fall back to the base table with money stripped; both failing fails closed", async () => {
  const missing = { data: null, error: { code: "PGRST205" } };
  const base = { data: [{ id: "w1", agreed_total_pence: 5, actual_cost_pence: 3, accepted_quote_id: "q" }], error: null };
  const fallback = await loadWorkOrdersForCaps(table => Promise.resolve(table === "work_orders_staff_view" ? missing : base), capabilitiesFor("staff"));
  assert.equal(fallback.error, null);
  assert.deepEqual([fallback.data[0].agreed_total_pence, fallback.data[0].actual_cost_pence, fallback.data[0].accepted_quote_id], [null, null, null]);
  const thrown = await loadWorkOrdersForCaps(table => table === "work_orders_staff_view" ? Promise.reject({ code: "PGRST205" }) : Promise.resolve(base), capabilitiesFor("staff"));
  assert.equal(thrown.error, null, "loadBusinessRows throws on errors; that must also trigger the fallback");
  assert.equal(thrown.data[0].agreed_total_pence, null);
  const denied = { data: null, error: { code: "42501" } };
  const failed = await loadWorkOrdersForCaps(() => Promise.resolve(denied), capabilitiesFor("staff"));
  assert.equal(failed.error, denied.error);
  const bothThrow = await loadWorkOrdersForCaps(() => Promise.reject(new Error("offline")), capabilitiesFor("staff"));
  assert.match(bothThrow.error.message, /offline/);
  const moneyRoleThrows = await loadWorkOrdersForCaps(() => Promise.reject(new Error("offline")), capabilitiesFor("owner"));
  assert.match(moneyRoleThrows.error.message, /offline/);
});

test("activity: staff never see quote, invoice or payment rows", () => {
  const rows = [{ entity_type: "request" }, { entity_type: "quote" }, { entity_type: "invoice" }, { entity_type: "payment" }, { entity_type: "work_order" }];
  assert.deepEqual(filterActivityForCaps(rows, capabilitiesFor("staff")).map(r => r.entity_type), ["request", "work_order"]);
  assert.equal(filterActivityForCaps(rows, capabilitiesFor("manager")).length, 5);
});

test("next step: staff are never pointed at a money step; they get the job step or a wait message", () => {
  const job = { id: "j", status: "in_progress" };
  const staff = capabilitiesFor("staff");
  for (const id of ["create-quote", "send-quote", "accept-quote", "create-job", "create-invoice", "send-invoice", "record-payment"]) {
    const adjusted = roleAdjustedAction({ id, label: "money", hint: "h", primary: true }, { job }, staff);
    assert.notEqual(adjusted.label, "money", id);
    assert.equal(adjusted.id, "advance-job", id);
  }
  const noJob = roleAdjustedAction({ id: "create-quote", label: "money", hint: "", primary: true }, { job: null }, staff);
  assert.deepEqual([noJob.id, noJob.primary], ["none", false]);
  const done = roleAdjustedAction({ id: "record-payment", label: "m", hint: "", primary: true }, { job: { status: "completed" } }, staff);
  assert.equal(done.id, "none");
  const cancelled = roleAdjustedAction({ id: "create-invoice", label: "m", hint: "", primary: true }, { job: { status: "cancelled" } }, staff);
  assert.equal(cancelled.id, "none");
  const open = { id: "open", label: "Open", hint: "", primary: true };
  assert.equal(roleAdjustedAction(open, { job }, staff), open, "non-money steps pass through");
  const money = { id: "create-quote", label: "Create quotation", hint: "", primary: true };
  assert.equal(roleAdjustedAction(money, { job }, capabilitiesFor("manager")), money);
});

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const lead = { id: "r1", reference: "REQ-1", customer_name: "Test Customer", postcode: "AA1 1AA", status: "reviewing", created_at: "2026-01-01T00:00:00Z" };
const rel = { quote: { id: "q1", quote_number: "Q-1", version: 1, status: "accepted", total_pence: 777700, scope: "scope" }, quotes: [], job: { id: "j1", work_order_number: "J-1", status: "accepted", agreed_total_pence: 777700 }, jobs: [], appointments: [], invoices: [{ id: "i1", invoice_number: "I-1", status: "sent", total_pence: 123400, paid_pence: 0, outstanding_pence: 123400 }] };
const ctx = money => ({ lead, rel, steps: [], badge: { key: "x", label: "x", tone: "x" }, action: { id: "none", label: "n", hint: "", primary: false }, esc, moneyPence: p => `£${(p / 100).toFixed(2)}`, format: String, money });

test("workspace view: money:false removes quotation, invoice and job totals; the default is unchanged", () => {
  const withMoney = renderWorkspaceHtml(ctx(undefined));
  assert.match(withMoney, /id="wsQuote"/);
  assert.match(withMoney, /id="wsInvoices"/);
  assert.match(withMoney, /£7777\.00/);
  const without = renderWorkspaceHtml(ctx(false));
  assert.doesNotMatch(without, /wsQuote|wsInvoices|7777|1234|>Q-1<|>I-1<|quoteDraft/);
  assert.match(without, /id="wsJob"/);
  assert.match(without, /J-1/);
});

test("staff-access accepts the manager role without widening anything else", async () => {
  const client = role => ({ auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) }) });
  assert.deepEqual(await checkStaffAccess(client("manager")), { state: "authorized", role: "manager" });
  for (const role of ["Manager", "admin", "customer", null]) assert.deepEqual(await checkStaffAccess(client(role)), { state: "unassigned" });
});
