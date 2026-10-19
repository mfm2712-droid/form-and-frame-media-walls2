import test from "node:test";
import assert from "node:assert/strict";
import { boardColumn, calendarEvents, dashboardQueues, documentRows, enquiryStage, filterDocuments, filterEnquiries, invoiceStatus, jobMoves, jobStatus, nextAction, quoteStatus, relatedRecords } from "./desk-model.mjs";
import { allowedNextStatuses } from "./workflow.mjs";

const today = new Date(2026, 9, 20, 10);
const lead = (over = {}) => ({ id:"r1", reference:"FF-TEST-1", customer_name:"Fictional Customer", email:"test@example.com", postcode:"SL1 1AA", status:"reviewing", created_at:"2026-10-18T09:00:00Z", ...over });
const quote = (over = {}) => ({ id:"q1", request_id:"r1", quote_number:"FFQ-1", version:1, status:"draft", total_pence:120000, created_at:"2026-10-19T09:00:00Z", ...over });

test("enquiry, quotation, job and invoice keep separate statuses", () => {
  const data = { quotes:[quote({ status:"sent", sent_at:"2026-10-19T10:00:00Z" })] };
  const rel = relatedRecords(lead(), data);
  assert.equal(enquiryStage(lead(), rel).label, "Quotation with customer");
  assert.equal(quoteStatus(rel.sent, { today }).label, "Sent · awaiting customer");
  assert.equal(jobStatus(null).label, "No job yet");
  assert.equal(invoiceStatus(null).label, "No invoice");
  assert.equal(enquiryStage(lead({ status:"new" }), relatedRecords(lead(), {})).label, "New");
  assert.equal(enquiryStage(lead({ status:"lost" }), rel).label, "Closed · not proceeding");
  assert.equal(enquiryStage(lead({ deleted_at:"2026-10-19" }), rel).key, "deleted");
  assert.equal(enquiryStage(lead({ assessment_required:true }), relatedRecords(lead(), {})).label, "Survey required");
});

test("quotation status shows revision requests, expiry and discarded drafts honestly", () => {
  assert.equal(quoteStatus(quote({ status:"sent", revision_requested_at:"2026-10-19" }), { today }).label, "Revision requested");
  assert.equal(quoteStatus(quote({ status:"sent", valid_until:"2026-10-01" }), { today }).label, "Expired");
  assert.equal(quoteStatus(quote({ status:"superseded" }), { today }).label, "Discarded draft");
  assert.equal(quoteStatus(quote({ status:"superseded", sent_at:"2026-10-01" }), { today }).label, "Replaced by revision");
  assert.equal(quoteStatus(quote({ status:"sent" }), { today, link:{ viewed_at:"2026-10-19" } }).label, "Sent · link opened");
  assert.equal(quoteStatus(quote({ status:"rejected" })).label, "Declined");
});

test("invoice status distinguishes issued, part paid, paid and overdue", () => {
  const base = { status:"sent", total_pence:1000, due_date:"2026-11-01" };
  assert.equal(invoiceStatus({ ...base, paid_pence:0, outstanding_pence:1000 }, { today }).key, "issued");
  assert.equal(invoiceStatus({ ...base, paid_pence:400, outstanding_pence:600 }, { today }).key, "partial");
  assert.equal(invoiceStatus({ ...base, paid_pence:1000, outstanding_pence:0 }, { today }).key, "paid");
  assert.equal(invoiceStatus({ ...base, paid_pence:0, outstanding_pence:1000, overdue:true }, { today }).key, "overdue");
  assert.equal(invoiceStatus({ status:"draft" }).key, "draft");
  assert.equal(invoiceStatus({ status:"void" }).key, "void");
});

test("job moves include backward steps and every move is allowed by the database rules", () => {
  for (const state of ["accepted", "ready_to_build", "in_progress", "quality_check", "ready_for_install", "installation_scheduled", "installed"]) {
    for (const move of jobMoves({ status:state })) assert.ok(allowedNextStatuses("work_order", state).includes(move.to), `${state} → ${move.to}`);
  }
  assert.ok(jobMoves({ status:"in_progress" }).some(move => move.backward));
  assert.deepEqual(jobMoves({ status:"completed" }), []);
  assert.equal(jobStatus({ status:"accepted" }, [{ kind:"installation", status:"scheduled" }]).label, "Installation scheduled");
  assert.equal(jobStatus({ status:"quality_check" }).label, "In progress");
});

test("the next step follows the real workflow from review to payment", () => {
  const steps = [];
  const record = (l, data) => steps.push(nextAction(l, relatedRecords(l, data), { today }).id);
  record(lead({ status:"new" }), {});
  record(lead({ assessment_required:true }), {});
  record(lead(), {});
  record(lead(), { quotes:[quote()] });
  record(lead(), { quotes:[quote({ status:"sent", sent_at:"x" })] });
  record(lead(), { quotes:[quote({ status:"sent", sent_at:"x", revision_requested_at:"y" })] });
  record(lead(), { quotes:[quote({ status:"accepted" })] });
  const job = { id:"j1", request_id:"r1", status:"accepted", work_order_number:"FFJ-1" };
  record(lead(), { quotes:[quote({ status:"accepted" })], workOrders:[job] });
  const install = { id:"a1", request_id:"r1", kind:"installation", status:"scheduled", starts_at:"2026-10-25T09:00:00Z", ends_at:"2026-10-25T17:00:00Z" };
  record(lead(), { quotes:[quote({ status:"accepted" })], workOrders:[job], appointments:[install] });
  record(lead(), { quotes:[quote({ status:"accepted" })], workOrders:[job], appointments:[install], invoices:[{ id:"i1", work_order_id:"j1", status:"draft" }] });
  assert.deepEqual(steps, ["review", "book-survey", "create-quote", "edit-quote", "await-customer", "revise-quote", "create-job", "book-installation", "create-invoice", "issue-invoice"]);
});

