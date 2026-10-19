// Pure workflow logic for the enquiry workspace. No DOM, no network.
// Statuses map onto the EXISTING database enums; nothing here needs a migration.
// "Opened" is the existing request status "reviewing".

export const STATUS_META = Object.freeze({
  new: { label: "New", tone: "new" },
  opened: { label: "Opened", tone: "opened" },
  quoted: { label: "Quoted", tone: "quoted" },
  accepted: { label: "Accepted", tone: "accepted" },
  in_progress: { label: "In progress", tone: "progress" },
  completed: { label: "Completed", tone: "completed" },
  archived: { label: "Archived", tone: "archived" },
  lost: { label: "Lost", tone: "archived" }
});

export const WORKFLOW_STEPS = Object.freeze([
  { id: "enquiry", label: "New enquiry" },
  { id: "open", label: "Open" },
  { id: "prepare", label: "Prepare quotation" },
  { id: "send", label: "Send quotation" },
  { id: "accept", label: "Customer accepts" },
  { id: "schedule", label: "Schedule survey / installation" },
  { id: "job", label: "Job in progress" },
  { id: "invoice", label: "Invoice" },
  { id: "payment", label: "Payment" },
  { id: "complete", label: "Completed" }
]);

// Mirrors the database transition rules (enforce_workflow_status_transition): completion is only allowed from "installed".
const JOB_NEXT = Object.freeze({
  accepted: { status: "in_progress", label: "Start the job" },
  ready_to_build: { status: "in_progress", label: "Start the job" },
  in_progress: { status: "quality_check", label: "Move to quality check" },
  quality_check: { status: "ready_for_install", label: "Mark ready for install" },
  ready_for_install: { status: "installation_scheduled", label: "Mark installation scheduled" },
  installation_scheduled: { status: "installed", label: "Mark installed" },
  installed: { status: "completed", label: "Mark job completed" }
});
export function nextJobStep(status) { return JOB_NEXT[status] || null; }

const STARTED_JOB = ["in_progress", "quality_check", "ready_for_install", "installation_scheduled", "installed", "completed"];

export function relatedRecords(lead, { quotes = [], workOrders = [], appointments = [], invoices = [] } = {}) {
  const id = lead?.id;
  const requestQuotes = quotes.filter(item => item.request_id === id).sort((a, b) => Number(b.version) - Number(a.version));
  const liveQuote = requestQuotes.find(item => item.status !== "superseded" && item.status !== "rejected" && item.status !== "expired") || null;
  const acceptedQuote = requestQuotes.find(item => item.status === "accepted") || null;
  const quote = acceptedQuote || liveQuote || requestQuotes[0] || null;
  const requestJobs = workOrders.filter(item => item.request_id === id && item.status !== "cancelled");
  const job = requestJobs[0] || null;
  const jobIds = new Set(requestJobs.map(item => item.id));
  return {
    quote,
    quotes: requestQuotes,
    job,
    jobs: requestJobs,
    appointments: appointments.filter(item => item.request_id === id),
    invoices: invoices.filter(item => jobIds.has(item.work_order_id) && item.status !== "void")
  };
}

export function isUnopened(lead) {
  return lead?.status === "new";
}

// Opening only ever moves "new" to "reviewing". Every other status is left alone.
export function statusAfterOpen(lead) {
  return isUnopened(lead) ? "reviewing" : null;
}

export function enquiryState(lead, rel) {
  if (lead?.status === "archived") return "archived";
  if (lead?.status === "lost") return "lost";
  if (rel.job?.status === "completed") return "completed";
  if (rel.job) return "in_progress";
  if (rel.quote?.status === "accepted" || lead?.status === "won") return "accepted";
  if (rel.quote || lead?.status === "quoted") return "quoted";
  if (lead?.status && lead.status !== "new") return "opened";
  return "new";
}

