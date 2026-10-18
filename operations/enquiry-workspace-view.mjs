// HTML builder for the enquiry workspace. Pure: takes data and helpers, returns a string.
// Every action here only records state. Nothing emails a customer, issues an invoice or charges a card.
import { quotePrefill, specRows, budgetNote, nextJobStep } from "./enquiry-workspace.mjs";

const stepGlyph = state => (state === "done" ? "✓" : state === "current" ? "●" : "○");
const pretty = value => String(value || "").replaceAll("_", " ");

export function badgeHtml(badge, esc) {
  return `<span class="ws-badge st-${esc(badge.tone)}" data-state="${esc(badge.key)}">${badge.key === "new" ? "● " : ""}${esc(badge.label.toUpperCase())}</span>`;
}

export function stepperHtml(steps, esc) {
  const current = steps.findIndex(step => step.state === "current");
  const progress = current === -1 ? `${steps.filter(step => step.state === "done").length} of ${steps.length} steps done` : `Step ${current + 1} of ${steps.length}`;
  return `<div class="ws-progress" aria-live="polite">${esc(progress)}</div><ol class="ws-stepper" aria-label="Project progress">${steps.map((step, index) => `<li class="${esc(step.state)}"${step.state === "current" ? ' aria-current="step"' : ""}><i aria-hidden="true">${stepGlyph(step.state)}</i><span>${esc(step.label)}</span><em class="sr-only"> ${esc(step.state === "done" ? "complete" : step.state === "current" ? "current step" : "not started")}</em></li>`).join("")}</ol>`;
}

function primaryButton(action, rel, esc, job) {
  const quote = rel.quote;
  switch (action.id) {
    case "open": return `<button type="button" class="ws-primary" data-ws-action="open-now">${esc(action.label)}</button>`;
    case "create-quote": return `<button type="button" class="ws-primary" data-ws-action="quote-editor">${esc(action.label)}</button>`;
    case "book-survey":
    case "schedule": return `<button type="button" class="ws-primary" data-ws-action="appointment-form">${esc(action.label)}</button>`;
    case "send-quote": return `<button type="button" class="ws-primary" data-ws-action="quote-status" data-id="${esc(quote.id)}" data-value="sent">${esc(action.label)}</button>`;
    case "accept-quote": return `<button type="button" class="ws-primary" data-ws-action="quote-status" data-id="${esc(quote.id)}" data-value="accepted">${esc(action.label)}</button><button type="button" class="outline" data-ws-action="quote-status" data-id="${esc(quote.id)}" data-value="rejected">Customer declined</button>`;
    case "create-job": return `<button type="button" class="ws-primary" data-make-order="${esc(quote.id)}">${esc(action.label)}</button>`;
    case "create-invoice": return `<button type="button" class="ws-primary" data-ws-action="invoice-form">${esc(action.label)}</button>`;
    case "send-invoice": {
      const draft = rel.invoices.find(item => item.status === "draft");
      return `<button type="button" class="ws-primary" data-ws-action="invoice-status" data-id="${esc(draft.id)}" data-value="sent">${esc(action.label)}</button>`;
    }
    case "record-payment": return `<button type="button" class="ws-primary" data-ws-action="payment-form">${esc(action.label)}</button>`;
    case "advance-job": return `<button type="button" class="ws-primary" data-ws-action="job-status" data-id="${esc(job.id)}" data-value="${esc(nextJobStep(job.status).status)}">${esc(action.label)}</button>`;
    default: return "";
  }
}

export function nextActionHtml({ action, rel, esc }) {
  const button = action.primary ? primaryButton(action, rel, esc, rel.job) : "";
  return `<section class="ws-next ${action.primary ? "" : "ws-next-idle"}" aria-labelledby="wsNextTitle"><p>NEXT STEP</p><h3 id="wsNextTitle">${esc(action.label)}</h3><small>${esc(action.hint)}</small>${button ? `<div class="ws-next-actions">${button}</div>` : ""}</section>`;
}

export function quoteEditorHtml({ lead, esc, today = new Date() }) {
  const { scope, suggestedSubtotal } = quotePrefill(lead);
  const until = new Date(today); until.setDate(until.getDate() + 30);
  const untilIso = until.toISOString().slice(0, 10);
  return `<form id="quoteDraft" class="ws-quote-form" data-request-id="${esc(lead.id)}"><p class="ws-form-note">Filled from the customer's enquiry. Check everything before saving. Saving creates a draft only; it is not sent.</p><label>Scope of work<textarea name="scope" required maxlength="12000" rows="9">${esc(scope)}</textarea></label><div class="ws-row"><label>Subtotal (£, before tax)<input name="subtotal" type="number" min="0" step="0.01" required ${suggestedSubtotal ? `value="${suggestedSubtotal}"` : ""} inputmode="decimal"></label><label>Tax rate (%)<input name="taxRate" type="number" min="0" max="100" step="0.01" value="0" required inputmode="decimal"></label><label>Valid until<input name="validUntil" type="date" value="${esc(untilIso)}"></label></div>${suggestedSubtotal ? `<small>Subtotal is suggested from the website guide midpoint (${esc(budgetNote(lead))}). It is an estimate to edit, not a price.</small>` : ""}<output class="ws-total" id="wsQuoteTotal" aria-live="polite"></output><button type="submit" class="ws-primary">Save quotation draft</button></form>`;
}

