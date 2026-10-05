import test from "node:test";
import assert from "node:assert/strict";
import { allowedNextStatuses, calculateTax, poundsToPence, taxRateForAmount } from "./workflow.mjs";

test("converts pounds and calculates tax in integer pence with explicit rates", () => {
  assert.equal(poundsToPence("10.01"), 1001);
  assert.deepEqual(calculateTax(1001, 20), { taxRateBasisPoints:2000, taxPence:200, totalPence:1201 });
  assert.deepEqual(calculateTax(0, 0), { taxRateBasisPoints:0, taxPence:0, totalPence:0 });
  assert.equal(poundsToPence(""), null);
  assert.equal(poundsToPence("-1"), null);
  assert.equal(calculateTax(1000, 101), null);
  assert.equal(calculateTax(Number.MAX_SAFE_INTEGER, 20), null);
});

test("accepts an invoice tax amount only when one exact basis-point rate reproduces it", () => {
  assert.equal(taxRateForAmount(1000, 200), 2000);
  assert.equal(taxRateForAmount(0, 0), 0);
  assert.equal(taxRateForAmount(1000, 1001), null);
  assert.equal(taxRateForAmount(100, 101), null);
});

test("workflow states only offer valid forward actions and keep terminal records locked", () => {
  assert.deepEqual(allowedNextStatuses("quote", "sent"), ["sent", "accepted", "rejected", "expired", "superseded"]);
  assert.deepEqual(allowedNextStatuses("work_order", "installed"), ["installed", "completed"]);
  assert.deepEqual(allowedNextStatuses("invoice", "void"), ["void"]);
  assert.deepEqual(allowedNextStatuses("unknown", "other"), ["other"]);
});
