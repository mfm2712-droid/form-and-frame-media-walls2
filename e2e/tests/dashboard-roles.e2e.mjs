// REAL BROWSER: owner dashboard panels and role gating. Mock Supabase, fictional data.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startSuite, fictionalLeads, fictionalMoney } from "../lib/fixture.mjs";
import { waitFor } from "../lib/env.mjs";

let suite;
before(async () => { suite = await startSuite(); });
after(async () => { await suite.close(); });
const tables = () => ({ consultation_requests: fictionalLeads(), ...fictionalMoney() });
const open = async (opts) => {
  const ctx = await suite.page({ session: true, ...opts });
  await ctx.page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await ctx.page.$eval("#hub", el => !el.hidden), { label: "desk" });
  await waitFor(async () => (await ctx.page.$$("#leadList [data-lead-id]")).length === 3, { label: "enquiries" });
  await waitFor(async () => await ctx.page.$eval("#totalBilled", el => el.textContent !== "—") || (await ctx.page.$eval("#businessState", el => /Job and calendar/.test(el.textContent))), { label: "business records" });
  return ctx;
};

test("owner: customers panel merges the two Grant enquiries by email (case-insensitive) and phone", async () => {
  const { page, errors } = await open({ mock: { role: "owner", tables: tables() } });
  const cards = await page.$$eval(".customer-card", els => els.map(el => el.innerText.replace(/\s+/g, " ")));
  assert.equal(cards.length, 2, `3 enquiries from 2 people -> 2 customers; got ${cards.length}`);
  const amelia = cards.find(text => /Amelia Grant|A\. Grant/.test(text));
  assert.match(amelia, /REPEAT CUSTOMER/);
  assert.match(amelia, /2 enquiries/);
  assert.match(amelia, /FF-E2E-001/); assert.match(amelia, /FF-E2E-002/);
  await page.type("#customerSearch", "900222");
  assert.equal((await page.$$(".customer-card")).length, 1, "search by phone digits");
  assert.deepEqual(errors, []);
  await page.close();
});

test("owner: finance overview is visible with correct totals; period switch recomputes", async () => {
  const { page } = await open({ mock: { role: "owner", tables: tables() } });
  assert.equal(await page.$eval("#financeOverview", el => el.hidden), false);
  const text = await page.$eval("#financeOverview", el => el.innerText.replace(/\s+/g, " "));
  assert.match(text, /Outstanding now\s*£1,600\.00/, "100000 + 60000 pence outstanding");
  assert.match(text, /Overdue now\s*£1,000\.00/);
  assert.match(text, /Invoiced\s*£1,800\.00/, "both invoices were issued this month or the last 90 days window per today's date");
  await page.select("#financePeriod", "last-month");
  await waitFor(async () => /Last month/.test(await page.$eval("#financeOverview", el => el.innerText)), { label: "period switch" });
  await page.close();
});

test("staff: no finance overview, no money tables requested, money text absent from the page", async () => {
  const { page, state } = await open({ mock: { role: "staff", tables: tables() } });
  assert.equal(await page.$eval("#financeOverview", el => el.hidden), true);
  const forbidden = ["quotes", "invoice_balances", "invoices", "invoice_payments", "payment_reversals"];
  const hit = state.requests.filter(r => r.method !== "OPTIONS" && forbidden.some(t => r.path === `/rest/v1/${t}`));
  assert.deepEqual(hit.map(r => r.path), [], "staff must not even request money tables");
  const body = await page.evaluate(() => document.body.innerText);
  for (const secret of ["FFI-20261003-CCCC", "£1,600.00", "FFQ-20261001-AAAA", "9,600"]) assert.equal(body.includes(secret), false, `staff page leaks ${secret}`);
  assert.equal(await page.$eval("#totalBilled", el => el.closest(".business-metrics").hidden), true);
  const customers = await page.$$eval(".customer-card", els => els.map(el => el.innerText).join(" "));
  assert.equal(/£/.test(customers), false, "customer cards show no money to staff");
  await page.close();
});
