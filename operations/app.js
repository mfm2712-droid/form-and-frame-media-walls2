import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { getLocalDayBounds, getTodayAgenda, nextAction, relevantDate } from "./today-view.mjs";
import { buildFinanceSummary, buildProjectModel } from "./project-model.mjs";
import { requirePersistedRow } from "./mutation-result.mjs";
import { toLocalDateTimeInputValue } from "./datetime-local.mjs";
import { PIPELINE_STAGES, isConfirmedVisitStatus, pipelineIndexForStatus } from "./pipeline.mjs";
import { allowedNextStatuses, calculateTax, poundsToPence, taxRateForAmount } from "./workflow.mjs";
import { isIOSDevice, isInstalledPWA, pushSetupMessage } from "./push-support.mjs";
import { activityDetailText } from "./activity-label.mjs";
import { enquiryTargetFromSearch, operationsViewFromSearch } from "./push-target.mjs";
import { assignmentLabel, assignmentOptionsHtml, assignmentUnavailableOptionsHtml } from "./assignment.mjs";
import { blockListHtml } from "./availability-list.mjs";
import { invoiceSettingsReady, renderInvoiceDocument } from "./invoice-document.mjs";
import { clearPaymentRecordingKey, getPaymentRecordingKey, paymentMatchesIntent } from "./payment-idempotency.mjs";
import { checkStaffAccess, staffAccessMessage } from "./staff-access.mjs";
import { calendarWindow, loadCalendarRecords } from "./calendar-records.mjs";
import { loadBusinessRows } from "./business-records.mjs";

