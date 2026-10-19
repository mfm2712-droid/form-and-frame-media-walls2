// Pure Owner Desk model: separate statuses for enquiries, quotations, jobs and
// invoices; the one recommended next step; the dashboard queues; search and the
// unified calendar. No DOM and no network, so every rule here is unit-tested.

const DAY = 86_400_000;
const isoDay = date => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---- Related records ------------------------------------------------------------
export function relatedRecords(lead, { quotes = [], workOrders = [], appointments = [], invoices = [], followUps = [], links = [] } = {}) {
  const id = lead?.id;
  const requestQuotes = quotes.filter(item => item.request_id === id).sort((a, b) => Number(b.version) - Number(a.version));
  const accepted = requestQuotes.find(item => item.status === "accepted") || null;
  const draft = requestQuotes.find(item => item.status === "draft") || null;
  const sent = requestQuotes.find(item => item.status === "sent") || null;
  const current = accepted || draft || sent || requestQuotes.find(item => !isDiscarded(item)) || null;
  const jobs = workOrders.filter(item => item.request_id === id);
  const job = jobs.find(item => item.status !== "cancelled") || jobs[0] || null;
  const jobIds = new Set(jobs.map(item => item.id));
  const quoteIds = new Set(requestQuotes.map(item => item.id));
  return {
    quote:current, draft, sent, accepted,
    quotes:requestQuotes,
    job, jobs,
    appointments:appointments.filter(item => item.request_id === id).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))),
    invoices:invoices.filter(item => jobIds.has(item.work_order_id)),
    followUps:followUps.filter(item => item.request_id === id),
    links:links.filter(item => quoteIds.has(item.quote_id))
  };
}

// ---- Status models ----------------------------------------------------------------
const status = (key, label, tone) => ({ key, label, tone });
export const isDiscarded = quote => quote?.status === "superseded" && !quote?.sent_at;

export function quoteStatus(quote, { today = new Date(), link = null } = {}) {
  if (!quote) return status("none", "No quotation", "muted");
  if (quote.status === "draft") return status("draft", "Draft", "draft");
  if (isDiscarded(quote)) return status("discarded", "Discarded draft", "muted");
  if (quote.status === "superseded") return status("superseded", "Replaced by revision", "muted");
  if (quote.status === "accepted") return status("accepted", "Accepted", "good");
  if (quote.status === "rejected") return status("declined", "Declined", "bad");
  if (quote.status === "expired") return status("expired", "Expired", "bad");
  if (quote.status === "sent") {
    if (quote.revision_requested_at) return status("revision", "Revision requested", "warn");
    if (quote.valid_until && quote.valid_until < isoDay(today)) return status("expired", "Expired", "bad");
    if (link?.viewed_at) return status("viewed", "Sent · link opened", "info");
    return status("sent", "Sent · awaiting customer", "info");
  }
  return status(quote.status, String(quote.status).replaceAll("_", " "), "muted");
}

export const JOB_STATUS_LABELS = Object.freeze({
  accepted:"Awaiting scheduling", ready_to_build:"Ready to build", in_progress:"In progress",
  quality_check:"Quality check", ready_for_install:"Ready for installation",
  installation_scheduled:"Installation scheduled", installed:"Installed", completed:"Completed", cancelled:"Cancelled"
});

// The owner's five job states; the detailed database step is shown beneath it.
export function jobStatus(job, appointments = []) {
  if (!job) return status("none", "No job yet", "muted");
  if (job.status === "cancelled") return status("cancelled", "Cancelled", "bad");
  if (job.status === "completed" || job.status === "installed") return status("completed", job.status === "installed" ? "Installed · ready to close" : "Completed", "good");
  const installBooked = appointments.some(item => item.kind === "installation" && ["scheduled", "confirmed"].includes(item.status));
  // Work under way stays "In progress" even once the installation date is booked.
  if (["in_progress", "quality_check"].includes(job.status)) return status("progress", "In progress", "warn");
  if (job.status === "installation_scheduled" || installBooked) return status("scheduled", "Installation scheduled", "info");
  if (job.status === "ready_for_install") return status("progress", "In progress", "warn");
  return status("awaiting", "Awaiting scheduling", "draft");
}

