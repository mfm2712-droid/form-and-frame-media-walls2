// In-memory stand-in for the Supabase client, used for the clearly labelled demo
// mode and for automated browser tests. Every record here is fictional. It mirrors
// the small part of the PostgREST API the Owner Desk uses, plus the database rules
// that matter for the workflow (totals, status steps, one draft, locked quotes).
import { allowedNextStatuses } from "./workflow.mjs";

const uuid = () => (globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = (message, code = "23514") => ({ data:null, error:{ message, code } });

function seed(now = new Date()) {
  const at = (days, hour = 9, minute = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
  const day = days => at(days).slice(0, 10);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const r = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003", "aaaaaaaa-0000-4000-8000-000000000004", "aaaaaaaa-0000-4000-8000-000000000005"];
  const spec = { wall:"4200", ceil:"2600", tv:"75", finish:"walnut", front:"fluted", handle:"brass", left:"cabinets", right:"shelves", fireType:"lin1", ledType:"perim", avcup:true };
  const lines = [
    { description:"MDF", quantity:"14", unit:"sheet", unit_price_pence:4200, line_total_pence:58800 },
    { description:"LED strips", quantity:"9.5", unit:"metre", unit_price_pence:1800, line_total_pence:17100 },
    { description:"Labour", quantity:"4", unit:"day", unit_price_pence:26000, line_total_pence:104000 }
  ];
  return {
    profiles:[{ id:ownerId, full_name:"Demo Owner", role:"owner" }, { id:"22222222-2222-4222-8222-222222222222", full_name:"Demo Fitter", role:"staff" }],
    consultation_requests:[
      { id:r[0], reference:"FF-DEMO-1201", created_at:at(0, 8, 12), status:"new", customer_name:"Demo Customer · Harper", email:"harper@example.com", phone:"07700 900 101", postcode:"SL4 2HT", address:"1 Example Lane\nWindsor", wall_width:"4.2 m wall", message:"75-inch TV, walnut cabinets and a linear fire. Weekday survey preferred.", project_spec:spec, guide_low:6900, guide_high:8300, source:"website", preferred_start:at(3, 9), preferred_end:at(3, 12), staff_notes:"", assessment_required:false, deleted_at:null },
      { id:r[1], reference:"FF-DEMO-1198", created_at:at(-2, 14), status:"reviewing", customer_name:"Demo Customer · Okafor", email:"okafor@example.com", phone:"07700 900 202", postcode:"SL1 5QJ", address:"", wall_width:"5.8 m wall", message:"Cinema wall with oak shelving.", project_spec:{ ...spec, finish:"oak", tv:"85" }, guide_low:9800, guide_high:11600, source:"website", staff_notes:"Prefers email.", assessment_required:true, deleted_at:null },
      { id:r[2], reference:"FF-DEMO-1190", created_at:at(-6, 10), status:"quoted", customer_name:"Demo Customer · Lindqvist", email:"lindqvist@example.com", phone:"", postcode:"SL3 8LA", address:"7 Sample Close\nLangley", wall_width:"3.1 m chimney breast", message:"Compact chimney breast, pale oak.", project_spec:{ ...spec, finish:"ash", tv:"55" }, guide_low:4900, guide_high:6100, source:"website", staff_notes:"", assessment_required:false, deleted_at:null },
      { id:r[3], reference:"FF-DEMO-1176", created_at:at(-20, 11), status:"won", customer_name:"Demo Customer · Moreau", email:"moreau@example.com", phone:"07700 900 404", postcode:"RG1 2BB", address:"22 Test Road\nReading", wall_width:"4.8 m wall", message:"Full wall with fire and floating shelf.", project_spec:spec, guide_low:8200, guide_high:9600, source:"website", staff_notes:"", assessment_required:false, deleted_at:null },
      { id:r[4], reference:"FF-DEMO-1150", created_at:at(-40, 11), status:"lost", customer_name:"Demo Customer · Byrne", email:"byrne@example.com", phone:"", postcode:"HP10 9AA", address:"", wall_width:"", message:"Changed plans.", project_spec:{}, guide_low:5000, guide_high:6000, source:"website", staff_notes:"", assessment_required:false, deleted_at:null }
    ],
    quotes:[
      { id:"bbbbbbbb-0000-4000-8000-000000000001", request_id:r[2], quote_number:"FFQ-DEMO-0190", version:1, status:"sent", subtotal_pence:179900, tax_rate_basis_points:2000, tax_pence:35980, scope:"Chimney breast media wall in pale ash with flush 55\" TV recess.", assumptions:"", valid_until:day(24), sent_at:at(-5, 16), accepted_at:null, created_at:at(-5, 15), line_items:lines, items_subtotal_pence:179900, discount_type:"none", discount_basis_points:0, discount_pence:0, exclusions:"Redecoration of adjoining walls.", terms:"50% deposit on acceptance; balance on completion.", revision_of:null, revision_requested_at:null, customer_message:"", responded_at:null },
      { id:"bbbbbbbb-0000-4000-8000-000000000002", request_id:r[3], quote_number:"FFQ-DEMO-0176", version:1, status:"accepted", subtotal_pence:162000, tax_rate_basis_points:2000, tax_pence:32400, scope:"Full-width walnut media wall with linear fire.", assumptions:"", valid_until:day(10), sent_at:at(-15), accepted_at:at(-12), created_at:at(-16), line_items:lines, items_subtotal_pence:179900, discount_type:"percent", discount_basis_points:1000, discount_pence:17990, exclusions:"", terms:"", revision_of:null, revision_requested_at:null, customer_message:"Looks great, go ahead.", responded_at:at(-12) }
    ],
    work_orders:[{ id:"cccccccc-0000-4000-8000-000000000001", request_id:r[3], accepted_quote_id:"bbbbbbbb-0000-4000-8000-000000000002", work_order_number:"FFJ-DEMO-0176", title:"Media wall · FF-DEMO-1176", status:"in_progress", assigned_to:ownerId, agreed_total_pence:194400, planned_start:day(-3), target_completion:day(6), actual_cost_pence:null, created_at:at(-12), completed_at:null }],
    appointments:[
      { id:"dddddddd-0000-4000-8000-000000000001", request_id:r[3], work_order_id:"cccccccc-0000-4000-8000-000000000001", kind:"installation", status:"scheduled", starts_at:at(5, 8), ends_at:at(5, 17), assigned_to:ownerId, location:"22 Test Road, Reading", notes:"", created_at:at(-10) },
      { id:"dddddddd-0000-4000-8000-000000000002", request_id:r[1], work_order_id:null, kind:"survey", status:"scheduled", starts_at:at(1, 10), ends_at:at(1, 11), assigned_to:ownerId, location:"SL1 5QJ", notes:"Measure alcoves", created_at:at(-1) }
    ],
    invoices:[{ id:"eeeeeeee-0000-4000-8000-000000000001", work_order_id:"cccccccc-0000-4000-8000-000000000001", invoice_number:"FFI-DEMO-0176", status:"sent", bill_to_name:"Demo Customer · Moreau", bill_to_address:"22 Test Road\nReading", issue_date:day(-12), due_date:day(2), subtotal_pence:81000, tax_rate_basis_points:2000, tax_pence:16200, sent_at:at(-12), created_at:at(-12) }],
    invoice_payments:[{ id:"ffffffff-0000-4000-8000-000000000001", recording_key:uuid(), invoice_id:"eeeeeeee-0000-4000-8000-000000000001", amount_pence:40000, received_at:at(-8), method:"bank_transfer", created_at:at(-8) }],
    follow_up_tasks:[{ id:"99999999-0000-4000-8000-000000000001", request_id:r[2], work_order_id:null, title:"Chase quotation decision", due_at:at(0, 15), assigned_to:ownerId, completed_at:null, cancelled_at:null, created_at:at(-3) }],
    availability_blocks:[{ id:"88888888-0000-4000-8000-000000000001", title:"Workshop closed", kind:"blocked", starts_at:at(9, 0), ends_at:at(10, 0), created_at:at(-4) }],
    workflow_activity:[
      { id:1, entity_type:"quote", entity_id:"bbbbbbbb-0000-4000-8000-000000000001", event_type:"status_changed", from_status:"draft", to_status:"sent", details:{}, created_at:at(-5, 16) },
      { id:2, entity_type:"quote", entity_id:"bbbbbbbb-0000-4000-8000-000000000002", event_type:"status_changed", from_status:"sent", to_status:"accepted", details:{}, created_at:at(-12) }
    ],
    request_uploads:[],
    quote_response_links:[{ id:uuid(), quote_id:"bbbbbbbb-0000-4000-8000-000000000001", token_hash:"0".repeat(64), expires_at:at(25), used_at:null, viewed_at:at(-4), decision:null, created_at:at(-5, 16) }],
    quote_catalogue_items:["Design & planning|Services|item", "Site survey|Services|visit", "MDF|Materials|sheet", "Timber|Materials|metre", "Plasterboard|Materials|sheet", "LED strips|Lighting & electrical|metre", "Electrical work|Lighting & electrical|item", "TV mounting|Installation|item", "Fireplace installation|Installation|item", "Painting & decorating|Finishing|item", "Labour|Labour|day", "Delivery|Logistics|item"]
      .map((row, index) => { const [name, category, unit] = row.split("|"); return { id:uuid(), name, category, unit, default_unit_price_pence:null, active:true, sort_order:(index + 1) * 10 }; }),
    business_settings:[],
    notification_events:[], notification_reads:[], notification_preferences:[], push_subscriptions:[]
  };
}

function balances(db) {
  return db.invoices.filter(invoice => invoice.status !== "void").map(invoice => {
    const total = invoice.subtotal_pence + invoice.tax_pence;
    const paid = db.invoice_payments.filter(payment => payment.invoice_id === invoice.id).reduce((sum, payment) => sum + payment.amount_pence, 0);
    const today = new Date().toISOString().slice(0, 10);
    return { id:invoice.id, work_order_id:invoice.work_order_id, invoice_number:invoice.invoice_number, status:invoice.status, issue_date:invoice.issue_date, due_date:invoice.due_date, currency:"GBP", subtotal_pence:invoice.subtotal_pence, tax_pence:invoice.tax_pence, total_pence:total, paid_pence:paid, outstanding_pence:invoice.status === "sent" ? Math.max(total - paid, 0) : 0, overdue:invoice.status === "sent" && invoice.due_date < today && paid < total };
  });
}

const STATUS_TABLE = { quotes:"quote", work_orders:"work_order", appointments:"appointment", invoices:"invoice" };

// Database rules worth reproducing so the demo cannot show an impossible state.
function checkRules(db, table, before, after) {
  const kind = STATUS_TABLE[table];
  if (kind && before && before.status !== after.status && !allowedNextStatuses(kind, before.status).includes(after.status)) return `Invalid status transition for ${table}: ${before.status}>${after.status}.`;
  if (table === "quotes") {
    if (before && before.status !== "draft") {
      for (const field of ["line_items", "subtotal_pence", "tax_pence", "scope", "terms", "exclusions", "valid_until", "discount_pence"]) {
        if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) return "An issued quotation is locked; create a revision for changed terms.";
      }
    }
    if (!before && db.quotes.some(quote => quote.request_id === after.request_id && quote.status === "draft")) return "This enquiry already has a draft quotation. Edit that draft instead.";
    if (after.status === "accepted" && db.quotes.some(quote => quote.request_id === after.request_id && quote.id !== after.id && quote.status === "accepted")) return "This enquiry already has an accepted quotation.";
    const lines = after.line_items || [];
    const sum = lines.reduce((total, line) => total + Number(line.line_total_pence), 0);
    if (lines.length && (after.items_subtotal_pence !== sum || after.subtotal_pence !== sum - (after.discount_pence || 0))) return "The quotation subtotal must equal the items subtotal less the discount.";
    if (after.tax_pence !== Math.round(after.subtotal_pence * after.tax_rate_basis_points / 10000)) return "Tax does not match the rate.";
  }
  if (table === "appointments" && ["scheduled", "confirmed"].includes(after.status)) {
    const clash = db.appointments.some(item => item.id !== after.id && ["scheduled", "confirmed"].includes(item.status) && item.starts_at < after.ends_at && item.ends_at > after.starts_at);
    const blocked = db.availability_blocks.some(item => item.kind !== "available" && item.starts_at < after.ends_at && item.ends_at > after.starts_at);
    if (clash) return "conflicting key value violates exclusion constraint";
    if (blocked) return "The requested appointment overlaps blocked availability.";
    if (after.ends_at <= after.starts_at) return "The appointment must end after it starts.";
  }
  if (table === "invoice_payments") {
    const invoice = db.invoices.find(item => item.id === after.invoice_id);
    const paid = db.invoice_payments.filter(item => item.invoice_id === after.invoice_id && item.id !== after.id).reduce((sum, item) => sum + item.amount_pence, 0);
    if (!invoice || invoice.status !== "sent") return "A payment can only be recorded against a sent invoice.";
    if (paid + after.amount_pence > invoice.subtotal_pence + invoice.tax_pence) return "The payment would exceed the outstanding invoice balance.";
  }
  if (table === "consultation_requests" && before && !before.deleted_at && after.deleted_at) {
    if (db.quotes.some(quote => quote.request_id === after.id && quote.status !== "draft" && !(quote.status === "superseded" && !quote.sent_at)) || db.work_orders.some(job => job.request_id === after.id)) return "This enquiry has issued quotations or a job, so it must be archived instead of deleted.";
  }
  return null;
}

function computed(table, row) {
  if (table === "quotes" || table === "invoices") return { ...row, total_pence:Number(row.subtotal_pence || 0) + Number(row.tax_pence || 0) };
  return row;
}

class Query {
  constructor(client, table) { this.client = client; this.table = table; this.filters = []; this.orders = []; this.mode = "select"; this.singleMode = null; this.countWanted = false; this.rangeFrom = null; this.rangeTo = null; this.limitTo = null; }
  select(columns = "*", options = {}) { if (this.mode === "select") this.columns = String(columns); if (options.count) this.countWanted = true; return this; }
  insert(rows) { this.mode = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, options = {}) { this.mode = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = (options.onConflict || "id").split(","); return this; }
  update(patch) { this.mode = "update"; this.payload = patch; return this; }
  delete() { this.mode = "delete"; return this; }
  eq(field, value) { this.filters.push(row => row[field] === value); return this; }
  neq(field, value) { this.filters.push(row => row[field] !== value); return this; }
  in(field, values) { this.filters.push(row => values.includes(row[field])); return this; }
  is(field, value) { this.filters.push(row => (row[field] ?? null) === value); return this; }
  lt(field, value) { this.filters.push(row => String(row[field]) < String(value)); return this; }
  lte(field, value) { this.filters.push(row => String(row[field]) <= String(value)); return this; }
  gt(field, value) { this.filters.push(row => String(row[field]) > String(value)); return this; }
  gte(field, value) { this.filters.push(row => String(row[field]) >= String(value)); return this; }
  or() { return this; }
  order(field, options = {}) { this.orders.push([field, options.ascending !== false]); return this; }
  range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
  limit(count) { this.limitTo = count; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
  rows() { return this.table === "invoice_balances" ? balances(this.client.db) : (this.client.db[this.table] || (this.client.db[this.table] = [])); }
  run() {
    const db = this.client.db;
    if (this.client.missing.has(this.table)) return fail(`relation "public.${this.table}" does not exist`, "42P01");
    // Simulates a database that has not had a migration applied yet.
    const absent = (this.columns || "").split(",").map(column => column.trim()).find(column => this.client.missingColumns.has(`${this.table}.${column}`));
    if (absent) return fail(`column ${this.table}.${absent} does not exist`, "42703");
    let result;
    if (this.mode === "insert" || this.mode === "upsert") {
      const created = [];
      for (const input of this.payload) {
        const existing = this.mode === "upsert" ? this.rows().find(row => this.conflict.every(key => row[key] === input[key])) : null;
        const before = existing ? clone(existing) : null;
        const defaults = { id:uuid(), created_at:new Date().toISOString() };
        if (this.table === "quotes") Object.assign(defaults, { status:"draft", line_items:[], discount_type:"none", discount_basis_points:0, discount_pence:0, exclusions:"", terms:"", assumptions:"", sent_at:null, accepted_at:null });
        if (this.table === "work_orders") Object.assign(defaults, { status:"accepted" });
        if (this.table === "appointments") Object.assign(defaults, { status:"scheduled", notes:"" });
        if (this.table === "invoices") Object.assign(defaults, { status:"draft", sent_at:null });
        if (this.table === "consultation_requests") Object.assign(defaults, { status:"new", project_spec:{}, deleted_at:null });
        if (this.table === "invoice_payments") Object.assign(defaults, { received_at:new Date().toISOString() });
        const next = existing ? { ...existing, ...input } : { ...defaults, ...input };
        if (!existing && this.table === "invoice_payments" && db.invoice_payments.some(row => row.recording_key === next.recording_key)) return fail("duplicate key value violates unique constraint", "23505");
        const problem = checkRules(db, this.table, before, next);
        if (problem) return fail(problem, problem.includes("exclusion") ? "23P01" : "23514");
        if (existing) Object.assign(existing, next); else this.rows().push(next);
        created.push(next);
        this.client.log(this.table, before ? "update" : "insert", next, before);
      }
      result = created;
    } else if (this.mode === "update") {
      const targets = this.rows().filter(row => this.filters.every(filter => filter(row)));
      for (const row of targets) {
        const before = clone(row), next = { ...row, ...this.payload };
        const problem = checkRules(db, this.table, before, next);
        if (problem) return fail(problem);
        if (this.table === "quotes" && before.status === "draft" && next.status === "sent") {
          for (const older of db.quotes) if (older.request_id === next.request_id && older.id !== next.id && older.status === "sent" && older.version < next.version) older.status = "superseded";
        }
        if (this.table === "consultation_requests" && next.deleted_at && !before.deleted_at) next.deleted_at = new Date().toISOString();
        Object.assign(row, next);
        this.client.log(this.table, "update", row, before);
      }
      result = targets;
    } else if (this.mode === "delete") {
      const rows = this.rows();
      result = rows.filter(row => this.filters.every(filter => filter(row)));
      db[this.table] = rows.filter(row => !result.includes(row));
    } else {
      result = this.rows().filter(row => this.filters.every(filter => filter(row)));
      for (const [field, ascending] of [...this.orders].reverse()) result = [...result].sort((a, b) => (String(a[field] ?? "") < String(b[field] ?? "") ? -1 : String(a[field] ?? "") > String(b[field] ?? "") ? 1 : 0) * (ascending ? 1 : -1));
    }
    const count = result.length;
    if (this.rangeFrom !== null) result = result.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitTo !== null) result = result.slice(0, this.limitTo);
    result = result.map(row => computed(this.table, clone(row)));
    if (this.singleMode === "one") return result.length === 1 ? { data:result[0], error:null } : fail("Expected one row", "PGRST116");
    if (this.singleMode === "maybe") return { data:result[0] || null, error:null };
    return { data:result, error:null, count:this.countWanted ? count : null };
  }
}

export function createDemoClient({ now = new Date(), missing = [], missingColumns = [] } = {}) {
  const listeners = new Set();
  const client = {
    demo:true,
    db:seed(now),
    missing:new Set(missing),
    missingColumns:new Set(missingColumns),
    log(table, action, row, before) {
      const kind = { quotes:"quote", work_orders:"work_order", appointments:"appointment", invoices:"invoice", consultation_requests:"request", invoice_payments:"payment", follow_up_tasks:"follow_up" }[table];
      if (!kind) return;
      this.db.workflow_activity.unshift({ id:this.db.workflow_activity.length + 100, entity_type:kind, entity_id:row.id, event_type:action === "insert" ? "record_created" : before?.status !== row.status ? "status_changed" : "record_updated", from_status:before?.status ?? null, to_status:row.status ?? null, actor_id:this.db.profiles[0].id, details:{}, created_at:new Date().toISOString() });
      listeners.forEach(listener => listener());
    },
    from(table) { return new Query(client, table); },
    async rpc(name, args) {
      if (name === "issue_quote_response_link") {
        const quote = client.db.quotes.find(item => item.id === args.p_quote_id);
        if (!quote || !["draft", "sent"].includes(quote.status)) return fail("Quotation not eligible");
        if (quote.valid_until && quote.valid_until < new Date().toISOString().slice(0, 10)) return fail("This quotation has passed its validity date. Create a revision instead.");
        if (quote.status === "draft") {
          const before = clone(quote);
          for (const older of client.db.quotes) if (older.request_id === quote.request_id && older.id !== quote.id && older.status === "sent") older.status = "superseded";
          Object.assign(quote, { status:"sent", sent_at:new Date().toISOString() });
          client.log("quotes", "update", quote, before);
        }
        client.db.quote_response_links.forEach(link => { if (link.quote_id === quote.id && !link.used_at) link.used_at = new Date().toISOString(); });
        client.db.quote_response_links.push({ id:uuid(), quote_id:quote.id, token_hash:args.p_token_hash, expires_at:new Date(Date.now() + 30 * 86_400_000).toISOString(), used_at:null, viewed_at:null, decision:null, created_at:new Date().toISOString() });
        return { data:null, error:null };
      }
      // Customer portal functions, mirroring get_quote_for_response and
      // record_customer_quote_decision in the migration (tested there in PostgreSQL).
      if (name === "get_quote_for_response" || name === "record_customer_quote_decision") {
        const link = client.db.quote_response_links.find(item => item.token_hash === args.p_token_hash);
        if (!link) return fail("Invalid or expired link", "P0001");
        const quote = client.db.quotes.find(item => item.id === link.quote_id);
        const today = new Date().toISOString().slice(0, 10);
        const state = link.decision ? "answered" : quote.status === "superseded" || link.used_at ? "replaced"
          : new Date(link.expires_at) <= new Date() ? "expired" : quote.status !== "sent" ? "closed"
          : quote.valid_until && quote.valid_until < today ? "expired" : null;
        if (name === "record_customer_quote_decision") {
          if (!["accepted", "rejected", "changes_requested"].includes(args.p_decision)) return fail("Invalid decision", "P0001");
          if (state) return fail(state === "expired" && link.expires_at > new Date().toISOString() ? "Quotation has expired" : "Invalid or expired link", "P0001");
          client.customerResponds(quote.id, args.p_decision, String(args.p_message || "").slice(0, 2000));
          return { data:{ ok:true, decision:args.p_decision }, error:null };
        }
        const seller = client.db.business_settings[0] || {};
        if (state) return { data:Object.fromEntries(Object.entries({ open:false, state, decision:link.decision, seller_name:seller.legal_name, seller_email:seller.contact_email, seller_phone:seller.contact_phone || null }).filter(([, value]) => value != null)), error:null };
        if (!link.viewed_at) link.viewed_at = new Date().toISOString();
        const lead = client.db.consultation_requests.find(item => item.id === quote.request_id);
        return { data:{ open:true, state:"open", link_expires_at:link.expires_at, quote_number:quote.quote_number, version:quote.version, status:quote.status, issued_at:quote.sent_at, valid_until:quote.valid_until, customer_name:lead.customer_name, reference:lead.reference, scope:quote.scope, exclusions:quote.exclusions, terms:quote.terms, line_items:quote.line_items, items_subtotal_pence:quote.items_subtotal_pence, discount_type:quote.discount_type, discount_basis_points:quote.discount_basis_points, discount_pence:quote.discount_pence, subtotal_pence:quote.subtotal_pence, tax_rate_basis_points:quote.tax_rate_basis_points, tax_pence:quote.tax_pence, total_pence:quote.subtotal_pence + quote.tax_pence, seller_name:seller.legal_name, seller_email:seller.contact_email, seller_phone:seller.contact_phone, vat_number:seller.vat_number }, error:null };
      }
      return fail(`Unknown function ${name}`, "PGRST202");
    },
    // Simulates the customer opening their link and answering (demo and tests only).
    customerResponds(quoteId, decision, message = "") {
      const quote = client.db.quotes.find(item => item.id === quoteId);
      const before = clone(quote);
      if (decision === "changes_requested") Object.assign(quote, { revision_requested_at:new Date().toISOString(), customer_message:message, responded_at:new Date().toISOString() });
      else {
        Object.assign(quote, { status:decision, accepted_at:decision === "accepted" ? new Date().toISOString() : null, customer_message:message, responded_at:new Date().toISOString() });
        const lead = client.db.consultation_requests.find(item => item.id === quote.request_id);
        if (lead) lead.status = decision === "accepted" ? "won" : "lost";
      }
      client.db.quote_response_links.forEach(link => { if (link.quote_id === quoteId && !link.used_at) { link.used_at = new Date().toISOString(); link.decision = decision; } });
      client.log("quotes", "update", quote, before);
    },
    auth:{
      async getUser() { return { data:{ user:{ id:client.db.profiles[0].id, email:"owner@example.com" } }, error:null }; },
      async getSession() { return { data:{ session:{ access_token:"demo" } }, error:null }; },
      async signOut() { return { error:null }; },
      async signInWithOtp() { return { error:null }; }
    },
    storage:{ from:() => ({ createSignedUrl:async () => ({ data:null, error:{ message:"Demo mode has no stored files." } }) }) },
    channel() { const channel = { on() { return channel; }, subscribe(callback) { callback?.("SUBSCRIBED"); return channel; } }; return channel; },
    async removeChannel() {},
    onChange(listener) { listeners.add(listener); }
  };
  return client;
}
