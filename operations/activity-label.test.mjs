import test from "node:test";
import assert from "node:assert/strict";
import { activityDetailText } from "./activity-label.mjs";

test("activity labels show status transitions clearly", () => {
  assert.equal(activityDetailText({ from_status: "ready_to_build", to_status: "in_progress" }), "ready to build → in progress");
});

test("record edits show recognised field names without any stored values", () => {
  assert.equal(activityDetailText({ details: { changed_fields: ["planned_start", "actual_cost_pence"] } }), "Changed: actual cost, planned start");
});

test("unknown fields and private values are not included in activity text", () => {
  assert.equal(activityDetailText({ details: { changed_fields: ["customer_email", "secret", { token: "never-render" }] } }), "");
});