// Allowed job moves with plain-English button labels, matching the database rules.
const JOB_MOVES = Object.freeze({
  accepted:[["ready_to_build", "Materials ready to build"], ["in_progress", "Start the work"]],
  ready_to_build:[["in_progress", "Start the work"], ["accepted", "Back to awaiting scheduling"]],
  in_progress:[["quality_check", "Move to quality check"], ["ready_to_build", "Pause · back to ready to build"]],
  quality_check:[["ready_for_install", "Passed · ready for installation"], ["in_progress", "Back to in progress"]],
  ready_for_install:[["installation_scheduled", "Mark installation scheduled"], ["in_progress", "Back to in progress"]],
  installation_scheduled:[["installed", "Mark installed"], ["ready_for_install", "Reschedule · back to ready"]],
  installed:[["completed", "Close the job as completed"]]
});
export function jobMoves(job) {
  if (!job) return [];
  const moves = (JOB_MOVES[job.status] || []).map(([to, label]) => ({ to, label, backward:/^(Back|Pause|Reschedule)/.test(label) }));
  if (!["installed", "completed", "cancelled"].includes(job.status)) moves.push({ to:"cancelled", label:"Cancel job", backward:false, destructive:true });
  return moves;
}

export function invoiceStatus(invoice, { today = new Date() } = {}) {
  if (!invoice) return status("none", "No invoice", "muted");
  if (invoice.status === "void") return status("void", "Void", "muted");
  if (invoice.status === "draft") return status("draft", "Draft", "draft");
  const total = Number(invoice.total_pence || 0), paid = Number(invoice.paid_pence || 0);
  const outstanding = invoice.outstanding_pence == null ? total - paid : Number(invoice.outstanding_pence);
  if (total > 0 && outstanding <= 0) return status("paid", "Paid", "good");
  const overdue = invoice.overdue ?? (invoice.due_date && invoice.due_date < isoDay(today));
  if (overdue) return status("overdue", paid > 0 ? "Overdue · part paid" : "Overdue", "bad");
  if (paid > 0) return status("partial", "Partially paid", "warn");
  return status("issued", "Issued · awaiting payment", "info");
}

const surveyCompleted = rel => rel.appointments.some(item => item.kind === "survey" && item.status === "completed");
const surveyBooked = rel => rel.appointments.some(item => item.kind === "survey" && ["scheduled", "confirmed"].includes(item.status));

// The enquiry's own stage. Quotation, job and invoice progress have their own statuses.
export function enquiryStage(lead, rel) {
  if (!lead) return status("none", "", "muted");
  if (lead.deleted_at) return status("deleted", "Deleted · can be restored", "muted");
  if (lead.status === "archived") return status("archived", "Archived", "muted");
  if (lead.status === "lost") return status("closed", "Closed · not proceeding", "muted");
  if (rel.job || rel.accepted || lead.status === "won") return status("won", "Won · became a job", "good");
  if (rel.sent) return status("quoted", "Quotation with customer", "info");
  if (rel.draft) return status("preparing", "Preparing quotation", "draft");
  const needsSurvey = (lead.assessment_required && !surveyCompleted(rel)) || ["date_requested", "confirmed"].includes(lead.status);
  if (needsSurvey) return status("survey", surveyBooked(rel) ? "Survey booked" : "Survey required", "warn");
  if (lead.status === "new") return status("new", "New", "new");
  return status("reviewing", "Reviewing", "info");
}

// The manual stage control offers only what a person decides; the rest follows the work.
export const MANUAL_STAGES = Object.freeze([
  { value:"new", label:"New" },
  { value:"reviewing", label:"Reviewing" },
  { value:"date_requested", label:"Survey required" },
  { value:"lost", label:"Closed · not proceeding" },
  { value:"archived", label:"Archived" }
]);

