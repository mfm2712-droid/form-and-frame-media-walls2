import { customerMoney } from "./customers.mjs";

const dateLabel = value => (value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—");

// esc/moneyPence are injected so the module stays DOM-free and testable.
export function customersHtml(customers, { esc, moneyPence, canSeeMoney = false, limit = 50, store = null } = {}) {
  if (!customers.length) return `<p class="today-empty">No customers match. Customers appear here as soon as an enquiry is received.</p>`;
  const shown = customers.slice(0, limit);
  const rows = shown.map(customer => {
    const money = customerMoney(customer, canSeeMoney);
    const contact = [...customer.emails.map(email => `<a href="mailto:${esc(email)}">${esc(email)}</a>`), ...customer.phones.map(phone => `<a href="tel:${esc(phone.replace(/[^+\d]/g, ""))}">${esc(phone)}</a>`)].join(" · ") || "<em>No contact details recorded</em>";
    const moneyLine = canSeeMoney && money.billedPence ? `<span>Invoiced ${esc(moneyPence(money.billedPence))} · outstanding ${esc(moneyPence(money.outstandingPence))}</span>` : "";
    const refs = customer.enquiries.map(item => `<button type="button" class="outline" data-open-enquiry="${esc(item.id)}">${esc(item.reference || "Enquiry")}</button>`).join(" ");
    const recordBlock = store?.available ? customerRecordHtml(customer, { esc, canWrite: store.canWrite }) : "";
    return `<article class="business-card customer-card" data-customer="${esc(customer.key)}"><div><b>${esc(customer.name)}${customer.repeat ? ` <small>REPEAT CUSTOMER</small>` : ""}${customer.stored ? ` <small>SAVED RECORD</small>` : ""}</b><span>${contact}</span><span>${esc(customer.postcode || "No postcode")} · ${customer.enquiryCount} enquir${customer.enquiryCount === 1 ? "y" : "ies"} (${customer.openEnquiries} open) · ${customer.jobs} job${customer.jobs === 1 ? "" : "s"} · last contact ${esc(dateLabel(customer.lastContact))}</span>${moneyLine}<span>${refs}</span>${recordBlock}</div></article>`;
  }).join("");
  const more = customers.length > shown.length ? `<p class="today-empty">Showing ${shown.length} of ${customers.length}. Search to narrow the list.</p>` : "";
  return rows + more;
}

// Saved-record controls. Staff see notes read-only; only owners get the form (database RLS enforces the same).
export function customerRecordHtml(customer, { esc, canWrite }) {
  const notes = customer.notes ? `<span class="customer-notes">Notes: ${esc(customer.notes)}</span>` : "";
  if (!canWrite) return notes;
  const label = customer.stored ? "Edit saved record" : "Save to customer records";
  return `${notes}<details class="record-form"><summary>${label}</summary><form class="customer-record-form" data-customer-key="${esc(customer.key)}"><label>Name<input name="fullName" value="${esc(customer.name)}" required maxlength="200"></label><label>Notes<textarea name="notes" maxlength="2000">${esc(customer.notes || "")}</textarea></label><button type="submit">${customer.stored ? "Save changes" : "Save customer"}</button></form></details>`;
}
