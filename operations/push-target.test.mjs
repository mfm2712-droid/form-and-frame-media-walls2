import test from "node:test";
import assert from "node:assert/strict";
import { enquiryTargetFromSearch, operationsViewFromSearch } from "./push-target.mjs";

test("push links resolve a UUID enquiry target", () => {
  assert.equal(enquiryTargetFromSearch("?enquiry=67e55044-10b1-426f-9247-bb680e5fe0c8"), "67e55044-10b1-426f-9247-bb680e5fe0c8");
});

test("push links reject malformed or absent enquiry targets", () => {
  assert.equal(enquiryTargetFromSearch("?enquiry=not-a-request"), null);
  assert.equal(enquiryTargetFromSearch("?other=67e55044-10b1-426f-9247-bb680e5fe0c8"), null);
});

test("workflow push links can open only a known mobile app view", () => {
  for (const view of ["today", "work", "calendar", "money"]) assert.equal(operationsViewFromSearch(`?view=${view}`), view);
  assert.equal(operationsViewFromSearch("?view=https%3A%2F%2Fexample.com"), null);
  assert.equal(operationsViewFromSearch("?view=admin"), null);
  assert.equal(operationsViewFromSearch("invalid"), null);
});
