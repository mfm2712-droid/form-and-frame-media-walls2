import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MEMBER_LABEL,
  UNASSIGNED_LABEL,
  UNASSIGNED_VALUE,
  UNKNOWN_MEMBER_LABEL,
  assignmentLabel,
  assignmentOptions,
  assignmentOptionsHtml,
  assignmentUnavailableOptionsHtml,
  memberLabel
} from "./assignment.mjs";

test("member labels use full names with a neutral fallback", () => {
  assert.equal(memberLabel({ id:"p1", full_name:"Anthony" }), "Anthony");
  assert.equal(memberLabel({ id:"p2", full_name:"  " }), FALLBACK_MEMBER_LABEL);
  assert.equal(memberLabel({ id:"p2" }), FALLBACK_MEMBER_LABEL);
  assert.equal(memberLabel({ id:"p2", full_name:null }), FALLBACK_MEMBER_LABEL);
  assert.equal(memberLabel(null), FALLBACK_MEMBER_LABEL);
});

test("assignment options always include an explicit Unassigned choice", () => {
  const options = assignmentOptions([
    { id:"p1", full_name:"Anthony" },
    { id:"p2", full_name:"" }
  ]);
  assert.deepEqual(options, [
    { value:UNASSIGNED_VALUE, label:UNASSIGNED_LABEL },
    { value:"p1", label:"Anthony" },
    { value:"p2", label:FALLBACK_MEMBER_LABEL }
  ]);
  assert.deepEqual(assignmentOptions(null), [{ value:UNASSIGNED_VALUE, label:UNASSIGNED_LABEL }]);
  assert.deepEqual(assignmentOptions([{ full_name:"No id" }, { id:"  ", full_name:"Blank id" }]), [{ value:UNASSIGNED_VALUE, label:UNASSIGNED_LABEL }]);
});

test("assignment labels resolve records to visible team members", () => {
  const profiles = [{ id:"p1", full_name:"Anthony" }, { id:"p2", full_name:"  " }];
  assert.equal(assignmentLabel(null, profiles), UNASSIGNED_LABEL);
  assert.equal(assignmentLabel("", profiles), UNASSIGNED_LABEL);
  assert.equal(assignmentLabel("  ", profiles), UNASSIGNED_LABEL);
  assert.equal(assignmentLabel("p1", profiles), "Anthony");
  assert.equal(assignmentLabel("p2", profiles), FALLBACK_MEMBER_LABEL);
  assert.equal(assignmentLabel("missing", profiles), UNKNOWN_MEMBER_LABEL);
  assert.equal(assignmentLabel("p1", null), UNKNOWN_MEMBER_LABEL);
  assert.equal(assignmentLabel("p1", undefined), UNKNOWN_MEMBER_LABEL);
});

test("assignment option markup marks the current choice and escapes names", () => {
  const html = assignmentOptionsHtml([{ id:"p1", full_name:"Anthony <b>&\"'" }], "p1");
  assert.equal(html, `<option value="">${UNASSIGNED_LABEL}</option><option value="p1" selected>Anthony &lt;b&gt;&amp;&quot;&#39;</option>`);
  assert.equal(assignmentOptionsHtml([{ id:"p1", full_name:"Anthony" }], ""), `<option value="" selected>${UNASSIGNED_LABEL}</option><option value="p1">Anthony</option>`);
  assert.equal(assignmentOptionsHtml(null, ""), `<option value="" selected>${UNASSIGNED_LABEL}</option>`);
});

test("unavailable assignment options keep the current state visible", () => {
  assert.equal(assignmentUnavailableOptionsHtml(null), `<option value="" selected>${UNASSIGNED_LABEL}</option>`);
  assert.equal(assignmentUnavailableOptionsHtml(""), `<option value="" selected>${UNASSIGNED_LABEL}</option>`);
  assert.equal(assignmentUnavailableOptionsHtml("p1"), `<option value="">${UNASSIGNED_LABEL}</option><option value="p1" selected>${UNKNOWN_MEMBER_LABEL}</option>`);
});