const $ = id => document.getElementById(id);
const esc = value => String(value || "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = value => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP", maximumFractionDigits:0 }).format(Number(value || 0));
const format = value => new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value));
const plusDays = (days, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
const local = toLocalDateTimeInputValue;
const pushEnquiryTarget = enquiryTargetFromSearch(window.location.search);
const pushViewTarget = operationsViewFromSearch(window.location.search);
let demo = false, db = null, demoLeads = [], demoBlocks = [], liveLeads = [], liveBlocks = [], selectedId = pushEnquiryTarget;
let liveQuotes = [], liveWorkOrders = [], liveAppointments = [], liveInvoices = [], liveInvoiceDetails = [], liveProfiles = null;
let invoiceSettings = null, currentStaffRole = null;
let calendarMode = "month", calendarDate = new Date();
let liveRefreshTimer = null, liveChannel = null;
let calendarBlocks = [], calendarAppointments = [], calendarLoadVersion = 0;

function setMobileView(view) {
  document.body.dataset.mobileView = view;
  document.querySelectorAll(".mobile-nav [data-mobile-view]").forEach(item => {
    if (item.dataset.mobileView === view) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $("businessTitle").textContent = view === "money" ? "Money" : view === "work" ? "Quotes & build jobs" : "Quotes, work & money";
  window.scrollTo({ top:0, behavior:"smooth" });
}

document.querySelectorAll(".mobile-nav [data-mobile-view]").forEach(button => button.addEventListener("click", () => setMobileView(button.dataset.mobileView)));

function showNotice(message, kind = "error") {
  const notice = $("notice");
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = !message;
}

async function saveLive(action, successMessage) {
  try {
    requirePersistedRow(await action());
    const refreshed = await loadLive();
    showNotice(refreshed ? successMessage : `${successMessage} The latest data could not be refreshed; use Refresh to verify it.`, refreshed ? "success" : "warning");
    return { saved:true, refreshed };
  } catch (error) {
    console.error("Operations change failed.", error);
    showNotice("We couldn't confirm this change. The latest data may be out of date; refresh before retrying.");
    return { saved:false, refreshed:false };
  }
}

function renderCalendar(blocks, appointments = []) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cellCount = calendarMode === "month" ? 42 : 7;
  let start;
  if (calendarMode === "month") {
    start = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    $("calendarPeriod").textContent = new Intl.DateTimeFormat("en-GB", { month:"long", year:"numeric" }).format(calendarDate);
  } else {
    start = new Date(calendarDate);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const last = new Date(start); last.setDate(start.getDate() + 6);
    $("calendarPeriod").textContent = `${start.toLocaleDateString("en-GB", { day:"numeric", month:"short" })} – ${last.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" })}`;
  }
  // The visible period ends after the last grid cell; the compact block
  // list below the grid repeats exactly these availability blocks.
  const periodEnd = new Date(start);
  periodEnd.setDate(periodEnd.getDate() + cellCount - 1);
  periodEnd.setHours(23, 59, 59, 999);
  const cells = Array.from({ length:cellCount }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index); const end = new Date(day); end.setDate(end.getDate() + 1);
    const dayBlocks = blocks.filter(item => new Date(item.starts_at) < end && new Date(item.ends_at) > day).map(item => ({ ...item, isAppointment:false }));
    const dayAppointments = appointments.filter(item => item.status !== "cancelled" && new Date(item.starts_at) < end && new Date(item.ends_at) > day).map(item => {
      const enquiry = requestFor(item.request_id);
      const assignee = assignmentLabel(item.assigned_to, liveProfiles);
      const title = `${item.status === "completed" ? "Completed · " : ""}${new Date(item.starts_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })} ${item.kind} · ${enquiry?.customer_name || "Booked"}${assignee === "Unassigned" ? "" : ` · ${assignee}`}`;
      return { ...item, kind:"appointment", title, isAppointment:true };
    });
    const events = [...dayBlocks, ...dayAppointments];
    const isOutside = calendarMode === "month" && day.getMonth() !== calendarDate.getMonth();
    const today = day.toDateString() === new Date().toDateString();
    return `<div class="cal-day ${isOutside ? "outside" : ""} ${today ? "is-today" : ""}"><div class="cal-day-head"><b>${day.getDate()}</b></div>${events.map(event => `<div class="cal-event ${event.isAppointment ? "appointment" : event.kind}" title="${esc(event.title)}">${esc(event.title)}${event.isAppointment ? "" : `<button class="unblock" data-id="${event.id}" aria-label="Remove ${esc(event.title)}">Remove</button>`}</div>`).join("")}</div>`;
  }).join("");
  document.querySelectorAll(".calendar-mode").forEach(button => {
    const active = button.dataset.calendarMode === calendarMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("calendar").innerHTML = `<div class="cal-grid ${calendarMode}"><div class="cal-weekdays">${names.map(name => `<b>${name}</b>`).join("")}</div>${cells}</div>`;
  // On narrow phones the in-cell Remove buttons cannot reach a 44px width,
  // so the same blocks are repeated below the grid with compliant targets.
  $("blockList").innerHTML = blockListHtml(blocks, start, periodEnd);
}

function renderProject(lead) {
  const p = buildProjectModel(lead);
  const summary = buildFinanceSummary(lead, p);
  const finance = summary.mode === "sample"
    ? `<p>DEMO ONLY · FICTIONAL COST BREAKDOWN</p><div class="cost"><div><span>Sample materials & fitted joinery</span><b>${money(summary.materials)}</b></div><div><span>Sample fire, LED & electrical</span><b>${money(summary.equipment)}</b></div><div><span>Sample workshop & installation labour</span><b>${money(summary.labour)}</b></div><div class="total"><span>FICTIONAL SAMPLE VALUE</span><b>${money(summary.total)}</b></div></div><small class="cost-note">Illustrative demo figures only. They are not actual costs, a customer quote, VAT calculation or profit margin.</small>`
    : `<p>WEBSITE PRICE GUIDE · NOT A QUOTE</p><div class="cost"><div><span>Indicative range</span><b>${money(summary.low)}–${money(summary.high)}</b></div></div><small class="cost-note">No approved quote, invoice or actual job costs are recorded for this enquiry. Revenue and margin are not yet available.</small>`;
  const appointmentAssigneeControl = liveProfiles
    ? `<label>Assigned to<select name="assignedTo">${assignmentOptionsHtml(liveProfiles, "")}</select></label>`
    : `<label>Assigned to<select name="assignedTo" disabled title="The team member list is unavailable; assignment is disabled until Refresh">${assignmentUnavailableOptionsHtml(null)}</select></label>`;
  const liveControls = demo ? "" : `<details class="record-form"><summary>Create formal quote draft</summary><form id="quoteDraft" data-request-id="${esc(lead.id)}"><label>Scope<textarea name="scope" required maxlength="12000" rows="3" placeholder="What is included in the media wall build?"></textarea></label><label>Subtotal (£)<input name="subtotal" type="number" min="0" step="0.01" required></label><label>Tax rate (%)<input name="taxRate" type="number" min="0" max="100" step="0.01" value="0" required></label><label>Valid until<input name="validUntil" type="date"></label><small>Rates require your business tax decision. Saving creates a draft only; it does not send a quote.</small><button>Create draft quote</button></form></details><details class="record-form"><summary>Schedule a real appointment</summary><form id="appointmentDraft" data-request-id="${esc(lead.id)}"><label>Appointment type<select name="kind"><option value="survey">Site survey</option><option value="installation">Installation</option></select></label><label>Starts<input name="startsAt" type="datetime-local" required></label><label>Ends<input name="endsAt" type="datetime-local" required></label><label>Location<input name="location" maxlength="240" value="${esc(lead.postcode)}"></label>${appointmentAssigneeControl}<button>Save appointment</button><small>Saved bookings reserve this time and are checked against holiday/closed blocks. The app does not send a customer confirmation.</small></form></details><details class="record-form"><summary>Schedule a follow-up</summary><form id="followUpDraft" data-request-id="${esc(lead.id)}"><label>Task<input name="title" required maxlength="160" value="Follow up ${esc(lead.customer_name)}"></label><label>Due<input name="dueAt" type="datetime-local" required></label><button>Save follow-up</button></form></details>`;
  $("projectPanel").innerHTML = `<p>PROJECT BRIEF</p><h2>${esc(p.title)}</h2><img src="${esc(p.image)}" alt="Proposed finish reference for ${esc(p.title)}"><div class="project-spec"><b>${esc(p.location)}</b><br>${esc(p.geometry)}<br>${esc(p.system)}</div><p>MATERIAL PALETTE</p><div class="material-row" title="${esc(p.materialLabel)}">${p.materials.map(colour => `<i class="material" style="--c:${colour}"></i>`).join("")}</div><small>${esc(p.materialLabel)}</small><div class="mini-plan" aria-label="Indicative media wall elevation"></div>${finance}<button id="confirmVisit" data-id="${esc(lead.id)}">Mark visit status confirmed</button><small class="project-note">This updates the enquiry status only; it does not reserve a calendar slot.</small>${liveControls}`;
}

const moneyPence = pence => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP" }).format(Number(pence || 0) / 100);
const optionList = (states, value) => states.map(state => `<option value="${state}" ${state === value ? "selected" : ""}>${state.replaceAll("_", " ")}</option>`).join("");
// Assignment stays disabled until the staff-visible profile list loads; a failed
// lookup keeps the control visible but unavailable until the next Refresh.
const assignmentControl = (kind, id, assignedTo) => liveProfiles
  ? `<label>Assigned to<select data-assignment="${kind}" data-id="${esc(id)}">${assignmentOptionsHtml(liveProfiles, assignedTo)}</select></label>`
  : `<label>Assigned to<select data-assignment="${kind}" data-id="${esc(id)}" disabled title="The team member list is unavailable; assignment is disabled until Refresh">${assignmentUnavailableOptionsHtml(assignedTo)}</select></label>`;
const nextRecordStates = allowedNextStatuses;
const requestFor = id => liveLeads.find(item => item.id === id);

function renderWorkflows(data) {
  liveQuotes = data.quotes;
  liveWorkOrders = data.workOrders;
  liveAppointments = data.appointments;
  liveInvoices = data.invoices;
  liveInvoiceDetails = data.invoiceRecords || [];
  const profiles = Array.isArray(data.profiles) ? data.profiles : null;
  $("invoiceWorkOrder").innerHTML = `<option value="">Choose a work order</option>${liveWorkOrders.filter(job => job.status !== "cancelled").map(job => `<option value="${esc(job.id)}">${esc(job.work_order_number)} · ${esc(job.title)}</option>`).join("")}`;
  $("invoiceDraftFromMoney").elements.issueDate.value = local(new Date()).slice(0, 10);
  const balances = data.invoices;
  const sentInvoices = balances.filter(row => row.status === "sent");
  const totalBilledPence = sentInvoices.reduce((sum, row) => sum + Number(row.total_pence || 0), 0);
  const totalReceivedPence = sentInvoices.reduce((sum, row) => sum + Number(row.paid_pence || 0), 0);
  const totalOutstandingPence = sentInvoices.reduce((sum, row) => sum + Number(row.outstanding_pence || 0), 0);
  $("totalBilled").textContent = moneyPence(totalBilledPence);
  $("totalReceived").textContent = moneyPence(totalReceivedPence);
  $("totalOutstanding").textContent = moneyPence(totalOutstandingPence);
  const sentQuoteRequests = new Set(data.quotes.filter(quote => quote.sent_at).map(quote => quote.request_id));
  const acceptedQuoteRequests = new Set(data.quotes.filter(quote => quote.status === "accepted").map(quote => quote.request_id));
  const wins = [...acceptedQuoteRequests].filter(requestId => sentQuoteRequests.has(requestId)).length;
  const sentCount = sentQuoteRequests.size;
  $("quoteWinRate").textContent = sentCount ? `${Math.round(wins / sentCount * 100)}%` : "—";
  $("quoteWinCount").textContent = `${wins} accepted / ${sentCount} enquiries with a sent quote (all saved quotes)`;
  const latestSentQuoteByRequest = new Map();
  for (const quote of data.quotes.filter(item => item.sent_at)) {
    const previous = latestSentQuoteByRequest.get(quote.request_id);
    if (!previous || Number(quote.version) > Number(previous.version)) latestSentQuoteByRequest.set(quote.request_id, quote);
  }
  const sentQuoteValuePence = [...latestSentQuoteByRequest.values()].reduce((sum, quote) => sum + Number(quote.total_pence || 0), 0);
  $("todayMoney").innerHTML = `<div class="today-money-heading"><p>YOUR BUSINESS · RECORDED RECORDS</p><h2>Today, at a glance</h2><small>All staff-visible saved invoice and quote records · GBP</small></div><div class="today-money-hero"><span>Received against sent invoices</span><b>${moneyPence(totalReceivedPence)}</b><small>${moneyPence(totalOutstandingPence)} remains outstanding</small></div><div class="today-money-cards"><article><span>Invoiced</span><b>${moneyPence(totalBilledPence)}</b></article><article><span>Still due</span><b>${moneyPence(totalOutstandingPence)}</b></article><article><span>Quotes sent</span><b>${moneyPence(sentQuoteValuePence)}</b></article><article><span>Quote win rate</span><b>${sentCount ? `${Math.round(wins / sentCount * 100)}%` : "—"}</b></article></div><p class="today-money-note">Figures are based on saved business records, not website guide prices. Quote rate is by enquiry, not total revenue.</p>`;
  $("activeBuilds").textContent = liveWorkOrders.filter(item => !["completed", "cancelled"].includes(item.status)).length;
  $("businessState").textContent = "All saved financial records · GBP";

  $("quoteList").innerHTML = data.quotes.length ? data.quotes.map(quote => {
    const enquiry = requestFor(quote.request_id);
    return `<article class="business-card"><div><b>${esc(quote.quote_number)}</b><span>${esc(enquiry?.customer_name || "Enquiry")}${enquiry ? ` · ${esc(enquiry.reference)}` : ""}</span></div><strong>${moneyPence(quote.total_pence)}</strong><label>Status<select data-record-status="quote" data-id="${esc(quote.id)}">${optionList(nextRecordStates("quote", quote.status), quote.status)}</select></label><small>Version ${quote.version} · ${quote.valid_until ? `valid to ${esc(quote.valid_until)}` : "no expiry set"} · status records external communication</small><p>${esc(quote.scope)}</p>${quote.status === "accepted" && !liveWorkOrders.some(job => job.accepted_quote_id === quote.id) ? `<button class="outline" data-make-order="${esc(quote.id)}">Create build job</button>` : ""}</article>`;
  }).join("") : `<p class="today-empty">No formal quotes recorded yet.</p>`;

  $("workOrderList").innerHTML = data.workOrders.length ? data.workOrders.map(job => {
    const enquiry = requestFor(job.request_id);
    const hasInvoice = data.invoices.some(invoice => invoice.work_order_id === job.id);
    return `<article class="business-card"><div><b>${esc(job.work_order_number)}</b><span>${esc(enquiry?.customer_name || job.title)} · ${esc(job.title)}</span></div><strong>${moneyPence(job.agreed_total_pence)}</strong><label>Build status<select data-record-status="work_order" data-id="${esc(job.id)}">${optionList(nextRecordStates("work_order", job.status), job.status)}</select></label><small>Assigned to ${esc(assignmentLabel(job.assigned_to, profiles))}</small>${assignmentControl("work_order", job.id, job.assigned_to)}<small>${job.target_completion ? `Target ${esc(job.target_completion)}` : "No target completion date"}${job.actual_cost_pence == null ? " · actual costs not entered" : ` · actual cost ${moneyPence(job.actual_cost_pence)}`}</small><label>Actual costs (£)<input data-actual-cost="${esc(job.id)}" type="number" min="0" step="0.01" value="${job.actual_cost_pence == null ? "" : (job.actual_cost_pence / 100).toFixed(2)}" placeholder="Enter actual cost"></label>${!hasInvoice && job.status !== "cancelled" ? `<details class="record-form"><summary>Create invoice draft</summary><form class="invoiceDraft" data-work-order-id="${esc(job.id)}"><label>Bill to<input name="billName" required maxlength="160" value="${esc(enquiry?.customer_name || "")}"></label><label>Billing address<textarea name="billAddress" required minlength="5" maxlength="1200" rows="2"></textarea></label><label>Issue date<input name="issueDate" type="date" required value="${local(new Date()).slice(0, 10)}"></label><label>Due date<input name="dueDate" type="date" required></label><label>Subtotal (£)<input name="subtotal" type="number" min="0" step="0.01" required></label><label>Tax amount (£)<input name="tax" type="number" min="0" step="0.01" value="0" required></label><button>Create invoice draft</button><small>Draft only. Enter the approved invoice figures and terms; this does not send an invoice.</small></form></details>` : ""}</article>`;
  }).join("") : `<p class="today-empty">No accepted quotes have been converted into build jobs.</p>`;
  if (data.workOrders.length) {
    $("workOrderList").insertAdjacentHTML("beforeend", `<div class="job-deadlines"><b>Plan build dates</b>${data.workOrders.map(job => `<div class="deadline-row"><span>${esc(job.work_order_number)}</span><label>Start<input type="date" data-job-date="planned_start" data-id="${esc(job.id)}" value="${esc(job.planned_start || "")}"></label><label>Target finish<input type="date" data-job-date="target_completion" data-id="${esc(job.id)}" value="${esc(job.target_completion || "")}"></label></div>`).join("")}</div>`);
  }

  $("appointmentList").innerHTML = data.appointments.length ? data.appointments.map(appointment => {
    const enquiry = requestFor(appointment.request_id);
    return `<article class="business-card"><div><b>${esc(appointment.kind.replaceAll("_", " "))}</b><span>${esc(enquiry?.customer_name || "Customer")}${appointment.location ? ` · ${esc(appointment.location)}` : ""}</span></div><small>${format(appointment.starts_at)} – ${new Date(appointment.ends_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })}</small><label>Appointment status<select data-record-status="appointment" data-id="${esc(appointment.id)}">${optionList(nextRecordStates("appointment", appointment.status), appointment.status)}</select></label><small>Assigned to ${esc(assignmentLabel(appointment.assigned_to, profiles))}</small>${assignmentControl("appointment", appointment.id, appointment.assigned_to)}<small>Calendar time is reserved while scheduled or confirmed.</small></article>`;
  }).join("") : `<p class="today-empty">No booked appointments yet. A requested visit window is not a booking.</p>`;

  $("invoiceList").innerHTML = data.invoices.length ? data.invoices.map(invoice => {
    const canPrint = invoiceSettingsReady(invoiceSettings) && liveInvoiceDetails.some(record => record.id === invoice.id);
    return `<article class="business-card"><div><b>${esc(invoice.invoice_number)}</b><span>${invoice.status === "sent" ? `Due ${esc(invoice.due_date)} · ${invoice.overdue ? "OVERDUE" : "not overdue"}` : "Draft · not yet billed"}</span></div><strong>${moneyPence(invoice.total_pence)}</strong><small>Received ${moneyPence(invoice.paid_pence)} · outstanding ${moneyPence(invoice.outstanding_pence)}</small><button class="outline" type="button" data-print-invoice="${esc(invoice.id)}" ${canPrint ? "" : "disabled"}>${canPrint ? "Print / save PDF" : "Complete invoice setup first"}</button><label>Invoice status<select data-record-status="invoice" data-id="${esc(invoice.id)}">${optionList(nextRecordStates("invoice", invoice.status), invoice.status)}</select></label>${invoice.status === "sent" && invoice.outstanding_pence > 0 ? `<form class="paymentDraft" data-invoice-id="${esc(invoice.id)}"><label>Record payment (£)<input name="amount" type="number" min="0.01" step="0.01" max="${(invoice.outstanding_pence / 100).toFixed(2)}" required></label><label>Method<select name="method"><option value="bank_transfer">Bank transfer</option><option value="card">Card · record manually</option><option value="cash">Cash</option><option value="other">Other</option></select></label><button>Save payment</button></form>` : ""}<small>Changing status to Sent records an external send. Printing creates the invoice document; delivery remains manual.</small></article>`;
  }).join("") : `<p class="today-empty">No invoice balances recorded. Quotes are not invoices.</p>`;
}

async function loadWorkflows() {
  if (demo) {
    $("businessState").textContent = "Demo only · no financial records";
    $("todayMoney").innerHTML = `<div class="today-money-heading"><p>OWNER OVERVIEW</p><h2>Today, at a glance</h2><small>Demo only · fictional business data is not used for live finance.</small></div><div class="today-money-empty">Recorded invoices, received payments and quote totals appear here after secure staff sign-in.</div>`;
    for (const id of ["totalBilled", "totalReceived", "totalOutstanding", "quoteWinRate", "activeBuilds"]) $(id).textContent = "—";
    $("quoteWinCount").textContent = "Available in live mode";
    for (const id of ["quoteList", "workOrderList", "appointmentList", "invoiceList", "activityList"]) $(id).innerHTML = `<p class="today-empty">Live business records are not shown in demo mode.</p>`;
    return;
  }
  try {
    const { start:todayStart, end:tomorrowStart } = getLocalDayBounds();
    const [quotes, workOrders, appointments, invoices, invoiceRecords, followUps, activity] = await Promise.all([
      loadBusinessRows(db, "quotes", "created_at"),
      loadBusinessRows(db, "work_orders", "created_at"),
      db.from("appointments").select("*").gt("ends_at", todayStart.toISOString()).lt("starts_at", plusDays(365, 0).toISOString()).order("starts_at").limit(500),
      loadBusinessRows(db, "invoice_balances", "due_date", true),
      loadBusinessRows(db, "invoices", "created_at"),
      db.from("follow_up_tasks").select("*").is("completed_at", null).is("cancelled_at", null).lte("due_at", tomorrowStart.toISOString()).order("due_at").limit(100),
      db.from("workflow_activity").select("*").order("created_at", { ascending:false }).limit(30)
    ]);
    const failure = [quotes, workOrders, appointments, invoices, invoiceRecords, followUps, activity].find(result => result.error);
    if (failure) throw failure.error;
    renderWorkflows({ quotes:quotes.data || [], workOrders:workOrders.data || [], appointments:appointments.data || [], invoices:invoices.data || [], invoiceRecords:invoiceRecords.data || [], followUps:followUps.data || [], profiles:liveProfiles });
    $("activityList").innerHTML = activity.data?.length ? activity.data.map(item => {
      const detail = activityDetailText(item);
      return `<article class="activity-row"><span>${format(item.created_at)}</span><b>${esc(item.event_type.replaceAll("_", " "))}</b><small>${esc(item.entity_type.replaceAll("_", " "))} · ${esc(item.entity_id.slice(0, 8))}${detail ? ` · ${esc(detail)}` : ""}</small></article>`;
    }).join("") : `<p class="today-empty">No activity recorded yet.</p>`;
    await refreshCalendar();
    const startMs = todayStart.getTime(), endMs = tomorrowStart.getTime();
    const todaysAppointments = (appointments.data || []).filter(item => item.status !== "cancelled" && new Date(item.starts_at).getTime() < endMs && new Date(item.ends_at).getTime() > startMs);
    $("todayAppointments").parentElement.querySelector("h3").textContent = "Booked appointments today";
    $("todayAppointments").innerHTML = todaysAppointments.length ? todaysAppointments.map(item => {
      const enquiry = requestFor(item.request_id);
      const assignee = assignmentLabel(item.assigned_to, liveProfiles);
      const appointmentActions = ["scheduled", "confirmed"].includes(item.status) ? `<div class="today-actions"><button class="outline" type="button" data-complete-appointment="${esc(item.id)}" aria-label="Mark appointment for ${esc(enquiry?.customer_name || item.kind)} complete">Done</button><button class="outline" type="button" data-cancel-appointment="${esc(item.id)}" aria-label="Cancel appointment for ${esc(enquiry?.customer_name || item.kind)}">Cancel</button></div>` : "";
      return `<article class="today-item"><div class="today-meta"><b>${esc(enquiry?.customer_name || item.kind.replaceAll("_", " "))}</b><span>${format(item.starts_at)} · ${esc(item.location || "No location")} · Assigned to ${esc(assignee)}</span></div><span class="today-status">${esc(item.status)}</span><span class="today-visit-state">Booked ${esc(item.kind)} · until ${new Date(item.ends_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })}</span>${appointmentActions}</article>`;
    }).join("") : `<p class="today-empty">No booked appointments for today. Preferred visit windows are shown separately and are not bookings.</p>`;
    const dueToday = followUps.data || [];
    const todayDate = local(todayStart).slice(0, 10);
    const dueInvoices = (invoices.data || []).filter(invoice => invoice.status === "sent" && invoice.outstanding_pence > 0 && invoice.due_date <= todayDate);
    const paymentRows = dueInvoices.map(invoice => `<article class="today-item"><div class="today-meta"><b>${esc(invoice.invoice_number)}</b><span>${invoice.due_date < todayDate ? "Overdue" : "Due today"} · ${esc(invoice.due_date)} · ${moneyPence(invoice.outstanding_pence)} remaining</span></div><span class="today-status">Payment due</span></article>`);
    const followUpRows = dueToday.map(task => `<article class="today-item"><div class="today-meta"><b>${esc(task.title)}</b><span>${new Date(task.due_at).getTime() < startMs ? "Overdue" : "Due"} · ${format(task.due_at)}</span></div><span class="today-status">Follow-up</span><button class="outline" data-complete-followup="${esc(task.id)}">Complete</button></article>`);
    $("todayPayments").innerHTML = [...paymentRows, ...followUpRows].join("") || `<p class="today-empty">No overdue invoices, payments due today or scheduled follow-ups.</p>`;
    const nextSevenDays = new Date(todayStart); nextSevenDays.setDate(nextSevenDays.getDate() + 7);
    const todayIso = todayDate;
    const deadlineEndIso = local(nextSevenDays).slice(0, 10);
    const upcomingJobs = (workOrders.data || []).filter(job => job.status !== "completed" && job.status !== "cancelled" && job.target_completion && job.target_completion <= deadlineEndIso);
    $("todayBlockers").innerHTML = upcomingJobs.length ? upcomingJobs.map(job => `<article class="today-item"><div class="today-meta"><b>${esc(job.work_order_number)}</b><span>${job.target_completion < todayIso ? "Overdue" : job.target_completion === todayIso ? "Target today" : "Target"} · ${esc(job.target_completion)}</span></div><span class="today-status">${esc(job.status.replaceAll("_", " "))}</span></article>`).join("") : `<p class="today-empty">No active build targets within the next seven days.</p>`;
    return true;
  } catch (error) {
    console.error("Business workflow records could not be loaded.", error);
    $("businessState").textContent = "Business records could not be fully loaded · refresh to retry";
    $("todayMoney").innerHTML = `<div class="today-money-heading"><p>OWNER OVERVIEW</p><h2>Today, at a glance</h2></div><div class="today-money-empty">Financial totals are unavailable until all required records load successfully. Use Refresh to retry. Website guide prices are not included.</div>`;
    for (const id of ["totalBilled", "totalReceived", "totalOutstanding", "quoteWinRate", "activeBuilds"]) $(id).textContent = "—";
    $("quoteWinCount").textContent = "Unavailable until all records load successfully";
    liveQuotes = []; liveWorkOrders = []; liveAppointments = []; liveInvoices = []; liveInvoiceDetails = [];
    for (const id of ["quoteList", "workOrderList", "appointmentList", "invoiceList", "activityList", "todayAppointments", "todayPayments", "todayBlockers"]) $(id).innerHTML = `<p class="today-empty">These records could not be loaded completely. Use Refresh to retry.</p>`;
    return false;
  }
}

function render(items, blocks, statsItems = items) {
  const allStatuses = ["new","reviewing","date_requested","confirmed","quoted","won","lost","archived"];
  const pipelineCounts = PIPELINE_STAGES.map((_, i) => statsItems.filter(item => pipelineIndexForStatus(item.status) === i).length);
  $("stats").innerHTML = PIPELINE_STAGES.map((stage, i) => `<div class="stat"><b>${pipelineCounts[i]}</b><span>${stage.label}</span></div>`).join("");
  if (!items.some(item => item.id === selectedId)) selectedId = items[0]?.id || null;
  renderToday(items);
  liveBlocks = blocks;
  $("leadList").innerHTML = items.length ? items.map(lead => `<article class="lead ${lead.id === selectedId ? "selected" : ""}" data-lead-id="${esc(lead.id)}"><div class="lead-top"><div><h3>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></h3><p>${esc(lead.postcode)} · ${esc(lead.email || lead.phone)} · ${esc(lead.wall_width)}</p></div><select data-id="${esc(lead.id)}" class="status" aria-label="Status for ${esc(lead.customer_name)}">${allStatuses.map(status => `<option value="${status}" ${lead.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select></div><p>${esc(lead.message || "No customer note.")}</p><small>${format(lead.created_at)} · ${esc(lead.source)} · guide ${money(lead.guide_low)}–${money(lead.guide_high)}</small></article>`).join("") : `<p class="empty">No enquiries yet. New website, chat and booking requests will appear here.</p>`;
  if (demo) renderCalendar(blocks);
  if (items.length) renderProject(items.find(item => item.id === selectedId));
  else $("projectPanel").innerHTML = `<p>PROJECT BRIEF</p><h2>Select an enquiry</h2><p class="empty">A selected enquiry will show its customer brief and website guide range. Actual job costs, quotes and invoices appear only when recorded.</p>`;
}

function renderToday(items) {
  const { todayNewEnquiries, todayVisitWindows } = getTodayAgenda(items);
  $("todayAppointments").parentElement.querySelector("h3").textContent = "Confirmed enquiry status today";
  $("todayReplies").parentElement.querySelector("h3").textContent = "New enquiries to action";
  $("todayPayments").parentElement.querySelector("h3").textContent = "Payment & follow-up attention";
  $("todayBlockers").parentElement.querySelector("h3").textContent = "Build & delivery tracking";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nextDay = new Date(today); nextDay.setDate(nextDay.getDate() + 1);

  // The schema records a visit status and preferred window, not a calendar booking.
  const todayAppointments = items.filter(item => {
    if (!isConfirmedVisitStatus(item.status)) return false;
    const ps = new Date(item.preferred_start), pe = new Date(item.preferred_end);
    return !isNaN(ps.getTime()) && !isNaN(pe.getTime()) && ps < nextDay && pe > today;
  });

  // The schema has no follow-up due date; show today's incoming enquiries for action instead.
  const repliesToday = todayNewEnquiries.filter(item => item.status === "new" || item.status === "reviewing");

  // Only real scheduled follow-up tasks are shown after the business workflow records load.

  const enquiryRows = todayNewEnquiries.map(lead => {
    const na = nextAction(lead.status);
    const rd = relevantDate(lead);
    const dateStr = rd ? ` · ${rd}` : "";
    const timeStr = new Date(lead.created_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
    const pIdx = pipelineIndexForStatus(lead.status);
    const stage = pIdx >= 0 ? PIPELINE_STAGES[pIdx] : null;
    const pipelineBadge = stage ? `<span class="pipeline-badge ${stage.className}">${stage.label}</span>` : "";
    return `<article class="today-item" data-lead-id="${esc(lead.id)}"><div class="today-meta"><b>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></b><span>${timeStr} · ${esc(lead.postcode)}</span></div><span class="today-status">${esc(lead.status.replaceAll("_", " "))}</span><span class="today-action">${na}${dateStr}</span>${pipelineBadge}<button class="outline" data-open-enquiry="${esc(lead.id)}" aria-label="Open enquiry for ${esc(lead.customer_name)}">Open</button></article>`;
  }).join("");
  $("todayEnquiries").innerHTML = enquiryRows || `<p class="today-empty">No enquiries received today.</p>`;

  const visitRows = todayVisitWindows.map(lead => {
    const isConfirmed = lead.status === "confirmed";
    const startsAt = new Date(lead.preferred_start), endsAt = new Date(lead.preferred_end);
    const sameDay = startsAt.toDateString() === endsAt.toDateString();
    const timing = sameDay
      ? `${startsAt.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })}–${endsAt.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" })}`
      : `${startsAt.toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}–${endsAt.toLocaleString("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}`;
    const na = nextAction(lead.status);
    const rd = relevantDate(lead);
    const dateStr = rd ? ` · ${rd}` : "";
    const timingStr = isConfirmed ? "Visit status confirmed · calendar slot not reserved" : "Preferred visit window · not booked";
    return `<article class="today-item" data-lead-id="${esc(lead.id)}"><div class="today-meta"><b>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></b><span>${timing} · ${esc(lead.postcode)}</span></div><span class="today-status">${esc(lead.status.replaceAll("_", " "))}</span><span class="today-action">${na}${dateStr}</span><span class="today-visit-state">${timingStr}</span><button class="outline" data-open-enquiry="${esc(lead.id)}" aria-label="Open enquiry for ${esc(lead.customer_name)}">Open</button></article>`;
  }).join("");
  $("todayVisits").innerHTML = visitRows || `<p class="today-empty">No preferred visit windows today.</p>`;

  // New sections placeholders
  $("todayAppointments").innerHTML = todayAppointments.length ? todayAppointments.map(a => `<article class="today-item"><div class="today-meta"><b>${esc(a.customer_name)}</b><span>Visit window requested · ${esc(a.postcode)}</span></div><span class="today-status">Not booked</span></article>`).join("") : `<p class="today-empty">Booked appointments appear here once the business calendar is connected.</p>`;
  $("todayReplies").innerHTML = repliesToday.length ? repliesToday.map(r => `<article class="today-item"><div class="today-meta"><b>${esc(r.customer_name)}</b><span>New enquiry · ${esc(r.postcode)}</span></div><span class="today-status">Reply / assign</span></article>`).join("") : `<p class="today-empty">No new enquiries received today. Follow-up due dates are not tracked yet.</p>`;
  $("todayPayments").innerHTML = `<p class="today-empty">Scheduled follow-ups appear here once the workflow database is ready.</p>`;
  $("todayBlockers").innerHTML = `<p class="today-empty">Build deadlines appear here once the workflow database is ready.</p>`;
}

function setBlockDefaults() { $("blockStart").value = local(plusDays(2, 8)); $("blockEnd").value = local(plusDays(3, 18)); $("liveDate").textContent = new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long" }).format(new Date()); $("todayDateLabel").textContent = new Intl.DateTimeFormat("en-GB", { weekday:"short", day:"numeric", month:"short" }).format(new Date()).toUpperCase(); }
function loadDemo() { render(demoLeads, demoBlocks); loadWorkflows(); }
async function loadInvoiceSettings() {
  const status = $("invoiceSetupStatus");
  $("invoiceSettings").hidden = currentStaffRole !== "owner";
  const { data, error } = await db.from("business_settings").select("*").eq("singleton", true).maybeSingle();
  if (error) {
    invoiceSettings = null;
    status.textContent = "Invoice setup is waiting for the business settings migration and confirmed owner details.";
    return;
  }
  invoiceSettings = data || null;
  const form = $("invoiceSettingsForm");
  if (currentStaffRole === "owner" && data) {
    form.elements.legalName.value = data.legal_name || "";
    form.elements.billingAddress.value = data.billing_address || "";
    form.elements.contactEmail.value = data.contact_email || "";
    form.elements.contactPhone.value = data.contact_phone || "";
    form.elements.companyNumber.value = data.company_number || "";
    form.elements.vatNumber.value = data.vat_number || "";
    form.elements.paymentInstructions.value = data.payment_instructions || "";
    form.elements.invoiceFooter.value = data.invoice_footer || "";
  }
  status.textContent = invoiceSettingsReady(invoiceSettings)
    ? "Invoice details are ready. Print or save each reviewed invoice as PDF; delivery remains manual."
    : "Invoice PDFs stay disabled until an owner saves the legal seller name, billing address and contact email.";
}
async function showStaffAccessIssue(access) {
  $("hub").hidden = true; $("setup").hidden = false;
  $("login").hidden = access.state !== "signed_out";
  $("accessActions").hidden = access.state === "signed_out";
  $("setupCopy").textContent = staffAccessMessage(access.state);
  $("loginMsg").textContent = "";
  document.querySelector(".mobile-nav").hidden = true;
  liveLeads = []; liveBlocks = []; liveQuotes = []; liveWorkOrders = [];
  liveAppointments = []; liveInvoices = []; liveInvoiceDetails = [];
  calendarBlocks = []; calendarAppointments = []; calendarLoadVersion++;
  liveProfiles = null; invoiceSettings = null; currentStaffRole = null;
  clearTimeout(liveRefreshTimer);
  if (liveChannel) { await db.removeChannel(liveChannel); liveChannel = null; }
}

async function refreshCalendar() {
  if (demo) { renderCalendar(demoBlocks); return true; }
  const version = ++calendarLoadVersion;
  const period = calendarWindow(calendarDate, calendarMode);
  renderCalendar([], []);
  $("calendar").hidden = true; $("blockList").hidden = true;
  $("calendar").setAttribute("aria-busy", "true");
  $("calendarLoadState").textContent = "Loading appointments and availability for this period…";
  $("calendarRetry").hidden = true;
  try {
    const access = await checkStaffAccess(db);
    if (version !== calendarLoadVersion) return false;
    if (access.state !== "authorized") { await showStaffAccessIssue(access); return false; }
    currentStaffRole = access.role;
    $("invoiceSettings").hidden = currentStaffRole !== "owner";
    const records = await loadCalendarRecords(db, period);
    if (version !== calendarLoadVersion) return false;
    calendarBlocks = records.blocks; calendarAppointments = records.appointments;
    liveBlocks = [...new Map([...liveBlocks, ...calendarBlocks].map(item => [item.id, item])).values()];
    renderCalendar(calendarBlocks, calendarAppointments);
    $("calendar").hidden = false; $("blockList").hidden = false;
    $("calendarLoadState").textContent = "Selected period loaded. Completed appointments remain in history; cancelled appointments release the time.";
    return true;
  } catch {
    if (version !== calendarLoadVersion) return false;
    $("calendarLoadState").textContent = "This period could not be loaded completely. Retry before using it to plan bookings.";
    $("calendarRetry").hidden = false;
    return false;
  } finally {
    if (version === calendarLoadVersion) $("calendar").setAttribute("aria-busy", "false");
  }
}

async function loadLive() {
  try {
    const access = await checkStaffAccess(db);
    if (access.state !== "authorized") {
      await showStaffAccessIssue(access);
      return false;
    }
    currentStaffRole = access.role;
    $("setup").hidden = true; $("hub").hidden = false;
    $("login").hidden = false; $("accessActions").hidden = true;
    document.querySelector(".mobile-nav").hidden = false;
    await loadInvoiceSettings();
    const notifiedEnquiryId = pushEnquiryTarget;
    const { start:todayStart, end:tomorrowStart } = getLocalDayBounds();
    const startIso = todayStart.toISOString(), endIso = tomorrowStart.toISOString();
    const [leadResult, blockResult, todayLeadResult, visitLeadResult, notifiedLeadResult, profileResult] = await Promise.all([
      db.from("consultation_requests").select("*").order("created_at", { ascending:false }).limit(60),
      db.from("availability_blocks").select("*").gte("ends_at", new Date().toISOString()).order("starts_at").limit(50),
      db.from("consultation_requests").select("*").gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending:false }),
      db.from("consultation_requests").select("*").in("status", ["date_requested", "confirmed"]).lt("preferred_start", endIso).gt("preferred_end", startIso).order("preferred_start"),
      notifiedEnquiryId ? db.from("consultation_requests").select("*").eq("id", notifiedEnquiryId).maybeSingle() : Promise.resolve({ data:null, error:null }),
      db.from("profiles").select("id, full_name").order("full_name").limit(100)
    ]);
    if (leadResult.error) throw leadResult.error;
    if (blockResult.error) throw blockResult.error;
    if (todayLeadResult.error) throw todayLeadResult.error;
    if (visitLeadResult.error) throw visitLeadResult.error;
    if (notifiedLeadResult.error) throw notifiedLeadResult.error;
    // A failed profile lookup must not take the work or calendar views with it:
    // assignment stays disabled until the next successful Refresh.
    let profilesLookupFailed = false;
    if (profileResult.error) {
      liveProfiles = null;
      profilesLookupFailed = true;
      console.error("Team member list could not be loaded.", profileResult.error);
    } else {
      liveProfiles = profileResult.data || [];
    }
    const recentLeads = leadResult.data || [];
    const todayLeads = todayLeadResult.data || [];
    const visitLeads = visitLeadResult.data || [];
    liveLeads = [...new Map([...recentLeads, ...todayLeads, ...visitLeads, ...(notifiedLeadResult.data ? [notifiedLeadResult.data] : [])].map(lead => [lead.id, lead])).values()];
    if (notifiedLeadResult.data) {
      selectedId = notifiedLeadResult.data.id;
      setMobileView("work");
    }
    render(liveLeads, blockResult.data || [], recentLeads);
    if (notifiedLeadResult.data) document.querySelector(`[data-lead-id="${CSS.escape(notifiedLeadResult.data.id)}"]`)?.scrollIntoView({ behavior:"smooth", block:"center" });
    const workflowsLoaded = await loadWorkflows();
    if (!workflowsLoaded) {
      showNotice("Enquiries loaded, but business records could not be fully refreshed. Use Refresh before making further changes.", "warning");
      return false;
    }
    showNotice("");
    if (profilesLookupFailed) showNotice("The team member list could not be loaded. Assignment is unavailable until Refresh.", "warning");
    return true;
  } catch (error) {
    console.error("Operations data refresh failed.", error);
    if (!liveLeads.length) $("leadList").innerHTML = `<p class="empty">Latest enquiries could not be loaded. Check the connection and refresh.</p>`;
    showNotice("The latest operations data could not be loaded. Any data still shown may be out of date.");
    return false;
  }
}
const load = () => demo ? loadDemo() : loadLive();

