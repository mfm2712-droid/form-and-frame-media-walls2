// Printable customer quotation. No payment or email is sent by this module.
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const pounds = pence => new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format(Number(pence || 0)/100);
export function quotationEmail(quote, customer) {
  if (!customer?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) return null;
  const subject = `Form & Frame quotation ${quote.quote_number}`;
  const body = `Hello ${customer.customer_name || ""},\n\nPlease find our quotation ${quote.quote_number} for ${pounds(quote.total_pence)}. We have prepared a PDF quotation for your review.\n\nPlease attach the PDF saved from Owner Desk before sending this email. Reply to confirm acceptance or ask any questions.\n\nKind regards,\nForm & Frame`;
  return `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function renderQuotationDocument({quote, customer}) {
  if (!quote?.quote_number || !customer) throw new Error("A saved quotation and customer are required.");
  const rows = [
    ["Subtotal", pounds(quote.subtotal_pence)],
    ["Tax", pounds(quote.tax_pence)],
    ["Total", pounds(quote.total_pence)]
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quotation ${escapeHtml(quote.quote_number)}</title><style>body{font:15px/1.6 Arial,sans-serif;color:#15372f;max-width:760px;margin:40px auto;padding:25px}.brand{display:flex;align-items:center;gap:16px;margin-bottom:20px}.brand b{font-size:22px;letter-spacing:3px}.brand small{display:block;letter-spacing:2px}header{border-bottom:3px solid #c3a066;padding-bottom:18px}h1{font-size:35px;margin:10px 0}h2{font-size:18px;margin-top:35px}small{color:#555}pre{white-space:pre-wrap;font:inherit}table{width:100%;border-collapse:collapse;margin-top:22px}td{border-bottom:1px solid #ddd;padding:12px 0}td:last-child{text-align:right;font-weight:bold}.notice{background:#f5f0e5;padding:14px;margin-top:35px}@media print{body{margin:0;padding:12mm}.notice{break-inside:avoid}}</style></head><body><header><div class="brand"><svg width="54" height="54" viewBox="0 0 512 512" aria-label="Form & Frame mark"><rect width="512" height="512" rx="112" fill="#0e342c"/><path d="M118 142h276v26H118zm0 202h276v26H118zM142 168h26v176h-26zm202 0h26v176h-26z" fill="#f1ecdf"/><path d="M244 228h24v56h-24z" fill="#c99b55"/></svg><span><b>FORM &amp; FRAME</b><small>DESIGN · BUILD · INSTALL</small></span></div><small>CUSTOMER QUOTATION</small><h1>Quotation</h1><strong>${escapeHtml(quote.quote_number)}</strong></header><p>Prepared for: <strong>${escapeHtml(customer.customer_name)}</strong><br>Project reference: ${escapeHtml(customer.reference || "")}<br>${customer.email ? `Email: ${escapeHtml(customer.email)}<br>` : ""}${customer.postcode ? `Location: ${escapeHtml(customer.postcode)}<br>` : ""}Date: ${new Date().toLocaleDateString("en-GB")}${quote.valid_until ? `<br>Valid until: ${escapeHtml(quote.valid_until)}` : ""}</p><h2>Scope of work</h2><pre>${escapeHtml(quote.scope || "")}</pre><h2>Quotation total</h2><table>${rows.map(([label,amount])=>`<tr><td>${label}</td><td>${amount}</td></tr>`).join("")}</table><div class="notice">This quotation is provided for review and is not an invoice or payment request. Please confirm acceptance with Form &amp; Frame before any work is scheduled.</div></body></html>`;
}
