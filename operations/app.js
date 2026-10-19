// Form & Frame Owner Desk. One controller: routing, loading, and every action.
// Business records stay behind Supabase Auth + row-level security; this file only
// uses the public anon key. Nothing here emails a customer or takes a payment.
import { checkStaffAccess, staffAccessMessage } from "./staff-access.mjs";
import { loadBusinessRows } from "./business-records.mjs";
import { requirePersistedRow } from "./mutation-result.mjs";
import { taxRateForAmount } from "./workflow.mjs";
import { calculateQuote, parsePounds, penceToInput, formatPence } from "./desk-money.mjs";
import { BOARD_COLUMNS, ENQUIRY_FILTERS, boardColumn, calendarEvents, dashboardQueues, documentRows, enquiryStage, filterDocuments, filterEnquiries, isDiscarded, isoDay, relatedRecords } from "./desk-model.mjs";
import { NAV, navIcon, esc, dashboardHtml, enquiriesHtml, jobsHtml, calendarHtml, financeHtml, settingsHtml, workspaceHtml, quoteEditorHtml, quoteLineHtml, quoteTotalsHtml, appointmentFormHtml, customerFormHtml, sendQuoteHtml, confirmHtml, invoiceFormHtml, paymentFormHtml, followUpFormHtml, jobFormHtml, catalogueFormHtml, blockFormHtml, decisionFormHtml } from "./desk-views.mjs";
import { quotePrefill } from "./enquiry-workspace.mjs";
import { quotationEmail, renderQuotationDocument } from "./quote-document.mjs";
import { invoiceSettingsReady, renderInvoiceDocument } from "./invoice-document.mjs";
import { clearPaymentRecordingKey, getPaymentRecordingKey, paymentMatchesIntent } from "./payment-idempotency.mjs";
import { isIOSDevice, isInstalledPWA, pushSetupMessage } from "./push-support.mjs";
import { CATEGORIES, visibleNotifications, unreadCount, unreadForRequest, normalisePreferences, deviceState } from "./notification-centre.mjs";
import { bellLabel, listHtml, preferencesHtml, deviceHtml, iconDiagnosticsHtml } from "./notification-view.mjs";
import { enquiryTargetFromSearch, operationsViewFromSearch } from "./push-target.mjs";

const $ = id => document.getElementById(id);
const cfg = window.FF_OPERATIONS_CONFIG;
const BUILT_IN_ITEMS = ["Design & planning|item", "Site survey|visit", "MDF|sheet", "Timber|metre", "Plasterboard|sheet", "LED strips|metre", "Electrical work|item", "TV mounting|item", "Fireplace installation|item", "Painting & decorating|item", "Labour|day", "Delivery|item"]
  .map(entry => { const [name, unit] = entry.split("|"); return { id:"", name, unit, category:"", default_unit_price_pence:null, active:true }; });
const SECTION_LABEL = { dashboard:"Dashboard", enquiries:"Enquiries", jobs:"Jobs", calendar:"Calendar", finance:"Finance & Documents", settings:"Settings" };

let db = null, demo = false, userId = null, currentStaffRole = null;
let leads = [], data = emptyData(), blocks = [], catalogue = [], settings = null, profiles = [];
let schema = { quoteLines:false, catalogue:false, softDelete:false, address:false, defaultTerms:false, links:false };
let loaded = false, liveRefreshTimer = null, liveChannel = null, loadVersion = 0;
const ui = { route:"dashboard", param:null, lastSection:"dashboard", enquiryFilter:"open", enquiryQuery:"", financeKind:"all", financeQuery:"", jobsView:"board", calMode:window.matchMedia("(max-width: 720px)").matches ? "agenda" : "month", calAnchor:new Date() };
const workspaceCache = new Map(); // lead id → { activity, photos }

function emptyData() { return { quotes:[], workOrders:[], appointments:[], invoices:[], payments:[], followUps:[], links:[] }; }

// ---- Feedback -------------------------------------------------------------------
let toastTimer = null;
function toast(message, kind = "success") {
  const node = $("toast");
  node.textContent = message; node.dataset.kind = kind; node.hidden = !message;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => { node.hidden = true; }, kind === "error" ? 9000 : 4500);
}

// Database rule messages are written for people; everything else gets a safe generic message.
function friendlyError(error) {
  const message = String(error?.message || "");
  if (/exclusion constraint|overlaps/i.test(message)) return message.includes("blocked") ? "That time overlaps blocked time off. Choose another time." : "That time overlaps another booking. Choose another time.";
  if (["23514", "P0001", "23505", "23P01"].includes(error?.code) && message && message.length < 200 && !/violates check constraint/.test(message)) return message;
  if (/Not authorised|permission|row-level/i.test(message)) return "Your account is not allowed to make this change.";
  return "We couldn't save this. Check your connection and try again; nothing was changed.";
}

async function mutate(action, success, { persisted = true } = {}) {
  try {
    const result = await action();
    if (result?.error) throw result.error;
    if (persisted) requirePersistedRow(result);
    await loadAll();
    render();
    if (success) toast(success);
    return { ok:true, result };
  } catch (error) {
    console.error("Owner Desk change failed.", error);
    return { ok:false, message:friendlyError(error) };
  }
}

// ---- Loading ------------------------------------------------------------------------
async function detectSchema() {
  const probe = async (table, columns) => { try { const { error } = await db.from(table).select(columns).limit(1); return !error; } catch { return false; } };
  const [quoteLines, catalogueReady, softDelete, address, defaultTerms, links] = await Promise.all([
    probe("quotes", "id,line_items,discount_pence,terms"), probe("quote_catalogue_items", "id"), probe("consultation_requests", "id,deleted_at"),
    probe("consultation_requests", "id,address"), probe("business_settings", "singleton,default_quote_terms"), probe("quote_response_links", "id,viewed_at,decision")
  ]);
  schema = { quoteLines, catalogue:catalogueReady, softDelete, address, defaultTerms, links };
}

async function loadAll() {
  const version = ++loadVersion;
  const since = new Date(); since.setDate(since.getDate() - 180);
  const [leadRows, quotes, jobs, balances, invoiceRows, appointments, followUps, payments, blockRows, profileRows, settingsRow, catalogueRows, linkRows] = await Promise.all([
    loadBusinessRows(db, "consultation_requests", "created_at"),
    loadBusinessRows(db, "quotes", "created_at"),
    loadBusinessRows(db, "work_orders", "created_at"),
    loadBusinessRows(db, "invoice_balances", "due_date", true),
    loadBusinessRows(db, "invoices", "created_at"),
    db.from("appointments").select("*").gte("ends_at", since.toISOString()).order("starts_at").limit(2000),
    db.from("follow_up_tasks").select("*").is("completed_at", null).is("cancelled_at", null).order("due_at").limit(500),
    db.from("invoice_payments").select("*").order("received_at", { ascending:false }).limit(2000),
    db.from("availability_blocks").select("*").gte("ends_at", since.toISOString()).order("starts_at").limit(500),
    db.from("profiles").select("id, full_name").order("full_name").limit(100),
    db.from("business_settings").select("*").eq("singleton", true).maybeSingle(),
    schema.catalogue ? db.from("quote_catalogue_items").select("*").order("sort_order").limit(500) : Promise.resolve({ data:[] }),
    schema.links ? db.from("quote_response_links").select("id, quote_id, expires_at, used_at, viewed_at, decision, created_at").order("created_at", { ascending:false }).limit(2000) : Promise.resolve({ data:[] })
  ]);
  for (const result of [appointments, followUps, payments, blockRows]) if (result.error) throw result.error;
  if (version !== loadVersion) return;
  const balanceById = new Map((balances.data || []).map(row => [row.id, row]));
  leads = leadRows.data || [];
  data = {
    quotes:quotes.data || [], workOrders:jobs.data || [], appointments:appointments.data || [],
    invoices:(invoiceRows.data || []).map(row => ({ ...row, ...(balanceById.get(row.id) || { paid_pence:0, outstanding_pence:0, overdue:false }), status:row.status })),
    payments:payments.data || [], followUps:followUps.data || [], links:linkRows.data || []
  };
  blocks = blockRows.data || [];
  profiles = profileRows.error ? [] : profileRows.data || [];
  settings = settingsRow.error ? null : settingsRow.data || null;
  catalogue = catalogueRows.error ? [] : catalogueRows.data || [];
  loaded = true;
}

const relFor = lead => relatedRecords(lead, data);
const leadById = id => leads.find(item => item.id === id) || null;
const quoteById = id => data.quotes.find(item => item.id === id) || null;
const invoiceById = id => data.invoices.find(item => item.id === id) || null;

// ---- Routing ---------------------------------------------------------------------------
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = hash.split("?");
  const [route, param] = path.split("/");
  const params = new URLSearchParams(query);
  if (route === "customer" && param) return { route:"customer", param, params };
  if (route === "back") return { route:"back", params };
  return { route:SECTION_LABEL[route] ? route : "dashboard", param:null, params };
}

function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