function startDemo() {
  demo = true; $("setup").hidden = true; $("hub").hidden = false; $("demoTag").hidden = false; $("signOut").hidden = true;
  document.querySelector(".mobile-nav").hidden = false;
  $("enablePush").hidden = true;
  demoLeads = [
    { id:"d1", reference:"FF-DEMO-1042", customer_name:"Amelia Grant", email:"amelia.grant@example.com", postcode:"SL4 2HT", wall_width:"4.2 m wall", message:"75-inch TV, concealed storage and a linear fire. Tuesday or Thursday survey preferred.", status:"new", source:"project assistant", guide_low:6950, guide_high:8250, created_at:new Date().toISOString(), project:{ title:"Windsor library wall", location:"WINDSOR · SL4 2HT", image:"../assets/cases/burnham-library-after.webp", geometry:"4.2 m wall · 75” recessed TV · 1.2 m linear fire", system:"European oak library wings · warm white LED · fluted lower cabinetry", materials:["#895e3f", "#e6d1a5", "#164138"], materialLabel:"European oak · warm ivory lacquer · forest green accent", materialsCost:3650, equipmentCost:1670, labourCost:2930, total:8250, sampleCosts:true } },
    { id:"d2", reference:"FF-DEMO-1041", customer_name:"Hugo Clarke", phone:"07700 900 441", postcode:"SL1 5QJ", wall_width:"5.8 m wall", message:"Full-width cinema wall with walnut shelving. Room photos attached.", status:"reviewing", source:"website enquiry", guide_low:9800, guide_high:11600, created_at:plusDays(-1).toISOString(), project:{ title:"Slough cinema wall", location:"SLOUGH · SL1 5QJ", image:"../assets/cases/slough-cinema-after.webp", geometry:"5.8 m wall · 85” recessed TV · 1.5 m linear fire", system:"Charcoal lacquer carcasses · smoked bronze display doors · RGB scene lighting", materials:["#242826", "#7c573b", "#c29156"], materialLabel:"Charcoal lacquer · smoked oak · aged bronze", materialsCost:5100, equipmentCost:2280, labourCost:4220, total:11600, sampleCosts:true } },
    { id:"d3", reference:"FF-DEMO-1040", customer_name:"Saira Patel", email:"saira.patel@example.com", postcode:"SL3 8LA", wall_width:"3.1 m chimney breast", message:"Compact chimney breast, existing fire to remove, pale oak finish.", status:"date_requested", source:"website enquiry", guide_low:4900, guide_high:6100, created_at:plusDays(-2).toISOString(), project:{ title:"Langley chimney breast", location:"LANGLEY · SL3 8LA", image:"../assets/cases/langley-chimney-after.webp", geometry:"3.1 m chimney breast · 55” flush TV · compact fire", system:"Microcement feature · pale oak alcove storage · dimmable warm LED", materials:["#c6b293", "#8c8c80", "#382e26"], materialLabel:"Pale oak · mineral microcement · black steel", materialsCost:2620, equipmentCost:1040, labourCost:2440, total:6100, sampleCosts:true } }
  ];
  demoBlocks = [{ id:"b1", title:"HOLIDAY — family break", kind:"holiday", starts_at:plusDays(2, 0).toISOString(), ends_at:plusDays(3, 23).toISOString() }, { id:"b2", title:"Workshop installation", kind:"blocked", starts_at:plusDays(6, 8).toISOString(), ends_at:plusDays(7, 18).toISOString() }, { id:"b3", title:"Extra survey availability", kind:"available", starts_at:plusDays(9, 10).toISOString(), ends_at:plusDays(9, 16).toISOString() }];
  setBlockDefaults(); loadDemo();
}

