// HTML for every Owner Desk screen. Pure functions: data in, markup out.
// Buttons carry data-act="…" and are handled in one place in app.js, so every
// visible control has exactly one behaviour.
import { formatPence, penceToInput, basisPointsText } from "./desk-money.mjs";
import { BOARD_COLUMNS, ENQUIRY_FILTERS, MANUAL_STAGES, enquiryStage, invoiceStatus, isDiscarded, jobMoves, jobStatus, JOB_STATUS_LABELS, monthGrid, nextAction, quoteStatus, sameDay, isoDay } from "./desk-model.mjs";
import { specRows, budgetNote } from "./enquiry-workspace.mjs";

export const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]));
const money = formatPence;
const dateTime = value => value ? new Intl.DateTimeFormat("en-GB", { weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }).format(new Date(value)) : "";
const dateOnly = value => value ? new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"short", year:"numeric" }).format(new Date(String(value).length === 10 ? `${value}T12:00:00` : value)) : "";
const time = value => new Intl.DateTimeFormat("en-GB", { hour:"2-digit", minute:"2-digit" }).format(new Date(value));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const chip = (status, extra = "") => status?.label ? `<span class="chip tone-${esc(status.tone)}" data-status="${esc(status.key)}"${extra}>${esc(status.label)}</span>` : "";
const btn = (act, label, { id = "", kind = "", attrs = "", disabled = false } = {}) => `<button type="button" class="btn ${kind}" data-act="${esc(act)}"${id ? ` data-id="${esc(id)}"` : ""}${attrs}${disabled ? " disabled" : ""}>${label}</button>`;
const empty = text => `<p class="empty">${text}</p>`;
const customerLink = (lead, label = null) => lead ? `<a class="link" href="#/customer/${esc(lead.id)}">${esc(label || lead.customer_name)}</a>` : `<span class="muted">Unknown customer</span>`;

// ---- Shell parts -------------------------------------------------------------------
export const NAV = Object.freeze([
  { route:"dashboard", label:"Dashboard", icon:"M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z" },
  { route:"enquiries", label:"Enquiries", icon:"M4 4h16v12H7l-3 3zM8 8h8M8 12h5" },
  { route:"jobs", label:"Jobs", icon:"M3 7h18v13H3zM8 7V4h8v3M3 12h18" },
  { route:"calendar", label:"Calendar", icon:"M4 5h16v15H4zM4 10h16M9 3v4M15 3v4" },
  { route:"finance", label:"Finance", icon:"M4 4h12l4 4v12H4zM8 12h8M8 16h5M8 8h4" }
]);
export const navIcon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

const sectionHead = (title, subtitle, actions = "") => `<header class="page-head"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;

// ---- Dashboard -----------------------------------------------------------------------
function queueCard({ key, title, hint, items, render, emptyText }) {
  return `<section class="queue" data-queue="${key}"><header><h2>${esc(title)}</h2><span class="count${items.length ? " has" : ""}">${items.length}</span></header><p class="queue-hint">${esc(hint)}</p>${items.length ? `<ul>${items.slice(0, 6).map(render).join("")}</ul>${items.length > 6 ? `<p class="more">and ${items.length - 6} more</p>` : ""}` : `<p class="queue-empty">${esc(emptyText)}</p>`}</section>`;
}
const row = (lead, main, side = "") => `<li><a class="queue-row" href="#/customer/${esc(lead.id)}"><span><b>${esc(lead.customer_name)}</b><small>${main}</small></span>${side ? `<em>${side}</em>` : ""}<i aria-hidden="true">›</i></a></li>`;

export function dashboardHtml({ queues, totals, notifications = [], greeting = "Good morning", today = new Date(), demo = false }) {
  const attention = queues.newEnquiries.length + queues.revisions.length + queues.toPrepare.length + queues.followUps.length + queues.outstanding.filter(item => item.invoice.overdue).length;
  const cards = [
    queueCard({ key:"new", title:"New enquiries", hint:"Not yet reviewed.", items:queues.newEnquiries, emptyText:"No new enquiries.", render:({ lead }) => row(lead, `${esc(lead.reference)} · received ${esc(dateTime(lead.created_at))}`, "Review") }),
    queueCard({ key:"revisions", title:"Changes requested", hint:"Customers asked for a revised quotation.", items:queues.revisions, emptyText:"No change requests.", render:({ lead, quote }) => row(lead, `${esc(quote.quote_number)} · “${esc(String(quote.customer_message || "").slice(0, 60))}”`, "Revise") }),
    queueCard({ key:"prepare", title:"Quotations to prepare", hint:"Reviewed enquiries without a sent quotation.", items:queues.toPrepare, emptyText:"Nothing waiting to be quoted.", render:({ lead, rel }) => row(lead, rel.draft ? `Draft ${esc(rel.draft.quote_number)} · ${money(rel.draft.total_pence)}` : `${esc(lead.reference)} · no quotation yet`, rel.draft ? "Finish" : "Prepare") }),
    queueCard({ key:"awaiting", title:"Awaiting customer response", hint:"Sent quotations without a decision.", items:queues.awaitingResponse, emptyText:"No quotations are waiting on customers.", render:({ lead, quote }) => row(lead, `${esc(quote.quote_number)} · ${money(quote.total_pence)} · sent ${esc(dateOnly(quote.sent_at))}`) }),
    queueCard({ key:"surveys", title:"Surveys scheduled", hint:"Booked site visits.", items:queues.surveys, emptyText:"No surveys booked.", render:({ lead, appointment }) => row(lead, esc(dateTime(appointment.starts_at)), sameDay(appointment.starts_at, today) ? "Today" : "") }),
    queueCard({ key:"progress", title:"Jobs in progress", hint:"Work under way.", items:queues.inProgress, emptyText:"No jobs in progress.", render:({ lead, rel }) => row(lead, `${esc(rel.job.work_order_number)} · ${esc(JOB_STATUS_LABELS[rel.job.status] || rel.job.status)}`) }),
    queueCard({ key:"installs", title:"Upcoming installations", hint:"In the next two weeks.", items:queues.installations, emptyText:"No installations in the next two weeks.", render:({ lead, appointment }) => row(lead, esc(dateTime(appointment.starts_at)), sameDay(appointment.starts_at, today) ? "Today" : "") }),
    queueCard({ key:"invoices", title:"Outstanding invoices", hint:"Issued and not fully paid.", items:queues.outstanding, emptyText:"Every issued invoice is paid.", render:({ lead, invoice }) => row(lead, `${esc(invoice.invoice_number)} · ${money(invoice.outstanding_pence)} due ${esc(dateOnly(invoice.due_date))}`, invoice.overdue ? `<span class="chip tone-bad">Overdue</span>` : "") }),
    queueCard({ key:"followups", title:"Follow-ups due", hint:"Due today or overdue.", items:queues.followUps, emptyText:"No follow-ups due.", render:({ lead, task }) => row(lead, `${esc(task.title)} · ${esc(dateTime(task.due_at))}`) })
  ];
  const alerts = notifications.filter(item => item.unread).slice(0, 4);
  return `${sectionHead(`${greeting}`, `${esc(new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long" }).format(today))} · ${attention ? `<b>${plural(attention, "item")}</b> need your attention` : "Nothing urgent needs your attention"}`, `${btn("new-enquiry", "+ New enquiry", { kind:"primary" })}`)}
