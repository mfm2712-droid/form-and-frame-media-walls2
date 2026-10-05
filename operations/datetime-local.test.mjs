import test from "node:test";
import assert from "node:assert/strict";
import { toLocalDateTimeInputValue } from "./datetime-local.mjs";

test("formats summer and winter instants as the same intended London wall time", () => {
  assert.equal(toLocalDateTimeInputValue("2026-07-05T07:00:00.000Z"), "2026-07-05T08:00");
  assert.equal(toLocalDateTimeInputValue("2026-01-05T08:00:00.000Z"), "2026-01-05T08:00");
});

test("returns an empty value for invalid dates", () => {
  assert.equal(toLocalDateTimeInputValue("not a date"), "");
});
