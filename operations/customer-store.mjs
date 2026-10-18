// Persistent customer records (issue #32, owner decision 18 Oct 2026: customers table = YES).
// The table comes from the UNAPPLIED draft supabase/drafts/20261018120000_customers_DRAFT.sql. Until an owner
// approves and applies it the table does not exist, and EVERYTHING here degrades to the list derived from
// enquiries (operations/customers.mjs): nothing breaks, nothing is written.
// UI gating is convenience only. Row level security is the control: staff may read, only owners may insert/update.
import { normaliseEmail, normalisePhone } from "./customers.mjs";

export const CUSTOMER_COLUMNS = "id, full_name, email, phone_normalised, postcode, notes, created_at, updated_at";
export const NOTES_MAX = 2000;

export const canWriteCustomers = role => role === "owner";

// PostgREST: PGRST205 = relation not in schema cache; Postgres 42P01 = undefined_table; HTTP 404.
export function isCustomersTableMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "PGRST205" || code === "42P01" || Number(error.status) === 404;
}

// Never throws. { available:false } means "use the derived list only".
export async function loadCustomerRecords(db) {
  try {
    const { data, error } = await db.from("customers").select(CUSTOMER_COLUMNS).order("full_name").limit(1000);
    if (error) return isCustomersTableMissing(error) ? { available: false, rows: [], error: null } : { available: false, rows: [], error };
    return { available: true, rows: data || [], error: null };
  } catch (error) {
    return isCustomersTableMissing(error) ? { available: false, rows: [], error: null } : { available: false, rows: [], error };
  }
}

// The record to store for a derived customer. Identity rule matches the database draft: lower(email) OR normalised phone.
export function customerPayload(customer, { fullName, notes } = {}) {
  const name = String(fullName ?? customer.name ?? "").trim();
  if (!name) return { error: "A customer name is required." };
  const cleanNotes = String(notes ?? customer.notes ?? "").trim();
  if (cleanNotes.length > NOTES_MAX) return { error: `Notes are limited to ${NOTES_MAX} characters.` };
  const email = (customer.emails || [])[0] ? normaliseEmail(customer.emails[0]) : "";
  const phone = (customer.phones || []).map(normalisePhone).find(Boolean) || "";
  return { payload: { full_name: name, email: email || null, phone_normalised: phone || null, postcode: String(customer.postcode ?? "").trim() || null, notes: cleanNotes || null } };
}

// Attach stored records to the derived list. A stored record matches by email or phone. The owner-edited
// name and notes win over the derived ones; stored customers with no enquiry in the loaded window still appear.
export function mergeStoredCustomers(derived, rows = []) {
  const byEmail = new Map(), byPhone = new Map();
  for (const row of rows) {
    if (row.email) byEmail.set(row.email, row);
    if (row.phone_normalised) byPhone.set(row.phone_normalised, row);
  }
  const used = new Set();
  const merged = derived.map(customer => {
    const record = customer.emails.map(email => byEmail.get(email)).find(Boolean) || customer.phones.map(phone => byPhone.get(normalisePhone(phone))).find(Boolean) || null;
    if (!record) return { ...customer, record: null, stored: false, notes: "" };
    used.add(record.id);
    return { ...customer, name: record.full_name || customer.name, postcode: customer.postcode || record.postcode || "", record, stored: true, notes: record.notes || "" };
  });
  for (const row of rows) {
    if (used.has(row.id)) continue;
    merged.push({ key: `c:${row.id}`, name: row.full_name, emails: row.email ? [row.email] : [], phones: row.phone_normalised ? [row.phone_normalised] : [], postcode: row.postcode || "",
      enquiries: [], enquiryCount: 0, firstContact: null, lastContact: row.updated_at || row.created_at || null, openEnquiries: 0, jobs: 0, activeJobs: 0, quotes: 0, invoices: [], repeat: false,
      record: row, stored: true, notes: row.notes || "" });
  }
  return merged;
}

// Owner-only create/update. Returns { saved, error?, unavailable? }; never throws. `role` is checked here as well as in the UI.
export async function saveCustomerRecord(db, role, customer, edits = {}) {
  if (!canWriteCustomers(role)) return { saved: false, error: "Only an owner can change customer records." };
  const built = customerPayload(customer, edits);
  if (built.error) return { saved: false, error: built.error };
  if (!built.payload.email && !built.payload.phone_normalised && !customer.record) return { saved: false, error: "This customer has no email or phone number, so they cannot be matched to a record." };
  try {
    const query = customer.record?.id
      ? db.from("customers").update({ ...built.payload, updated_at: new Date().toISOString() }).eq("id", customer.record.id)
      : db.from("customers").insert(built.payload);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      if (isCustomersTableMissing(error)) return { saved: false, unavailable: true, error: "Customer records are not set up yet." };
      if (String(error.code) === "23505") return { saved: false, error: "Another customer record already uses this email or phone number." };
      if (String(error.code) === "42501") return { saved: false, error: "Only an owner can change customer records." };
      return { saved: false, error: "The customer record could not be saved." };
    }
    if (!data) return { saved: false, error: "The change was not applied (no row was updated). Refresh and try again." };
    return { saved: true };
  } catch {
    return { saved: false, error: "The customer record could not be saved." };
  }
}