${demo ? `<div class="demo-banner" role="note"><b>Demo · fictional data.</b> Nothing here is a real customer and nothing is saved.</div>` : ""}
<section class="totals-strip" aria-label="Money at a glance"><div><span>Outstanding</span><b>${money(totals.outstanding)}</b></div><div><span>Overdue</span><b class="${totals.overdue ? "bad" : ""}">${money(totals.overdue)}</b></div><div><span>Received this month</span><b>${money(totals.receivedMonth)}</b></div><div><span>Quotations awaiting decision</span><b>${money(totals.awaitingValue)}</b></div></section>
${alerts.length ? `<section class="alert-strip" aria-label="Unread notifications"><h2>Notifications</h2>${alerts.map(item => `<button type="button" class="alert-row" data-act="open-notification" data-id="${esc(item.id)}" data-request="${esc(item.requestId || "")}" data-view="${esc(item.view || "")}"><b>${esc(item.title)}</b><span>${esc(item.body)}</span></button>`).join("")}</section>` : ""}
<div class="queues">${cards.join("")}</div>`;
}

// ---- Enquiries -----------------------------------------------------------------------
export function enquiriesHtml({ rows, filter, query, counts, today = new Date() }) {
  const chips = ENQUIRY_FILTERS.map(item => `<button type="button" class="filter${item.key === filter ? " on" : ""}" data-act="enquiry-filter" data-id="${item.key}" aria-pressed="${item.key === filter}">${esc(item.label)}${counts[item.key] != null ? ` <b>${counts[item.key]}</b>` : ""}</button>`).join("");
  const list = rows.length ? `<ul class="list">${rows.map(({ lead, rel }) => {
    const stage = enquiryStage(lead, rel), action = nextAction(lead, rel, { today });
    return `<li><a class="list-row${stage.key === "new" ? " is-new" : ""}" href="#/customer/${esc(lead.id)}"><span class="who"><b>${esc(lead.customer_name)}</b><small>${esc(lead.reference)} · ${esc(lead.postcode || "")}</small></span><span class="when"><small>Received</small>${esc(dateOnly(lead.created_at))}</span><span class="state">${chip(stage)}</span><span class="next"><small>Next</small>${esc(action.label)}</span><i aria-hidden="true">›</i></a></li>`;
  }).join("")}</ul>` : empty(query ? `No enquiries match “${esc(query)}”.` : "No enquiries in this view.");
  return `${sectionHead("Enquiries", "Every website and manual enquiry. Open one to see everything about that customer.", btn("new-enquiry", "+ New enquiry", { kind:"primary" }))}
<div class="toolbar"><label class="search"><span class="sr-only">Search enquiries</span><input type="search" id="enquirySearch" value="${esc(query)}" placeholder="Search name, reference, postcode, quotation or invoice number" autocomplete="off"></label><div class="filters" role="group" aria-label="Filter enquiries">${chips}</div></div>${list}`;
}

// ---- Jobs board -----------------------------------------------------------------------
export function jobsHtml({ columns, view = "board" }) {
  const card = ({ lead, rel }) => {
    const action = nextAction(lead, rel);
    const job = rel.job && rel.job.status !== "cancelled" ? rel.job : null;
    const install = rel.appointments.find(item => item.kind === "installation" && ["scheduled", "confirmed"].includes(item.status));
    const survey = rel.appointments.find(item => item.kind === "survey" && ["scheduled", "confirmed"].includes(item.status));
    const amount = job ? job.agreed_total_pence : rel.accepted?.total_pence ?? rel.sent?.total_pence ?? rel.draft?.total_pence;
    return `<a class="job-card" href="#/customer/${esc(lead.id)}"><b>${esc(lead.customer_name)}</b><small>${esc(job ? job.work_order_number : lead.reference)}${amount != null ? ` · ${money(amount)}` : ""}</small>${install ? `<span class="when">Installation ${esc(dateTime(install.starts_at))}</span>` : survey ? `<span class="when">Survey ${esc(dateTime(survey.starts_at))}</span>` : ""}<span class="next">${esc(action.label)}</span></a>`;
  };
  const toggle = `<div class="seg" role="group" aria-label="Jobs layout">${["board", "list"].map(mode => `<button type="button" data-act="jobs-view" data-id="${mode}" class="${view === mode ? "on" : ""}" aria-pressed="${view === mode}">${mode === "board" ? "Board" : "List"}</button>`).join("")}</div>`;
  const body = view === "board"
    ? `<div class="board">${BOARD_COLUMNS.map(column => `<section class="lane"><header><h2>${esc(column.label)}</h2><span class="count${columns[column.key].length ? " has" : ""}">${columns[column.key].length}</span></header>${columns[column.key].map(card).join("") || `<p class="lane-empty">None</p>`}</section>`).join("")}</div>`
    : `<div class="job-list">${BOARD_COLUMNS.map(column => columns[column.key].length ? `<section><h2>${esc(column.label)} <span class="count has">${columns[column.key].length}</span></h2><div class="job-grid">${columns[column.key].map(card).join("")}</div></section>` : "").join("") || empty("No active projects.")}</div>`;
  return `${sectionHead("Jobs", "Every live project, from survey to completion. New enquiries appear here once reviewed.", toggle)}${body}`;
}

// ---- Calendar --------------------------------------------------------------------------
const EVENT_LABEL = { survey:"Survey", installation:"Installation", follow_up:"Follow-up", milestone:"Project date", blocked:"Unavailable", available:"Available" };
export function calendarHtml({ events, mode, anchor, today = new Date() }) {
  const eventButton = event => event.requestId
    ? `<a class="ev ev-${esc(event.type)}${event.done ? " done" : ""}" href="#/customer/${esc(event.requestId)}" title="${esc(`${EVENT_LABEL[event.type]} · ${event.lead?.customer_name || ""}`)}"><b>${event.allDay ? "" : esc(time(event.start))}</b> ${esc(event.lead?.customer_name || event.title)}<small>${esc(event.type === "milestone" || event.type === "follow_up" ? event.title : EVENT_LABEL[event.type])}</small></a>`
    : `<span class="ev ev-${esc(event.type)}"><b>${esc(EVENT_LABEL[event.type])}</b> ${esc(event.title)} <button type="button" class="link" data-act="remove-block" data-id="${esc(event.id)}">Remove</button></span>`;
  let body;
  if (mode === "agenda") {
    const days = [...new Set(events.map(event => isoDay(event.start)))];
    body = days.length ? `<ol class="agenda">${days.map(day => `<li><h3>${esc(new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long" }).format(new Date(`${day}T12:00:00`)))}${day === isoDay(today) ? " · Today" : ""}</h3>${events.filter(event => isoDay(event.start) === day).map(eventButton).join("")}</li>`).join("")}</ol>` : empty("Nothing scheduled in this period.");
  } else {
    const days = mode === "week" ? Array.from({ length:7 }, (_, i) => { const d = new Date(anchor); d.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7) + i); return d; }) : monthGrid(anchor);
    body = `<div class="cal ${mode}"><div class="cal-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(name => `<b>${name}</b>`).join("")}</div><div class="cal-body">${days.map(day => {
      const dayEvents = events.filter(event => new Date(event.start) < new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) && new Date(event.end || event.start) >= new Date(day.getFullYear(), day.getMonth(), day.getDate()));
      return `<div class="cal-day${mode === "month" && day.getMonth() !== anchor.getMonth() ? " out" : ""}${sameDay(day, today) ? " today" : ""}"><span class="d">${day.getDate()}</span>${dayEvents.map(eventButton).join("")}</div>`;
    }).join("")}</div></div>`;
  }
  const label = mode === "month" ? new Intl.DateTimeFormat("en-GB", { month:"long", year:"numeric" }).format(anchor) : mode === "week" ? `Week of ${dateOnly(anchor)}` : `Next 6 weeks from ${dateOnly(anchor)}`;
  return `${sectionHead("Calendar", "Surveys, installations, follow-ups, project dates and time off in one place. Select an entry to open the customer.", `${btn("block-time", "Block time off")}`)}
