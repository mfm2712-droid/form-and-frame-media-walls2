import test from "node:test";
import assert from "node:assert/strict";
import { nextJobStep, enquiryState, relatedRecords, workflowSteps, recommendedAction, statusAfterOpen, specRows, quotePrefill, budgetNote, isUnopened } from "./enquiry-workspace.mjs";

const lead = (over = {}) => ({ id: "r1", status: "new", reference: "FF-TEST", customer_name: "Test Customer", postcode: "SL1 1AA", guide_low: 5000, guide_high: 6000, project_spec: {}, ...over });
const rel = (data = {}) => relatedRecords(lead(), data);
const quote = (over = {}) => ({ id: "q1", request_id: "r1", version: 1, status: "draft", sent_at: null, ...over });
const job = (over = {}) => ({ id: "j1", request_id: "r1", status: "accepted", ...over });

test("a new enquiry is New and unopened; opening moves only new to reviewing", () => {
  assert.equal(enquiryState(lead(), rel()), "new");
  assert.equal(isUnopened(lead()), true);
  assert.equal(statusAfterOpen(lead()), "reviewing");
  for (const status of ["reviewing", "quoted", "won", "archived", "lost", "confirmed", "date_requested"]) assert.equal(statusAfterOpen(lead({ status })), null);
});

test("seven required states are distinguished", () => {
  assert.equal(enquiryState(lead({ status: "reviewing" }), rel()), "opened");
  assert.equal(enquiryState(lead({ status: "reviewing" }), rel({ quotes: [quote()] })), "quoted");
  assert.equal(enquiryState(lead({ status: "quoted" }), rel({ quotes: [quote({ status: "accepted" })] })), "accepted");
  assert.equal(enquiryState(lead({ status: "won" }), rel()), "accepted");
  assert.equal(enquiryState(lead({ status: "won" }), rel({ quotes: [quote({ status: "accepted" })], workOrders: [job()] })), "in_progress");
  assert.equal(enquiryState(lead({ status: "won" }), rel({ quotes: [quote({ status: "accepted" })], workOrders: [job({ status: "completed" })] })), "completed");
  assert.equal(enquiryState(lead({ status: "archived" }), rel({ quotes: [quote()] })), "archived");
});

test("a cancelled job does not count and a superseded quote is ignored", () => {
  const r = rel({ quotes: [quote({ id: "q1", version: 1, status: "superseded" }), quote({ id: "q2", version: 2 })], workOrders: [job({ status: "cancelled" })] });
  assert.equal(r.job, null);
  assert.equal(r.quote.id, "q2");
});

