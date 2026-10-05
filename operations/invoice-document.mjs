const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);
const pounds = value => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP" }).format(Number(value || 0) / 100);
const dateLabel = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "Not set";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { dateStyle:"long", timeZone:"UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
};

export function invoiceSettingsReady(settings) {
  return !!(settings && String(settings.legal_name || "").trim().length >= 2
    && String(settings.billing_address || "").trim().length >= 5
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.contact_email || "").trim()));
}

export function renderInvoiceDocument({ settings, invoice, balance, workOrder, customerEmail = "" }) {
  if (!invoiceSettingsReady(settings)) throw new Error("Complete the legal business name, billing address and contact email first.");
  if (!invoice || !balance || !workOrder) throw new Error("Invoice, balance and build records are all required.");
  const subtotal = Number(invoice.subtotal_pence), tax = Number(invoice.tax_pence), total = Number(invoice.total_pence);
  if (![subtotal, tax, total].every(Number.isSafeInteger) || subtotal < 0 || tax < 0 || subtotal + tax !== total) {
    throw new Error("The saved invoice totals could not be verified.");
  }
  const isDraft = invoice.status !== "sent";
  const taxLabel = String(settings.vat_number || "").trim() ? "VAT" : "Tax";
  const sellerAddress = escapeHtml(settings.billing_address).replace(/\r?\n/g, "<br>");
  const buyerAddress = escapeHtml(invoice.bill_to_address).replace(/\r?\n/g, "<br>");
  const footer = String(settings.invoice_footer || "").trim();
  const paymentInstructions = String(settings.payment_instructions || "").trim();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eef0ec;color:#202820;font:15px/1.5 Arial,sans-serif}.sheet{position:relative;max-width:820px;min-height:1060px;margin:24px auto;padding:64px;background:white;box-shadow:0 8px 32px #172f2418}.top{display:flex;justify-content:space-between;gap:36px;border-bottom:2px solid #174638;padding-bottom:28px}.brand{color:#174638;font-size:26px;font-weight:700;letter-spacing:.02em}.muted{color:#68736b}.label{font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#68736b}.doc-title{margin:0;color:#174638;font-size:32px}.seller{text-align:right;max-width:330px}.draft-stamp{position:absolute;top:300px;right:64px;transform:rotate(-16deg);padding:9px 20px;border:3px solid #a95c4d;color:#a95c4d;font-size:26px;font-weight:700;letter-spacing:.12em}.parties{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:42px 0}.parties p{margin:7px 0}.details{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:30px 0;padding:20px;background:#f5f6f3;border-radius:10px}.details span{display:block}.table{width:100%;border-collapse:collapse;margin-top:38px}.table th{text-align:left;background:#174638;color:white;padding:12px}.table td{padding:14px 12px;border-bottom:1px solid #e3e7e1}.right{text-align:right}.totals{width:min(360px,100%);margin:20px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:16px;padding:8px 4px}.grand{border-top:2px solid #174638;margin-top:8px;font-size:20px;font-weight:700;color:#174638}.payment{margin-top:44px;padding:22px;border:1px solid #dce2da;border-radius:10px}.payment h2{margin:0 0 8px;font-size:17px}.footer{margin-top:50px;padding-top:18px;border-top:1px solid #e3e7e1;color:#68736b;font-size:12px}.actions{max-width:820px;margin:16px auto;text-align:right}.actions button{border:0;border-radius:8px;padding:12px 18px;background:#174638;color:#fff;font-weight:700;cursor:pointer}@media(max-width:640px){.sheet{min-height:auto;margin:0;padding:28px 20px;box-shadow:none}.top{display:block}.seller{text-align:left;margin-top:22px}.parties{gap:16px;margin:28px 0}.details{grid-template-columns:1fr}.draft-stamp{top:240px;right:20px}.actions{padding:12px}}@media print{body{background:white}.sheet{max-width:none;min-height:0;margin:0;padding:18mm;box-shadow:none}.actions{display:none}@page{size:A4;margin:0}}
</style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet">${isDraft ? `<div class="draft-stamp">DRAFT · NOT SENT</div>` : ""}<header class="top"><div><div class="brand">FORM &amp; FRAME</div><h1 class="doc-title">Invoice</h1><div class="muted">${escapeHtml(settings.company_number ? `Company no. ${settings.company_number}` : "")}</div></div><div class="seller"><b>${escapeHtml(settings.legal_name)}</b><p>${sellerAddress}</p><p>${escapeHtml(settings.contact_email)}${settings.contact_phone ? `<br>${escapeHtml(settings.contact_phone)}` : ""}</p>${settings.vat_number ? `<p>VAT no. ${escapeHtml(settings.vat_number)}</p>` : ""}</div></header>
<section class="parties"><div><div class="label">Bill to</div><p><b>${escapeHtml(invoice.bill_to_name)}</b></p><p>${buyerAddress}</p>${customerEmail ? `<p>${escapeHtml(customerEmail)}</p>` : ""}</div><div><div class="label">Project</div><p><b>${escapeHtml(workOrder.title)}</b></p><p>${escapeHtml(workOrder.work_order_number)}</p></div></section>
<section class="details"><div><span class="label">Invoice number</span><b>${escapeHtml(invoice.invoice_number)}</b></div><div><span class="label">Issue date</span><b>${dateLabel(invoice.issue_date)}</b></div><div><span class="label">Payment due</span><b>${dateLabel(invoice.due_date)}</b></div></section>
<table class="table"><thead><tr><th>Description</th><th class="right">Amount</th></tr></thead><tbody><tr><td>${escapeHtml(workOrder.title)}</td><td class="right">${pounds(subtotal)}</td></tr><tr><td>${taxLabel}${invoice.tax_rate_basis_points ? ` · ${(Number(invoice.tax_rate_basis_points) / 100).toFixed(2)}%` : ""}</td><td class="right">${pounds(tax)}</td></tr></tbody></table>
<section class="totals"><div><span>Invoice total</span><b>${pounds(total)}</b></div><div><span>Payments received</span><b>${pounds(balance.paid_pence)}</b></div><div class="grand"><span>Balance due</span><span>${pounds(balance.outstanding_pence)}</span></div></section>
${paymentInstructions ? `<section class="payment"><h2>How to pay</h2><p>${escapeHtml(paymentInstructions).replace(/\r?\n/g, "<br>")}</p></section>` : ""}<footer class="footer">${footer ? escapeHtml(footer).replace(/\r?\n/g, "<br>") : ""}</footer></main></body></html>`;
}