function onRoute() {
  const next = parseRoute();
  if (next.route === "back") { go(`#/${ui.lastSection}`); return; }
  if (next.route !== "customer") ui.lastSection = next.route;
  if (next.route === "calendar" && next.params.get("date")) { ui.calAnchor = new Date(`${next.params.get("date")}T12:00:00`); if (ui.calMode === "agenda") ui.calMode = "week"; }
  ui.route = next.route; ui.param = next.param;
  render();
  $("page").focus({ preventScroll:true });
  window.scrollTo({ top:0 });
  if (next.route === "customer" && db) { void loadWorkspaceExtras(next.param); void markRequestNotificationsRead(next.param); }
}

// ---- Rendering --------------------------------------------------------------------------
function renderNav() {
  const active = ui.route === "customer" ? ui.lastSection : ui.route;
  const counts = loaded ? { enquiries:leads.filter(lead => !lead.deleted_at && enquiryStage(lead, relFor(lead)).key === "new").length } : {};
  const item = entry => `<a href="#/${entry.route}" class="${active === entry.route ? "on" : ""}"${active === entry.route ? ' aria-current="page"' : ""}>${navIcon(entry.icon)}<span>${esc(entry.label)}</span>${counts[entry.route] ? `<b class="nav-count" aria-label="${counts[entry.route]} new">${counts[entry.route]}</b>` : ""}</a>`;
  $("sidenav").innerHTML = `${NAV.map(item).join("")}<a href="#/settings" class="settings-link${active === "settings" ? " on" : ""}">${navIcon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")}<span>Settings</span></a><a href="../index.html" class="site-link" target="_blank" rel="noopener">${navIcon("M14 4h6v6M20 4l-9 9M18 14v6H4V6h6")}<span>Public website ↗</span></a>`;
  $("tabbar").innerHTML = NAV.map(item).join("");
}

function renderPage() {
  const page = $("page");
  if (!loaded) { page.innerHTML = `<div class="loading" role="status">Loading your records…</div>`; return; }
  const today = new Date();
  if (ui.route === "customer") {
    const lead = leadById(ui.param);
    if (!lead) { page.innerHTML = `<div class="card"><h1>Customer not found</h1><p>This enquiry may have been removed or you may not have access to it.</p><a class="btn" href="#/enquiries">Back to enquiries</a></div>`; return; }
    const rel = relFor(lead);
    const extras = workspaceCache.get(lead.id) || { activity:[], photos:[] };
    page.innerHTML = workspaceHtml({ lead, rel, today, schema, profiles, photos:extras.photos, activity:activityFor(lead, rel, extras.activity), settingsReady:invoiceSettingsReady(settings), backLabel:SECTION_LABEL[ui.lastSection] || "Dashboard", demo:false });
    return;
  }
  if (ui.route === "dashboard") {
    const queues = dashboardQueues({ leads, data, today });
    page.innerHTML = dashboardHtml({ queues, totals:moneyTotals(today), notifications:ncItems(), greeting:greeting(today), today, demo });
  } else if (ui.route === "enquiries") {
    const counts = Object.fromEntries(ENQUIRY_FILTERS.map(item => [item.key, filterEnquiries(leads, data, { filter:item.key }).length]));
    page.innerHTML = enquiriesHtml({ rows:filterEnquiries(leads, data, { query:ui.enquiryQuery, filter:ui.enquiryFilter }), filter:ui.enquiryFilter, query:ui.enquiryQuery, counts, today });
  } else if (ui.route === "jobs") {
    const columns = Object.fromEntries(BOARD_COLUMNS.map(column => [column.key, []]));
    for (const lead of leads) { if (lead.deleted_at) continue; const rel = relFor(lead); const key = boardColumn(lead, rel); if (key) columns[key].push({ lead, rel }); }
    columns.completed = columns.completed.slice(0, 12);
    page.innerHTML = jobsHtml({ columns, view:ui.jobsView });
  } else if (ui.route === "calendar") {
    const { from, to } = calendarRange();
    page.innerHTML = calendarHtml({ events:calendarEvents({ leads, data, blocks, from, to }), mode:ui.calMode, anchor:ui.calAnchor, today });
  } else if (ui.route === "finance") {
    page.innerHTML = financeHtml({ rows:filterDocuments(documentRows({ leads, data, today }), { query:ui.financeQuery, kind:ui.financeKind }), kind:ui.financeKind, query:ui.financeQuery, totals:moneyTotals(today) });
  } else if (ui.route === "settings") {
    page.innerHTML = settingsHtml({ settings, catalogue, role:currentStaffRole, schema, profile:profiles.find(item => item.id === userId) });
  }
}

function render() {
  if ($("hub").hidden) return;
  // Keep the cursor in a search box while results update around it.
  const focused = document.activeElement?.id;
  const caret = focused && document.activeElement.selectionStart;
  renderNav();
  renderPage();
  if (focused && $(focused) && $(focused).tagName === "INPUT" && document.activeElement !== $(focused)) {
    $(focused).focus();
    try { $(focused).setSelectionRange(caret, caret); } catch { /* not a text field */ }
  }
  renderNotifications();
}

const greeting = date => date.getHours() < 12 ? "Good morning" : date.getHours() < 18 ? "Good afternoon" : "Good evening";

function moneyTotals(today) {
  const sent = data.invoices.filter(item => item.status === "sent");
  const month = isoDay(today).slice(0, 7);
  const awaiting = data.quotes.filter(item => item.status === "sent" && !item.revision_requested_at);
  return {
    invoiced:sent.reduce((sum, item) => sum + Number(item.total_pence || 0), 0),
    received:sent.reduce((sum, item) => sum + Number(item.paid_pence || 0), 0),
    outstanding:sent.reduce((sum, item) => sum + Number(item.outstanding_pence || 0), 0),
    overdue:sent.filter(item => item.overdue).reduce((sum, item) => sum + Number(item.outstanding_pence || 0), 0),
    receivedMonth:data.payments.filter(item => String(item.received_at).slice(0, 7) === month).reduce((sum, item) => sum + Number(item.amount_pence || 0), 0),
    awaitingValue:awaiting.reduce((sum, item) => sum + Number(item.total_pence || 0), 0)
  };
}

function calendarRange() {
  const a = ui.calAnchor;
  if (ui.calMode === "month") { const from = new Date(a.getFullYear(), a.getMonth(), 1); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); const to = new Date(from); to.setDate(to.getDate() + 42); return { from, to }; }
  if (ui.calMode === "week") { const from = new Date(a.getFullYear(), a.getMonth(), a.getDate()); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); const to = new Date(from); to.setDate(to.getDate() + 7); return { from, to }; }
  const from = new Date(a.getFullYear(), a.getMonth(), a.getDate()); const to = new Date(from); to.setDate(to.getDate() + 42); return { from, to };
}

