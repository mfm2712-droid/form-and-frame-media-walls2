import test from "node:test";
import assert from "node:assert/strict";
import { canIssueQuote, surveyReadiness } from "./quote-readiness.mjs";

test("simple enquiries can be quoted without a site assessment", () => {
  assert.equal(canIssueQuote({ assessmentRequired:false, appointments:[], requestId:"r1" }), true);
});

test("assessment-required enquiries cannot be quoted before a completed survey", () => {
  const appointments = [{ request_id:"r1", kind:"survey", status:"confirmed" }];
  assert.equal(canIssueQuote({ assessmentRequired:true, appointments, requestId:"r1" }), false);
  assert.deepEqual(surveyReadiness({ appointments, requestId:"r1" }), { completed:false, booked:true });
});

test("a completed survey unlocks the quote", () => {
  const appointments = [{ request_id:"r1", kind:"survey", status:"completed" }];
  assert.equal(canIssueQuote({ assessmentRequired:true, appointments, requestId:"r1" }), true);
});

test("another enquiry's survey never unlocks this enquiry", () => {
  const appointments = [{ request_id:"other", kind:"survey", status:"completed" }];
  assert.equal(canIssueQuote({ assessmentRequired:true, appointments, requestId:"r1" }), false);
});