async function startLive() {
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (!data.session) { await loadLive(); return; }
    setBlockDefaults();
    if (pushEnquiryTarget) setMobileView("work");
    else if (pushViewTarget) setMobileView(pushViewTarget);
    if (!await loadLive()) return;
    if (pushEnquiryTarget && liveLeads.some(item => item.id === pushEnquiryTarget)) {
      requestAnimationFrame(() => document.querySelector(`[data-lead-id="${CSS.escape(pushEnquiryTarget)}"]`)?.scrollIntoView({ behavior:"smooth", block:"center" }));
    }
    const pushButton = $("enablePush");
    const ios = isIOSDevice({ userAgent:navigator.userAgent, platform:navigator.platform, maxTouchPoints:navigator.maxTouchPoints });
    const installed = isInstalledPWA({ displayModeStandalone:window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone:navigator.standalone === true });
    const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const pushReady = !!(cfg?.vapidPublicKey && window.isSecureContext && pushSupported && (!ios || installed));
    pushButton.hidden = !pushReady;
    if (!pushReady) {
      $("pushHelp").hidden = false;
      $("pushHelp").textContent = pushSetupMessage({ ios, installed, secure:window.isSecureContext, configured:!!cfg?.vapidPublicKey, supported:pushSupported });
    } else {
      try {
        const current = await navigator.serviceWorker.register("./service-worker.js", { scope:"./" });
        const existing = await current.pushManager.getSubscription();
        if (existing) {
          const { data:userData } = await db.auth.getUser();
          const { data:registration } = await db.from("push_subscriptions").select("id").eq("endpoint", existing.endpoint).eq("user_id", userData?.user?.id).maybeSingle();
          if (registration) { pushButton.textContent = "Disable push alerts"; pushButton.setAttribute("aria-label", "Disable push alerts"); }
        }
      } catch (error) {
        console.error("Operations service worker registration failed.", error);
        pushButton.hidden = true;
        $("pushHelp").hidden = false;
        $("pushHelp").textContent = "This browser could not install the notification service worker. Open the staff desk on its secure HTTPS address and refresh.";
      }
    }
    const realtimeTables = ["consultation_requests", "availability_blocks", "profiles", "business_settings", "quotes", "work_orders", "appointments", "follow_up_tasks", "invoices", "invoice_payments", "workflow_activity"];
    if (liveChannel) await db.removeChannel(liveChannel);
    liveChannel = db.channel("ff-operations");
    for (const table of realtimeTables) {
      liveChannel.on("postgres_changes", { event:"*", schema:"public", table }, scheduleLiveRefresh);
    }
    liveChannel.subscribe(status => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") showNotice("Live updates are unavailable. Use Refresh to check for new enquiries.", "warning");
    });
  } catch (error) {
    console.error("Operations sign-in check failed.", error);
    $("loginMsg").textContent = "We couldn't verify your session. Check your connection and try again.";
  }
}
const cfg = window.FF_OPERATIONS_CONFIG;
if (!cfg?.supabaseUrl || cfg.supabaseUrl.includes("YOUR_PROJECT")) { $("setupCopy").textContent = "Demo mode: preview the staff workspace with enquiries, commercial briefs and calendar controls."; startDemo(); }
else { db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey); $("login").addEventListener("submit", async event => { event.preventDefault(); const button = event.submitter || $("login").querySelector("button"); button.disabled = true; $("loginMsg").textContent = "Sending secure sign-in link…"; try { const { error } = await db.auth.signInWithOtp({ email:$("email").value, options:{ emailRedirectTo:location.href, shouldCreateUser:false } }); if (error) throw error; $("loginMsg").textContent = "Secure sign-in link sent — check your inbox."; } catch (error) { console.error("Operations sign-in request failed.", error); $("loginMsg").textContent = "The sign-in link couldn't be sent. Check your connection and try again."; } finally { button.disabled = false; } }); startLive(); }

