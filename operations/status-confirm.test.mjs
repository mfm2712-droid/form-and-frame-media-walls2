import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { confirmStatusChange, confirmTextFor } from "./status-confirm.mjs";

test("commitment-changing statuses carry confirmation text, routine ones do not", () => {
  for (const [kind, value] of [["quote", "sent"], ["quote", "accepted"], ["quote", "rejected"], ["quote", "expired"], ["invoice", "sent"], ["invoice", "void"], ["work_order", "completed"], ["work_order", "cancelled"], ["appointment", "cancelled"]]) {
    assert.ok(confirmTextFor(kind, value), `${kind}:${value} must ask first`);
  }
  for (const [kind, value] of [["quote", "draft"], ["work_order", "in_progress"], ["appointment", "completed"], ["nonsense", "x"]]) assert.equal(confirmTextFor(kind, value), null);
  assert.equal(confirmTextFor("job", "completed"), confirmTextFor("work_order", "completed"));
});

test("a declined confirmation blocks the change and an accepted one allows it", () => {
  const asked = [];
  assert.equal(confirmStatusChange("quote", "accepted", text => { asked.push(text); return false; }), false);
  assert.equal(confirmStatusChange("quote", "accepted", () => true), true);
  assert.equal(confirmStatusChange("quote", "draft", () => { throw new Error("must not ask"); }), true);
  assert.match(asked[0], /accepted this quotation/);
});

test("both the workspace buttons and the select path in app.js go through the shared guard", async () => {
  const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.equal((app.match(/confirmStatusChange\(/g) || []).length, 2);
  assert.equal(/const confirmText = \{/.test(app), false, "no private confirm table may be reintroduced in app.js");
  const selectPath = app.slice(app.indexOf('closest("select[data-record-status]")'));
  assert.ok(selectPath.indexOf("confirmStatusChange(") < selectPath.indexOf("saveLive("), "select path must confirm before saving");
});
