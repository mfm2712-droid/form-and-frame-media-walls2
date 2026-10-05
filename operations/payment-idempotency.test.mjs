import test from "node:test";
import assert from "node:assert/strict";
import { clearPaymentRecordingKey, getPaymentRecordingKey, paymentMatchesIntent } from "./payment-idempotency.mjs";

function memoryStorage() {
  const values = new Map();
  return { getItem:key => values.get(key) ?? null, setItem:(key, value) => values.set(key, value) };
}

test("payment retry keeps its idempotency key across a page reload", () => {
  const storage = memoryStorage();
  const first = getPaymentRecordingKey(storage, "invoice-1", 12500, "bank_transfer", () => "attempt-1");
  const afterReload = getPaymentRecordingKey(storage, "invoice-1", 12500, "bank_transfer", () => "attempt-2");
  assert.equal(first, "attempt-1");
  assert.equal(afterReload, first);
});

test("different payment intents have separate keys and confirmed attempts can be cleared", () => {
  const storage = memoryStorage();
  const first = getPaymentRecordingKey(storage, "invoice-1", 12500, "bank_transfer", () => "attempt-1");
  assert.equal(getPaymentRecordingKey(storage, "invoice-1", 12500, "cash", () => "attempt-2"), "attempt-2");
  assert.equal(getPaymentRecordingKey(storage, "invoice-1", 10000, "bank_transfer", () => "attempt-3"), "attempt-3");
  clearPaymentRecordingKey(storage, "invoice-1", 12500, "bank_transfer");
  assert.equal(getPaymentRecordingKey(storage, "invoice-1", 12500, "bank_transfer", () => "attempt-4"), "attempt-4");
  assert.equal(first, "attempt-1");
});

test("storage errors leave the attempt usable for the current page", () => {
  const storage = { getItem:() => { throw new Error("blocked"); }, setItem:() => { throw new Error("blocked"); } };
  assert.equal(getPaymentRecordingKey(storage, "invoice-1", 5000, "cash", () => "attempt-1"), "attempt-1");
});

test("a saved payment only confirms the exact invoice, amount and method", () => {
  const payment = { invoice_id:"invoice-1", amount_pence:"12500", method:"bank_transfer" };
  assert.equal(paymentMatchesIntent(payment, "invoice-1", 12500, "bank_transfer"), true);
  assert.equal(paymentMatchesIntent(payment, "invoice-2", 12500, "bank_transfer"), false);
  assert.equal(paymentMatchesIntent(payment, "invoice-1", 2500, "bank_transfer"), false);
  assert.equal(paymentMatchesIntent(payment, "invoice-1", 12500, "cash"), false);
});