test("board columns and dashboard queues place each project once in the right place", () => {
  const data = {
    quotes:[quote({ status:"sent", sent_at:"x" }), quote({ id:"q2", request_id:"r2", status:"accepted" })],
    workOrders:[{ id:"j2", request_id:"r2", status:"in_progress" }],
    appointments:[{ id:"a1", request_id:"r3", kind:"survey", status:"scheduled", starts_at:"2026-10-21T09:00:00Z", ends_at:"2026-10-21T10:00:00Z" }],
    invoices:[{ id:"i1", work_order_id:"j2", status:"sent", outstanding_pence:500, due_date:"2026-10-30" }]
  };
  const leads = [lead(), lead({ id:"r2", reference:"FF-TEST-2" }), lead({ id:"r3", reference:"FF-TEST-3", status:"date_requested" }), lead({ id:"r4", status:"new" })];
  assert.equal(boardColumn(leads[0], relatedRecords(leads[0], data)), "awaiting");
  assert.equal(boardColumn(leads[1], relatedRecords(leads[1], data)), "progress");
  assert.equal(boardColumn(leads[2], relatedRecords(leads[2], data)), "survey");
  assert.equal(boardColumn(leads[3], relatedRecords(leads[3], data)), null);
  const queues = dashboardQueues({ leads, data, today });
  assert.equal(queues.newEnquiries.length, 1);
  assert.equal(queues.awaitingResponse.length, 1);
  assert.equal(queues.inProgress.length, 1);
  assert.equal(queues.surveys.length, 1);
  assert.equal(queues.outstanding.length, 1);
});

test("search finds customers by name, reference, quotation and invoice numbers", () => {
  const data = { quotes:[quote({ quote_number:"FFQ-20261019-AB12" })], workOrders:[{ id:"j1", request_id:"r1", work_order_number:"FFJ-9" }], invoices:[{ id:"i1", work_order_id:"j1", invoice_number:"FFI-77", status:"sent" }] };
  const leads = [lead(), lead({ id:"r9", customer_name:"Other Person", reference:"FF-TEST-9", postcode:"RG1 2BB", email:"other@example.com" })];
  for (const query of ["fictional", "FF-TEST-1", "ab12", "FFI-77", "ffj-9", "sl1 1aa"]) {
    assert.deepEqual(filterEnquiries(leads, data, { query, filter:"all" }).map(row => row.lead.id), ["r1"], query);
  }
  assert.equal(filterEnquiries([lead({ deleted_at:"x" })], {}, { filter:"open" }).length, 0, "deleted enquiries leave the main list");
  assert.equal(filterEnquiries([lead({ deleted_at:"x" })], {}, { filter:"deleted" }).length, 1, "and can be found to restore");
  const rows = documentRows({ leads, data:{ ...data, payments:[{ id:"p1", invoice_id:"i1", amount_pence:100, received_at:"2026-10-19" }] }, today });
  assert.deepEqual(filterDocuments(rows, { query:"fictional" }).map(row => row.kind).sort(), ["invoice", "payment", "quote"]);
  assert.deepEqual(filterDocuments(rows, { query:"FFI-77", kind:"invoice" }).length, 1);
});

test("the calendar combines appointments, follow-ups, job dates and blocked time", () => {
  const from = new Date(2026, 9, 1), to = new Date(2026, 10, 1);
  const events = calendarEvents({
    leads:[lead()],
    data:{
      appointments:[{ id:"a1", request_id:"r1", kind:"installation", status:"scheduled", starts_at:"2026-10-22T08:00:00Z", ends_at:"2026-10-22T16:00:00Z" }, { id:"a2", request_id:"r1", kind:"survey", status:"cancelled", starts_at:"2026-10-21T08:00:00Z", ends_at:"2026-10-21T09:00:00Z" }],
      followUps:[{ id:"f1", request_id:"r1", title:"Call back", due_at:"2026-10-23T10:00:00Z" }],
      workOrders:[{ id:"j1", request_id:"r1", status:"in_progress", work_order_number:"FFJ-1", target_completion:"2026-10-30" }]
    },
    blocks:[{ id:"b1", kind:"blocked", title:"Holiday", starts_at:"2026-10-27T00:00:00Z", ends_at:"2026-10-28T00:00:00Z" }],
    from, to
  });
  assert.deepEqual(events.map(event => event.type), ["installation", "follow_up", "blocked", "milestone"]);
  assert.ok(events.filter(event => event.type !== "blocked").every(event => event.requestId === "r1"), "every work event links to its customer");
});
