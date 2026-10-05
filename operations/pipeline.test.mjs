import test from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_STAGES, isConfirmedVisitStatus, isQuoteFollowUp, pipelineIndexForStatus } from "./pipeline.mjs";

test("pipeline keeps stored enquiry statuses distinct and accurately labelled", () => {
  assert.deepEqual(["new", "reviewing", "date_requested", "confirmed", "quoted", "won"].map(pipelineIndexForStatus), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(PIPELINE_STAGES.map(stage => stage.label), ["New enquiry", "Needs review", "Visit requested", "Visit marked confirmed", "Quote sent", "Accepted job"]);
  assert.equal(pipelineIndexForStatus("lost"), -1);
  assert.equal(pipelineIndexForStatus("archived"), -1);
  assert.equal(pipelineIndexForStatus("unexpected"), -1);
});

test("quote follow-up and visit status are not mistaken for invoice payment or a booking", () => {
  assert.equal(isQuoteFollowUp("quoted"), true);
  assert.equal(isQuoteFollowUp("won"), false);
  assert.equal(isConfirmedVisitStatus("confirmed"), true);
  assert.equal(isConfirmedVisitStatus("date_requested"), false);
});
