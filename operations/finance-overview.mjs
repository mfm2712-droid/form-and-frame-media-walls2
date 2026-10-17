// Basic owner-only financial overview (issue #33, minimal). Pure functions over `invoice_balances` rows
// ({ status, issue_date, due_date, total_pence, paid_pence, outstanding_pence, overdue }).
// Honest scope: figures are derived from RECORDED sent invoices only (never from quotes or guide prices);
// "paid" means payments recorded against invoices ISSUED in the period (payment dates are not used here).
// Dates are YYYY-MM-DD strings (Postgres `date`), compared lexicographically; "today" is injected.

const isoDate = date => date.toISOString().slice(0, 10);
const shiftDays = (today, days) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return isoDate(d); };
const monthStart = (today, offset = 0) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset); return isoDate(d); };

export const PERIODS = Object.freeze([
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-90", label: "Last 90 days" },
  { id: "all", label: "All time" }
]);

// Inclusive from, exclusive to (null = open).
export function periodRange(id, today) {
  if (id === "this-month") return { from: monthStart(today), to: null };
  if (id === "last-month") return { from: monthStart(today, -1), to: monthStart(today) };
  if (id === "last-90") return { from: shiftDays(today, -89), to: null };
  if (id === "all") return { from: null, to: null };
  throw new Error(`Unknown finance period: ${id}`);
}

const inRange = (date, { from, to }) => Boolean(date) && (!from || date >= from) && (!to || date < to);
const num = value => Number(value || 0);

export function agedBucket(dueDate, today) {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  if (!(days > 0)) return null;
  return days <= 30 ? "1-30" : days <= 60 ? "31-60" : "61+";
}

export function financeOverview(invoices = [], { period = "this-month", today } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error("financeOverview needs today as YYYY-MM-DD");
  const range = periodRange(period, today);
  const sent = invoices.filter(invoice => invoice.status === "sent");
  const issued = sent.filter(invoice => period === "all" || inRange(invoice.issue_date, range));
  const billedPence = issued.reduce((sum, invoice) => sum + num(invoice.total_pence), 0);
  const paidPence = issued.reduce((sum, invoice) => sum + num(invoice.paid_pence), 0);
  // Snapshot as of today (not period-bound): money still owed on every sent invoice.
  const open = sent.filter(invoice => num(invoice.outstanding_pence) > 0);
  const outstandingPence = open.reduce((sum, invoice) => sum + num(invoice.outstanding_pence), 0);
  const overdueRows = open.filter(invoice => invoice.due_date && invoice.due_date < today);
  const aged = { "1-30": 0, "31-60": 0, "61+": 0 };
  for (const invoice of overdueRows) aged[agedBucket(invoice.due_date, today)] += num(invoice.outstanding_pence);
  return {
    period, range, today,
    invoicesIssued: issued.length, billedPence, paidPence,
    outstandingPence, openInvoices: open.length,
    overduePence: overdueRows.reduce((sum, invoice) => sum + num(invoice.outstanding_pence), 0), overdueCount: overdueRows.length,
    aged
  };
}