export function statusBadge(lead, rel) {
  const key = enquiryState(lead, rel);
  return { key, ...STATUS_META[key] };
}

const activeAppointments = rel => rel.appointments.filter(item => item.status !== "cancelled");
const sentInvoices = rel => rel.invoices.filter(item => item.status === "sent");

export function workflowSteps(lead, rel) {
  const state = enquiryState(lead, rel);
  const quoteSent = rel.quotes.some(item => item.sent_at || ["sent", "accepted"].includes(item.status));
  const accepted = rel.quote?.status === "accepted" || lead?.status === "won";
  const jobStarted = rel.job ? STARTED_JOB.includes(rel.job.status) : false;
  const invoiceSent = sentInvoices(rel).length > 0;
  const paid = invoiceSent && sentInvoices(rel).every(item => Number(item.outstanding_pence) === 0 && Number(item.total_pence) > 0);
  const done = {
    enquiry: true,
    open: lead?.status !== "new",
    prepare: rel.quotes.length > 0,
    send: quoteSent,
    accept: accepted,
    schedule: activeAppointments(rel).length > 0,
    job: jobStarted,
    invoice: invoiceSent,
    payment: paid,
    complete: rel.job?.status === "completed"
  };
  let currentFound = false;
  return WORKFLOW_STEPS.map(step => {
    let stepState = done[step.id] ? "done" : "todo";
    if (!done[step.id] && !currentFound && !["archived", "lost"].includes(state)) { stepState = "current"; currentFound = true; }
    return { ...step, state: stepState };
  });
}

// One recommended next action. The UI shows it as the primary button; every other tool stays available.
export function recommendedAction(lead, rel, { quoteAllowed = true } = {}) {
  const state = enquiryState(lead, rel);
  if (state === "archived" || state === "lost") return { id: "none", label: "No action needed", hint: "This enquiry is closed. Change its status to reopen it.", primary: false };
  if (lead?.status === "new") return { id: "open", label: "Open this enquiry", hint: "Opening marks it as being handled for everyone on the team.", primary: true };
  if (!rel.quote && !quoteAllowed) return { id: "book-survey", label: "Book the site survey", hint: "A site assessment is required before a formal quotation.", primary: true };
  if (!rel.quote) return { id: "create-quote", label: "Create quotation", hint: "Opens the quotation form with this enquiry's details already filled in.", primary: true };
  if (rel.quote.status === "draft") return { id: "send-quote", label: "Send quotation", hint: "Create the secure link and email the quotation to the customer.", primary: true };
  if (rel.quote.status === "sent") return { id: "accept-quote", label: "Record customer acceptance", hint: "Use this once the customer has agreed. You can also record a rejection.", primary: true };
  if (rel.quote.status === "accepted" && !rel.job) return { id: "create-job", label: "Create build job", hint: "Turns the accepted quotation into a job at the agreed price.", primary: true };
  if (rel.job && rel.job.status !== "completed") {
    if (!activeAppointments(rel).length) return { id: "schedule", label: "Schedule survey or installation", hint: "Books a real calendar slot. No customer message is sent.", primary: true };
    if (!STARTED_JOB.includes(rel.job.status)) return { id: "advance-job", label: "Start the job", hint: "Moves the job to In progress.", primary: true };
    const drafts = rel.invoices.filter(item => item.status === "draft");
    const sent = sentInvoices(rel);
    if (!rel.invoices.length) return { id: "create-invoice", label: "Create invoice draft", hint: "Creates a draft only. Nothing is issued until you record it as sent.", primary: true };
    if (drafts.length) return { id: "send-invoice", label: "Record invoice as sent", hint: "Issue the invoice yourself, then record it here. The app never emails customers.", primary: true };
    if (sent.some(item => Number(item.outstanding_pence) > 0)) return { id: "record-payment", label: "Record a payment", hint: "Records money you have actually received. No card is charged.", primary: true };
    const step = nextJobStep(rel.job.status);
    return { id: "advance-job", label: step.label, hint: "All invoices are paid. Move the job on towards completion.", primary: true };
  }
  if (rel.job?.status === "completed") return { id: "none", label: "Project complete", hint: "Everything is finished. Archive the enquiry when you no longer need it on the board.", primary: false };
  return { id: "none", label: "No action needed", hint: "", primary: false };
}