test("stepper marks exactly one current step and done steps before it", () => {
  const steps = workflowSteps(lead({ status: "reviewing" }), rel());
  assert.equal(steps.length, 10);
  assert.deepEqual(steps.map(item => item.state), ["done", "done", "current", "todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
  const sent = workflowSteps(lead({ status: "quoted" }), rel({ quotes: [quote({ status: "sent", sent_at: "2026-10-16T09:00:00Z" })] }));
  assert.equal(sent.find(item => item.state === "current").id, "accept");
  const closed = workflowSteps(lead({ status: "archived" }), rel());
  assert.equal(closed.filter(item => item.state === "current").length, 0);
});

test("payment step needs every sent invoice fully paid", () => {
  const base = { quotes: [quote({ status: "accepted" })], workOrders: [job({ status: "in_progress" })], appointments: [{ id: "a", request_id: "r1", status: "scheduled", kind: "installation" }] };
  const unpaid = workflowSteps(lead({ status: "won" }), rel({ ...base, invoices: [{ id: "i1", work_order_id: "j1", status: "sent", total_pence: 10000, outstanding_pence: 2500 }] }));
  assert.equal(unpaid.find(item => item.id === "invoice").state, "done");
  assert.equal(unpaid.find(item => item.id === "payment").state, "current");
  const paid = workflowSteps(lead({ status: "won" }), rel({ ...base, invoices: [{ id: "i1", work_order_id: "j1", status: "sent", total_pence: 10000, outstanding_pence: 0 }] }));
  assert.equal(paid.find(item => item.id === "payment").state, "done");
});

test("recommended action follows the workflow and only sends quotations through the secure email flow", () => {
  assert.equal(recommendedAction(lead(), rel()).id, "open");
  assert.equal(recommendedAction(lead({ status: "reviewing" }), rel()).id, "create-quote");
  assert.equal(recommendedAction(lead({ status: "reviewing" }), rel(), { quoteAllowed: false }).id, "book-survey");
  assert.equal(recommendedAction(lead({ status: "quoted" }), rel({ quotes: [quote()] })).id, "send-quote");
  assert.match(recommendedAction(lead({ status: "quoted" }), rel({ quotes: [quote()] })).hint, /secure link and email/);
  assert.equal(recommendedAction(lead({ status: "quoted" }), rel({ quotes: [quote({ status: "sent", sent_at: "x" })] })).id, "accept-quote");
  assert.equal(recommendedAction(lead({ status: "won" }), rel({ quotes: [quote({ status: "accepted" })] })).id, "create-job");
  const withJob = { quotes: [quote({ status: "accepted" })], workOrders: [job()] };
  assert.equal(recommendedAction(lead({ status: "won" }), rel(withJob)).id, "schedule");
  const booked = { ...withJob, appointments: [{ id: "a", request_id: "r1", status: "scheduled" }] };
  assert.equal(recommendedAction(lead({ status: "won" }), rel(booked)).id, "advance-job");
  const running = { ...booked, workOrders: [job({ status: "in_progress" })] };
  assert.equal(recommendedAction(lead({ status: "won" }), rel(running)).id, "create-invoice");
  assert.equal(recommendedAction(lead({ status: "won" }), rel({ ...running, invoices: [{ id: "i", work_order_id: "j1", status: "draft" }] })).id, "send-invoice");
  assert.equal(recommendedAction(lead({ status: "won" }), rel({ ...running, invoices: [{ id: "i", work_order_id: "j1", status: "sent", total_pence: 100, outstanding_pence: 100 }] })).id, "record-payment");
  const paidInvoice = [{ id: "i", work_order_id: "j1", status: "sent", total_pence: 100, outstanding_pence: 0 }];
  const paidNext = recommendedAction(lead({ status: "won" }), rel({ ...running, invoices: paidInvoice }));
  assert.equal(paidNext.id, "advance-job");
  assert.equal(paidNext.label, "Move to quality check");
  const installed = { ...running, workOrders: [job({ status: "installed" })], invoices: paidInvoice };
  assert.equal(recommendedAction(lead({ status: "won" }), rel(installed)).label, "Mark job completed");
  assert.equal(recommendedAction(lead({ status: "archived" }), rel()).id, "none");
});

test("spec rows are readable, skip unknown values and show the customer budget", () => {
  const rows = specRows({ wall: "4200", ceil: "2700", tv: "65", finish: "walnut", handle: "brass", fireType: "lin2", ledType: "perim", left: "shelves", right: "cabinets", avcup: true, budgetMode: true, budget: 7500 });
  const map = Object.fromEntries(rows);
  assert.equal(map["Wall width"], "4200 mm");
  assert.equal(map["Finish"], "American walnut");
  assert.equal(map["Fire"], "Linear fire 2.0 kW");
  assert.equal(map["Customer budget"], "£7,500");
  assert.deepEqual(specRows(null), []);
  assert.deepEqual(specRows([1, 2]), []);
  assert.equal(specRows({ finish: "unknown-thing" }).find(([l]) => l === "Finish")[1], "unknown-thing");
});

test("budget note is honest when there is no customer budget", () => {
  assert.equal(budgetNote(lead({ project_spec: { budgetMode: true, budget: 7500 } })), "Customer budget £7,500");
  assert.match(budgetNote(lead()), /No budget given\. Website guide £5,000 to £6,000/);
  assert.equal(budgetNote({ project_spec: {} }), "No budget given");
});

test("quote prefill uses the enquiry brief and a whole-pound midpoint, never sending anything", () => {
  const p = quotePrefill(lead({ project_spec: { wall: "4200", finish: "oak" } }));
  assert.match(p.scope, /Test Customer \(FF-TEST\)/);
  assert.match(p.scope, /Finish: European oak/);
  assert.equal(p.suggestedSubtotal, 5500);
  assert.equal(quotePrefill(lead({ guide_low: null, guide_high: null })).suggestedSubtotal, null);
});

test("job steps follow the database chain and completion is only reachable from installed", () => {
  const order = ["accepted", "in_progress", "quality_check", "ready_for_install", "installation_scheduled", "installed", "completed"];
  let status = "accepted"; const seen = [status];
  while (nextJobStep(status)) { status = nextJobStep(status).status; seen.push(status); }
  assert.deepEqual(seen, order);
  assert.equal(nextJobStep("completed"), null);
  assert.equal(nextJobStep("cancelled"), null);
});