<div class="toolbar cal-bar"><div class="seg">${btn("cal-move", "‹", { id:"-1", attrs:' aria-label="Previous"' })}${btn("cal-move", "Today", { id:"0" })}${btn("cal-move", "›", { id:"1", attrs:' aria-label="Next"' })}</div><b class="cal-label" aria-live="polite">${esc(label)}</b><div class="seg" role="group" aria-label="Calendar layout">${["agenda", "week", "month"].map(item => `<button type="button" data-act="cal-mode" data-id="${item}" class="${mode === item ? "on" : ""}" aria-pressed="${mode === item}">${item[0].toUpperCase() + item.slice(1)}</button>`).join("")}</div></div>
<div class="legend">${["survey", "installation", "follow_up", "milestone", "blocked"].map(type => `<span><i class="ev-${type}"></i>${EVENT_LABEL[type]}</span>`).join("")}</div>${body}
<p class="note">Only booked appointments reserve time. A customer's preferred visit window is a request, not a booking.</p>`;
}

// ---- Finance & Documents ---------------------------------------------------------------
export function financeHtml({ rows, kind, query, totals }) {
  const kinds = [["all", "Everything"], ["quote", "Quotations"], ["invoice", "Invoices"], ["payment", "Payments"]];
  return `${sectionHead("Finance & Documents", "Every quotation, invoice and payment. Search by customer, quotation, invoice or project reference.")}
<section class="totals-strip"><div><span>Invoiced</span><b>${money(totals.invoiced)}</b></div><div><span>Received</span><b>${money(totals.received)}</b></div><div><span>Outstanding</span><b>${money(totals.outstanding)}</b></div><div><span>Overdue</span><b class="${totals.overdue ? "bad" : ""}">${money(totals.overdue)}</b></div></section>
<div class="toolbar"><label class="search"><span class="sr-only">Search documents</span><input type="search" id="financeSearch" value="${esc(query)}" placeholder="Customer, FFQ-, FFI- or project reference" autocomplete="off"></label><div class="filters">${kinds.map(([key, label]) => `<button type="button" class="filter${kind === key ? " on" : ""}" data-act="finance-kind" data-id="${key}" aria-pressed="${kind === key}">${label}</button>`).join("")}</div></div>
${rows.length ? `<div class="table-wrap"><table class="doc-table"><thead><tr><th>Document</th><th>Customer</th><th>Date</th><th class="num">Amount</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(item => `<tr><td><b>${item.kind === "quote" ? "Quotation" : item.kind === "invoice" ? "Invoice" : "Payment"}</b><small>${esc(item.number)}${item.version ? ` · v${esc(item.version)}` : ""}${item.kind === "payment" ? ` · ${esc(String(item.method || "").replaceAll("_", " "))}` : ""}</small></td><td>${customerLink(item.lead)}<small>${esc(item.lead?.reference || "")}</small></td><td>${esc(dateOnly(item.date))}${item.due ? `<small>Due ${esc(dateOnly(item.due))}</small>` : ""}</td><td class="num">${money(item.amount)}${item.kind === "invoice" && item.outstanding ? `<small>${money(item.outstanding)} due</small>` : ""}</td><td>${chip(item.status)}</td><td class="act">${item.kind === "quote" ? btn("preview-quote", "View PDF", { id:item.id, kind:"small" }) : item.kind === "invoice" ? btn("preview-invoice", "View PDF", { id:item.id, kind:"small" }) : ""}</td></tr>`).join("")}</tbody></table></div>` : empty(query ? `Nothing matches “${esc(query)}”.` : "No documents yet.")}`;
}

// ---- Settings --------------------------------------------------------------------------
export function settingsHtml({ settings, catalogue, role, schema, profile }) {
  const owner = role === "owner";
  const s = settings || {};
  const field = (name, label, value, attrs = "") => `<label>${label}<input name="${name}" value="${esc(value || "")}"${attrs}${owner ? "" : " disabled"}></label>`;
  const area = (name, label, value, attrs = "") => `<label>${label}<textarea name="${name}" rows="3"${attrs}${owner ? "" : " disabled"}>${esc(value || "")}</textarea></label>`;
  return `${sectionHead("Settings", owner ? "Company details, quotation wording and the standard items catalogue." : "Only an owner can change these settings.")}
<div class="settings-grid"><section class="card"><h2>Company details</h2><p class="hint">Shown on quotations and invoices. Leave anything you have not confirmed empty: nothing is invented.</p><form id="settingsForm" class="form">${field("legalName", "Legal company name", s.legal_name, ' required minlength="2" maxlength="160"')}${area("billingAddress", "Business address", s.billing_address, ' required minlength="5" maxlength="1200"')}${field("contactEmail", "Contact email", s.contact_email, ' type="email" required maxlength="254"')}${field("contactPhone", "Phone (optional)", s.contact_phone, ' maxlength="60"')}${field("companyNumber", "Company number (optional)", s.company_number, ' maxlength="80"')}${field("vatNumber", "VAT number (only if registered)", s.vat_number, ' maxlength="80"')}${area("paymentInstructions", "Payment instructions for invoices (optional)", s.payment_instructions, ' maxlength="2000"')}${area("invoiceFooter", "Invoice footer (optional)", s.invoice_footer, ' maxlength="1200"')}${schema.defaultTerms ? `${area("defaultTerms", "Default quotation terms", s.default_quote_terms, ' maxlength="8000"')}${area("defaultExclusions", "Default quotation exclusions", s.default_quote_exclusions, ' maxlength="6000"')}` : ""}${owner ? `<div class="form-actions"><button class="btn primary">Save company details</button></div>` : ""}</form></section>
<section class="card"><h2>Standard items</h2><p class="hint">The quotation editor's item list. Prices are optional defaults and always editable on each quotation.</p>${schema.catalogue ? `${catalogue.length ? `<ul class="catalogue">${catalogue.map(item => `<li class="${item.active ? "" : "off"}"><span><b>${esc(item.name)}</b><small>${esc(item.category)} · per ${esc(item.unit)}${item.active ? "" : " · switched off"}</small></span><span class="num">${item.default_unit_price_pence == null ? `<span class="muted">No default price</span>` : money(item.default_unit_price_pence)}</span>${owner ? btn("edit-catalogue", "Edit", { id:item.id, kind:"small" }) : ""}</li>`).join("")}</ul>` : empty("No items yet.")}${owner ? btn("edit-catalogue", "+ Add item", { id:"" }) : ""}` : `<p class="warn-box">The standard items list needs the October database update (migration 20261019211600). The editor still offers the built-in item names.</p>`}</section>
<section class="card"><h2>Your account</h2><p>${esc(profile?.full_name || "Signed in")} · ${esc(owner ? "Owner" : "Staff")}</p><div class="stack">${btn("open-notification-settings", "Notification settings")}<a class="btn" href="../index.html" target="_blank" rel="noopener">Open the public website ↗</a>${btn("sign-out", "Sign out")}</div></section></div>`;
}

// ---- Customer workspace --------------------------------------------------------------
export function timelineSteps(lead, rel) {
  const surveyDone = rel.appointments.some(item => item.kind === "survey" && item.status === "completed");
  const surveyBooked = rel.appointments.some(item => item.kind === "survey" && ["scheduled", "confirmed"].includes(item.status));
  const quoted = rel.quotes.some(item => !isDiscarded(item));
  const sent = rel.quotes.some(item => item.sent_at);
  const declined = !rel.accepted && rel.quotes.some(item => item.status === "rejected") && !rel.sent && !rel.draft;
  const job = rel.job && rel.job.status !== "cancelled" ? rel.job : null;
  const installBooked = rel.appointments.some(item => item.kind === "installation" && item.status !== "cancelled");
  const started = job && ["in_progress", "quality_check", "ready_for_install", "installation_scheduled", "installed", "completed"].includes(job.status);
  const complete = job && ["installed", "completed"].includes(job.status);
  const invoices = rel.invoices.filter(item => item.status === "sent");
  const paid = invoices.length > 0 && invoices.every(item => Number(item.outstanding_pence) === 0);
  const steps = [
    ["Enquiry received", true],
    ["Reviewed", lead.status !== "new"],
    ["Site survey", surveyDone ? true : (!lead.assessment_required && !surveyBooked) ? "skip" : false, surveyDone ? "" : surveyBooked ? "Booked" : lead.assessment_required ? "Required" : "Not needed"],
    ["Quotation prepared", quoted],
    ["Quotation sent", sent],
    ["Customer decision", rel.accepted ? true : declined ? "stop" : false, rel.accepted ? "Accepted" : declined ? "Declined" : ""],
    ["Installation booked", installBooked],
    ["Work in progress", started],
    ["Completed", complete],
    ["Invoiced & paid", paid, invoices.length && !paid ? "Awaiting payment" : ""]
  ];
  let current = false;
  return steps.map(([label, state, note = ""]) => {
    let value = state === true ? "done" : state === "skip" ? "skipped" : state === "stop" ? "stop" : "todo";
    if (value === "todo" && !current && !["closed", "archived", "deleted"].includes(enquiryStage(lead, rel).key)) { value = "current"; current = true; }
    return { label, state:value, note };
  });
}

