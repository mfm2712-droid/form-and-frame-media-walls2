// Customer view derived from enquiries (+ optional job/quote/invoice records). Issue #32 (G7), minimal slice.
// There is no `customers` table: a customer is whoever appears on one or more enquiries
// (`consultation_requests`). Enquiries that share an email OR a phone number are the same customer.
// Pure functions only: nothing here reads or writes the database, so it works before any migration.
// The matching table design is in supabase/drafts/*customers_DRAFT.sql (NOT applied).

export const normaliseEmail = value => {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

// UK-centric: digits only, +44 / 0044 -> leading 0. Too-short values are not usable as identity.
export const normalisePhone = value => {
  let digits = String(value ?? "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+44")) digits = "0" + digits.slice(3);
  else if (digits.startsWith("0044")) digits = "0" + digits.slice(4);
  digits = digits.replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
};

const byNewest = (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""));

export function deriveCustomers(leads = [], { quotes = [], workOrders = [], invoices = [] } = {}) {
  const parent = new Map();
  const find = key => { while (parent.get(key) !== key) { parent.set(key, parent.get(parent.get(key))); key = parent.get(key); } return key; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const ids = [];
  for (const lead of leads) {
    const id = `lead:${lead.id}`; ids.push(id); parent.set(id, id);
  }
  const owner = new Map(); // identity key -> lead node
  for (const lead of leads) {
    const node = `lead:${lead.id}`;
    for (const key of [normaliseEmail(lead.email) && `e:${normaliseEmail(lead.email)}`, normalisePhone(lead.phone) && `p:${normalisePhone(lead.phone)}`].filter(Boolean)) {
      if (owner.has(key)) union(owner.get(key), node); else owner.set(key, node);
    }
  }
  const groups = new Map();
  for (const lead of leads) {
    const root = find(`lead:${lead.id}`);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(lead);
  }
  const requestToJobs = new Map(), requestToQuotes = new Map(), requestToInvoices = new Map();
  const add = (map, request, row) => { if (!request) return; if (!map.has(request)) map.set(request, []); map.get(request).push(row); };
  for (const job of workOrders) add(requestToJobs, job.request_id, job);
  for (const quote of quotes) add(requestToQuotes, quote.request_id, quote);
  const jobToRequest = new Map(workOrders.map(job => [job.id, job.request_id]));
  for (const invoice of invoices) add(requestToInvoices, jobToRequest.get(invoice.work_order_id) || invoice.request_id, invoice);

  const customers = [...groups.values()].map(group => {
    const enquiries = [...group].sort(byNewest);
    const newest = enquiries[0];
    const pick = field => enquiries.map(item => item[field]).find(value => String(value ?? "").trim()) || "";
    const emails = [...new Set(enquiries.map(item => normaliseEmail(item.email)).filter(Boolean))];
    const phones = [...new Set(enquiries.map(item => String(item.phone ?? "").trim()).filter(Boolean))];
    const requestIds = enquiries.map(item => item.id);
    const collect = map => requestIds.flatMap(id => map.get(id) || []);
    const jobs = collect(requestToJobs), customerQuotes = collect(requestToQuotes), customerInvoices = collect(requestToInvoices);
    return {
      key: emails[0] ? `e:${emails[0]}` : (normalisePhone(phones[0]) ? `p:${normalisePhone(phones[0])}` : `lead:${newest.id}`),
      name: String(pick("customer_name")).trim() || "Unnamed customer",
      emails, phones, postcode: String(pick("postcode")).trim(),
      enquiries, enquiryCount: enquiries.length,
      firstContact: enquiries[enquiries.length - 1].created_at || null,
      lastContact: newest.created_at || null,
      openEnquiries: enquiries.filter(item => !["won", "lost", "archived"].includes(item.status)).length,
      jobs: jobs.length, activeJobs: jobs.filter(job => !["completed", "cancelled"].includes(job.status)).length,
      quotes: customerQuotes.length, invoices: customerInvoices,
      repeat: enquiries.length > 1
    };
  });
  return customers.sort((a, b) => String(b.lastContact || "").localeCompare(String(a.lastContact || "")));
}

// Money for one customer (sent invoices only, matching the finance panel). Owner-only: callers pass
// canSeeMoney from the role capabilities; without it money fields are null (never computed).
export function customerMoney(customer, canSeeMoney) {
  if (!canSeeMoney) return { billedPence: null, paidPence: null, outstandingPence: null };
  const sent = customer.invoices.filter(invoice => invoice.status === "sent");
  const sum = field => sent.reduce((total, invoice) => total + Number(invoice[field] || 0), 0);
  return { billedPence: sum("total_pence"), paidPence: sum("paid_pence"), outstandingPence: sum("outstanding_pence") };
}

export function filterCustomers(customers, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return customers;
  const digits = needle.replace(/\D/g, "");
  return customers.filter(customer => [customer.name, customer.postcode, ...customer.emails, ...customer.phones, ...customer.enquiries.map(item => item.reference)]
    .some(value => String(value ?? "").toLowerCase().includes(needle)) || (digits.length >= 4 && customer.phones.some(phone => normalisePhone(phone).includes(digits))));
}
