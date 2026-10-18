// REAL BROWSER: quotation workflow, status confirmations, job management, notifications centre.
// Real app + real supabase-js; Supabase REST is a labelled in-memory mock that records every write.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startSuite, fictionalLeads, fictionalMoney, fictionalNotifications, numberingRpc } from "../lib/fixture.mjs";
import { waitFor } from "../lib/env.mjs";

let suite;
before(async () => { suite = await startSuite(); });
after(async () => { await suite.close(); });
const writes = state => state.requests.filter(r => ["POST", "PATCH", "DELETE"].includes(r.method) && r.path.startsWith("/rest/v1/"));

async function openDesk({ role = "owner", extra = {}, dialogs = "dismiss" } = {}) {
  const tables = { consultation_requests: fictionalLeads(), ...fictionalMoney(), notification_events: fictionalNotifications(), ...extra };
  const ctx = await suite.page({ session: true, dialogs, mock: { role, tables, rpc: numberingRpc } });
  await ctx.page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await ctx.page.$eval("#hub", el => !el.hidden), { label: "desk" });
  await waitFor(async () => (await ctx.page.$$("#leadList [data-lead-id]")).length === 3, { label: "enquiries" });
  await waitFor(async () => await ctx.page.$eval("#totalBilled", el => el.textContent !== "—"), { label: "business records" });
  return ctx;
}

test("quotation workflow: draft is saved with a server-allocated number and is never sent", async () => {
  const { page, state, dialogLog } = await openDesk();
  // 1. open an enquiry that has no quote yet and create a draft through the real form
  await page.click('#leadList [data-lead-id="lead-1"]');
  await waitFor(async () => await page.$("#wsQuoteEditor"), { label: "quote editor" });
  await page.evaluate(() => { document.getElementById("wsQuoteEditor").open = true; });
  // the editor is pre-filled from the enquiry brief (guide midpoint); the owner overwrites it
  for (const name of ["scope", "subtotal"]) await page.$eval(`#wsQuoteEditor [name="${name}"]`, el => { el.value = ""; });
  await page.type('#wsQuoteEditor [name="scope"]', "E2E fictional media wall scope");
  await page.type('#wsQuoteEditor [name="subtotal"]', "5000");
  await page.evaluate(() => { const rate = document.querySelector('#wsQuoteEditor [name="taxRate"]'); rate.value = "20"; rate.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("#wsQuoteEditor button:not([type=button])");
  await waitFor(() => writes(state).some(r => r.method === "POST" && r.path === "/rest/v1/quotes"), { label: "quote insert" });
  const insert = writes(state).find(r => r.path === "/rest/v1/quotes");
  const row = Array.isArray(insert.body) ? insert.body[0] : insert.body;
  assert.equal(row.request_id, "lead-1");
  assert.equal(row.version, 1);
  assert.equal(row.subtotal_pence, 500000);
  assert.equal(row.tax_rate_basis_points, 2000);
  assert.equal(row.tax_pence, 100000);
  assert.equal(row.quote_number, "FFQ-000001", "number comes from the allocate_document_number RPC, not the browser");
  assert.ok(state.requests.some(r => r.path === "/rest/v1/rpc/allocate_document_number"));
  assert.equal(row.status === undefined || row.status === "draft", true, "a new quote is a draft, never sent");
  assert.equal(dialogLog.length, 0, "creating a draft needs no confirmation");
  await page.close();
});

test("status select asks before committing: declining writes nothing and reverts; accepting writes the PATCH (#30)", async () => {
  const declined = await openDesk({ dialogs: "dismiss" });
  await declined.page.select('select[data-record-status="quote"]', "accepted");
  await waitFor(() => declined.dialogLog.length === 1, { label: "confirm dialog" });
  assert.match(declined.dialogLog[0], /customer accepted this quotation/);
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(writes(declined.state).filter(r => r.path === "/rest/v1/quotes"), [], "declined = no write");
  assert.equal(await declined.page.$eval('select[data-record-status="quote"]', el => el.value), "sent", "select reverts to the saved status");
  await declined.page.close();

  const accepted = await openDesk({ dialogs: "accept" });
  await accepted.page.select('select[data-record-status="quote"]', "accepted");
  await waitFor(() => writes(accepted.state).some(r => r.method === "PATCH" && r.path === "/rest/v1/quotes"), { label: "quote patch" });
  const patch = writes(accepted.state).find(r => r.path === "/rest/v1/quotes");
  assert.equal(patch.body.status, "accepted");
  assert.ok(patch.body.accepted_at, "acceptance timestamp is recorded");
  assert.match(patch.search, /id=eq\.q-1/);
  await accepted.page.close();
});

test("job management: cancelling a job is confirmed; planned start after target completion is rejected client-side", async () => {
  const ctx = await openDesk({ dialogs: "dismiss" });
  const { page, state } = ctx;
  await page.select('select[data-record-status="work_order"]', "cancelled");
  await waitFor(() => ctx.dialogLog.some(m => /Cancel this build job/.test(m)), { label: "cancel confirm" });
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(writes(state).filter(r => r.path === "/rest/v1/work_orders"), []);
  // date rules: set target first (allowed), then a later planned start (must be refused, no write for the bad one)
  await page.$eval('input[data-job-date="target_completion"]', el => { el.value = "2026-11-10"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await waitFor(() => writes(state).some(r => r.path === "/rest/v1/work_orders" && r.body.target_completion === "2026-11-10"), { label: "target saved" });
  const before = writes(state).length;
  await page.$eval('input[data-job-date="planned_start"]', el => { el.value = "2026-11-20"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  await waitFor(async () => /planned start must be on or before/i.test(await page.$eval("#notice", el => el.textContent)), { label: "validation notice" });
  assert.equal(writes(state).length, before, "invalid date pair is never sent to the database");
  await page.close();
});

test("notifications centre: unread badge from events, mark-all-read persists reads and clears the badge", async () => {
  const { page, state } = await openDesk();
  await waitFor(async () => await page.$eval("#notifBadge", el => !el.hidden && el.textContent === "2"), { label: "badge 2" });
  assert.match(await page.$eval("#notifBell", el => el.getAttribute("aria-label")), /2/);
  await page.click("#notifBell");
  await waitFor(async () => (await page.$eval("#ncList", el => el.innerText)).includes("FF-E2E-001"), { label: "list" });
  await page.click("#ncMarkAll");
  await waitFor(() => writes(state).some(r => r.path === "/rest/v1/notification_reads"), { label: "reads upsert" });
  const upsert = writes(state).find(r => r.path === "/rest/v1/notification_reads");
  assert.deepEqual(upsert.body.map(r => r.event_id).sort(), ["n-1", "n-2"]);
  await waitFor(async () => await page.$eval("#notifBadge", el => el.hidden), { label: "badge cleared" });
  await page.close();
});

test("staff cannot see or reach money actions on an enquiry (no quote editor, no money writes)", async () => {
  const { page, state } = await openDesk({ role: "staff" });
  await page.click('#leadList [data-lead-id="lead-1"]');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(await page.$("#wsQuoteEditor"), null, "staff get no quote editor");
  assert.equal(await page.$('select[data-record-status="quote"]'), null);
  assert.deepEqual(writes(state).filter(r => /quotes|invoices|invoice_payments/.test(r.path)), []);
  await page.close();
});
