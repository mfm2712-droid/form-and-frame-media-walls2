import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, lineTotalPence, parsePercent, parsePounds, parseQuantity, quantityText } from "./desk-money.mjs";

test("pounds, quantities and percentages parse exactly without floating point", () => {
  assert.equal(parsePounds("0.1"), 10);
  assert.equal(parsePounds("1,250.5"), 125050);
  assert.equal(parsePounds("£19.99"), 1999);
  assert.equal(parsePounds("1.005"), null, "three decimals are refused, not rounded");
  assert.equal(parsePounds("-5"), null);
  assert.equal(parsePounds(""), null);
  assert.equal(parseQuantity("2.5"), 250);
  assert.equal(parseQuantity("0"), null);
  assert.equal(quantityText(250), "2.5");
  assert.equal(quantityText(1205), "12.05");
  assert.equal(quantityText(300), "3");
  assert.equal(parsePercent("17.5"), 1750);
  assert.equal(parsePercent("101"), null);
});

test("line totals round half up to the penny, matching the database", () => {
  assert.equal(lineTotalPence(150, 333), 500, "1.5 × £3.33 = £4.995 → £5.00");
  assert.equal(lineTotalPence(10, 10), 1, "0.1 × £0.10 = 1p");
  assert.equal(lineTotalPence(300, 1999), 5997);
  // 0.1 + 0.2 style errors cannot appear: £0.10 + £0.20 is exactly 30p.
  const result = calculateQuote({ lines:[{ description:"A", quantity:"1", unitPrice:"0.10" }, { description:"B", quantity:"1", unitPrice:"0.20" }] });
  assert.equal(result.itemsSubtotalPence, 30);
});

test("a percentage discount, VAT and grand total are exact", () => {
  const result = calculateQuote({
    lines:[
      { description:"MDF", quantity:"12", unit:"sheet", unitPrice:"38.50" },
      { description:"Labour", quantity:"3.5", unit:"day", unitPrice:"240" },
      { description:"", quantity:"", unitPrice:"" }
    ],
    discountType:"percent", discountPercent:"10", taxPercent:"20"
  });
  assert.equal(result.ok, true, result.errors.join(" "));
  assert.equal(result.items.length, 2, "blank rows are ignored");
  assert.deepEqual(result.items[1], { description:"Labour", quantity:"3.5", unit:"day", unit_price_pence:24000, line_total_pence:84000 });
  assert.equal(result.itemsSubtotalPence, 46200 + 84000);
  assert.equal(result.discountBasisPoints, 1000);
  assert.equal(result.discountPence, 13020);
  assert.equal(result.subtotalPence, 117180);
  assert.equal(result.taxBasisPoints, 2000);
  assert.equal(result.taxPence, 23436);
  assert.equal(result.totalPence, 140616);
});

test("a fixed discount cannot exceed the items and needs an amount", () => {
  const lines = [{ description:"TV mounting", quantity:"1", unitPrice:"150" }];
  assert.equal(calculateQuote({ lines, discountType:"fixed", discountAmount:"25", taxPercent:"0" }).totalPence, 12500);
  assert.match(calculateQuote({ lines, discountType:"fixed", discountAmount:"200", taxPercent:"0" }).errors.join(" "), /cannot be larger/);
  assert.match(calculateQuote({ lines, discountType:"fixed", discountAmount:"", taxPercent:"0" }).errors.join(" "), /discount amount/);
  assert.match(calculateQuote({ lines, discountType:"percent", discountPercent:"", taxPercent:"0" }).errors.join(" "), /percentage/);
});

test("invalid lines explain exactly what to fix", () => {
  const result = calculateQuote({ lines:[{ description:"Timber", quantity:"0", unitPrice:"12" }, { description:"", quantity:"2", unitPrice:"5" }], taxPercent:"x" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Line 1: enter a quantity/);
  assert.match(result.errors.join(" "), /Line 2: add a description/);
  assert.match(result.errors.join(" "), /VAT rate/);
  assert.match(calculateQuote({ lines:[] }).errors.join(" "), /at least one item/);
});