function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => { void loadLive(); }, 180);
}

function decodeVapidKey(encoded) {
  const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

$("enablePush").addEventListener("click", async buttonEvent => {
  const button = buttonEvent.currentTarget;
  const help = $("pushHelp");
  help.hidden = false;
  button.disabled = true;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope:"./" });
    let subscription = await registration.pushManager.getSubscription();
    const { data: userResult, error: userError } = await db.auth.getUser();
    if (userError || !userResult.user) throw userError || new Error("Sign in again to manage this device.");
    if (button.textContent === "Disable push alerts" && subscription) {
      const { data:deleted, error } = await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", userResult.user.id).select("id").maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error("This device was not registered with the signed-in account.");
      await subscription.unsubscribe();
      button.textContent = "Enable push alerts";
      button.setAttribute("aria-label", "Enable push alerts");
      help.textContent = "Push alerts are disabled on this device.";
      button.disabled = false;
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications were not allowed for this device.");
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:decodeVapidKey(cfg.vapidPublicKey) });
    const subscriptionJson = subscription.toJSON();
    const record = {
      user_id:userResult.user.id,
      endpoint:subscriptionJson.endpoint,
      p256dh:subscriptionJson.keys?.p256dh,
      auth_secret:subscriptionJson.keys?.auth,
      user_agent:navigator.userAgent.slice(0, 500),
      last_seen_at:new Date().toISOString()
    };
    const { error } = await db.from("push_subscriptions").upsert(record, { onConflict:"endpoint" });
    if (error) throw error;
    button.textContent = "Disable push alerts";
    button.setAttribute("aria-label", "Disable push alerts");
    help.textContent = "This device is registered for private new-enquiry alerts. Use this button to turn them off.";
  } catch (error) {
    console.error("Push subscription failed.", error);
    help.textContent = error?.message || "We couldn't enable push on this device. Check browser settings and try again.";
    button.disabled = false;
  }
});