// ---- The one next step ------------------------------------------------------------
export function nextAction(lead, rel, { today = new Date() } = {}) {
  const stage = enquiryStage(lead, rel);
  if (["deleted", "archived", "closed"].includes(stage.key)) return { id:"reopen", label:"Reopen if the customer comes back", hint:"This enquiry is closed. Nothing needs doing.", primary:false };
  if (lead.status === "new") return { id:"review", label:"Review this enquiry", hint:"Read the requirements, then contact the customer, book a survey or prepare a quotation.", primary:true };
  const job = rel.job && rel.job.status !== "cancelled" ? rel.job : null;
  if (!rel.draft && !rel.sent && !rel.accepted) {
    if (lead.assessment_required && !surveyCompleted(rel)) {
      return surveyBooked(rel)
        ? { id:"complete-survey", label:"Complete the booked survey", hint:"Mark the survey done after the visit, then prepare the quotation.", primary:true }
        : { id:"book-survey", label:"Book the site survey", hint:"This enquiry needs a survey before it can be quoted.", primary:true };
    }
    const earlier = rel.quotes.find(item => !isDiscarded(item));
    return earlier
      ? { id:"create-quote", label:"Prepare a new quotation", hint:`${earlier.quote_number} was ${quoteStatus(earlier, { today }).label.toLowerCase()}. A new version starts from its lines.`, primary:true }
      : { id:"create-quote", label:"Prepare the quotation", hint:"Opens the quotation editor with the customer's requirements filled in.", primary:true };
  }
  if (rel.draft) return { id:"edit-quote", label:"Finish and send the quotation", hint:`Draft ${rel.draft.quote_number} is ready to edit, preview and send.`, primary:true };
  if (rel.sent && new Date(`${rel.sent.valid_until || "9999-12-31"}T23:59:59`) < today) return { id:"revise-quote", label:"Send an updated quotation", hint:`${rel.sent.quote_number} has passed its validity date.`, primary:true };
  if (rel.sent && rel.sent.revision_requested_at) return { id:"revise-quote", label:"Revise the quotation", hint:"The customer asked for changes. Create a revision, then send it.", primary:true };
  if (rel.sent) return { id:"await-customer", label:"Wait for the customer's decision", hint:"Send a reminder or record the customer's answer if they replied another way.", primary:false };
  if (rel.accepted && !job) return { id:"create-job", label:"Create the job", hint:"Turns the accepted quotation into a job at the agreed price.", primary:true };
  if (job) {
    if (job.status === "completed") {
      const unpaid = rel.invoices.some(item => item.status === "sent" && Number(item.outstanding_pence) > 0);
      return unpaid ? { id:"record-payment", label:"Record the payment", hint:"The job is complete but the invoice is not fully paid.", primary:true }
        : { id:"done", label:"Project complete", hint:"Archive the enquiry when you no longer need it on the board.", primary:false };
    }
    const installBooked = rel.appointments.some(item => item.kind === "installation" && ["scheduled", "confirmed"].includes(item.status));
    if (!installBooked && !["installed"].includes(job.status)) return { id:"book-installation", label:"Schedule the installation", hint:"Choose the date, time, team and location. It appears in the calendar.", primary:true };
    if (!rel.invoices.some(item => item.status !== "void")) return { id:"create-invoice", label:"Create the invoice", hint:"Amounts come from the accepted quotation.", primary:true };
    if (rel.invoices.some(item => item.status === "draft")) return { id:"issue-invoice", label:"Issue the invoice", hint:"Print or save the PDF, send it to the customer, then record it as issued.", primary:true };
    if (job.status === "installed") return { id:"advance-job", label:"Close the job as completed", hint:"Installation is done.", primary:true };
    return { id:"advance-job", label:"Update the job's progress", hint:"Move the job on as the work happens.", primary:true };
  }
  return { id:"none", label:"No action needed", hint:"", primary:false };
}

// ---- Project board ------------------------------------------------------------------
export const BOARD_COLUMNS = Object.freeze([
  { key:"survey", label:"Awaiting survey" },
  { key:"preparing", label:"Preparing quotation" },
  { key:"awaiting", label:"Awaiting customer" },
  { key:"accepted", label:"Accepted · awaiting scheduling" },
  { key:"progress", label:"In progress" },
  { key:"installation", label:"Installation scheduled" },
  { key:"completed", label:"Completed" }
]);

export function boardColumn(lead, rel) {
  const stage = enquiryStage(lead, rel);
  if (["deleted", "archived", "closed"].includes(stage.key)) return null;
  if (rel.job && rel.job.status !== "cancelled") {
    const js = jobStatus(rel.job, rel.appointments).key;
    return { completed:"completed", scheduled:"installation", progress:"progress", awaiting:"accepted" }[js] || "accepted";
  }
  if (rel.accepted) return "accepted";
  if (rel.sent) return "awaiting";
  if (stage.key === "survey") return "survey";
  if (stage.key === "new") return null; // New enquiries live in Enquiries until reviewed.
  return "preparing";
}

