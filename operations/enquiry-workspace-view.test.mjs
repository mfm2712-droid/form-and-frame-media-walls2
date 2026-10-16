import test from "node:test";
import assert from "node:assert/strict";
import { relatedRecords, statusBadge, workflowSteps, recommendedAction } from "./enquiry-workspace.mjs";
import { renderWorkspaceHtml, badgeHtml, stepperHtml } from "./enquiry-workspace-view.mjs";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const moneyPence = pence => `£${(Number(pence || 0) / 100).toFixed(2)}`;
const format = value => String(value);
const lead = (over = {}) => ({ id: "r1", reference: "FF-TEST", status: "reviewing", customer_name: "Test <b>Customer</b>", email: "t@example.test", phone: "07700 900000", postcode: "SL1 1AA", wall_width: "4.2 m", message: "<script>alert(1)</script>", created_at: "2026-10-16T09:00:00Z", source: "website", guide_low: 5000, guide_high: 6000, project_spec: { finish: "oak", tv: "65" }, ...over });
const build = (data, leadOver, extra = {}) => {
  const l = lead(leadOver), rel = relatedRecords(l, data);
  return renderWorkspaceHtml({ lead: l, rel, steps: workflowSteps(l, rel), badge: statusBadge(l, rel), action: recommendedAction(l, rel), esc, moneyPence, format, today: new Date("2026-10-16T09:00:00Z"), ...extra });
};

test("customer text is escaped everywhere", () => {
  const html = build({});
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<b>Customer</b>"), false);
  assert.match(html, /Test &lt;b&gt;Customer&lt;\/b&gt;/);
});

test("a new enquiry shows the NEW badge and an Open action", () => {
  const html = build({}, { status: "new" });
  assert.match(html, /st-new/);
  assert.match(html, /data-ws-action="open-now"/);
});

test("quotation editor is prefilled and offered only when no quotation is in progress", () => {
  const html = build({});
  assert.match(html, /id="quoteDraft"/);
  assert.match(html, /name="subtotal"[^>]*value="5500"/);
  const withQuote = build({ quotes: [{ id: "q1", request_id: "r1", version: 1, status: "draft", quote_number: "FFQ-1", total_pence: 100, scope: "x" }] });
  assert.equal(withQuote.includes('id="quoteDraft"'), false);
  assert.match(withQuote, /already in progress/);
});

test("the editor is withheld when a site assessment is still required", () => {
  const html = build({}, {}, { quoteAllowed: false });
  assert.equal(html.includes('id="quoteDraft"'), false);
  assert.match(html, /site assessment is required first/i);
});

test("every sensitive action says it only records state and nothing is emailed", () => {
  const quote = { id: "q1", request_id: "r1", version: 1, status: "draft", quote_number: "FFQ-1", total_pence: 100, scope: "x" };
  assert.match(build({ quotes: [quote] }), /never emails/);
  const job = { id: "j1", request_id: "r1", status: "in_progress", work_order_number: "FFJ-1", agreed_total_pence: 100 };
  const accepted = { ...quote, status: "accepted", subtotal_pence: 100, tax_pence: 0 };
  const invoice = { id: "i1", work_order_id: "j1", status: "draft", invoice_number: "FFI-1", total_pence: 100, paid_pence: 0, outstanding_pence: 100 };
  const html = build({ quotes: [accepted], workOrders: [job], invoices: [invoice] });
  assert.match(html, /Nothing is emailed/);
  assert.equal(/<a [^>]*href="mailto:[^"]*"[^>]*data-ws-action/.test(html), false);
});

test("payment form only offers methods the database accepts", () => {
  const job = { id: "j1", request_id: "r1", status: "in_progress", work_order_number: "FFJ-1", agreed_total_pence: 100 };
  const invoice = { id: "i1", work_order_id: "j1", status: "sent", invoice_number: "FFI-1", total_pence: 10000, paid_pence: 0, outstanding_pence: 10000 };
  const html = build({ quotes: [{ id: "q1", request_id: "r1", version: 1, status: "accepted", quote_number: "Q", total_pence: 1, scope: "x" }], workOrders: [job], invoices: [invoice] });
  const methods = [...html.matchAll(/<option value="([a-z_]+)">/g)].map(match => match[1]).filter(value => ["bank_transfer", "cash", "card", "stripe", "other", "cheque", "card_reader"].includes(value));
  assert.deepEqual(methods.sort(), ["bank_transfer", "card", "cash", "other"]);
  assert.match(html, /value="100\.00"/);
});

test("badge and stepper render accessible state text", () => {
  assert.match(badgeHtml({ key: "completed", label: "Completed", tone: "completed" }, esc), /COMPLETED/);
  const html = stepperHtml([{ id: "a", label: "A", state: "done" }, { id: "b", label: "B", state: "current" }, { id: "c", label: "C", state: "todo" }], esc);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /Step 2 of 3/);
});