const FINISH = { oak: "European oak", smoked: "Smoked oak", walnut: "American walnut", ash: "Pale ash", charcoal: "Charcoal lacquer", sage: "Sage green lacquer", bone: "Bone matt lacquer", microcement: "Polished microcement", custom: "Custom lacquer" };
const HANDLE = { push: "Handleless / push", edge: "Edge pull", brass: "Knurled brass", leather: "Leather tab" };
const FIRE = { none: "No fire", lin1: "Linear fire 1.0 kW", lin2: "Linear fire 2.0 kW", stove: "Inset stove" };
const LED = { none: "No lighting", perim: "Perimeter reveal", shelf: "Shelf wash", plinth: "Floating plinth", halo: "Halo behind TV", cove: "Cove up-light", spots: "Downlights", accent: "RGB accent" };
const SIDE = { none: "None", shelves: "Open shelves", cabinets: "Cabinets", drawers: "Drawer bank", glass: "Glazed display", mixed: "Cabinet + shelves" };
const FRONT = { flat: "Flat / slab", fluted: "Fluted", shaker: "Shaker frame", vgroove: "V-groove" };
const gbp = value => `£${Math.round(Number(value)).toLocaleString("en-GB")}`;

// Readable rows from the stored configurator state. Unknown or missing values are skipped, never invented.
export function specRows(spec) {
  const s = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
  const rows = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== "") rows.push([label, String(value)]); };
  const wall = s.customDims ? s.wallCustom : s.wall;
  add("Wall width", wall ? `${wall} mm` : "");
  const ceil = s.customDims ? s.ceilCustom : s.ceil;
  add("Ceiling height", ceil ? `${ceil} mm` : "");
  add("TV size", s.tv ? `${s.tv}″` : "");
  add("Finish", FINISH[s.finish] || s.finish);
  add("Fronts", FRONT[s.front] || s.front);
  add("Handles", HANDLE[s.handle] || s.handle);
  add("Left side", SIDE[s.left]);
  add("Right side", SIDE[s.right]);
  add("Fire", FIRE[s.fireType]);
  add("Lighting", LED[s.ledType]);
  if (s.bridge) add("Bridging cabinets", "Yes");
  if (s.avcup) add("AV / router cupboard", "Yes");
  if (s.shelf) add("Floating media shelf", "Yes");
  if (s.budgetMode && Number(s.budget) > 0) add("Customer budget", gbp(s.budget));
  return rows;
}

export function budgetNote(lead) {
  const spec = lead?.project_spec || {};
  if (spec.budgetMode && Number(spec.budget) > 0) return `Customer budget ${gbp(spec.budget)}`;
  if (lead?.guide_low || lead?.guide_high) return `No budget given. Website guide ${gbp(lead.guide_low)} to ${gbp(lead.guide_high)}`;
  return "No budget given";
}

// Values to pre-fill the quotation form. Pence-safe: whole pounds only, from the website guide midpoint.
export function quotePrefill(lead) {
  const rows = specRows(lead?.project_spec);
  const scopeLines = rows.filter(([label]) => label !== "Customer budget").map(([label, value]) => `${label}: ${value}`);
  const scope = [`Bespoke media wall for ${lead?.customer_name || "customer"} (${lead?.reference || ""}), ${lead?.postcode || ""}.`, ...scopeLines].join("\n").trim();
  const low = Number(lead?.guide_low), high = Number(lead?.guide_high);
  const suggested = Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low ? Math.round((low + high) / 2) : null;
  return { scope, suggestedSubtotal: suggested };
}
