const STORAGE_KEY = "form-frame:pending-payment-recordings:v1";

function intentKey(invoiceId, amountPence, method) {
  return JSON.stringify([invoiceId, amountPence, method]);
}

function readPending(storage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function getPaymentRecordingKey(storage, invoiceId, amountPence, method, createId = () => crypto.randomUUID()) {
  const key = intentKey(invoiceId, amountPence, method);
  const pending = readPending(storage);
  if (typeof pending[key] === "string" && pending[key]) return pending[key];
  const recordingKey = createId();
  pending[key] = recordingKey;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch { /* The form keeps its in-memory key when storage is unavailable. */ }
  return recordingKey;
}

export function clearPaymentRecordingKey(storage, invoiceId, amountPence, method) {
  const key = intentKey(invoiceId, amountPence, method);
  const pending = readPending(storage);
  if (!(key in pending)) return;
  delete pending[key];
  try { storage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch { /* A later lookup can safely reuse the pending key. */ }
}

export function paymentMatchesIntent(payment, invoiceId, amountPence, method) {
  return Boolean(payment)
    && payment.invoice_id === invoiceId
    && Number(payment.amount_pence) === amountPence
    && payment.method === method;
}