const timelineHtml = steps => `<ol class="timeline" aria-label="Project progress">${steps.map(step => `<li class="${step.state}"${step.state === "current" ? ' aria-current="step"' : ""}><i aria-hidden="true">${step.state === "done" ? "✓" : step.state === "skipped" ? "–" : step.state === "stop" ? "×" : ""}</i><span>${esc(step.label)}${step.note ? `<small>${esc(step.note)}</small>` : ""}</span></li>`).join("")}</ol>`;

const primaryForAction = (action, rel) => {
  const map = {
    review:["mark-reviewed", "Mark as reviewed"], "book-survey":["book-appointment", "Book site survey", "survey"], "complete-survey":["scroll-appointments", "Go to the survey"],
    "create-quote":["new-quote", "Prepare quotation"], "edit-quote":["edit-quote", "Open quotation editor", rel.draft?.id], "revise-quote":["revise-quote", "Create revision", rel.sent?.id],
    "await-customer":["send-quote", "Send reminder / link again", rel.sent?.id], "create-job":["create-job", "Create the job", rel.accepted?.id],
    "book-installation":["book-appointment", "Schedule installation", "installation"], "create-invoice":["new-invoice", "Create invoice"],
    "issue-invoice":["issue-invoice", "Issue invoice", rel.invoices.find(item => item.status === "draft")?.id], "record-payment":["record-payment", "Record payment", rel.invoices.find(item => item.status === "sent" && Number(item.outstanding_pence) > 0)?.id],
    "advance-job":["scroll-job", "Update job progress"], reopen:["reopen", "Reopen enquiry"]
  };
  const entry = map[action.id];
  return entry ? btn(entry[0], entry[1], { id:entry[2] || "", kind:action.primary ? "primary" : "" }) : "";
};