// ---- Workspace activity -------------------------------------------------------------------
const personName = id => profiles.find(item => item.id === id)?.full_name || "a team member";
function activityFor(lead, rel, recorded) {
  const items = [{ at:lead.created_at, text:`Enquiry received${lead.source ? ` from the ${lead.source === "manual" ? "team (entered manually)" : lead.source}` : ""}.` }];
  const quoteName = id => { const quote = rel.quotes.find(item => item.id === id); return quote ? `${quote.quote_number} (v${quote.version})` : "Quotation"; };
  for (const entry of recorded) {
    const who = entry.actor_id ? ` by ${personName(entry.actor_id)}` : "";
    let text = null;
    if (entry.entity_type === "quote") {
      if (entry.event_type === "record_created") text = `Quotation ${quoteName(entry.entity_id)} created${who}.`;
      else if (entry.event_type === "status_changed") text = {
        sent:`Quotation ${quoteName(entry.entity_id)} sent to the customer${who}.`,
        accepted:entry.actor_id ? `Customer acceptance of ${quoteName(entry.entity_id)} recorded${who}.` : `Customer accepted ${quoteName(entry.entity_id)} using their secure link.`,
        rejected:entry.actor_id ? `Customer decline of ${quoteName(entry.entity_id)} recorded${who}.` : `Customer declined ${quoteName(entry.entity_id)} using their secure link.`,
        superseded:`Quotation ${quoteName(entry.entity_id)} replaced by a newer version.`,
        expired:`Quotation ${quoteName(entry.entity_id)} expired.`
      }[entry.to_status] || null;
      else text = `Quotation ${quoteName(entry.entity_id)} edited${who}.`;
    } else if (entry.entity_type === "appointment") {
      const appointment = rel.appointments.find(item => item.id === entry.entity_id);
      const label = appointment?.kind === "installation" ? "Installation" : "Survey";
      text = entry.event_type === "record_created" ? `${label} booked${who}.` : entry.event_type === "status_changed" ? `${label} ${entry.to_status === "completed" ? "completed" : entry.to_status}${who}.` : `${label} rescheduled or updated${who}.`;
    } else if (entry.entity_type === "work_order") {
      text = entry.event_type === "record_created" ? `Job created${who}.` : entry.event_type === "status_changed" ? `Job moved to ${String(entry.to_status).replaceAll("_", " ")}${who}.` : `Job details updated${who}.`;
    } else if (entry.entity_type === "invoice") {
      text = entry.event_type === "record_created" ? `Invoice draft created${who}.` : entry.to_status === "sent" ? `Invoice issued${who}.` : entry.to_status === "void" ? `Invoice voided${who}.` : `Invoice updated${who}.`;
    } else if (entry.entity_type === "payment") text = `Payment recorded${who}.`;
    else if (entry.entity_type === "follow_up") text = entry.event_type === "record_created" ? `Follow-up scheduled${who}.` : `Follow-up updated${who}.`;
    else if (entry.entity_type === "request") text = entry.event_type === "status_changed" ? `Enquiry stage changed${who}.` : `Customer details updated${who}.`;
    if (text) items.push({ at:entry.created_at, text });
  }
  for (const quote of rel.quotes) if (quote.revision_requested_at) items.push({ at:quote.revision_requested_at, text:`Customer asked for changes to ${quote.quote_number}.` });
  for (const link of rel.links) if (link.viewed_at) items.push({ at:link.viewed_at, text:"Customer opened their quotation link." });
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

async function loadWorkspaceExtras(leadId) {
  const lead = leadById(leadId);
  if (!lead) return;
  const rel = relFor(lead);
  const ids = [lead.id, ...rel.quotes.map(item => item.id), ...rel.jobs.map(item => item.id), ...rel.appointments.map(item => item.id), ...rel.invoices.map(item => item.id), ...rel.followUps.map(item => item.id)];
  try {
    const [activity, uploads] = await Promise.all([
      db.from("workflow_activity").select("*").in("entity_id", ids).order("created_at", { ascending:false }).limit(60),
      db.from("request_uploads").select("*").eq("request_id", lead.id).order("created_at", { ascending:false }).limit(12)
    ]);
    const photos = [];
    for (const file of uploads.data || []) {
      if (!/^image\//.test(file.mime_type)) { photos.push({ name:file.file_name, url:null }); continue; }
      const signed = await db.storage.from("project-uploads").createSignedUrl(file.storage_path, 600);
      photos.push({ name:file.file_name, url:signed.data?.signedUrl || null });
    }
    workspaceCache.set(lead.id, { activity:activity.error ? [] : activity.data || [], photos });
    if (ui.route === "customer" && ui.param === lead.id && !$("dialog").open) render();
  } catch (error) { console.error("Enquiry history could not be loaded.", error); }
}

// ---- Dialogs ------------------------------------------------------------------------------
function openDialog(html, { wide = false } = {}) {
  const dialog = $("dialog");
  $("dialogBody").innerHTML = html;
  dialog.classList.toggle("wide", wide);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("input:not([type=hidden]):not([readonly]),select,textarea")?.focus();
}
function closeDialog() { if ($("dialog").open) $("dialog").close(); }
function formError(form, message) { const node = form.querySelector(".form-errors"); if (node) { node.textContent = message; node.hidden = !message; } else toast(message, "error"); }

function previewDocument(html, title) {
  $("previewTitle").textContent = title;
  // The preview bar already has a print button; hide the document's own one.
  $("previewFrame").srcdoc = html.replace("</head>", "<style>.actions{display:none}.sheet{margin-top:12px}</style></head>");
  if (!$("preview").open) $("preview").showModal();
}
$("previewClose").addEventListener("click", () => $("preview").close());
$("previewPrint").addEventListener("click", () => { try { $("previewFrame").contentWindow.focus(); $("previewFrame").contentWindow.print(); } catch { toast("Printing is blocked in this browser. Use the share menu instead.", "error"); } });

function confirmAction(options) { openDialog(confirmHtml(options)); }

// ---- Quotation editor ---------------------------------------------------------------------
function catalogueForEditor() { const active = catalogue.filter(item => item.active); return active.length ? active : BUILT_IN_ITEMS; }

function openQuoteEditor(lead, { quote = null, revisionOf = null } = {}) {
  const source = quote || revisionOf;
  const rows = Array.isArray(source?.line_items) && source.line_items.length
    ? source.line_items.map(line => ({ description:line.description, quantity:line.quantity, unit:line.unit || "item", unitPrice:penceToInput(line.unit_price_pence) }))
    : [{ description:"", quantity:"1", unit:"item", unitPrice:"" }];
  const prefill = quotePrefill(lead);
  const until = new Date(); until.setDate(until.getDate() + 30);
  const discount = source && source.discount_type && source.discount_type !== "none"
    ? { type:source.discount_type, percent:source.discount_type === "percent" ? String(source.discount_basis_points / 100) : "", amount:source.discount_type === "fixed" ? penceToInput(source.discount_pence) : "" }
    : { type:"none", percent:"", amount:"" };
  const taxPercent = source ? String(Number(source.tax_rate_basis_points || 0) / 100) : settings?.vat_number ? "20" : "0";
  openDialog(quoteEditorHtml({
    lead, quote, revisionOf, rows, catalogue:catalogueForEditor(), discount, taxPercent,
    scope:source?.scope || prefill.scope, exclusions:source?.exclusions ?? settings?.default_quote_exclusions ?? "", terms:source?.terms ?? settings?.default_quote_terms ?? "",
    validUntil:quote?.valid_until || isoDay(until), ready:schema.quoteLines
  }), { wide:true });
  updateQuoteTotals();
}

function readQuoteForm(form) {
  const lines = [...form.querySelectorAll("tr.line")].map(row => ({
    description:row.querySelector('[name="description"]').value, quantity:row.querySelector('[name="quantity"]').value,
    unit:row.querySelector('[name="unit"]').value, unitPrice:row.querySelector('[name="unitPrice"]').value,
    catalogueItemId:catalogue.find(item => item.name === row.querySelector('[name="description"]').value.trim())?.id || ""
  }));
  const apply = form.elements.applyDiscount.checked;
  const preset = form.querySelector('[name="discountPreset"]:checked')?.value || "";
  const discountType = !apply ? "none" : preset === "fixed" ? "fixed" : "percent";
  return calculateQuote({ lines, discountType, discountPercent:preset === "custom" ? form.elements.customPercent.value : preset, discountAmount:form.elements.fixedAmount.value, taxPercent:form.elements.taxPercent.value });
}

function updateQuoteTotals() {
  const form = $("quoteForm");
  if (!form) return;
  form.querySelector(".discount-options").hidden = !form.elements.applyDiscount.checked;
  const result = readQuoteForm(form);
  for (const row of form.querySelectorAll("tr.line")) {
    const single = calculateQuote({ lines:[{ description:"x", quantity:row.querySelector('[name="quantity"]').value, unitPrice:row.querySelector('[name="unitPrice"]').value }] });
    row.querySelector("[data-line-total]").textContent = single.items.length ? formatPence(single.items[0].line_total_pence) : "—";
  }
  $("quoteTotals").innerHTML = quoteTotalsHtml(result);
}

async function saveQuote(form, { preview = false } = {}) {
  const result = readQuoteForm(form);
  const scope = form.elements.scope.value.trim();
  const errors = [...result.errors];
  if (!scope) errors.push("Describe the scope of work.");
  if (!form.elements.validUntil.value) errors.push("Choose how long the quotation is valid.");
  if (errors.length) { formError(form, errors.join(" ")); return; }
  if (!schema.quoteLines) { formError(form, "Saving needs the October database update. Ask Mark to apply migration 20261019211600."); return; }
  const lead = leadById(form.dataset.requestId);
  const fields = {
    line_items:result.items, items_subtotal_pence:result.itemsSubtotalPence, discount_type:result.discountType, discount_basis_points:result.discountBasisPoints, discount_pence:result.discountPence,
    subtotal_pence:result.subtotalPence, tax_rate_basis_points:result.taxBasisPoints, tax_pence:result.taxPence,
    scope, exclusions:form.elements.exclusions.value.trim(), terms:form.elements.terms.value.trim(), valid_until:form.elements.validUntil.value
  };
  const button = form.querySelector("button.primary"); button.disabled = true;
  let outcome;
  if (form.dataset.quoteId) {
    outcome = await mutate(() => db.from("quotes").update(fields).eq("id", form.dataset.quoteId).eq("status", "draft").select("id").maybeSingle(), "Quotation saved.");
  } else {
    const versions = data.quotes.filter(item => item.request_id === lead.id).map(item => Number(item.version));
    const version = versions.length ? Math.max(...versions) + 1 : 1;
    const revisionOf = quoteById(form.dataset.revisionOf);
    const base = revisionOf ? revisionOf.quote_number.replace(/-R\d+$/, "") : `FFQ-${isoDay(new Date()).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const payload = { ...fields, request_id:lead.id, version, quote_number:version > 1 ? `${base}-R${version}` : base, created_by:userId, ...(revisionOf ? { revision_of:revisionOf.id } : {}) };
    outcome = await mutate(() => db.from("quotes").insert(payload).select("id").single(), revisionOf ? `Revision ${payload.quote_number} saved as a draft.` : "Quotation draft saved.");
  }
  button.disabled = false;
  if (!outcome.ok) { formError(form, outcome.message); return; }
  closeDialog();
  const savedId = form.dataset.quoteId || outcome.result.data?.id;
  if (preview && savedId) showQuotePdf(savedId);
}

function showQuotePdf(quoteId, responseUrl = "") {
  const quote = quoteById(quoteId); const lead = quote && leadById(quote.request_id);
  if (!quote || !lead) return toast("Refresh and try again.", "error");
  previewDocument(renderQuotationDocument({ quote, customer:lead, settings, responseUrl }), `Quotation ${quote.quote_number}`);
}

function showInvoicePdf(invoiceId) {
  const invoice = invoiceById(invoiceId);
  const job = invoice && data.workOrders.find(item => item.id === invoice.work_order_id);
  const lead = job && leadById(job.request_id);
  if (!invoiceSettingsReady(settings)) return toast("Add your company details in Settings before creating invoice PDFs.", "error");
  try { previewDocument(renderInvoiceDocument({ settings, invoice, balance:invoice, workOrder:job, customerEmail:lead?.email || "", quote:quoteById(job?.accepted_quote_id) }), `Invoice ${invoice.invoice_number}`); }
  catch (error) { toast(error.message, "error"); }
}

const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");

function openSendQuote(quote, link = "") {
  const lead = leadById(quote.request_id);
  const fresh = quoteById(quote.id) || quote;
  openDialog(sendQuoteHtml({ lead, quote:fresh, link, emailHref:link ? quotationEmail(fresh, lead, link) || "" : "" }));
}

// ---- Actions ---------------------------------------------------------------------------------
const currentLead = () => ui.route === "customer" ? leadById(ui.param) : null;
const stamp = () => new Date().toISOString();
const shortCode = () => crypto.randomUUID().slice(0, 4).toUpperCase();

const ACTIONS = {
  "close-dialog":() => closeDialog(),
  back:event => { event.preventDefault(); go(`#/${ui.lastSection}`); },
  "new-enquiry":() => openDialog(customerFormHtml({ schema })),
  "enquiry-filter":(_, id) => { ui.enquiryFilter = id; render(); },
  "finance-kind":(_, id) => { ui.financeKind = id; render(); },
  "jobs-view":(_, id) => { ui.jobsView = id; render(); },
  "cal-mode":(_, id) => { ui.calMode = id; render(); },
  "cal-move":(_, id) => {
    const step = Number(id), a = new Date(ui.calAnchor);
    if (step === 0) ui.calAnchor = new Date();
    else if (ui.calMode === "month") ui.calAnchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
    else { a.setDate(a.getDate() + step * (ui.calMode === "week" ? 7 : 42)); ui.calAnchor = a; }
    render();
  },
  "block-time":() => openDialog(blockFormHtml()),
  "remove-block":(_, id) => confirmAction({ title:"Remove this blocked time?", body:"The time becomes available for bookings again.", confirmLabel:"Remove", act:"remove-block", id }),
  "open-notification":async (_, id, button) => { await markNotificationsRead([id]); routeForNotification(button.dataset.request, button.dataset.view); },
  "open-notification-settings":() => openNotificationPanel("settings"),
  "sign-out":async () => { if (db && !demo) await db.auth.signOut(); location.reload(); },
  "edit-catalogue":(_, id) => openDialog(catalogueFormHtml({ item:catalogue.find(item => item.id === id) || null })),

  // Workspace
  "mark-reviewed":async () => { const lead = currentLead(); const r = await mutate(() => db.from("consultation_requests").update({ status:"reviewing" }).eq("id", lead.id).select("id").maybeSingle(), "Marked as reviewed. Next: contact the customer, book a survey or prepare the quotation."); if (!r.ok) toast(r.message, "error"); },
  "edit-customer":() => openDialog(customerFormHtml({ lead:currentLead(), schema })),
  "new-follow-up":() => openDialog(followUpFormHtml({ lead:currentLead() })),
  "follow-up-done":async (_, id) => { const r = await mutate(() => db.from("follow_up_tasks").update({ completed_at:stamp() }).eq("id", id).is("completed_at", null).select("id").maybeSingle(), "Follow-up marked done."); if (!r.ok) toast(r.message, "error"); },
  "new-quote":() => { const lead = currentLead(); const rel = relFor(lead); if (rel.draft) return openQuoteEditor(lead, { quote:rel.draft }); const earlier = rel.quotes.find(item => !isDiscarded(item)); openQuoteEditor(lead, earlier ? { revisionOf:earlier } : {}); },
  "edit-quote":(_, id) => { const quote = quoteById(id); if (!quote || quote.status !== "draft") return toast("Only drafts can be edited. Create a revision instead.", "error"); openQuoteEditor(leadById(quote.request_id), { quote }); },
  "revise-quote":(_, id) => { const quote = quoteById(id); const lead = leadById(quote.request_id); const rel = relFor(lead); if (rel.draft) return openQuoteEditor(lead, { quote:rel.draft }); openQuoteEditor(lead, { revisionOf:quote }); },
  "preview-quote":(_, id) => showQuotePdf(id),
  "send-quote":(_, id) => { const quote = quoteById(id); if (quote) openSendQuote(quote); },
  "issue-link":async (_, id, button) => {
    const quote = quoteById(id); if (!quote) return;
    button.disabled = true;
    const token = randomToken();
    try {
      const result = await db.rpc("issue_quote_response_link", { p_quote_id:quote.id, p_token_hash:await sha256(token) });
      if (result.error) throw result.error;
      await loadAll(); render();
      const link = new URL("../quote-response.html", location.href); link.searchParams.set("token", token);
      openSendQuote(quoteById(quote.id), link.href);
      toast(quote.status === "draft" ? "Link created and quotation marked as sent. Email it to the customer now." : "New link created. The previous link no longer works.");
    } catch (error) { button.disabled = false; toast(friendlyError(error), "error"); }
  },
  "copy-link":async () => { const input = $("responseLink"); try { await navigator.clipboard.writeText(input.value); toast("Link copied."); } catch { input.select(); toast("Select the link and copy it.", "error"); } },
  "discard-quote":(_, id) => confirmAction({ title:"Discard this draft?", body:"The draft is kept in the history as discarded but no longer appears as the current quotation.", confirmLabel:"Discard draft", danger:true, act:"discard-quote", id }),
  "record-decision":(_, id) => openDialog(decisionFormHtml({ quote:quoteById(id) })),
  "create-job":(_, id) => { const quote = quoteById(id) || relFor(currentLead()).accepted; confirmAction({ title:"Create the job?", body:`This creates a job for ${esc(quote.quote_number)} at the agreed price of <b>${formatPence(quote.total_pence)}</b>. Next you can schedule the installation.`, confirmLabel:"Create job", act:"create-job", id:quote.id }); },
  "job-move":(_, to) => { const job = relFor(currentLead()).job; if (to === "cancelled") return confirmAction({ title:"Cancel this job?", body:"The job is kept for your records but marked cancelled. Issued invoices and payments are not changed.", confirmLabel:"Cancel job", danger:true, act:"job-move", id:to }); void moveJob(job, to); },
  "edit-job":() => openDialog(jobFormHtml({ job:relFor(currentLead()).job, profiles })),
  "scroll-job":() => $("ws-job")?.scrollIntoView({ behavior:"smooth", block:"start" }),
  "scroll-appointments":() => $("ws-appointments")?.scrollIntoView({ behavior:"smooth", block:"start" }),
  "book-appointment":(_, kind) => { const lead = currentLead(); const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(kind === "installation" ? 8 : 10, 0, 0, 0); openDialog(appointmentFormHtml({ lead, kind:kind || "survey", profiles, defaultLocation:[lead.address, lead.postcode].filter(Boolean).join(", ").replace(/\n/g, ", "), start })); },
  reschedule:(_, id) => openDialog(appointmentFormHtml({ lead:currentLead(), appointment:data.appointments.find(item => item.id === id), profiles })),
  "appointment-done":async (_, id) => { const r = await mutate(() => db.from("appointments").update({ status:"completed" }).eq("id", id).select("id").maybeSingle(), "Appointment marked done."); if (!r.ok) toast(r.message, "error"); },
  "appointment-cancel":(_, id) => confirmAction({ title:"Cancel this appointment?", body:"The time becomes free in the calendar. The customer is not told automatically.", confirmLabel:"Cancel appointment", danger:true, act:"appointment-cancel", id }),
  "toggle-survey":async () => { const lead = currentLead(); const r = await mutate(() => db.from("consultation_requests").update({ assessment_required:!lead.assessment_required }).eq("id", lead.id).select("id").maybeSingle(), lead.assessment_required ? "A survey is no longer required before quoting." : "A survey is now required before this enquiry can be quoted."); if (!r.ok) toast(r.message, "error"); },
  "new-invoice":() => { const lead = currentLead(); const rel = relFor(lead); openDialog(invoiceFormHtml({ lead, job:rel.job, quote:quoteById(rel.job?.accepted_quote_id) })); },
  "issue-invoice":(_, id) => { const invoice = invoiceById(id); confirmAction({ title:"Issue this invoice?", body:`Record ${esc(invoice.invoice_number)} for <b>${formatPence(invoice.total_pence)}</b> as issued. It can no longer be edited. Send the PDF to the customer yourself.`, confirmLabel:"Issue invoice", act:"issue-invoice", id }); },
  "void-invoice":(_, id) => confirmAction({ title:"Discard this draft invoice?", body:"The draft is marked void and kept for your records.", confirmLabel:"Discard draft", danger:true, act:"void-invoice", id }),
  "preview-invoice":(_, id) => showInvoicePdf(id),
  "record-payment":(_, id) => { const invoice = invoiceById(id) || relFor(currentLead()).invoices.find(item => item.status === "sent" && Number(item.outstanding_pence) > 0); if (invoice) openDialog(paymentFormHtml({ invoice })); },
  reopen:async () => { const lead = currentLead(); const r = await mutate(() => db.from("consultation_requests").update({ status:"reviewing" }).eq("id", lead.id).select("id").maybeSingle(), "Enquiry reopened."); if (!r.ok) toast(r.message, "error"); },
  "close-enquiry":() => confirmAction({ title:"Close this enquiry?", body:"Mark it as not proceeding. You can reopen it later.", confirmLabel:"Close enquiry", act:"set-stage", id:"lost" }),
  "archive-enquiry":() => confirmAction({ title:"Archive this enquiry?", body:"It leaves the active lists but stays searchable under Closed. You can reopen it later.", confirmLabel:"Archive", act:"set-stage", id:"archived" }),
  "delete-enquiry":() => confirmAction({ title:"Are you sure you want to delete this enquiry?", body:"It moves to Deleted and can be restored from Enquiries → Deleted. Enquiries with an issued quotation or a job must be archived instead.", confirmLabel:"Delete enquiry", danger:true, act:"delete-enquiry", id:currentLead().id }),
  "restore-enquiry":async () => { const lead = currentLead(); const r = await mutate(() => db.from("consultation_requests").update({ deleted_at:null }).eq("id", lead.id).select("id").maybeSingle(), "Enquiry restored."); if (!r.ok) toast(r.message, "error"); }
};

// Confirmed actions run only after the confirmation dialog is submitted.
const CONFIRMED = {
  "remove-block":id => mutate(() => db.from("availability_blocks").delete().eq("id", id).select("id").maybeSingle(), "Blocked time removed."),
  "discard-quote":id => mutate(() => db.from("quotes").update({ status:"superseded" }).eq("id", id).eq("status", "draft").select("id").maybeSingle(), "Draft discarded."),
  "create-job":id => { const quote = quoteById(id), lead = leadById(quote.request_id); return mutate(() => db.from("work_orders").insert({ request_id:lead.id, accepted_quote_id:quote.id, work_order_number:`FFJ-${isoDay(new Date()).replaceAll("-", "")}-${shortCode()}`, title:`Media wall · ${lead.reference}`, agreed_total_pence:quote.total_pence, created_by:userId }).select("id").single(), "Job created. Next: schedule the installation."); },
  "job-move":to => moveJob(relFor(currentLead()).job, to),
  "appointment-cancel":id => mutate(() => db.from("appointments").update({ status:"cancelled" }).eq("id", id).select("id").maybeSingle(), "Appointment cancelled. The time is free again."),
  "issue-invoice":id => mutate(() => db.from("invoices").update({ status:"sent", sent_at:stamp() }).eq("id", id).eq("status", "draft").select("id").maybeSingle(), "Invoice issued. Send the PDF to the customer."),
  "void-invoice":id => mutate(() => db.from("invoices").update({ status:"void" }).eq("id", id).eq("status", "draft").select("id").maybeSingle(), "Draft invoice discarded."),
  "set-stage":status => { const lead = currentLead(); return mutate(() => db.from("consultation_requests").update({ status }).eq("id", lead.id).select("id").maybeSingle(), status === "lost" ? "Enquiry closed." : status === "archived" ? "Enquiry archived." : "Enquiry stage updated."); },
  "delete-enquiry":id => mutate(() => db.from("consultation_requests").update({ deleted_at:stamp() }).eq("id", id).select("id").maybeSingle(), "Enquiry deleted. Restore it from Enquiries → Deleted.")
};

async function moveJob(job, to) {
  const patch = { status:to };
  if (to === "in_progress" && !job.actual_started_at) patch.actual_started_at = stamp();
  if (to === "completed") patch.completed_at = stamp();
  const result = await mutate(() => db.from("work_orders").update(patch).eq("id", job.id).eq("status", job.status).select("id").maybeSingle(), "Job progress updated.");
  if (!result.ok) toast(result.message, "error");
  return result;
}

function routeForNotification(requestId, view) {
  closeNotificationPanel();
  if (requestId) return go(`#/customer/${requestId}`);
  go(`#/${{ today:"dashboard", work:"jobs", calendar:"calendar", money:"finance" }[view] || "dashboard"}`);
}

document.addEventListener("click", async event => {
  const target = event.target.closest("[data-act]");
  if (!target || target.tagName === "SELECT") return;
  const handler = ACTIONS[target.dataset.act];
  if (!handler) return;
  if (target.tagName === "A") event.preventDefault();
  await handler(event, target.dataset.id || "", target);
});

document.addEventListener("change", async event => {
  if (event.target.id === "stageSelect") {
    const lead = currentLead(), value = event.target.value;
    if (["lost", "archived"].includes(value)) { event.target.value = lead.status; ACTIONS[value === "lost" ? "close-enquiry" : "archive-enquiry"](); return; }
    const result = await mutate(() => db.from("consultation_requests").update({ status:value }).eq("id", lead.id).select("id").maybeSingle(), "Enquiry stage updated.");
    if (!result.ok) { event.target.value = lead.status; toast(result.message, "error"); }
  }
  if (event.target.closest("#quoteForm")) {
    const input = event.target;
    if (input.name === "description") {
      const item = catalogueForEditor().find(entry => entry.name === input.value.trim());
      const row = input.closest("tr");
      if (item && row) {
        if (item.unit) row.querySelector('[name="unit"]').value = item.unit;
        if (item.default_unit_price_pence != null && !row.querySelector('[name="unitPrice"]').value) row.querySelector('[name="unitPrice"]').value = penceToInput(item.default_unit_price_pence);
      }
    }
    if (input.name === "discountPreset" || input.name === "applyDiscount") {
      const form = $("quoteForm");
      if (input.name === "applyDiscount" && input.checked && !form.querySelector('[name="discountPreset"]:checked')) form.querySelector('[name="discountPreset"][value="10"]').checked = true;
    }
    updateQuoteTotals();
  }
});

document.addEventListener("input", event => {
  if (event.target.closest("#quoteForm")) { updateQuoteTotals(); return; }
  if (event.target.id === "enquirySearch") { ui.enquiryQuery = event.target.value; render(); }
  if (event.target.id === "financeSearch") { ui.financeQuery = event.target.value; render(); }
});

$("dialog").addEventListener("click", event => {
  if (event.target.closest('[data-act="add-line"]')) {
    const body = $("quoteLines"); const index = body.querySelectorAll("tr.line").length;
    const template = document.createElement("tbody");
    template.innerHTML = quoteLineHtml({ description:"", quantity:"1", unit:"item", unitPrice:"" }, index);
    body.append(...template.children);
    body.lastElementChild.querySelector("input").focus();
    updateQuoteTotals();
  }
  const remove = event.target.closest('[data-act="remove-line"]');
  if (remove) { const rows = $("quoteLines").querySelectorAll("tr.line"); if (rows.length > 1) remove.closest("tr").remove(); else rows[0].querySelectorAll("input").forEach(input => { input.value = input.name === "quantity" ? "1" : input.name === "unit" ? "item" : ""; }); updateQuoteTotals(); }
  if (event.target.closest('[data-act="save-and-preview"]')) void saveQuote($("quoteForm"), { preview:true });
});

// ---- Forms -------------------------------------------------------------------------------
const FORMS = {
  async quoteForm(form) { await saveQuote(form); },
  async confirmForm(form) {
    const run = CONFIRMED[form.dataset.confirm];
    const button = form.querySelector("button.primary,button.danger"); button.disabled = true;
    const result = await run(form.dataset.id);
    button.disabled = false;
    if (result?.ok === false) return formError(form, result.message);
    closeDialog();
  },
  async customerForm(form) {
    const f = form.elements;
    const email = f.email.value.trim();
    if (f.customerName.value.trim().length < 2) return formError(form, "Enter the customer's name.");
    if (!f.postcode.value.trim()) return formError(form, "Enter a postcode.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return formError(form, "Check the email address.");
    const patch = { customer_name:f.customerName.value.trim(), email:email || null, phone:f.phone.value.trim() || null, postcode:f.postcode.value.trim(), wall_width:f.wallWidth.value.trim() || null, message:f.message.value.trim() || null, staff_notes:f.staffNotes.value.trim() || null, ...(schema.address ? { address:f.address.value.trim() || null } : {}) };
    const id = form.dataset.requestId;
    const result = id
      ? await mutate(() => db.from("consultation_requests").update(patch).eq("id", id).select("id").maybeSingle(), "Customer details saved.")
      : await mutate(() => db.from("consultation_requests").insert({ ...patch, reference:`FF-M-${isoDay(new Date()).slice(2).replaceAll("-", "")}-${shortCode()}`, source:"manual", status:"reviewing" }).select("id").single(), "Enquiry created.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
    if (!id) go(`#/customer/${result.result.data.id}`);
  },
  async appointmentForm(form) {
    const f = form.elements;
    const startsAt = new Date(f.startsAt.value);
    if (!Number.isFinite(startsAt.getTime())) return formError(form, "Choose a start date and time.");
    const endsAt = new Date(startsAt.getTime() + Number(f.duration.value) * 60000);
    const lead = leadById(form.dataset.requestId);
    let result;
    if (form.dataset.appointmentId) result = await mutate(() => db.from("appointments").update({ starts_at:startsAt.toISOString(), ends_at:endsAt.toISOString(), location:f.location.value.trim() }).eq("id", form.dataset.appointmentId).select("id").maybeSingle(), "Appointment moved. Let the customer know the new time.");
    else {
      const rel = relFor(lead);
      const kind = f.kind.value;
      const payload = { request_id:lead.id, kind, status:"scheduled", starts_at:startsAt.toISOString(), ends_at:endsAt.toISOString(), location:f.location.value.trim(), notes:f.notes.value.trim(), assigned_to:f.assignedTo.value || null, created_by:userId, ...(kind === "installation" && rel.job && rel.job.status !== "cancelled" ? { work_order_id:rel.job.id } : {}) };
      result = await mutate(() => db.from("appointments").insert(payload).select("id").single(), `${kind === "survey" ? "Survey" : "Installation"} booked for ${new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" }).format(startsAt)}. It is in the calendar.`);
    }
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async followUpForm(form) {
    const due = new Date(form.elements.dueAt.value);
    if (!Number.isFinite(due.getTime())) return formError(form, "Choose when it is due.");
    const result = await mutate(() => db.from("follow_up_tasks").insert({ request_id:form.dataset.requestId, title:form.elements.title.value.trim(), due_at:due.toISOString(), created_by:userId }).select("id").single(), "Follow-up scheduled. It appears on the dashboard and calendar.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async decisionForm(form) {
    const decision = form.querySelector('[name="decision"]:checked')?.value;
    if (!decision) return formError(form, "Choose what the customer decided.");
    if (!form.elements.confirmed.checked) return formError(form, "Confirm that you have the customer's decision.");
    const quote = quoteById(form.dataset.quoteId);
    const result = await mutate(async () => {
      const updated = await db.from("quotes").update({ status:decision, accepted_at:decision === "accepted" ? stamp() : null, ...(schema.quoteLines ? { responded_at:stamp() } : {}) }).eq("id", quote.id).eq("status", "sent").select("id").maybeSingle();
      if (updated.error || !updated.data) return updated.error ? updated : { data:null, error:{ message:"This quotation is no longer awaiting a decision.", code:"P0001" } };
      await db.from("consultation_requests").update({ status:decision === "accepted" ? "won" : "lost" }).eq("id", quote.request_id).select("id").maybeSingle();
      return updated;
    }, decision === "accepted" ? "Acceptance recorded. Next: create the job." : "Decline recorded.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async invoiceForm(form) {
    const f = form.elements;
    const subtotal = parsePounds(f.subtotal.value), tax = parsePounds(f.tax.value);
    const rate = subtotal === null || tax === null ? null : taxRateForAmount(subtotal, tax);
    if (subtotal === null || tax === null) return formError(form, "Enter the subtotal and VAT in pounds, for example 1200 or 1200.50.");
    if (rate === null) return formError(form, "The VAT amount must match a single rate between 0% and 100% of the subtotal.");
    if (f.dueDate.value < f.issueDate.value) return formError(form, "The payment due date must be on or after the issue date.");
    const result = await mutate(() => db.from("invoices").insert({ work_order_id:form.dataset.workOrderId, invoice_number:`FFI-${isoDay(new Date()).replaceAll("-", "")}-${shortCode()}`, bill_to_name:f.billName.value.trim(), bill_to_address:f.billAddress.value.trim(), issue_date:f.issueDate.value, due_date:f.dueDate.value, subtotal_pence:subtotal, tax_rate_basis_points:rate, tax_pence:tax, created_by:userId }).select("id").single(), "Invoice draft saved. Preview it, then issue it.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async paymentForm(form) {
    const amount = parsePounds(form.elements.amount.value);
    if (!amount) return formError(form, "Enter the amount received in pounds.");
    const invoiceId = form.dataset.invoiceId, method = form.elements.method.value;
    const intent = JSON.stringify([invoiceId, amount, method]);
    let storage = null;
    try { storage = window.sessionStorage; } catch { /* in-memory retry key */ }
    const key = form.dataset.recordingIntent === intent && form.dataset.recordingKey ? form.dataset.recordingKey : getPaymentRecordingKey(storage, invoiceId, amount, method);
    form.dataset.recordingKey = key; form.dataset.recordingIntent = intent;
    const result = await mutate(async () => {
      const inserted = await db.from("invoice_payments").insert({ recording_key:key, invoice_id:invoiceId, amount_pence:amount, method, recorded_by:userId }).select("id").single();
      if (!inserted.error && inserted.data) return inserted;
      const existing = await db.from("invoice_payments").select("id, invoice_id, amount_pence, method").eq("recording_key", key).maybeSingle();
      if (!existing.error && paymentMatchesIntent(existing.data, invoiceId, amount, method)) return existing;
      return inserted;
    }, `Payment of ${formatPence(amount)} recorded.`);
    if (!result.ok) return formError(form, result.message);
    clearPaymentRecordingKey(storage, invoiceId, amount, method);
    closeDialog();
  },
  async jobForm(form) {
    const f = form.elements;
    if (f.plannedStart.value && f.targetCompletion.value && f.targetCompletion.value < f.plannedStart.value) return formError(form, "The target completion must be on or after the start date.");
    const result = await mutate(() => db.from("work_orders").update({ assigned_to:f.assignedTo.value || null, planned_start:f.plannedStart.value || null, target_completion:f.targetCompletion.value || null }).eq("id", form.dataset.jobId).select("id").maybeSingle(), "Job dates and assignment saved.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async blockForm(form) {
    const f = form.elements;
    const start = new Date(f.startsAt.value), end = new Date(f.endsAt.value);
    if (!(end > start)) return formError(form, "The end must be after the start.");
    const result = await mutate(() => db.from("availability_blocks").insert({ title:f.title.value.trim(), kind:f.kind.value, starts_at:start.toISOString(), ends_at:end.toISOString() }).select("id").single(), "Calendar updated.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  },
  async catalogueForm(form) {
    const f = form.elements;
    const price = f.price.value.trim() ? parsePounds(f.price.value) : null;
    if (f.price.value.trim() && price === null) return formError(form, "Enter the price in pounds, or leave it empty.");
    const row = { name:f.name.value.trim(), category:f.category.value.trim(), unit:f.unit.value.trim(), default_unit_price_pence:price, active:f.active.checked, updated_by:userId };
    const id = form.dataset.itemId;
    const result = await mutate(() => id ? db.from("quote_catalogue_items").update(row).eq("id", id).select("id").maybeSingle() : db.from("quote_catalogue_items").insert(row).select("id").single(), "Standard item saved.");
    if (!result.ok) return formError(form, result.message);
    closeDialog();
  }
};

document.addEventListener("submit", async event => {
  const form = event.target;
  if (form.id === "login" || form.id === "globalSearch") return;
  if (form.id === "settingsForm") { event.preventDefault(); return saveSettings(form); }
  const handler = FORMS[form.id];
  if (!handler) return;
  event.preventDefault();
  formError(form, "");
  await handler(form);
});

async function saveSettings(form) {
  if (currentStaffRole !== "owner") return toast("Only an owner can change company details.", "error");
  const f = form.elements;
  const values = { singleton:true, legal_name:f.legalName.value.trim(), billing_address:f.billingAddress.value.trim(), contact_email:f.contactEmail.value.trim(), contact_phone:f.contactPhone.value.trim(), company_number:f.companyNumber.value.trim(), vat_number:f.vatNumber.value.trim(), payment_instructions:f.paymentInstructions.value.trim(), invoice_footer:f.invoiceFooter.value.trim(), updated_by:userId, ...(schema.defaultTerms ? { default_quote_terms:f.defaultTerms.value.trim(), default_quote_exclusions:f.defaultExclusions.value.trim() } : {}) };
  if (!invoiceSettingsReady(values)) return toast("Enter the legal company name, a full business address and a valid contact email.", "error");
  const result = await mutate(() => db.from("business_settings").upsert(values, { onConflict:"singleton" }).select("singleton").single(), "Company details saved.", { persisted:false });
  if (!result.ok) toast(result.message, "error");
}

// Global search: jump straight to a single match, otherwise show matches in Enquiries.
$("globalSearch").addEventListener("submit", event => {
  event.preventDefault();
  const query = $("globalSearchInput").value.trim();
  if (!query) return;
  const matches = filterEnquiries(leads, data, { query, filter:"all" });
  if (matches.length === 1) { $("globalSearchInput").value = ""; go(`#/customer/${matches[0].lead.id}`); return; }
  ui.enquiryQuery = query; ui.enquiryFilter = "all"; $("globalSearchInput").value = "";
  go("#/enquiries");
});

document.addEventListener("keydown", event => {
  if (event.key === "/" && !event.target.closest("input,textarea,select") && !$("hub").hidden) { event.preventDefault(); $("globalSearchInput").focus(); }
  if (event.key === "Escape") closeNotificationPanel();
});

// ---- Live data ----------------------------------------------------------------------------
function scheduleLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(async () => { try { await loadAll(); render(); } catch (error) { console.error("Refresh failed.", error); } }, 180);
}

async function subscribeLive() {
  const realtimeTables = ["consultation_requests", "availability_blocks", "profiles", "business_settings", "quotes", "work_orders", "appointments", "follow_up_tasks", "invoices", "invoice_payments", "workflow_activity", "quote_catalogue_items", "quote_response_links"];
  if (liveChannel) await db.removeChannel(liveChannel);
  liveChannel = db.channel("ff-operations");
  for (const table of realtimeTables) {
    liveChannel.on("postgres_changes", { event:"*", schema:"public", table }, scheduleLiveRefresh);
  }
  liveChannel.subscribe(status => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") toast("Live updates are paused. Pull down or reopen the app to refresh.", "error"); });
}

// ---- Access ---------------------------------------------------------------------------------
async function showStaffAccessIssue(access) {
  $("hub").hidden = true; $("setup").hidden = false;
  $("login").hidden = access.state !== "signed_out";
  $("accessActions").hidden = access.state === "signed_out";
  $("setupCopy").textContent = staffAccessMessage(access.state);
  leads = []; data = emptyData(); blocks = []; settings = null; profiles = []; loaded = false; currentStaffRole = null;
  clearTimeout(liveRefreshTimer);
  if (liveChannel) { await db.removeChannel(liveChannel); liveChannel = null; }
}

async function startDesk() {
  const access = await checkStaffAccess(db);
  if (access.state !== "authorized") { await showStaffAccessIssue(access); return false; }
  currentStaffRole = access.role;
  userId = (await db.auth.getUser()).data?.user?.id || null;
  $("setup").hidden = true; $("hub").hidden = false;
  applyDeepLink();
  render();
  try {
    await detectSchema();
    await loadAll();
  } catch (error) {
    console.error("Owner Desk records could not be loaded.", error);
    $("page").innerHTML = `<div class="card"><h1>Your records could not be loaded</h1><p>Check your connection, then try again. Nothing has been changed.</p><button type="button" class="btn primary" id="reloadDesk">Try again</button></div>`;
    $("reloadDesk").addEventListener("click", () => location.reload());
    return false;
  }
  onRoute();
  await subscribeLive();
  void loadNotifications();
  void setupPush();
  return true;
}

// Push alerts open ./?enquiry=<id> or ./?view=<section>; translate them into routes.
function applyDeepLink() {
  const enquiry = enquiryTargetFromSearch(location.search);
  const view = operationsViewFromSearch(location.search);
  if (!enquiry && !view) { if (!location.hash) history.replaceState(null, "", "#/dashboard"); return; }
  const route = enquiry ? `#/customer/${enquiry}` : `#/${{ today:"dashboard", work:"jobs", calendar:"calendar", money:"finance" }[view]}`;
  history.replaceState(null, "", `${location.pathname}${route}`);
}

window.addEventListener("hashchange", onRoute);

// ---- Push notifications (device registration) -----------------------------------------------
function decodeVapidKey(encoded) {
  const padded = encoded + "=".repeat((4 - encoded.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

async function setupPush() {
  const ios = isIOSDevice({ userAgent:navigator.userAgent, platform:navigator.platform, maxTouchPoints:navigator.maxTouchPoints });
  const installed = isInstalledPWA({ displayModeStandalone:window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone:navigator.standalone === true });
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ready = !!(cfg?.vapidPublicKey && window.isSecureContext && supported && (!ios || installed));
  if (!ready) { $("pushHelp").textContent = pushSetupMessage({ ios, installed, secure:window.isSecureContext, configured:!!cfg?.vapidPublicKey, supported }); return; }
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope:"./", updateViaCache:"none" });
    const existing = await registration.pushManager.getSubscription();
    if (existing && userId) {
      const { data:registered } = await db.from("push_subscriptions").select("id").eq("endpoint", existing.endpoint).eq("user_id", userId).maybeSingle();
      if (registered) $("enablePush").textContent = "Turn off notifications";
    }
  } catch (error) { console.error("Operations service worker registration failed.", error); }
}

$("enablePush").addEventListener("click", async () => {
  const button = $("enablePush"), help = $("pushHelp");
  button.disabled = true;
  try {
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope:"./", updateViaCache:"none" });
    let subscription = await registration.pushManager.getSubscription();
    const { data:userResult, error:userError } = await db.auth.getUser();
    if (userError || !userResult.user) throw userError || new Error("Sign in again to manage this device.");
    if (button.textContent === "Turn off notifications" && subscription) {
      const { data:deleted, error } = await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", userResult.user.id).select("id").maybeSingle();
      if (error) throw error;
      if (!deleted) throw new Error("This device was not registered with the signed-in account.");
      await subscription.unsubscribe();
      button.textContent = "Enable notifications";
      ncSay("ncPrefNote", "Notifications are turned off on this device.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications were not allowed for this device.");
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:decodeVapidKey(cfg.vapidPublicKey) });
    const json = subscription.toJSON();
    const { error } = await db.from("push_subscriptions").upsert({ user_id:userResult.user.id, endpoint:json.endpoint, p256dh:json.keys?.p256dh, auth_secret:json.keys?.auth, user_agent:navigator.userAgent.slice(0, 500), last_seen_at:stamp() }, { onConflict:"endpoint" });
    if (error) throw error;
    button.textContent = "Turn off notifications";
    ncSay("ncPrefNote", "This device is registered for private alerts.");
  } catch (error) {
    console.error("Push subscription failed.", error);
    help.textContent = error?.message || "We couldn't enable push on this device.";
    ncSay("ncPrefNote", help.textContent);
  } finally {
    button.disabled = false;
    if (!$("notifPanel").hidden) renderDevicePanel();
  }
});

// ---- Notification centre (reads the notification_events outbox) ------------------------------
let ncEvents = [], ncReadIds = new Set(), ncPrefs = normalisePreferences(null), ncStoreReady = true, ncUser = null;
let ncInstallPrompt = null, ncTab = "inbox", ncLoadVersion = 0, ncLoading = Promise.resolve(), ncNoteTimer = null;
const ncItems = () => visibleNotifications(ncEvents, { userId:ncUser, readIds:ncReadIds, preferences:ncPrefs });

function ncSay(id, message) {
  const note = $(id);
  note.textContent = message; note.hidden = !message;
  clearTimeout(ncNoteTimer); if (message && ncStoreReady) ncNoteTimer = setTimeout(() => { note.hidden = true; }, 6000);
}

function renderNotifications() {
  const items = ncItems();
  const count = unreadCount(items);
  const bell = $("notifBell"), badge = $("notifBadge");
  bell.setAttribute("aria-label", bellLabel(count));
  badge.hidden = count === 0; badge.textContent = count > 99 ? "99+" : String(count);
  const tabCount = $("ncTabCount"); tabCount.hidden = count === 0; tabCount.textContent = String(count);
  document.title = `${count ? `(${count}) ` : ""}Form & Frame — Owner Desk`;
  try { if (count) navigator.setAppBadge?.(count); else navigator.clearAppBadge?.(); } catch { /* optional */ }
  $("ncList").innerHTML = listHtml(items);
  $("ncMarkAll").disabled = count === 0;
  if (!ncStoreReady && !demo) ncSay("ncNote", "Read tracking and preferences need the latest database update. Alerts still arrive on your devices.");
}

async function loadNotifications() {
  if (!db || demo) return;
  const version = ++ncLoadVersion;
  ncLoading = (async () => {
    try {
      ncUser = userId;
      if (!ncUser) return;
      const [events, reads, prefs] = await Promise.all([
        db.from("notification_events").select("id, request_id, channel, event_type, payload, created_at").eq("channel", "push").in("event_type", ["new_enquiry", "workflow_update"]).order("created_at", { ascending:false }).limit(60),
        db.from("notification_reads").select("event_id").eq("user_id", ncUser).limit(1000),
        db.from("notification_preferences").select("*").eq("user_id", ncUser).maybeSingle()
      ]);
      if (version !== ncLoadVersion) return;
      if (events.error) throw events.error;
      ncStoreReady = !reads.error && !prefs.error;
      ncEvents = events.data || [];
      ncReadIds = new Set((reads.data || []).map(row => row.event_id));
      ncPrefs = normalisePreferences(prefs.data);
    } catch (error) { console.error("Notifications could not be loaded.", error); ncStoreReady = false; }
    render();
  })();
  return ncLoading;
}

async function markNotificationsRead(ids) {
  ids = [...new Set(ids)].filter(id => id && !ncReadIds.has(id));
  if (!ids.length) return;
  ids.forEach(id => ncReadIds.add(id)); renderNotifications();
  if (demo || !ncUser) return;
  const { error } = await db.from("notification_reads").upsert(ids.map(event_id => ({ user_id:ncUser, event_id })), { onConflict:"user_id,event_id", ignoreDuplicates:true });
  if (error) { console.error("Could not save read state.", error); ids.forEach(id => ncReadIds.delete(id)); ncStoreReady = false; renderNotifications(); }
}

async function markRequestNotificationsRead(requestId) { if (demo || !db) return; await ncLoading; await markNotificationsRead(unreadForRequest(ncItems(), requestId)); }

async function readWorkerInfo() {
  try {
    const registration = await navigator.serviceWorker.getRegistration("./");
    const active = registration?.active;
    if (!active) return null;
    return await new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 1500);
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      active.postMessage({ type:"ff-worker-version" }, [channel.port2]);
    });
  } catch { return null; }
}

async function renderDevicePanel() {
  const ios = isIOSDevice({ userAgent:navigator.userAgent, platform:navigator.platform, maxTouchPoints:navigator.maxTouchPoints });
  const android = /Android/i.test(navigator.userAgent);
  const installed = isInstalledPWA({ displayModeStandalone:window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone:navigator.standalone === true });
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const device = deviceState({ ios, installed, secure:window.isSecureContext, supported, configured:!!cfg?.vapidPublicKey, permission:supported ? Notification.permission : "default", registered:$("enablePush").textContent === "Turn off notifications" });
  $("ncDevice").innerHTML = deviceHtml(device, { ios, android, installed }, { canInstall:!!ncInstallPrompt && !installed });
  if (android || !ios) { const worker = await readWorkerInfo(); $("ncIcon").innerHTML = iconDiagnosticsHtml({ installed, worker, badgeUrl:worker?.badge || "./notification-badge-ff.png" }); }
  else $("ncIcon").innerHTML = "";
  $("ncPrefs").innerHTML = preferencesHtml(ncPrefs, { disabled:!ncStoreReady || demo });
}

function setNotificationTab(tab) {
  ncTab = tab;
  document.querySelectorAll("[data-nc-tab]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.ncTab === tab)));
  $("ncInbox").hidden = tab !== "inbox"; $("ncSettings").hidden = tab !== "settings";
  if (tab === "settings") renderDevicePanel();
}
function openNotificationPanel(tab = "inbox") { $("notifPanel").hidden = false; $("notifBell").setAttribute("aria-expanded", "true"); setNotificationTab(tab); void loadNotifications(); $("ncClose").focus(); }
function closeNotificationPanel() { if ($("notifPanel").hidden) return; $("notifPanel").hidden = true; $("notifBell").setAttribute("aria-expanded", "false"); $("notifBell").focus(); }

async function sendTestNotification() {
  try {
    const { data:sessionData } = await db.auth.getSession();
    if (!sessionData.session) throw new Error("Sign in again first.");
    const response = await fetch(`${cfg.supabaseUrl.replace(/\/+$/, "")}/functions/v1/push-new-enquiry`, { method:"POST", headers:{ Authorization:`Bearer ${sessionData.session.access_token}`, apikey:cfg.supabaseAnonKey, "Content-Type":"application/json" }, body:JSON.stringify({ test:true }) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) ncSay("ncPrefNote", "The push service did not accept this sign-in. Sign out and back in, then try again.");
    else if (result.status === "sent") ncSay("ncPrefNote", "Test sent. It should appear on this device within a few seconds.");
    else if (result.status === "not_configured") ncSay("ncPrefNote", "The push service is not configured yet: the private VAPID keys are missing in Supabase.");
    else if (result.status === "no_subscriptions") ncSay("ncPrefNote", "No device is registered for your account yet. Turn notifications on first.");
    else ncSay("ncPrefNote", "The test could not be delivered. Try again in a minute.");
  } catch (error) { console.error("Test notification failed.", error); ncSay("ncPrefNote", "The push service could not be reached."); }
}

$("notifBell").addEventListener("click", () => $("notifPanel").hidden ? openNotificationPanel() : closeNotificationPanel());
$("ncClose").addEventListener("click", closeNotificationPanel);
$("ncMarkAll").addEventListener("click", () => markNotificationsRead(ncItems().filter(item => item.unread).map(item => item.id)));
$("notifPanel").addEventListener("click", async event => {
  const tab = event.target.closest("[data-nc-tab]");
  if (tab) { setNotificationTab(tab.dataset.ncTab); return; }
  const read = event.target.closest("[data-nc-read]");
  if (read) { await markNotificationsRead([read.dataset.ncRead]); return; }
  const open = event.target.closest("[data-nc-open]");
  if (open) { await markNotificationsRead([open.dataset.ncOpen]); routeForNotification(open.dataset.ncRequest, open.dataset.ncView); return; }
  const action = event.target.closest("[data-nc-device]")?.dataset.ncDevice;
  if (action === "enable" || action === "disable") $("enablePush").click();
  else if (action === "test") await sendTestNotification();
  else if (action === "update-worker") {
    try { const registration = await navigator.serviceWorker.register("./service-worker.js", { scope:"./", updateViaCache:"none" }); await registration.update(); ncSay("ncPrefNote", "Alert worker updated."); }
    catch { ncSay("ncPrefNote", "The alert worker could not be updated. Check your connection."); }
    renderDevicePanel();
  } else if (action === "install" && ncInstallPrompt) { ncInstallPrompt.prompt(); await ncInstallPrompt.userChoice.catch(() => {}); ncInstallPrompt = null; renderDevicePanel(); }
});
$("notifPanel").addEventListener("change", async event => {
  const box = event.target.closest("[data-nc-pref]");
  if (!box || demo || !ncUser) return;
  const key = box.dataset.ncPref, previous = ncPrefs[key];
  ncPrefs = { ...ncPrefs, [key]:box.checked }; renderNotifications();
  const { error } = await db.from("notification_preferences").upsert({ user_id:ncUser, ...ncPrefs }, { onConflict:"user_id" });
  if (error) { console.error("Could not save notification preferences.", error); ncPrefs = { ...ncPrefs, [key]:previous }; renderNotifications(); renderDevicePanel(); ncSay("ncPrefNote", "Your choice could not be saved. Check your connection and try again."); }
  else ncSay("ncPrefNote", `${CATEGORIES.find(category => category.key === key)?.label || "Alert"} alerts ${box.checked ? "on" : "off"}.`);
});
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); ncInstallPrompt = event; if (!$("notifPanel").hidden) renderDevicePanel(); });
window.addEventListener("appinstalled", () => { ncInstallPrompt = null; if (!$("notifPanel").hidden) renderDevicePanel(); });
navigator.serviceWorker?.addEventListener("message", event => { if (event.data?.type === "ff-push-received") { void loadNotifications(); scheduleLiveRefresh(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && loaded && !demo) { void loadNotifications(); scheduleLiveRefresh(); } });

// ---- Start ------------------------------------------------------------------------------------
async function start() {
  if (!cfg?.supabaseUrl || cfg.supabaseUrl.includes("YOUR_PROJECT")) {
    // No backend configured: run the labelled demo on fictional, in-memory records.
    const { createDemoClient } = await import("./desk-demo-client.mjs");
    db = createDemoClient(window.FF_DEMO_OPTIONS || {}); demo = true; window.ffDemo = db;
    db.onChange(scheduleLiveRefresh); // simulated customer replies arrive like live updates
    $("demoTag").hidden = false; $("notifBell").hidden = true;
    await startDesk();
    return;
  }
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2");
  db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  $("login").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("login").querySelector("button"); button.disabled = true;
    $("loginMsg").textContent = "Sending a secure sign-in link…";
    try {
      const { error } = await db.auth.signInWithOtp({ email:$("email").value, options:{ emailRedirectTo:location.href.split("#")[0], shouldCreateUser:false } });
      if (error) throw error;
      $("loginMsg").textContent = "Check your inbox for the secure sign-in link.";
    } catch (error) {
      console.error("Operations sign-in request failed.", error);
      $("loginMsg").textContent = "The sign-in link couldn't be sent. Check the address and your connection, then try again.";
    } finally { button.disabled = false; }
  });
  $("retryAccess").addEventListener("click", () => startDesk());
  $("accessSignOut").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
  try {
    const { data:sessionData, error } = await db.auth.getSession();
    if (error) throw error;
    if (!sessionData.session) { await showStaffAccessIssue({ state:"signed_out" }); return; }
    await startDesk();
  } catch (error) {
    console.error("Operations sign-in check failed.", error);
    $("loginMsg").textContent = "We couldn't verify your session. Check your connection and try again.";
  }
}

void start();
