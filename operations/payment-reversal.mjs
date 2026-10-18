// Owner-only payment reversal hook (issue #14). Reversals are append-only records created by the
// optional database draft (supabase/drafts/*payment_reversals*). Until that draft is applied the
// reversal table does not exist: this module detects that and the UI shows nothing extra.
// UI gating is convenience only; row level security in the database decides who may insert.

export const REVERSAL_REASON_MIN = 5;
export const REVERSAL_REASON_MAX = 500;

export const canReversePayments = role => role === "owner";

// PostgREST: PGRST205 = relation not in schema cache; Postgres 42P01 = undefined_table; HTTP 404.
export function isReversalTableMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "PGRST205" || code === "42P01" || Number(error.status) === 404;
}

export function normaliseReversalReason(value) {
  const reason = String(value ?? "").trim();
  return reason.length >= REVERSAL_REASON_MIN && reason.length <= REVERSAL_REASON_MAX ? reason : null;
}

// The server copies amount and invoice from the payment, so only these fields are ever sent.
export function reversalPayload(paymentId, reason, reversalKey) {
  const clean = normaliseReversalReason(reason);
  if (!paymentId || !clean || !reversalKey) return null;
  return { payment_id: paymentId, reason: clean, reversal_key: reversalKey };
}

// Pending keys let a double-click or a retry after a lost response reuse one idempotency key.
export function reversalKeyFor(pending, paymentId, createId = () => crypto.randomUUID()) {
  if (!pending.has(paymentId)) pending.set(paymentId, createId());
  return pending.get(paymentId);
}

export function ledgerRows(invoiceId, payments = [], reversals = []) {
  const reversed = new Map(reversals.map(row => [row.payment_id, row]));
  return payments
    .filter(payment => payment.invoice_id === invoiceId)
    .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))
    .map(payment => ({ ...payment, reversal: reversed.get(payment.id) || null }));
}

// Never throws. available=false means "not enabled yet" (table missing) or "could not load";
// the caller then simply omits the ledger instead of failing the whole dashboard.
export async function loadPaymentLedger(db) {
  try {
    const [payments, reversals] = await Promise.all([
      db.from("invoice_payments").select("id, invoice_id, amount_pence, method, received_at").order("received_at").limit(1000),
      db.from("invoice_payment_reversals").select("id, payment_id, invoice_id, amount_pence, reason, created_at").limit(1000)
    ]);
    if (reversals.error) return { available: false, reason: isReversalTableMissing(reversals.error) ? "not_enabled" : "unavailable", payments: [], reversals: [] };
    if (payments.error) return { available: false, reason: "unavailable", payments: [], reversals: [] };
    return { available: true, reason: null, payments: payments.data || [], reversals: reversals.data || [] };
  } catch {
    return { available: false, reason: "unavailable", payments: [], reversals: [] };
  }
}

export function paymentLedgerHtml(rows, { canReverse, esc, money, formatDate }) {
  if (!rows.length) return "";
  const items = rows.map(row => {
    const state = row.reversal
      ? `<small>Reversed ${esc(formatDate(row.reversal.created_at))} · ${esc(row.reversal.reason)}</small>`
      : canReverse ? `<button class="outline" type="button" data-reverse-payment="${esc(row.id)}">Reverse</button>` : "";
    return `<li class="${row.reversal ? "payment-reversed" : ""}"><span>${esc(formatDate(row.received_at))} · ${esc(String(row.method).replaceAll("_", " "))} · ${row.reversal ? `<s>${money(row.amount_pence)}</s>` : money(row.amount_pence)}</span> ${state}</li>`;
  }).join("");
  return `<details class="record-form payment-ledger"><summary>Payments (${rows.length})</summary><ul>${items}</ul>${canReverse ? "<small>A reversal is permanent and recorded in the activity log; record the correct payment separately.</small>" : ""}</details>`;
}
