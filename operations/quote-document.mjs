// Printable, branded customer quotation. Builds a document only: it never
// emails, charges or changes a record.
import { dateLabel, documentHead, escapeHtml, letterhead, multiline, pounds, printBar, sellerBlock } from "./document-style.mjs";

const percent = points => `${(Number(points || 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function quotationEmail(quote, customer, responseUrl = "") {
  if (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return null;
  const subject = `Form & Frame quotation ${quote.quote_number}`;
  const respond = responseUrl
    ? `You can view the full quotation and accept it, decline it or ask for changes here:\n${responseUrl}\n\nThis secure link is personal to you and expires in 30 days.`
    : "Reply to confirm acceptance or ask any questions.";
  const body = `Hello ${customer.customer_name || ""},\n\nThank you for your enquiry. Please find our quotation ${quote.quote_number} for ${pounds(quote.total_pence)}.\n\nPlease attach the PDF saved from Owner Desk before sending this email.\n\n${respond}\n\nKind regards,\nForm & Frame`;
  return `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function quoteLinesHtml(quote) {
  const lines = Array.isArray(quote.line_items) ? quote.line_items : [];
  if (!lines.length) return `<table class="items"><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody><tr><td>Media wall works as described above</td><td class="num">${pounds(quote.subtotal_pence)}</td></tr></tbody></table>`;
  return `<table class="items"><thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead><tbody>${lines.map(line => `<tr><td>${escapeHtml(line.description)}</td><td class="num">${escapeHtml(line.quantity)}</td><td>${escapeHtml(line.unit || "item")}</td><td class="num">${pounds(line.unit_price_pence)}</td><td class="num">${pounds(line.line_total_pence)}</td></tr>`).join("")}</tbody></table>`;
}

export function quoteTotalsHtml(quote, { vatRegistered = false } = {}) {
  const taxLabel = vatRegistered ? "VAT" : "Tax";
  const hasLines = Array.isArray(quote.line_items) && quote.line_items.length > 0;
  const discount = Number(quote.discount_pence || 0);
  const rows = [];
  if (hasLines) rows.push(`<div><span>Items subtotal</span><b>${pounds(quote.items_subtotal_pence)}</b></div>`);
  if (discount > 0) rows.push(`<div class="discount"><span>Discount${quote.discount_type === "percent" ? ` (${percent(quote.discount_basis_points)})` : ""}</span><b>−${pounds(discount)}</b></div>`);
  rows.push(`<div><span>${discount > 0 ? "Subtotal after discount" : "Subtotal"}</span><b>${pounds(quote.subtotal_pence)}</b></div>`);
  rows.push(`<div><span>${taxLabel}${Number(quote.tax_rate_basis_points) ? ` at ${percent(quote.tax_rate_basis_points)}` : " (not charged)"}</span><b>${pounds(quote.tax_pence)}</b></div>`);
  rows.push(`<div class="grand"><span>Total</span><span>${pounds(quote.total_pence)}</span></div>`);
  return `<section class="totals">${rows.join("")}</section>`;
}

export function renderQuotationDocument({ quote, customer, settings = null, responseUrl = "" }) {
  if (!quote?.quote_number || !customer) throw new Error("A saved quotation and customer are required.");
  const issued = quote.status !== "draft";
  const reference = `${quote.quote_number}${quote.version ? ` · version ${quote.version}` : ""}`;
  return `${documentHead(`Quotation ${quote.quote_number}`)}<body>${printBar}<main class="sheet">${issued ? "" : `<div class="stamp">DRAFT · NOT SENT</div>`}${letterhead({ title:"Quotation", reference })}<div class="body">
<section class="parties"><div><span class="label">Prepared for</span><p><b>${escapeHtml(customer.customer_name)}</b></p>${customer.address ? `<p>${multiline(customer.address)}</p>` : ""}${customer.postcode ? `<p>${escapeHtml(customer.postcode)}</p>` : ""}${customer.email ? `<p>${escapeHtml(customer.email)}</p>` : ""}${customer.phone ? `<p>${escapeHtml(customer.phone)}</p>` : ""}</div><div class="seller"><span class="label">From</span>${sellerBlock(settings)}</div></section>
<section class="facts"><div><span class="label">Quotation</span><b>${escapeHtml(quote.quote_number)}</b></div><div><span class="label">Project ref.</span><b>${escapeHtml(customer.reference || "—")}</b></div><div><span class="label">Issue date</span><b>${dateLabel(quote.sent_at || quote.created_at || new Date().toISOString())}</b></div><div><span class="label">Valid until</span><b>${dateLabel(quote.valid_until)}</b></div></section>
<h2>Scope of work</h2><p class="scope">${escapeHtml(quote.scope || "")}</p>
<h2>Itemised pricing</h2>${quoteLinesHtml(quote)}${quoteTotalsHtml(quote, { vatRegistered:Boolean(settings?.vat_number) })}
${quote.exclusions ? `<section class="panel"><h2>Not included</h2><p class="scope">${escapeHtml(quote.exclusions)}</p></section>` : ""}
${quote.terms ? `<section class="panel"><h2>Terms</h2><p class="scope">${escapeHtml(quote.terms)}</p></section>` : ""}
<section class="respond"><h2 style="margin-top:0">How to respond</h2>${responseUrl ? `<p>Open your secure link to accept, decline or ask for changes:<br><a href="${escapeHtml(responseUrl)}">${escapeHtml(responseUrl)}</a></p>` : `<p>Reply to Form &amp; Frame${settings?.contact_email ? ` at ${escapeHtml(settings.contact_email)}` : ""} to accept this quotation or ask for changes. We will confirm before scheduling any work.</p>`}<p>This quotation is not an invoice. No payment is taken by accepting it.</p></section>
</div><footer class="foot"><span>${escapeHtml(settings?.legal_name || "Form & Frame")}</span><span>${escapeHtml(reference)}</span></footer></main></body></html>`;
}