// ---- Dashboard -----------------------------------------------------------------------
export function dashboardQueues({ leads = [], data = {}, today = new Date() } = {}) {
  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const in14 = new Date(start.getTime() + 15 * DAY);
  const queues = { newEnquiries:[], toPrepare:[], revisions:[], awaitingResponse:[], surveys:[], inProgress:[], installations:[], outstanding:[], followUps:[] };
  for (const lead of leads) {
    if (lead.deleted_at) continue;
    const rel = relatedRecords(lead, data);
    const stage = enquiryStage(lead, rel);
    if (stage.key === "new") queues.newEnquiries.push({ lead, rel });
    if (["reviewing", "preparing"].includes(stage.key) || (stage.key === "survey" && surveyCompleted(rel))) queues.toPrepare.push({ lead, rel });
    if (rel.sent?.revision_requested_at) queues.revisions.push({ lead, rel, quote:rel.sent });
    else if (rel.sent) queues.awaitingResponse.push({ lead, rel, quote:rel.sent });
    if (rel.job && jobStatus(rel.job, rel.appointments).key === "progress") queues.inProgress.push({ lead, rel });
    for (const appointment of rel.appointments) {
      if (!["scheduled", "confirmed"].includes(appointment.status)) continue;
      const startsAt = new Date(appointment.starts_at);
      if (appointment.kind === "survey" && new Date(appointment.ends_at) >= start) queues.surveys.push({ lead, rel, appointment });
      if (appointment.kind === "installation" && new Date(appointment.ends_at) >= start && startsAt < in14) queues.installations.push({ lead, rel, appointment });
    }
    for (const invoice of rel.invoices) {
      if (invoice.status === "sent" && Number(invoice.outstanding_pence) > 0) queues.outstanding.push({ lead, rel, invoice });
    }
    for (const task of rel.followUps) {
      if (!task.completed_at && !task.cancelled_at && new Date(task.due_at) < new Date(start.getTime() + DAY)) queues.followUps.push({ lead, rel, task });
    }
  }
  queues.surveys.sort((a, b) => String(a.appointment.starts_at).localeCompare(String(b.appointment.starts_at)));
  queues.installations.sort((a, b) => String(a.appointment.starts_at).localeCompare(String(b.appointment.starts_at)));
  queues.outstanding.sort((a, b) => String(a.invoice.due_date).localeCompare(String(b.invoice.due_date)));
  queues.followUps.sort((a, b) => String(a.task.due_at).localeCompare(String(b.task.due_at)));
  return queues;
}

// ---- Search ------------------------------------------------------------------------
const norm = value => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function matchesLead(lead, query, rel = null) {
  const q = norm(query);
  if (!q) return true;
  const fields = [lead.customer_name, lead.reference, lead.email, lead.phone, lead.postcode, lead.message];
  if (rel) {
    for (const quote of rel.quotes) fields.push(quote.quote_number);
    for (const job of rel.jobs) fields.push(job.work_order_number, job.title);
    for (const invoice of rel.invoices) fields.push(invoice.invoice_number);
  }
  const haystack = norm(fields.filter(Boolean).join(" "));
  const compactQ = q.replace(/\s/g, "");
  return q.split(" ").every(term => haystack.includes(term)) || haystack.replace(/\s/g, "").includes(compactQ);
}

export const ENQUIRY_FILTERS = Object.freeze([
  { key:"open", label:"Open" },
  { key:"new", label:"New" },
  { key:"survey", label:"Survey" },
  { key:"quoting", label:"Quoting" },
  { key:"won", label:"Won" },
  { key:"closed", label:"Closed" },
  { key:"deleted", label:"Deleted" },
  { key:"all", label:"All" }
]);

export function filterEnquiries(leads, data, { query = "", filter = "open" } = {}) {
  return leads.map(lead => ({ lead, rel:relatedRecords(lead, data) }))
    .filter(({ lead, rel }) => {
      const stage = enquiryStage(lead, rel).key;
      if (filter === "deleted") { if (stage !== "deleted") return false; }
      else if (stage === "deleted") return false;
      else if (filter === "open" && ["archived", "closed", "won"].includes(stage)) return false;
      else if (filter === "new" && stage !== "new") return false;
      else if (filter === "survey" && stage !== "survey") return false;
      else if (filter === "quoting" && !["reviewing", "preparing", "quoted"].includes(stage)) return false;
      else if (filter === "won" && stage !== "won") return false;
      else if (filter === "closed" && !["archived", "closed"].includes(stage)) return false;
      return matchesLead(lead, query, rel);
    })
    .sort((a, b) => String(b.lead.created_at).localeCompare(String(a.lead.created_at)));
}

