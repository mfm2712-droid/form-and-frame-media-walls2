import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { agedBucket, financeOverview, periodRange } from "./finance-overview.mjs";
import { financeOverviewHtml } from "./finance-overview-view.mjs";

const TODAY = "2026-10-18";
const inv = (id, status, issue, due, total, paid) => ({ id, status, issue_date: issue, due_date: due, total_pence: total, paid_pence: paid, outstanding_pence: status === "sent" ? Math.max(total - paid, 0) : 0 });
const rows = [
  inv(1, "sent", "2026-10-02", "2026-10-16", 100000, 40000),  // this month, 2 days overdue, 60k outstanding
  inv(2, "sent", "2026-09-20", "2026-10-04", 50000, 50000),   // last month, paid in full
  inv(3, "sent", "2026-08-01", "2026-08-15", 30000, 0),       // 64 days overdue
  inv(4, "draft", "2026-10-10", "2026-10-24", 999999, 0),     // draft never counts
  inv(5, "sent", "2026-10-15", "2026-11-14", 20000, 0),       // not yet due
  inv(6, "void", "2026-10-01", "2026-10-15", 777777, 0),      // void never counts
  inv(7, "sent", "2026-06-01", "2026-06-15", 10000, 10000)    // old, fully paid: only in "all"
];

test("period ranges: this month, last month, last 90 days, all", () => {
  assert.deepEqual(periodRange("this-month", TODAY), { from: "2026-10-01", to: null });
  assert.deepEqual(periodRange("last-month", TODAY), { from: "2026-09-01", to: "2026-10-01" });
  assert.deepEqual(periodRange("last-90", TODAY), { from: "2026-07-21", to: null });
  assert.deepEqual(periodRange("all", TODAY), { from: null, to: null });
  assert.deepEqual(periodRange("last-month", "2026-01-15"), { from: "2025-12-01", to: "2026-01-01" }, "year boundary");
  assert.throws(() => periodRange("forever", TODAY));
});

test("this month: sent invoices only; outstanding/overdue are snapshots over all sent invoices", () => {
  const o = financeOverview(rows, { period: "this-month", today: TODAY });
  assert.equal(o.invoicesIssued, 2);
  assert.equal(o.billedPence, 120000);
  assert.equal(o.paidPence, 40000);
  assert.equal(o.outstandingPence, 60000 + 30000 + 20000);
  assert.equal(o.openInvoices, 3);
  assert.equal(o.overduePence, 90000);
  assert.equal(o.overdueCount, 2);
  assert.deepEqual(o.aged, { "1-30": 60000, "31-60": 0, "61+": 30000 });
});

test("last month, last 90 days and all time", () => {
  const last = financeOverview(rows, { period: "last-month", today: TODAY });
  assert.equal(last.billedPence, 50000); assert.equal(last.paidPence, 50000);
  const n90 = financeOverview(rows, { period: "last-90", today: TODAY });
  assert.equal(n90.invoicesIssued, 4);       // Oct 2, Sep 20, Aug 1, Oct 15; Jun 1 is outside
  const all = financeOverview(rows, { period: "all", today: TODAY });
  assert.equal(all.invoicesIssued, 5);
  assert.equal(all.billedPence, 210000);
});

test("edge cases: empty data, due today is not overdue, bad today rejected", () => {
  const empty = financeOverview([], { period: "all", today: TODAY });
  assert.equal(empty.billedPence, 0); assert.equal(empty.overduePence, 0);
  assert.equal(financeOverview([inv(1, "sent", "2026-10-01", TODAY, 100, 0)], { period: "all", today: TODAY }).overdueCount, 0);
  assert.equal(agedBucket("2026-10-18", TODAY), null);
  assert.equal(agedBucket("2026-10-17", TODAY), "1-30");
  assert.equal(agedBucket("2026-09-18", TODAY), "1-30");
  assert.equal(agedBucket("2026-09-17", TODAY), "31-60");
  assert.equal(agedBucket("2026-08-18", TODAY), "61+");
  assert.throws(() => financeOverview(rows, { period: "all", today: "18/10/2026" }));
});

test("view renders nothing without the money capability and escapes content with it", () => {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const moneyPence = v => `£${(v / 100).toFixed(2)}`;
  const o = financeOverview(rows, { period: "this-month", today: TODAY });
  assert.equal(financeOverviewHtml(o, { esc, moneyPence, canSeeMoney: false }), "");
  const html = financeOverviewHtml(o, { esc, moneyPence, canSeeMoney: true });
  assert.match(html, /£1200\.00/); assert.match(html, /Overdue now/); assert.match(html, /<option value="this-month" selected>/);
});

test("the panel ships hidden and app.js renders it only through the role gate", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /<section id="financeOverview"[^>]*\shidden>/);
  const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
  const fn = app.slice(app.indexOf("function renderFinanceOverview"), app.indexOf("$(\"financeOverview\")?.addEventListener"));
  assert.match(fn, /box\.hidden = demo \|\| !caps\.money/);
  assert.ok(fn.indexOf("box.hidden") < fn.indexOf("financeOverview(liveInvoices"), "role check must precede any computation");
});
