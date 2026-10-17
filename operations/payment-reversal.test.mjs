import assert from "node:assert/strict";
import test from "node:test";
import { canReversePayments, isReversalTableMissing, ledgerRows, loadPaymentLedger, normaliseReversalReason, paymentLedgerHtml, reversalKeyFor, reversalPayload } from "./payment-reversal.mjs";

const esc = v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = p => `£${(p / 100).toFixed(2)}`;
const formatDate = v => String(v).slice(0, 10);

test("only the owner role may reverse payments in the UI", () => {
  assert.equal(canReversePayments("owner"), true);
  for (const role of ["manager", "staff", "admin", null, undefined]) assert.equal(canReversePayments(role), false);
});

test("reason must be 5-500 trimmed characters", () => {
  assert.equal(normaliseReversalReason("  Wrong invoice  "), "Wrong invoice");
  for (const bad of ["", "    ", "abcd", null, undefined, "x".repeat(501)]) assert.equal(normaliseReversalReason(bad), null);
  assert.equal(normaliseReversalReason("x".repeat(500)).length, 500);
});

test("payload carries no amount or invoice (the server derives them)", () => {
  assert.deepEqual(reversalPayload("p1", " Bounced transfer ", "k1"), { payment_id: "p1", reason: "Bounced transfer", reversal_key: "k1" });
  assert.equal(reversalPayload("p1", "no", "k1"), null);
  assert.equal(reversalPayload("", "Bounced transfer", "k1"), null);
  assert.equal(reversalPayload("p1", "Bounced transfer", ""), null);
});

test("a retry for the same payment reuses one idempotency key", () => {
  const pending = new Map();
  let n = 0;
  const create = () => `key-${++n}`;
  assert.equal(reversalKeyFor(pending, "p1", create), "key-1");
  assert.equal(reversalKeyFor(pending, "p1", create), "key-1");
  assert.equal(reversalKeyFor(pending, "p2", create), "key-2");
  pending.delete("p1");
  assert.equal(reversalKeyFor(pending, "p1", create), "key-3");
});

test("missing-table detection is limited to not-found signals", () => {
  assert.equal(isReversalTableMissing({ code: "PGRST205" }), true);
  assert.equal(isReversalTableMissing({ code: "42P01" }), true);
  assert.equal(isReversalTableMissing({ status: 404 }), true);
  assert.equal(isReversalTableMissing({ code: "42501" }), false);
  assert.equal(isReversalTableMissing(null), false);
});

function fakeDb({ payments, reversals }) {
  const q = result => { const o = { select: () => o, order: () => o, limit: () => o, then: (a, b) => Promise.resolve(result).then(a, b) }; return o; };
  return { from: t => q(t === "invoice_payments" ? payments : reversals) };
}

test("ledger loading degrades: table missing, denied, or network failure never throws", async () => {
  const ok = { data: [{ id: "p1", invoice_id: "i1", amount_pence: 100, method: "cash", received_at: "2026-01-01T00:00:00Z" }], error: null };
  assert.equal((await loadPaymentLedger(fakeDb({ payments: ok, reversals: { data: [], error: null } }))).available, true);
  const missing = await loadPaymentLedger(fakeDb({ payments: ok, reversals: { data: null, error: { code: "PGRST205" } } }));
  assert.deepEqual([missing.available, missing.reason], [false, "not_enabled"]);
  const denied = await loadPaymentLedger(fakeDb({ payments: ok, reversals: { data: null, error: { code: "42501" } } }));
  assert.deepEqual([denied.available, denied.reason], [false, "unavailable"]);
  const noPayments = await loadPaymentLedger(fakeDb({ payments: { data: null, error: { code: "42501" } }, reversals: { data: [], error: null } }));
  assert.equal(noPayments.available, false);
  assert.equal((await loadPaymentLedger({ from() { throw new Error("offline"); } })).available, false);
});

test("ledger rows pair payments with reversals per invoice, oldest first", () => {
  const payments = [
    { id: "p2", invoice_id: "i1", received_at: "2026-02-01" }, { id: "p1", invoice_id: "i1", received_at: "2026-01-01" }, { id: "px", invoice_id: "i2", received_at: "2026-01-01" }
  ];
  const rows = ledgerRows("i1", payments, [{ payment_id: "p1", reason: "r" }]);
  assert.deepEqual(rows.map(r => [r.id, Boolean(r.reversal)]), [["p1", true], ["p2", false]]);
});

test("html shows Reverse only for the owner and only for unreversed payments, and escapes content", () => {
  const rows = [
    { id: "p1", amount_pence: 5000, method: "bank_transfer", received_at: "2026-01-01", reversal: { created_at: "2026-01-02", reason: "<b>Wrong</b> invoice" } },
    { id: "p2", amount_pence: 7000, method: "cash", received_at: "2026-01-03", reversal: null }
  ];
  const owner = paymentLedgerHtml(rows, { canReverse: true, esc, money, formatDate });
  assert.equal((owner.match(/data-reverse-payment/g) || []).length, 1);
  assert.match(owner, /data-reverse-payment="p2"/);
  assert.match(owner, /<s>£50\.00<\/s>/);
  assert.doesNotMatch(owner, /<b>Wrong<\/b>/);
  const manager = paymentLedgerHtml(rows, { canReverse: false, esc, money, formatDate });
  assert.doesNotMatch(manager, /data-reverse-payment/);
  assert.equal(paymentLedgerHtml([], { canReverse: true, esc, money, formatDate }), "");
});