$("refresh").addEventListener("click", load); $("unblockAll").addEventListener("click", load);
$("calendarPrev").addEventListener("click", () => { calendarDate = calendarMode === "month" ? new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1) : new Date(calendarDate.getFullYear(), calendarDate.getMonth(), calendarDate.getDate() - 7); refreshCalendar(); });
$("calendarNext").addEventListener("click", () => { calendarDate = new Date(calendarDate); if (calendarMode === "month") calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); else calendarDate.setDate(calendarDate.getDate() + 7); refreshCalendar(); });
$("calendarToday").addEventListener("click", () => { calendarDate = new Date(); refreshCalendar(); });
$("calendarRetry").addEventListener("click", refreshCalendar);
document.querySelectorAll(".calendar-mode").forEach(button => button.addEventListener("click", () => { calendarMode = button.dataset.calendarMode; refreshCalendar(); }));
const openTodayEnquiry = async event => {
  const button = event.target.closest("button[data-open-enquiry]");
  if (!button) return;
  selectedId = button.dataset.openEnquiry;
  await load();
  document.querySelector(`[data-lead-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ behavior:"smooth", block:"center" });
};
$("todayEnquiries").addEventListener("click", openTodayEnquiry);
$("todayVisits").addEventListener("click", openTodayEnquiry);
$("leadList").addEventListener("click", event => { if (event.target.closest("select")) return; const card = event.target.closest("[data-lead-id]"); if (!card) return; selectedId = card.dataset.leadId; load(); });
$("leadList").addEventListener("change", async event => {
  if (!event.target.matches(".status")) return;
  const select = event.target, id = select.dataset.id;
  if (demo) {
    const lead = demoLeads.find(item => item.id === id);
    if (lead) lead.status = select.value;
    loadDemo();
    return;
  }
  const lead = liveLeads.find(item => item.id === id), next = select.value;
  if (!lead) return;
  select.disabled = true;
  const result = await saveLive(() => db.from("consultation_requests").update({ status:next }).eq("id", id).select("id").maybeSingle(), "Enquiry status updated.");
  if (!result.saved && select.isConnected) select.value = lead.status;
  if (select.isConnected) select.disabled = false;
});
$("block").addEventListener("submit", async event => {
  event.preventDefault();
  const kind = $("blockKind").value, start = new Date($("blockStart").value), end = new Date($("blockEnd").value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    showNotice("Choose a valid start and end time. The end must be after the start.");
    return;
  }
  const record = { id:crypto.randomUUID(), title:kind === "holiday" ? `HOLIDAY — ${$("blockTitle").value}` : $("blockTitle").value, kind, starts_at:start.toISOString(), ends_at:end.toISOString() };
  if (demo) { demoBlocks.push(record); loadDemo(); return; }
  const button = event.submitter || $("block").querySelector("button");
  button.disabled = true;
  await saveLive(() => db.from("availability_blocks").insert({ title:record.title, starts_at:record.starts_at, ends_at:record.ends_at, kind:kind === "holiday" ? "blocked" : kind }).select("id").single(), "Availability updated.");
  button.disabled = false;
});
// One removal path serves the grid and the narrow-screen block list.
// Only ids that belong to a current availability block reach
// availability_blocks, so a scheduled or confirmed appointment can never
// be deleted as an availability block. Success is reported only after
// Supabase confirms the deletion; on error the block stays on screen and
// the button is re-enabled.
async function removeAvailabilityBlock(button) {
  const id = button.dataset.id;
  if (demo) {
    if (!demoBlocks.some(block => block.id === id)) return;
    demoBlocks = demoBlocks.filter(block => block.id !== id);
    loadDemo();
    return;
  }
  if (!liveBlocks.some(block => block.id === id)) {
    showNotice("That availability block is no longer listed. Refresh to see the latest availability.");
    return;
  }
  button.disabled = true;
  await saveLive(() => db.from("availability_blocks").delete().eq("id", id).select("id").maybeSingle(), "Availability block removed.");
  if (button.isConnected) button.disabled = false;
}
$("calendar").addEventListener("click", async event => {
  const button = event.target.closest("button[data-id]");
  if (button) await removeAvailabilityBlock(button);
});
$("blockList").addEventListener("click", async event => {
  const button = event.target.closest("button[data-id]");
  if (button) await removeAvailabilityBlock(button);
});
$("projectPanel").addEventListener("click", async event => {
  const button = event.target.closest("#confirmVisit"), id = button?.dataset.id;
  if (!id) return;
  if (demo) { const lead = demoLeads.find(item => item.id === id); if (lead) lead.status = "confirmed"; loadDemo(); return; }
  button.disabled = true;
  await saveLive(() => db.from("consultation_requests").update({ status:"confirmed" }).eq("id", id).select("id").maybeSingle(), "Visit status updated. No calendar slot was reserved.");
  if (button.isConnected) button.disabled = false;
});

$("projectPanel").addEventListener("submit", async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (demo) return showNotice("Demo mode does not save business records.", "warning");
  const fields = new FormData(form), requestId = form.dataset.requestId;
  const userResult = await db.auth.getUser();
  if (userResult.error || !userResult.data.user) return showNotice("Sign in again before saving a business record.");
  const userId = userResult.data.user.id;
  const button = form.querySelector("button[type=submit],button:not([type])");
  if (button) button.disabled = true;
  if (form.id === "quoteDraft") {
    const subtotalPence = poundsToPence(fields.get("subtotal"));
    const tax = calculateTax(subtotalPence, fields.get("taxRate"));
    if (subtotalPence === null || !tax) {
      showNotice("Enter a valid quote amount and an explicit tax rate between 0 and 100%.");
      if (button) button.disabled = false;
      return;
    }
    const existingVersions = liveQuotes.filter(quote => quote.request_id === requestId).map(quote => Number(quote.version));
    const version = existingVersions.length ? Math.max(...existingVersions) + 1 : 1;
    const quoteNo = `FFQ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const payload = { request_id:requestId, quote_number:quoteNo, version, subtotal_pence:subtotalPence, tax_rate_basis_points:tax.taxRateBasisPoints, tax_pence:tax.taxPence, scope:String(fields.get("scope") || "").trim(), valid_until:String(fields.get("validUntil") || "") || null, created_by:userId };
    const result = await saveLive(() => db.from("quotes").insert(payload).select("id").single(), "Draft quote saved. It has not been sent to the customer.");
    if (result.saved) form.reset();
  } else if (form.id === "appointmentDraft") {
    const startsAt = new Date(String(fields.get("startsAt"))), endsAt = new Date(String(fields.get("endsAt")));
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      showNotice("Choose a valid appointment start and end time.");
      if (button) button.disabled = false;
      return;
    }
    const assignedTo = String(fields.get("assignedTo") || "").trim() || null;
    if (assignedTo && !liveProfiles?.some(profile => profile.id === assignedTo)) {
      showNotice("Choose a team member from the assignment list.");
      if (button) button.disabled = false;
      return;
    }
    const payload = { request_id:requestId, kind:fields.get("kind"), status:"scheduled", starts_at:startsAt.toISOString(), ends_at:endsAt.toISOString(), location:String(fields.get("location") || "").trim(), assigned_to:assignedTo, created_by:userId };
    const result = await saveLive(() => db.from("appointments").insert(payload).select("id").single(), "Calendar appointment saved and time reserved. No customer message has been sent.");
    if (result.saved) form.reset();
  } else if (form.id === "followUpDraft") {
    const dueAt = new Date(String(fields.get("dueAt")));
    if (!Number.isFinite(dueAt.getTime())) {
      showNotice("Choose a valid follow-up due time.");
      if (button) button.disabled = false;
      return;
    }
    const result = await saveLive(() => db.from("follow_up_tasks").insert({ request_id:requestId, title:String(fields.get("title") || "").trim(), due_at:dueAt.toISOString(), created_by:userId }).select("id").single(), "Follow-up scheduled.");
    if (result.saved) form.reset();
  }
  if (button?.isConnected) button.disabled = false;
});

