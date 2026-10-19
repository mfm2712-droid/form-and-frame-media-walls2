// Printable, branded invoice matching the quotation design. Building it never
// sends the invoice or takes a payment.
import { dateLabel, documentHead, escapeHtml, letterhead, multiline, pounds, printBar, sellerBlock } from "./document-style.mjs";

export function invoiceSettingsReady(settings) {
  return !!(settings && String(settings.legal_name || "").trim().length >= 2
    && String(settings.billing_address || "").trim().length >= 5
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.contact_email || "").trim()));
}

export function renderInvoiceDocument({ settings, invoice, balance, workOrder, customerEmail = "", quote = null }) {
  if (!invoiceSettingsReady(settings)) throw new Error("Complete the legal business name, billing address and contact email first.");
  if (!invoice || !balance || !workOrder) throw new Error("Invoice, balance and build records are all required.");
  const subtotal = Number(invoice.subtotal_pence), tax = Number(invoice.tax_pence), total = Number(invoice.total_pence);
  if (![subtotal, tax, total].every(Number.isSafeInteger) || subtotal < 0 || tax < 0 || subtotal + tax !== total) {
    throw new Error("The saved invoice totals could not be verified.");
  }
  const isDraft = invoice.status !== "sent";
  const taxLabel = String(settings.vat_number || "").trim() ? "VAT" : "Tax";
  const footer = String(settings.invoice_footer || "").trim();
  const paymentInstructions = String(settings.payment_instructions || "").trim();
  const reference = invoice.invoice_number;
  const quoteNote = quote?.quote_number ? `<p class="scope">As agreed in quotation ${escapeHtml(quote.quote_number)}${quote.version ? ` (version ${escapeHtml(quote.version)})` : ""}.</p>` : "";
  return `${documentHead(`Invoice ${invoice.invoice_number}`)}<body>${printBar}<main class="sheet">${isDraft ? `<div class="stamp">DRAFT · NOT SENT</div>` : ""}${letterhead({ title:"Invoice", reference })}<div class="body">
<section class="parties"><div><span class="label">Bill to</span><p><b>${escapeHtml(invoice.bill_to_name)}</b></p><p>${multiline(invoice.bill_to_address)}</p>${customerEmail ? `<p>${escapeHtml(customerEmail)}</p>` : ""}</div><div class="seller"><span class="label">From</span>${sellerBlock(settings)}</div></section>
<section class="facts"><div><span class="label">Invoice number</span><b>${escapeHtml(invoice.invoice_number)}</b></div><div><span class="label">Project</span><b>${escapeHtml(workOrder.work_order_number)}</b></div><div><span class="label">Issue date</span><b>${dateLabel(invoice.issue_date)}</b></div><div><span class="label">Payment due</span><b>${dateLabel(invoice.due_date)}</b></div></section>
<h2>${escapeHtml(workOrder.title)}</h2>${quoteNote}
<table class="items"><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody><tr><td>${escapeHtml(workOrder.title)}</td><td class="num">${pounds(subtotal)}</td></tr><tr><td>${taxLabel}${invoice.tax_rate_basis_points ? ` · ${(Number(invoice.tax_rate_basis_points) / 100).toFixed(2)}%` : ""}</td><td class="num">${pounds(tax)}</td></tr></tbody></table>
<section class="totals"><div><span>Invoice total</span><b>${pounds(total)}</b></div><div><span>Payments received</span><b>${pounds(balance.paid_pence)}</b></div><div class="grand"><span>Balance due</span><span>${pounds(balance.outstanding_pence)}</span></div></section>
${paymentInstructions ? `<section class="panel"><h2>How to pay</h2><p>${multiline(paymentInstructions)}</p></section>` : `<section class="panel"><h2>How to pay</h2><p class="missing">Payment instructions are not configured. Contact Form &amp; Frame before paying.</p></section>`}
</div><footer class="foot"><span>${footer ? multiline(footer) : escapeHtml(settings.legal_name)}</span><span>${escapeHtml(reference)}</span></footer></main></body></html>`;
}