// Finance & Documents: one searchable list of every quotation, invoice and payment.
export function documentRows({ leads = [], data = {}, today = new Date() } = {}) {
  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const jobById = new Map((data.workOrders || []).map(job => [job.id, job]));
  const rows = [];
  for (const quote of data.quotes || []) {
    if (isDiscarded(quote)) continue;
    const lead = leadById.get(quote.request_id);
    rows.push({ kind:"quote", id:quote.id, number:quote.quote_number, version:quote.version, lead, date:quote.sent_at || quote.created_at, amount:Number(quote.total_pence || 0), status:quoteStatus(quote, { today }) });
  }
  for (const invoice of data.invoices || []) {
    const job = jobById.get(invoice.work_order_id);
    const lead = job ? leadById.get(job.request_id) : null;
    rows.push({ kind:"invoice", id:invoice.id, number:invoice.invoice_number, lead, job, date:invoice.issue_date, due:invoice.due_date, amount:Number(invoice.total_pence || 0), outstanding:Number(invoice.outstanding_pence || 0), status:invoiceStatus(invoice, { today }) });
  }
  for (const payment of data.payments || []) {
    const invoice = (data.invoices || []).find(item => item.id === payment.invoice_id);
    const job = invoice ? jobById.get(invoice.work_order_id) : null;
    const lead = job ? leadById.get(job.request_id) : null;
    rows.push({ kind:"payment", id:payment.id, number:invoice?.invoice_number || "", lead, date:payment.received_at, amount:Number(payment.amount_pence || 0), method:payment.method, status:status("received", "Received", "good") });
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function filterDocuments(rows, { query = "", kind = "all" } = {}) {
  const q = norm(query);
  return rows.filter(row => (kind === "all" || row.kind === kind) && (!q || norm([row.number, row.lead?.customer_name, row.lead?.reference, row.job?.work_order_number].join(" ")).includes(q)));
}

// ---- Calendar ------------------------------------------------------------------------
// One calendar: appointments, follow-ups, job dates and blocked time, each linked to its customer.
export function calendarEvents({ leads = [], data = {}, blocks = [], from, to } = {}) {
  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const inRange = (start, end) => new Date(start) < to && new Date(end || start) >= from;
  const events = [];
  for (const appointment of data.appointments || []) {
    if (appointment.status === "cancelled" || !inRange(appointment.starts_at, appointment.ends_at)) continue;
    events.push({ type:appointment.kind, id:appointment.id, start:appointment.starts_at, end:appointment.ends_at, lead:leadById.get(appointment.request_id) || null, requestId:appointment.request_id, title:appointment.kind === "survey" ? "Site survey" : "Installation", done:appointment.status === "completed", record:appointment });
  }
  for (const task of data.followUps || []) {
    if (task.completed_at || task.cancelled_at || !inRange(task.due_at, task.due_at)) continue;
    events.push({ type:"follow_up", id:task.id, start:task.due_at, end:task.due_at, lead:leadById.get(task.request_id) || null, requestId:task.request_id, title:task.title, record:task });
  }
  for (const job of data.workOrders || []) {
    if (job.status === "cancelled") continue;
    for (const [field, title] of [["planned_start", "Build starts"], ["target_completion", "Target completion"]]) {
      if (!job[field]) continue;
      const day = `${job[field]}T09:00:00`;
      if (!inRange(day, day)) continue;
      events.push({ type:"milestone", id:`${job.id}:${field}`, start:day, end:day, allDay:true, lead:leadById.get(job.request_id) || null, requestId:job.request_id, title:`${title} · ${job.work_order_number}`, record:job });
    }
  }
  for (const block of blocks) {
    if (!inRange(block.starts_at, block.ends_at)) continue;
    events.push({ type:block.kind === "available" ? "available" : "blocked", id:block.id, start:block.starts_at, end:block.ends_at, lead:null, requestId:null, title:block.title, record:block });
  }
  return events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

export function monthGrid(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length:42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
}

export const sameDay = (a, b) => isoDay(a) === isoDay(b);
export { isoDay };