export function renderWorkspaceHtml(ctx) {
  const { lead, rel, steps, badge, action, esc, moneyPence, format, legacyTools = "", activity = [], activityText = () => "", demo = false, quoteAllowed = true, invoiceDefaults = null, today, money = true } = ctx;
  const spec = specRows(lead.project_spec);
  const contact = `${lead.email ? `<a class="outline" href="mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(`Form & Frame enquiry ${lead.reference}`)}">Email ${esc(lead.email)}</a>` : ""}${lead.phone ? `<a class="outline" href="tel:${encodeURIComponent(String(lead.phone).replace(/[^+\d]/g, ""))}">Call ${esc(lead.phone)}</a>` : ""}`;
  const quote = rel.quote;
  const blockingQuote = rel.quotes.some(item => ["draft", "sent", "accepted"].includes(item.status));
  const quoteCard = `<section class="ws-card" id="wsQuote"><h3>Quotation</h3>${quote ? `<div class="ws-record"><b>${esc(quote.quote_number)} · v${esc(quote.version)}</b><span class="ws-pill">${esc(pretty(quote.status))}</span><strong>${moneyPence(quote.total_pence)}</strong><small>${quote.valid_until ? `Valid to ${esc(quote.valid_until)}` : "No expiry set"}${quote.sent_at ? ` · recorded as sent ${esc(format(quote.sent_at))}` : ""}</small><p>${esc(quote.scope)}</p></div>` : `<p class="ws-empty">No quotation yet.</p>`}${demo ? `<p class="ws-empty">Demo mode does not save quotations.</p>` : blockingQuote ? `<p class="ws-empty">One quotation is already in progress, so a second cannot be created. Reject or let it expire to start a revision.</p>` : quoteAllowed ? `<details id="wsQuoteEditor" class="ws-editor" ${rel.quote ? "" : ""}><summary>${quote ? "Create a revised quotation" : "Create quotation"}</summary>${quoteEditorHtml({ lead, esc, today })}</details>` : `<p class="ws-empty">A site assessment is required first. Complete a survey, then create the quotation.</p>`}</section>`;
  const job = rel.job;
  const nextStep = job ? nextJobStep(job.status) : null;
  const jobCard = `<section class="ws-card" id="wsJob"><h3>Build job</h3>${job ? `<div class="ws-record"><b>${esc(job.work_order_number)}</b><span class="ws-pill">${esc(pretty(job.status))}</span>${money ? `<strong>${moneyPence(job.agreed_total_pence)}</strong>` : ""}<small>${job.target_completion ? `Target ${esc(job.target_completion)}` : "No target date set"}</small></div>${nextStep ? `<button type="button" class="outline" data-ws-action="job-status" data-id="${esc(job.id)}" data-value="${esc(nextStep.status)}">${esc(nextStep.label)}</button>` : ""}` : `<p class="ws-empty">${quote?.status === "accepted" ? "The quotation is accepted. Create the build job." : "A job is created once the customer accepts a quotation."}</p>`}</section>`;
  const appts = rel.appointments;
  const apptCard = `<section class="ws-card" id="wsAppointments"><h3>Appointments</h3>${appts.length ? appts.map(item => `<div class="ws-record"><b>${esc(pretty(item.kind))}</b><span class="ws-pill">${esc(pretty(item.status))}</span><small>${esc(format(item.starts_at))}${item.location ? ` · ${esc(item.location)}` : ""}</small></div>`).join("") : `<p class="ws-empty">Nothing booked. Preferred visit windows are requests, not bookings.</p>`}${demo ? "" : `<button type="button" class="outline" data-ws-action="appointment-form">Schedule survey or installation</button>`}</section>`;
  const invoiceBlocked = rel.invoices.length > 0;
  const invoiceCard = `<section class="ws-card" id="wsInvoices"><h3>Invoice &amp; payment</h3>${rel.invoices.length ? rel.invoices.map(item => `<div class="ws-record"><b>${esc(item.invoice_number)}</b><span class="ws-pill">${esc(pretty(item.status))}</span><strong>${moneyPence(item.total_pence)}</strong><small>Received ${moneyPence(item.paid_pence)} · outstanding ${moneyPence(item.outstanding_pence)}</small>${item.status === "draft" ? `<button type="button" class="outline" data-ws-action="invoice-status" data-id="${esc(item.id)}" data-value="sent">Record as sent</button><small>Records that you issued it. Nothing is emailed.</small>` : ""}${item.status === "sent" ? `<button type="button" class="outline" data-print-invoice="${esc(item.id)}">Print / save PDF</button>${Number(item.outstanding_pence) > 0 ? `<form class="paymentDraft ws-pay" id="wsPayment-${esc(item.id)}" data-invoice-id="${esc(item.id)}"><label>Amount received (£)<input name="amount" type="number" min="0.01" step="0.01" value="${(Number(item.outstanding_pence) / 100).toFixed(2)}" required inputmode="decimal"></label><label>Method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card (taken outside this app)</option><option value="other">Other</option></select></label><button>Record payment</button><small>Records money already received. No card is charged here.</small></form>` : ""}` : ""}</div>`).join("") : `<p class="ws-empty">${job ? "No invoice yet." : "Invoices are created from a build job."}</p>`}${job && !invoiceBlocked && invoiceDefaults ? `<details id="wsInvoiceEditor" class="ws-editor"><summary>Create invoice draft</summary><form class="invoiceDraft ws-invoice-form" data-work-order-id="${esc(job.id)}"><p class="ws-form-note">Amounts come from the accepted quotation. Saving creates a draft only.</p><label>Bill to<input name="billName" required maxlength="160" value="${esc(invoiceDefaults.billName)}"></label><label>Billing address<textarea name="billAddress" required maxlength="500" rows="3" placeholder="Customer billing address"></textarea></label><div class="ws-row"><label>Subtotal (£)<input name="subtotal" type="number" min="0" step="0.01" required value="${esc(invoiceDefaults.subtotal)}" inputmode="decimal"></label><label>Tax (£)<input name="tax" type="number" min="0" step="0.01" required value="${esc(invoiceDefaults.tax)}" inputmode="decimal"></label></div><div class="ws-row"><label>Issue date<input name="issueDate" type="date" required value="${esc(invoiceDefaults.issueDate)}"></label><label>Due date<input name="dueDate" type="date" required value="${esc(invoiceDefaults.dueDate)}"></label></div><button class="ws-primary">Save invoice draft</button></form></details>` : ""}</section>`;
  const activityCard = `<section class="ws-card" id="wsActivity"><h3>Activity</h3>${activity.length ? activity.map(item => `<div class="ws-activity"><span>${esc(format(item.created_at))}</span><b>${esc(pretty(item.entity_type))} · ${esc(pretty(item.event_type))}</b><small>${esc(activityText(item))}</small></div>`).join("") : `<p class="ws-empty">No recorded activity yet. Received ${esc(format(lead.created_at))}.</p>`}</section>`;
  const configCard = `<section class="ws-card" id="wsConfig"><h3>Requested media wall</h3>${spec.length ? `<dl class="ws-spec">${spec.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : `<p class="ws-empty">No configuration was attached to this enquiry.</p>`}<p class="ws-budget">${esc(budgetNote(lead))}</p></section>`;
  const customerCard = `<section class="ws-card" id="wsCustomer"><h3>Customer</h3><div class="ws-record"><b>${esc(lead.customer_name)}</b><small>${esc(lead.postcode)}${lead.wall_width ? ` · ${esc(lead.wall_width)}` : ""}</small><small>Reference ${esc(lead.reference)} · received ${esc(format(lead.created_at))} · ${esc(lead.source || "website")}</small></div><div class="ws-contact">${contact || `<span class="ws-empty">No contact details recorded.</span>`}</div><p class="ws-message">${esc(lead.message || "No customer note.")}</p></section>`;
  const photosCard = `<section class="ws-card" id="wsPhotosCard"><h3>Photographs</h3><div id="wsPhotos" class="ws-photos"><p class="ws-empty">${demo ? "Photographs load in live mode." : "Checking for uploaded photographs…"}</p></div></section>`;
  const statusControl = `<label class="ws-status-control">Change status manually<select class="status" data-id="${esc(lead.id)}" aria-label="Enquiry status">${["new", "reviewing", "date_requested", "confirmed", "quoted", "won", "lost", "archived"].map(status => `<option value="${status}" ${lead.status === status ? "selected" : ""}>${pretty(status)}</option>`).join("")}</select></label><small>Quotation, job and invoice progress changes the stage by itself. Use this to archive or reopen.</small>`;
  return `<header class="ws-head"><button type="button" class="outline ws-back" data-ws-action="back">‹ All enquiries</button><div class="ws-title"><p>ENQUIRY ${esc(lead.reference)}</p><h2>${esc(lead.customer_name)}</h2></div>${badgeHtml(badge, esc)}</header>${stepperHtml(steps, esc)}${nextActionHtml({ action, rel, esc })}<div class="ws-grid"><div class="ws-main">${money ? quoteCard : ""}${apptCard}${jobCard}${money ? invoiceCard : ""}</div><aside class="ws-side">${customerCard}${configCard}${photosCard}${activityCard}</aside></div><details class="ws-more"><summary>More tools &amp; secondary actions</summary><div class="ws-more-body">${statusControl}${legacyTools}</div></details>`;
}