$("business").addEventListener("change", async event => {
  const invoiceWorkOrder = event.target.closest("#invoiceWorkOrder");
  if (invoiceWorkOrder) {
    const job = liveWorkOrders.find(item => item.id === invoiceWorkOrder.value);
    const form = $("invoiceDraftFromMoney");
    form.dataset.workOrderId = job?.id || "";
    const enquiry = job && requestFor(job.request_id);
    if (enquiry) form.elements.billName.value = enquiry.customer_name || "";
    return;
  }
  const assignment = event.target.closest("select[data-assignment]");
  if (assignment) {
    const kind = assignment.dataset.assignment;
    const table = kind === "work_order" ? "work_orders" : "appointments";
    const records = kind === "work_order" ? liveWorkOrders : liveAppointments;
    const record = records.find(item => item.id === assignment.dataset.id);
    if (!record || !liveProfiles) return;
    const previous = record.assigned_to || null;
    const value = assignment.value || null;
    if (value && !liveProfiles.some(profile => profile.id === value)) {
      assignment.value = previous || "";
      showNotice("Choose a team member from the assignment list.");
      return;
    }
    const noun = kind === "work_order" ? "Build job" : "Appointment";
    assignment.disabled = true;
    const result = await saveLive(() => db.from(table).update({ assigned_to:value }).eq("id", record.id).select("id").maybeSingle(), `${noun} assignment updated.`);
    if (!result.saved && assignment.isConnected) assignment.value = previous || "";
    if (assignment.isConnected) assignment.disabled = false;
    return;
  }
  const status = event.target.closest("select[data-record-status]");
  if (status) {
    const kind = status.dataset.recordStatus, id = status.dataset.id, value = status.value;
    const table = { quote:"quotes", work_order:"work_orders", appointment:"appointments", invoice:"invoices" }[kind];
    const previous = { quote:liveQuotes, work_order:liveWorkOrders, appointment:liveAppointments, invoice:liveInvoices }[kind].find(item => item.id === id);
    if (!table || !previous) return;
    const patch = { status:value };
    if (kind === "quote" && value === "sent") patch.sent_at = new Date().toISOString();
    if (kind === "quote" && value === "accepted") patch.accepted_at = new Date().toISOString();
    if (kind === "invoice" && value === "sent") patch.sent_at = new Date().toISOString();
    if (kind === "work_order" && value === "in_progress" && !previous.actual_started_at) patch.actual_started_at = new Date().toISOString();
    if (kind === "work_order" && value === "completed") patch.completed_at = new Date().toISOString();
    status.disabled = true;
    const result = await saveLive(() => db.from(table).update(patch).eq("id", id).select("id").maybeSingle(), `${kind.replace("_", " ")} status updated.`);
    if (!result.saved && status.isConnected) status.value = previous.status;
    if (status.isConnected) status.disabled = false;
    return;
  }
  const cost = event.target.closest("input[data-actual-cost]");
  const jobDate = event.target.closest("input[data-job-date]");
  if (jobDate) {
    const job = liveWorkOrders.find(item => item.id === jobDate.dataset.id);
    if (!job) return;
    const field = jobDate.dataset.jobDate, value = jobDate.value || null;
    const payload = { [field]:value };
    if (field === "planned_start" && value && job.target_completion && job.target_completion < value) { jobDate.value = job[field] || ""; return showNotice("The planned start must be on or before the target completion date."); }
    if (field === "target_completion" && value && job.planned_start && value < job.planned_start) { jobDate.value = job[field] || ""; return showNotice("The target completion must be on or after the planned start date."); }
    jobDate.disabled = true;
    const result = await saveLive(() => db.from("work_orders").update(payload).eq("id", job.id).select("id").maybeSingle(), "Build date updated.");
    if (!result.saved && jobDate.isConnected) jobDate.value = job[field] || "";
    if (jobDate.isConnected) jobDate.disabled = false;
    return;
  }
  if (cost) {
    const job = liveWorkOrders.find(item => item.id === cost.dataset.actualCost);
    const amount = cost.value === "" ? null : poundsToPence(cost.value);
    if (!job || (cost.value !== "" && amount === null)) return showNotice("Enter a valid actual cost in pounds.");
    cost.disabled = true;
    const result = await saveLive(() => db.from("work_orders").update({ actual_cost_pence:amount }).eq("id", job.id).select("id").maybeSingle(), "Actual job costs updated.");
    if (!result.saved && cost.isConnected) cost.value = job.actual_cost_pence == null ? "" : (job.actual_cost_pence / 100).toFixed(2);
    if (cost.isConnected) cost.disabled = false;
  }
});