export function workspaceHtml(ctx) {
  const { lead, rel, today = new Date(), schema, profiles = [], activity = [], photos = [], settingsReady = false, backLabel = "Enquiries", demo = false } = ctx;
  const stage = enquiryStage(lead, rel), action = nextAction(lead, rel, { today });
  const job = rel.job && rel.job.status !== "cancelled" ? rel.job : rel.job;
  const latestInvoice = rel.invoices.find(item => item.status !== "void") || null;
  const linkFor = quote => rel.links.filter(link => link.quote_id === quote?.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const qStatus = quoteStatus(rel.quote, { today, link:linkFor(rel.quote) });
  const person = id => profiles.find(item => item.id === id)?.full_name || "Unassigned";
  const closed = ["closed", "archived", "deleted"].includes(stage.key);

  const header = `<header class="ws-top"><a class="back" href="#/back" data-act="back">‹ Back to ${esc(backLabel)}</a><div class="ws-id"><h1>${esc(lead.customer_name)}</h1><p>${esc(lead.reference)} · received ${esc(dateOnly(lead.created_at))} · ${esc(lead.source || "website")}</p></div><div class="ws-status" aria-label="Statuses"><span><small>Enquiry</small>${chip(stage)}</span><span><small>Quotation</small>${chip(qStatus)}</span><span><small>Job</small>${chip(jobStatus(job, rel.appointments))}</span><span><small>Invoice</small>${chip(invoiceStatus(latestInvoice, { today }))}</span></div></header>
<section class="next-step${action.primary ? "" : " idle"}" aria-labelledby="nextTitle"><div><p>NEXT STEP</p><h2 id="nextTitle">${esc(action.label)}</h2><span>${esc(action.hint)}</span></div><div class="next-actions">${demo ? "" : primaryForAction(action, rel)}</div></section>
${timelineHtml(timelineSteps(lead, rel))}`;

  // Customer
  const spec = specRows(lead.project_spec);
  const customer = `<section class="card" id="ws-customer"><header class="card-head"><h2>Customer details</h2>${btn("edit-customer", "Edit details", { kind:"small" })}</header>
<dl class="facts"><div><dt>Name</dt><dd>${esc(lead.customer_name)}</dd></div><div><dt>Email</dt><dd>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : `<span class="muted">Not given</span>`}</dd></div><div><dt>Phone</dt><dd>${lead.phone ? `<a href="tel:${esc(String(lead.phone).replace(/[^+\d]/g, ""))}">${esc(lead.phone)}</a>` : `<span class="muted">Not given</span>`}</dd></div><div><dt>Address</dt><dd>${lead.address ? esc(lead.address).replace(/\n/g, "<br>") : `<span class="muted">Not recorded</span>`}${lead.postcode ? `<br>${esc(lead.postcode)}` : ""}</dd></div>${lead.preferred_start ? `<div><dt>Preferred visit</dt><dd>${esc(dateTime(lead.preferred_start))}${lead.preferred_end ? ` – ${esc(time(lead.preferred_end))}` : ""}<small>A request, not a booking</small></dd></div>` : ""}</dl>
<div class="contact">${lead.email ? `<a class="btn" href="mailto:${esc(lead.email)}?subject=${encodeURIComponent(`Your Form & Frame enquiry ${lead.reference}`)}">Email customer</a>` : ""}${lead.phone ? `<a class="btn" href="tel:${esc(String(lead.phone).replace(/[^+\d]/g, ""))}">Call customer</a>` : ""}${btn("new-follow-up", "Schedule follow-up")}</div>
<h3>Project requirements</h3>${spec.length ? `<dl class="spec">${spec.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : `<p class="muted">No configurator design was attached.</p>`}${lead.wall_width ? `<p><b>Wall:</b> ${esc(lead.wall_width)}</p>` : ""}<p class="muted">${esc(budgetNote(lead))}</p>
<h3>Customer's message</h3><p class="message">${esc(lead.message || "No message.")}</p>
<h3>Internal notes</h3><p class="message">${esc(lead.staff_notes || "No notes yet.")}</p>
${photos.length ? `<h3>Uploaded files</h3><div class="photos">${photos.map(photo => photo.url ? `<a href="${esc(photo.url)}" target="_blank" rel="noopener"><img src="${esc(photo.url)}" alt="${esc(photo.name)}" loading="lazy"></a>` : `<span class="file">${esc(photo.name)}</span>`).join("")}</div>` : ""}</section>`;

  // Quotation
  const quotes = rel.quotes.filter(item => !isDiscarded(item));
  const q = rel.draft || rel.sent || rel.accepted || quotes[0] || null;
  let quoteBody;
  if (!q) quoteBody = `<p class="muted">No quotation yet.</p><div class="row-actions">${btn("new-quote", "Create quotation", { kind:"primary" })}</div>`;
  else {
    const qs = quoteStatus(q, { today, link:linkFor(q) });
    const link = linkFor(q);
    const lines = Array.isArray(q.line_items) ? q.line_items : [];
    const actions = [];
    actions.push(btn("preview-quote", "Preview PDF", { id:q.id }));
    if (q.status === "draft") { actions.unshift(btn("edit-quote", "Edit quotation", { id:q.id, kind:"primary" })); actions.push(btn("send-quote", "Send to customer", { id:q.id }), btn("discard-quote", "Discard draft", { id:q.id, kind:"quiet" })); }
    if (q.status === "sent") { actions.push(btn("send-quote", "Copy link / email again", { id:q.id }), btn("revise-quote", "Create revision", { id:q.id }), btn("record-decision", "Record customer's answer", { id:q.id, kind:"quiet" })); }
    if (q.status === "accepted" && !(rel.job && rel.job.status !== "cancelled")) actions.unshift(btn("create-job", "Create the job", { id:q.id, kind:"primary" }));
    if (["rejected", "expired"].includes(q.status) || (q.status === "superseded" && !rel.draft && !rel.sent && !rel.accepted)) actions.push(btn("revise-quote", "Prepare new version", { id:q.id }));
    quoteBody = `<div class="quote-summary"><div><b>${esc(q.quote_number)}</b> <small>version ${esc(q.version)}</small> ${chip(qs)}</div><strong>${money(q.total_pence)}</strong></div>
${q.revision_requested_at || q.customer_message ? `<blockquote class="customer-said"><small>Customer ${q.revision_requested_at ? "asked for changes" : "wrote"} ${esc(dateTime(q.responded_at || q.revision_requested_at))}</small>${esc(q.customer_message || "")}</blockquote>` : ""}
${lines.length ? `<table class="mini-lines"><tbody>${lines.slice(0, 8).map(line => `<tr><td>${esc(line.description)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td><td class="num">${money(line.line_total_pence)}</td></tr>`).join("")}${lines.length > 8 ? `<tr><td colspan="3" class="muted">+ ${lines.length - 8} more lines</td></tr>` : ""}</tbody><tfoot>${Number(q.discount_pence) ? `<tr><td colspan="2">Discount${q.discount_type === "percent" ? ` ${basisPointsText(q.discount_basis_points)}` : ""}</td><td class="num">−${money(q.discount_pence)}</td></tr>` : ""}<tr><td colspan="2">VAT ${basisPointsText(q.tax_rate_basis_points)}</td><td class="num">${money(q.tax_pence)}</td></tr><tr><td colspan="2"><b>Total</b></td><td class="num"><b>${money(q.total_pence)}</b></td></tr></tfoot></table>` : `<p class="scope-text">${esc(q.scope || "")}</p>`}
<p class="muted small">${q.valid_until ? `Valid until ${esc(dateOnly(q.valid_until))}` : "No validity date"}${q.sent_at ? ` · sent ${esc(dateTime(q.sent_at))}` : " · not sent yet"}${link?.viewed_at ? ` · link opened ${esc(dateTime(link.viewed_at))}` : ""}${q.status !== "draft" ? " · issued quotations cannot be edited" : ""}</p>
<div class="row-actions">${actions.join("")}</div>`;
  }
  const quoteCard = `<section class="card" id="ws-quote"><header class="card-head"><h2>Quotation</h2></header>${schema.quoteLines ? "" : `<p class="warn-box">Itemised quotations need the October database update (migration 20261019211600). Until it is applied, existing quotations can be viewed but not created or edited here.</p>`}${quoteBody}</section>`;

  // Appointments
  const appts = rel.appointments;
  const apptCard = `<section class="card" id="ws-appointments"><header class="card-head"><h2>Appointments</h2></header>${appts.length ? `<ul class="appts">${appts.map(item => `<li class="${item.status}"><span><b>${item.kind === "survey" ? "Site survey" : "Installation"}</b> ${chip({ key:item.status, label:{ scheduled:"Booked", confirmed:"Confirmed", completed:"Done", cancelled:"Cancelled" }[item.status], tone:{ scheduled:"info", confirmed:"info", completed:"good", cancelled:"muted" }[item.status] })}<small>${esc(dateTime(item.starts_at))} – ${esc(time(item.ends_at))} · ${esc(person(item.assigned_to))}${item.location ? ` · ${esc(item.location)}` : ""}</small>${item.notes ? `<small>${esc(item.notes)}</small>` : ""}</span>${["scheduled", "confirmed"].includes(item.status) ? `<span class="row-actions">${btn("reschedule", "Reschedule", { id:item.id, kind:"small" })}${btn("appointment-done", "Mark done", { id:item.id, kind:"small" })}${btn("appointment-cancel", "Cancel", { id:item.id, kind:"small quiet" })}</span>` : ""}<a class="link small" href="#/calendar?date=${esc(isoDay(item.starts_at))}">View in calendar</a></li>`).join("")}</ul>` : `<p class="muted">Nothing booked. A preferred visit window from the website is a request, not a booking.</p>`}${rel.followUps.length ? `<h3>Follow-ups</h3><ul class="appts">${rel.followUps.map(task => `<li><span><b>${esc(task.title)}</b><small>Due ${esc(dateTime(task.due_at))}</small></span><span class="row-actions">${btn("follow-up-done", "Mark done", { id:task.id, kind:"small" })}</span></li>`).join("")}</ul>` : ""}<div class="row-actions">${btn("book-appointment", "Book survey", { id:"survey" })}${btn("book-appointment", "Book installation", { id:"installation" })}</div>
<p class="muted small">${lead.assessment_required ? "A survey is required before this enquiry can be quoted." : "A survey is optional for this enquiry."} ${btn("toggle-survey", lead.assessment_required ? "Survey not needed" : "Require a survey first", { kind:"link" })}</p></section>`;

  // Job
  const activeJob = rel.job && rel.job.status !== "cancelled" ? rel.job : null;
  const jobCard = `<section class="card" id="ws-job"><header class="card-head"><h2>Job</h2></header>${activeJob ? `<div class="quote-summary"><div><b>${esc(activeJob.work_order_number)}</b> ${chip(jobStatus(activeJob, rel.appointments))}</div><strong>${money(activeJob.agreed_total_pence)}</strong></div><p class="muted small">Step: ${esc(JOB_STATUS_LABELS[activeJob.status])} · assigned to ${esc(person(activeJob.assigned_to))}${activeJob.planned_start ? ` · starts ${esc(dateOnly(activeJob.planned_start))}` : ""}${activeJob.target_completion ? ` · target ${esc(dateOnly(activeJob.target_completion))}` : ""}</p><div class="row-actions">${jobMoves(activeJob).map(move => btn("job-move", esc(move.label), { id:move.to, kind:move.destructive ? "quiet danger" : move.backward ? "quiet" : "" })).join("")}${btn("edit-job", "Dates & assignment", { kind:"quiet" })}</div>` : rel.accepted ? `<p class="muted">The quotation is accepted.</p><div class="row-actions">${btn("create-job", "Create the job", { id:rel.accepted.id, kind:"primary" })}</div>` : `<p class="muted">A job is created when the customer accepts a quotation.</p>`}${rel.job?.status === "cancelled" ? `<p class="muted small">Job ${esc(rel.job.work_order_number)} was cancelled.</p>` : ""}</section>`;

  // Invoices
  const invCard = `<section class="card" id="ws-invoice"><header class="card-head"><h2>Invoice &amp; payments</h2></header>${rel.invoices.length ? `<ul class="invoices">${rel.invoices.map(item => `<li><div class="quote-summary"><div><b>${esc(item.invoice_number)}</b> ${chip(invoiceStatus(item, { today }))}</div><strong>${money(item.total_pence)}</strong></div><small>${item.status === "sent" ? `Received ${money(item.paid_pence)} · outstanding ${money(item.outstanding_pence)} · due ${esc(dateOnly(item.due_date))}` : item.status === "draft" ? "Draft · not issued" : "Void"}</small><div class="row-actions">${item.status !== "void" ? btn("preview-invoice", "Preview PDF", { id:item.id, disabled:!settingsReady, attrs:settingsReady ? "" : ' title="Add company details in Settings first"' }) : ""}${item.status === "draft" ? btn("issue-invoice", "Issue invoice", { id:item.id, kind:"primary" }) + btn("void-invoice", "Discard draft", { id:item.id, kind:"quiet" }) : ""}${item.status === "sent" && Number(item.outstanding_pence) > 0 ? btn("record-payment", "Record payment", { id:item.id, kind:"primary" }) : ""}</div></li>`).join("")}</ul>${settingsReady ? "" : `<p class="warn-box">Invoice PDFs need your company details. Add them in Settings.</p>`}` : `<p class="muted">${activeJob ? "No invoice yet." : "Invoices are created from the job."}</p>`}${activeJob && !rel.invoices.some(item => item.status !== "void") ? `<div class="row-actions">${btn("new-invoice", "Create invoice", { kind:activeJob ? "primary" : "" })}</div>` : ""}<p class="muted small">Payments are recorded after money is received. Nothing here charges a card.</p></section>`;

  // Documents
  const docs = [
    ...rel.quotes.filter(item => !isDiscarded(item)).map(item => ({ label:`Quotation ${item.quote_number} · v${item.version}`, status:quoteStatus(item, { today, link:linkFor(item) }), act:"preview-quote", id:item.id, date:item.sent_at || item.created_at })),
    ...rel.invoices.map(item => ({ label:`Invoice ${item.invoice_number}`, status:invoiceStatus(item, { today }), act:"preview-invoice", id:item.id, date:item.issue_date }))
  ];
  const docCard = `<section class="card" id="ws-documents"><header class="card-head"><h2>Documents</h2></header>${docs.length ? `<ul class="docs">${docs.map(doc => `<li><span><b>${esc(doc.label)}</b><small>${esc(dateOnly(doc.date))}</small></span>${chip(doc.status)}${btn(doc.act, "Open PDF", { id:doc.id, kind:"small", disabled:doc.act === "preview-invoice" && !settingsReady })}</li>`).join("")}</ul>` : `<p class="muted">Quotations and invoices appear here as they are created. Issued versions are kept unchanged.</p>`}${photos.length ? `<p class="muted small">${plural(photos.length, "uploaded file")} shown under customer details.</p>` : ""}</section>`;

  // Activity
  const actCard = `<section class="card" id="ws-activity"><header class="card-head"><h2>Activity</h2></header><ol class="activity">${activity.map(item => `<li><time>${esc(dateTime(item.at))}</time><span>${esc(item.text)}</span></li>`).join("")}</ol></section>`;

  // Manage
  const manage = `<section class="card manage" id="ws-manage"><header class="card-head"><h2>Manage enquiry</h2></header><label class="inline">Enquiry stage<select id="stageSelect" data-act="set-stage">${MANUAL_STAGES.map(item => `<option value="${item.value}"${lead.status === item.value ? " selected" : ""}>${esc(item.label)}</option>`).join("")}${MANUAL_STAGES.some(item => item.value === lead.status) ? "" : `<option value="${esc(lead.status)}" selected>${esc(stage.label)} (set by the workflow)</option>`}</select></label><p class="muted small">Quotation, job and invoice progress update automatically. Use this to step back, close or archive. Customer acceptances, issued invoices and payments are never changed from here.</p><div class="row-actions">${lead.deleted_at ? btn("restore-enquiry", "Restore enquiry", { kind:"primary" }) : `${closed ? btn("reopen", "Reopen") : btn("close-enquiry", "Close · not proceeding", { kind:"quiet" })}${lead.status === "archived" ? "" : btn("archive-enquiry", "Archive", { kind:"quiet" })}${schema.softDelete ? btn("delete-enquiry", "Delete enquiry", { kind:"quiet danger" }) : ""}`}</div></section>`;

  return `${header}<div class="ws-grid"><div class="ws-main">${quoteCard}${apptCard}${jobCard}${invCard}</div><div class="ws-side">${customer}${docCard}${actCard}${manage}</div></div>`;
}

// ---- Dialog bodies -----------------------------------------------------------------------
const field = (label, input, hint = "") => `<label>${label}${input}${hint ? `<small class="hint">${hint}</small>` : ""}</label>`;
const actionsRow = (saveLabel, { danger = false } = {}) => `<div class="dialog-actions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn ${danger ? "danger" : "primary"}">${saveLabel}</button></div>`;
const toLocalInput = value => { if (!value) return ""; const d = new Date(value); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export const quoteLineHtml = (line, index) => `<tr class="line" data-index="${index}"><td class="c-desc" data-label="Item"><input name="description" list="catalogueList" value="${esc(line.description)}" placeholder="Search items or type your own" maxlength="300" aria-label="Item ${index + 1} description" autocomplete="off"></td><td data-label="Qty"><input name="quantity" inputmode="decimal" value="${esc(line.quantity)}" aria-label="Item ${index + 1} quantity" placeholder="1"></td><td data-label="Unit"><input name="unit" value="${esc(line.unit)}" maxlength="30" aria-label="Item ${index + 1} unit" placeholder="item"></td><td data-label="Unit price £"><input name="unitPrice" inputmode="decimal" value="${esc(line.unitPrice)}" aria-label="Item ${index + 1} unit price in pounds" placeholder="0.00"></td><td class="num line-total" data-label="Line total" data-line-total>—</td><td class="c-remove"><button type="button" class="icon-btn" data-act="remove-line" data-id="${index}" aria-label="Remove item ${index + 1}">×</button></td></tr>`;

export function quoteEditorHtml({ lead, quote = null, rows, catalogue, discount, taxPercent, scope, exclusions, terms, validUntil, revisionOf = null, ready = true }) {
  const options = catalogue.map(item => `<option value="${esc(item.name)}" data-unit="${esc(item.unit)}" data-price="${item.default_unit_price_pence == null ? "" : esc(penceToInput(item.default_unit_price_pence))}" data-id="${esc(item.id || "")}"></option>`).join("");
  return `<form id="quoteForm" class="form editor" data-request-id="${esc(lead.id)}"${quote ? ` data-quote-id="${esc(quote.id)}"` : ""}${revisionOf ? ` data-revision-of="${esc(revisionOf.id)}"` : ""} novalidate>
<header class="dialog-head"><div><p>${quote ? `QUOTATION ${esc(quote.quote_number)} · VERSION ${esc(quote.version)} · DRAFT` : revisionOf ? `REVISION OF ${esc(revisionOf.quote_number)}` : "NEW QUOTATION"}</p><h2>${esc(lead.customer_name)}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close editor">×</button></header>
${ready ? "" : `<p class="warn-box">Saving itemised quotations needs the October database update (migration 20261019211600). You can try the editor, but it cannot save yet.</p>`}
<datalist id="catalogueList">${options}</datalist>
<h3>Materials &amp; services</h3>
<div class="table-wrap"><table class="lines"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price (£)</th><th class="num">Line total</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody id="quoteLines">${rows.map(quoteLineHtml).join("")}</tbody></table></div>
<button type="button" class="btn" data-act="add-line">+ Add item</button>
<div class="editor-grid"><div>
<fieldset class="discount"><legend>Discount</legend><label class="check"><input type="checkbox" name="applyDiscount"${discount.type !== "none" ? " checked" : ""}> Apply discount</label><div class="discount-options"${discount.type === "none" ? " hidden" : ""}><div class="seg" role="radiogroup" aria-label="Discount percentage">${["5", "10", "15", "20", "25"].map(value => `<label class="pill"><input type="radio" name="discountPreset" value="${value}"${discount.type === "percent" && discount.percent === value ? " checked" : ""}> ${value}%</label>`).join("")}<label class="pill"><input type="radio" name="discountPreset" value="custom"${discount.type === "percent" && !["5", "10", "15", "20", "25"].includes(discount.percent) ? " checked" : ""}> Custom %</label><label class="pill"><input type="radio" name="discountPreset" value="fixed"${discount.type === "fixed" ? " checked" : ""}> Fixed £</label></div>
${field("Custom percentage", `<input name="customPercent" inputmode="decimal" value="${esc(discount.type === "percent" && !["5", "10", "15", "20", "25"].includes(discount.percent) ? discount.percent : "")}" placeholder="e.g. 7.5">`)}${field("Fixed amount (£)", `<input name="fixedAmount" inputmode="decimal" value="${esc(discount.amount || "")}" placeholder="e.g. 250">`)}</div></fieldset>
${field("VAT rate (%)", `<input name="taxPercent" inputmode="decimal" value="${esc(taxPercent)}" required>`, "Use 0 if you are not VAT registered. The rate is your decision; none is assumed.")}
${field("Valid until", `<input type="date" name="validUntil" value="${esc(validUntil)}" required>`)}
</div><aside class="totals-box" aria-live="polite" id="quoteTotals"></aside></div>
${field("Scope of work", `<textarea name="scope" rows="5" maxlength="12000" required>${esc(scope)}</textarea>`, "What you will build. Shown on the PDF.")}
${field("Exclusions", `<textarea name="exclusions" rows="3" maxlength="6000">${esc(exclusions)}</textarea>`, "What is not included, for example redecorating adjoining walls.")}
${field("Terms", `<textarea name="terms" rows="3" maxlength="8000">${esc(terms)}</textarea>`, "Deposit, payment and cancellation terms you have agreed to offer.")}
<p class="form-errors" id="quoteErrors" role="alert" hidden></p>
<div class="dialog-actions sticky"><button type="button" class="btn" data-act="close-dialog">Cancel</button>${quote ? `<button type="button" class="btn" data-act="save-and-preview">Save &amp; preview PDF</button>` : ""}<button class="btn primary"${ready ? "" : " disabled"}>${quote ? "Save changes" : "Save quotation draft"}</button></div></form>`;
}

export function quoteTotalsHtml(result) {
  return `<h3>Totals</h3><dl><div><dt>Items subtotal</dt><dd>${money(result.itemsSubtotalPence)}</dd></div><div class="${result.discountPence ? "discount" : ""}"><dt>Discount${result.discountType === "percent" && result.discountBasisPoints ? ` (${basisPointsText(result.discountBasisPoints)})` : ""}</dt><dd>${result.discountPence ? `−${money(result.discountPence)}` : "—"}</dd></div><div><dt>Subtotal after discount</dt><dd>${money(result.subtotalPence)}</dd></div><div><dt>VAT${result.taxBasisPoints ? ` (${basisPointsText(result.taxBasisPoints)})` : ""}</dt><dd>${money(result.taxPence)}</dd></div><div class="grand"><dt>Grand total</dt><dd>${money(result.totalPence)}</dd></div></dl>`;
}

export function appointmentFormHtml({ lead, kind = "survey", appointment = null, profiles = [], defaultLocation = "", start = null }) {
  const startValue = toLocalInput(appointment?.starts_at || start);
  const minutes = appointment ? Math.round((new Date(appointment.ends_at) - new Date(appointment.starts_at)) / 60000) : kind === "survey" ? 60 : 480;
  return `<form id="appointmentForm" class="form" data-request-id="${esc(lead.id)}"${appointment ? ` data-appointment-id="${esc(appointment.id)}"` : ""}><header class="dialog-head"><div><p>${appointment ? "RESCHEDULE" : "BOOK"} · ${esc(lead.customer_name)}</p><h2>${appointment ? "Reschedule appointment" : kind === "survey" ? "Book site survey" : "Schedule installation"}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>
${appointment ? `<input type="hidden" name="kind" value="${esc(appointment.kind)}">` : field("Type", `<select name="kind"><option value="survey"${kind === "survey" ? " selected" : ""}>Site survey</option><option value="installation"${kind === "installation" ? " selected" : ""}>Installation</option></select>`)}
<div class="two">${field("Start", `<input type="datetime-local" name="startsAt" value="${esc(startValue)}" required>`)}${field("Duration", `<select name="duration">${[[30, "30 minutes"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"], [240, "Half day (4 hours)"], [480, "Full day (8 hours)"], [960, "Two days"]].map(([value, label]) => `<option value="${value}"${value === minutes ? " selected" : ""}>${label}</option>`).join("")}${[30, 60, 90, 120, 240, 480, 960].includes(minutes) ? "" : `<option value="${minutes}" selected>${minutes} minutes</option>`}</select>`)}</div>
${appointment ? "" : field("Assigned to", `<select name="assignedTo"><option value="">Unassigned</option>${profiles.map(person => `<option value="${esc(person.id)}">${esc(person.full_name || "Team member")}</option>`).join("")}</select>`)}
${field("Location", `<input name="location" maxlength="240" value="${esc(appointment?.location ?? defaultLocation)}">`)}
${appointment ? "" : field("Notes for the team (optional)", `<textarea name="notes" rows="2" maxlength="2000"></textarea>`)}
<p class="hint">The time is checked against other bookings and blocked time. No message is sent to the customer.</p><p class="form-errors" role="alert" hidden></p>${actionsRow(appointment ? "Save new time" : "Book appointment")}</form>`;
}

export function customerFormHtml({ lead = null, schema }) {
  const l = lead || {};
  return `<form id="customerForm" class="form"${lead ? ` data-request-id="${esc(lead.id)}"` : ""}><header class="dialog-head"><div><p>${lead ? esc(lead.reference) : "MANUAL ENQUIRY"}</p><h2>${lead ? "Edit customer details" : "New enquiry"}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>
${field("Customer name", `<input name="customerName" value="${esc(l.customer_name || "")}" required minlength="2" maxlength="120" autocomplete="off">`)}
<div class="two">${field("Email", `<input name="email" type="email" value="${esc(l.email || "")}" maxlength="254">`)}${field("Phone", `<input name="phone" type="tel" value="${esc(l.phone || "")}" maxlength="60">`)}</div>
${schema.address ? field("Address", `<textarea name="address" rows="2" maxlength="600">${esc(l.address || "")}</textarea>`) : ""}
${field("Postcode", `<input name="postcode" value="${esc(l.postcode || "")}" required maxlength="24">`)}
${field("Wall size / dimensions", `<input name="wallWidth" value="${esc(l.wall_width || "")}" maxlength="120">`)}
${field("Project requirements / customer's message", `<textarea name="message" rows="4" maxlength="4000">${esc(l.message || "")}</textarea>`)}
${field("Internal notes (staff only)", `<textarea name="staffNotes" rows="3" maxlength="4000">${esc(l.staff_notes || "")}</textarea>`)}
<p class="form-errors" role="alert" hidden></p>${actionsRow(lead ? "Save details" : "Create enquiry")}</form>`;
}

export function sendQuoteHtml({ lead, quote, link = "", emailHref = "" }) {
  return `<div class="form"><header class="dialog-head"><div><p>${esc(quote.quote_number)} · VERSION ${esc(quote.version)}</p><h2>Send to ${esc(lead.customer_name)}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>
<ol class="send-steps"><li><b>Check the PDF.</b> ${btn("preview-quote", "Preview PDF", { id:quote.id })}<small>Use Print → Save as PDF to keep a copy for your email.</small></li>
<li><b>Create the customer's secure link.</b>${link ? `<div class="link-box"><input readonly value="${esc(link)}" aria-label="Customer response link" id="responseLink">${btn("copy-link", "Copy link")}</div><small>Single use, expires in 30 days. The customer can view the quotation and accept, decline or ask for changes.</small>` : `${btn("issue-link", quote.status === "draft" ? "Create link &amp; mark as sent" : "Create a new link", { id:quote.id, kind:"primary" })}<small>${quote.status === "draft" ? "This locks the quotation: later changes need a revision." : "Any earlier link for this quotation stops working."}</small>`}</li>
<li><b>Email the customer.</b>${lead.email ? (link ? `<a class="btn primary" href="${esc(emailHref)}">Open email draft</a><small>Opens your email app with the message and link filled in. Attach the PDF, then send it yourself.</small>` : `<small>Available once the link exists.</small>`) : `<small class="bad">No email address on record. Copy the link and send it another way.</small>`}</li></ol>
<p class="hint">Owner Desk does not send emails itself: no email delivery service is configured. Nothing reaches the customer until you send it.</p><div class="dialog-actions"><button type="button" class="btn primary" data-act="close-dialog">Done</button></div></div>`;
}

export function confirmHtml({ title, body, confirmLabel, danger = false, act, id = "", extra = "" }) {
  return `<form id="confirmForm" class="form" data-confirm="${esc(act)}" data-id="${esc(id)}"><header class="dialog-head"><div><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header><p>${body}</p>${extra}<p class="form-errors" role="alert" hidden></p>${actionsRow(esc(confirmLabel), { danger })}</form>`;
}

export function invoiceFormHtml({ lead, job, quote, today = new Date() }) {
  const due = new Date(today); due.setDate(due.getDate() + 14);
  return `<form id="invoiceForm" class="form" data-work-order-id="${esc(job.id)}"><header class="dialog-head"><div><p>${esc(job.work_order_number)}</p><h2>Create invoice</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>
<p class="hint">Amounts start from the accepted quotation${quote ? ` ${esc(quote.quote_number)} (${money(quote.total_pence)})` : ""}. Change them for a deposit or stage payment.</p>
${field("Bill to", `<input name="billName" required maxlength="160" value="${esc(lead.customer_name)}">`)}
${field("Billing address", `<textarea name="billAddress" required minlength="5" maxlength="1200" rows="3">${esc([lead.address, lead.postcode].filter(Boolean).join("\n"))}</textarea>`)}
<div class="two">${field("Subtotal (£)", `<input name="subtotal" inputmode="decimal" required value="${esc(penceToInput(quote?.subtotal_pence ?? job.agreed_total_pence))}">`)}${field("VAT amount (£)", `<input name="tax" inputmode="decimal" required value="${esc(penceToInput(quote?.tax_pence ?? 0))}">`)}</div>
<div class="two">${field("Issue date", `<input type="date" name="issueDate" required value="${isoDay(today)}">`)}${field("Payment due", `<input type="date" name="dueDate" required value="${isoDay(due)}">`)}</div>
<p class="form-errors" role="alert" hidden></p>${actionsRow("Save invoice draft")}</form>`;
}

export function paymentFormHtml({ invoice }) {
  return `<form id="paymentForm" class="form" data-invoice-id="${esc(invoice.id)}"><header class="dialog-head"><div><p>${esc(invoice.invoice_number)}</p><h2>Record a payment</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>
<p>Outstanding: <b>${money(invoice.outstanding_pence)}</b></p>
<div class="two">${field("Amount received (£)", `<input name="amount" inputmode="decimal" required value="${esc(penceToInput(invoice.outstanding_pence))}">`)}${field("Method", `<select name="method"><option value="bank_transfer">Bank transfer</option><option value="card">Card (taken outside this app)</option><option value="cash">Cash</option><option value="other">Other</option></select>`)}</div>
<p class="hint">Record money you have actually received. No card is charged here.</p><p class="form-errors" role="alert" hidden></p>${actionsRow("Record payment")}</form>`;
}

export function followUpFormHtml({ lead }) {
  const due = new Date(); due.setDate(due.getDate() + 2); due.setHours(10, 0, 0, 0);
  return `<form id="followUpForm" class="form" data-request-id="${esc(lead.id)}"><header class="dialog-head"><div><p>${esc(lead.reference)}</p><h2>Schedule follow-up</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>${field("What needs doing", `<input name="title" required maxlength="160" value="Follow up with ${esc(lead.customer_name)}">`)}${field("Due", `<input type="datetime-local" name="dueAt" required value="${esc(toLocalInput(due))}">`)}<p class="form-errors" role="alert" hidden></p>${actionsRow("Save follow-up")}</form>`;
}

export function jobFormHtml({ job, profiles }) {
  return `<form id="jobForm" class="form" data-job-id="${esc(job.id)}"><header class="dialog-head"><div><p>${esc(job.work_order_number)}</p><h2>Dates &amp; assignment</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>${field("Assigned to", `<select name="assignedTo"><option value="">Unassigned</option>${profiles.map(person => `<option value="${esc(person.id)}"${person.id === job.assigned_to ? " selected" : ""}>${esc(person.full_name || "Team member")}</option>`).join("")}</select>`)}<div class="two">${field("Build starts", `<input type="date" name="plannedStart" value="${esc(job.planned_start || "")}">`)}${field("Target completion", `<input type="date" name="targetCompletion" value="${esc(job.target_completion || "")}">`)}</div><p class="form-errors" role="alert" hidden></p>${actionsRow("Save")}</form>`;
}

export function catalogueFormHtml({ item = null }) {
  const i = item || { name:"", category:"Materials", unit:"item", default_unit_price_pence:null, active:true, sort_order:200 };
  return `<form id="catalogueForm" class="form"${item ? ` data-item-id="${esc(item.id)}"` : ""}><header class="dialog-head"><div><p>STANDARD ITEMS</p><h2>${item ? "Edit item" : "Add item"}</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>${field("Name", `<input name="name" required minlength="2" maxlength="120" value="${esc(i.name)}">`)}<div class="two">${field("Category", `<input name="category" required maxlength="60" value="${esc(i.category)}">`)}${field("Unit", `<input name="unit" required maxlength="30" value="${esc(i.unit)}" placeholder="sheet, metre, day, item">`)}</div>${field("Default unit price (£, optional)", `<input name="price" inputmode="decimal" value="${esc(penceToInput(i.default_unit_price_pence))}" placeholder="Leave empty if it varies">`)}<label class="check"><input type="checkbox" name="active"${i.active ? " checked" : ""}> Offer this item in the quotation editor</label><p class="form-errors" role="alert" hidden></p>${actionsRow("Save item")}</form>`;
}

export function blockFormHtml() {
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(8, 0, 0, 0);
  const end = new Date(start); end.setHours(18);
  return `<form id="blockForm" class="form"><header class="dialog-head"><div><p>CALENDAR</p><h2>Block time off</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header>${field("Reason", `<input name="title" required maxlength="120" value="Unavailable">`)}${field("Type", `<select name="kind"><option value="blocked">Unavailable / holiday</option><option value="available">Extra availability</option></select>`)}<div class="two">${field("From", `<input type="datetime-local" name="startsAt" required value="${esc(toLocalInput(start))}">`)}${field("Until", `<input type="datetime-local" name="endsAt" required value="${esc(toLocalInput(end))}">`)}</div><p class="form-errors" role="alert" hidden></p>${actionsRow("Block time")}</form>`;
}

export function decisionFormHtml({ quote }) {
  return `<form id="decisionForm" class="form" data-quote-id="${esc(quote.id)}"><header class="dialog-head"><div><p>${esc(quote.quote_number)}</p><h2>Record the customer's answer</h2></div><button type="button" class="icon-btn" data-act="close-dialog" aria-label="Close">×</button></header><p>Use this only when the customer gave their decision another way, for example by phone or email. It is recorded under your name in the activity history.</p><fieldset class="choice"><legend>The customer…</legend><label class="check"><input type="radio" name="decision" value="accepted" required> accepted the quotation</label><label class="check"><input type="radio" name="decision" value="rejected"> declined the quotation</label></fieldset><label class="check"><input type="checkbox" name="confirmed" required> I have the customer's decision in writing or have confirmed it with them</label><p class="form-errors" role="alert" hidden></p>${actionsRow("Record answer")}</form>`;
}