$("business").addEventListener("click", async event => {
  const printInvoice = event.target.closest("button[data-print-invoice]");
  if (printInvoice) {
    const balance = liveInvoices.find(invoice => invoice.id === printInvoice.dataset.printInvoice);
    const invoice = liveInvoiceDetails.find(record => record.id === printInvoice.dataset.printInvoice);
    const job = invoice && liveWorkOrders.find(record => record.id === invoice.work_order_id);
    const enquiry = job && requestFor(job.request_id);
    if (!invoiceSettingsReady(invoiceSettings) || !invoice || !balance || !job) return showNotice("Refresh and complete invoice setup before printing this invoice.");
    let documentHtml;
    try { documentHtml = renderInvoiceDocument({ settings:invoiceSettings, invoice, balance, workOrder:job, customerEmail:enquiry?.email || "" }); }
    catch (error) { return showNotice(error.message || "The invoice could not be prepared."); }
    const printWindow = window.open("", "_blank");
    if (!printWindow) return showNotice("Allow pop-ups for the staff app to print or save an invoice PDF.");
    printWindow.document.open();
    printWindow.document.write(documentHtml);
    printWindow.document.close();
    printWindow.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 300);
    return;
  }
  const updateAppointment = event.target.closest("button[data-cancel-appointment], button[data-complete-appointment]");
  if (updateAppointment) {
    const isCancellation = updateAppointment.hasAttribute("data-cancel-appointment");
    const appointmentId = updateAppointment.dataset.cancelAppointment || updateAppointment.dataset.completeAppointment;
    const appointment = liveAppointments.find(item => item.id === appointmentId);
    if (!appointment || !["scheduled", "confirmed"].includes(appointment.status)) return;
    if (isCancellation && !window.confirm("Cancel this booked appointment? The time will become available again.")) return;
    updateAppointment.disabled = true;
    const status = isCancellation ? "cancelled" : "completed";
    const message = isCancellation ? "Appointment cancelled. Its time is available again." : "Appointment marked complete.";
    const result = await saveLive(() => db.from("appointments").update({ status }).eq("id", appointment.id).select("id").maybeSingle(), message);
    if (!result.saved && updateAppointment.isConnected) updateAppointment.disabled = false;
    return;
  }
  const complete = event.target.closest("button[data-complete-followup]");
  if (complete) {
    complete.disabled = true;
    await saveLive(() => db.from("follow_up_tasks").update({ completed_at:new Date().toISOString() }).eq("id", complete.dataset.completeFollowup).is("completed_at", null).select("id").maybeSingle(), "Follow-up completed.");
    return;
  }
  const createOrder = event.target.closest("button[data-make-order]");
  if (!createOrder) return;
  const quote = liveQuotes.find(item => item.id === createOrder.dataset.makeOrder);
  const enquiry = quote && requestFor(quote.request_id);
  if (!quote || !enquiry) return showNotice("Refresh the enquiry list before converting this quote to a job.");
  createOrder.disabled = true;
  const userResult = await db.auth.getUser();
  if (userResult.error || !userResult.data.user) return showNotice("Sign in again before creating a build job.");
  const title = enquiry.project_spec?.title || `Media wall · ${enquiry.reference}`;
  const number = `FFJ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  await saveLive(() => db.from("work_orders").insert({ request_id:enquiry.id, accepted_quote_id:quote.id, work_order_number:number, title, agreed_total_pence:quote.total_pence, created_by:userResult.data.user.id }).select("id").single(), "Accepted quote converted into a build job.");
});

$("business").addEventListener("submit", async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === "invoiceSettingsForm") {
    if (currentStaffRole !== "owner") return showNotice("Only a signed-in owner can update invoice seller details.");
    const userResult = await db.auth.getUser();
    if (userResult.error || !userResult.data.user) return showNotice("Sign in again before saving invoice seller details.");
    const fields = new FormData(form), button = form.querySelector("button");
    const values = {
      legal_name:String(fields.get("legalName") || "").trim(),
      billing_address:String(fields.get("billingAddress") || "").trim(),
      contact_email:String(fields.get("contactEmail") || "").trim(),
      contact_phone:String(fields.get("contactPhone") || "").trim(),
      company_number:String(fields.get("companyNumber") || "").trim(),
      vat_number:String(fields.get("vatNumber") || "").trim(),
      payment_instructions:String(fields.get("paymentInstructions") || "").trim(),
      invoice_footer:String(fields.get("invoiceFooter") || "").trim(),
      singleton:true,
      updated_by:userResult.data.user.id
    };
    if (!invoiceSettingsReady(values)) return showNotice("Enter a legal company name, full billing address and valid contact email.");
    button.disabled = true;
    const previousSettings = invoiceSettings;
    invoiceSettings = values;
    const result = await saveLive(() => db.from("business_settings").upsert(values, { onConflict:"singleton" }).select("*").single(), "Invoice seller details saved.");
    if (!result.saved) invoiceSettings = previousSettings;
    if (button.isConnected) button.disabled = false;
  } else if (form.classList.contains("invoiceDraft")) {
    const fields = new FormData(form), subtotal = poundsToPence(fields.get("subtotal")), tax = poundsToPence(fields.get("tax"));
    const taxRateBasisPoints = subtotal === null || tax === null ? null : taxRateForAmount(subtotal, tax);
    const issueDate = String(fields.get("issueDate")), dueDate = String(fields.get("dueDate"));
    if (subtotal === null || tax === null || taxRateBasisPoints === null || dueDate < issueDate) return showNotice("Check invoice amounts and ensure the due date is on or after the issue date. The tax amount must match a rate between 0 and 100%.");
    const userResult = await db.auth.getUser();
    if (userResult.error || !userResult.data.user) return showNotice("Sign in again before creating an invoice.");
    const button = form.querySelector("button"); button.disabled = true;
    const invoiceNo = `FFI-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const result = await saveLive(() => db.from("invoices").insert({ work_order_id:form.dataset.workOrderId, invoice_number:invoiceNo, bill_to_name:String(fields.get("billName") || "").trim(), bill_to_address:String(fields.get("billAddress") || "").trim(), issue_date:issueDate, due_date:dueDate, subtotal_pence:subtotal, tax_rate_basis_points:taxRateBasisPoints, tax_pence:tax, created_by:userResult.data.user.id }).select("id").single(), "Invoice draft saved. It has not been sent.");
    if (result.saved) form.reset();
    if (button.isConnected) button.disabled = false;
  } else if (form.classList.contains("paymentDraft")) {
    const fields = new FormData(form), amount = poundsToPence(fields.get("amount"));
    if (amount === null || amount < 1) return showNotice("Enter a valid payment amount in pounds.");
    const button = form.querySelector("button"); button.disabled = true;
    const userResult = await db.auth.getUser();
    if (userResult.error || !userResult.data.user) { button.disabled = false; return showNotice("Sign in again before recording a payment."); }
    const invoiceId = form.dataset.invoiceId;
    const method = String(fields.get("method"));
    const intent = JSON.stringify([invoiceId, amount, method]);
    let paymentStorage = null;
    try { paymentStorage = window.sessionStorage; } catch { /* Retain an in-memory retry key if browser storage is disabled. */ }
    const recordingKey = form.dataset.recordingIntent === intent && form.dataset.recordingKey
      ? form.dataset.recordingKey
      : getPaymentRecordingKey(paymentStorage, invoiceId, amount, method);
    form.dataset.recordingKey = recordingKey;
    form.dataset.recordingIntent = intent;
    const savePayment = async () => {
      try {
        const inserted = await db.from("invoice_payments").insert({ recording_key:recordingKey, invoice_id:invoiceId, amount_pence:amount, method, recorded_by:userResult.data.user.id }).select("id").single();
        if (!inserted.error && inserted.data) return inserted;
        const existing = await db.from("invoice_payments").select("id, invoice_id, amount_pence, method").eq("recording_key", recordingKey).maybeSingle();
        if (!existing.error && paymentMatchesIntent(existing.data, invoiceId, amount, method)) return existing;
        return inserted;
      } catch (error) {
        const existing = await db.from("invoice_payments").select("id, invoice_id, amount_pence, method").eq("recording_key", recordingKey).maybeSingle().catch(() => null);
        if (!existing?.error && paymentMatchesIntent(existing?.data, invoiceId, amount, method)) return existing;
        throw error;
      }
    };
    const result = await saveLive(savePayment, "Payment recorded against the invoice.");
    if (result.saved) {
      clearPaymentRecordingKey(paymentStorage, invoiceId, amount, method);
      form.reset();
      delete form.dataset.recordingKey;
      delete form.dataset.recordingIntent;
    }
    if (button.isConnected) button.disabled = false;
  }
});

$("signOut").addEventListener("click", async () => { if (db) await db.auth.signOut(); location.reload(); });
$("accessSignOut").addEventListener("click", () => $("signOut").click());
$("retryAccess").addEventListener("click", async () => {
  const button = $("retryAccess");
  button.disabled = true;
  try { await startLive(); } finally { button.disabled = false; }
});
