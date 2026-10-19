// Shared Form & Frame letterhead for printable quotations and invoices.
// Brand: forest green #0e342c, brass #c99b55, warm paper #f1ecdf, the FF frame
// mark from the app icon, Playfair Display headings and DM Sans text.

export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
export const pounds = pence => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP" }).format(Number(pence || 0) / 100);
export const multiline = value => escapeHtml(value).replace(/\r?\n/g, "<br>");
export const dateLabel = value => {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Not set";
  const [year, month, day] = text.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { dateStyle:"long", timeZone:"UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
};

export const BRAND_MARK = `<svg class="mark" viewBox="0 0 512 512" role="img" aria-label="Form &amp; Frame"><rect width="512" height="512" rx="112" fill="#0e342c"/><path d="M118 142h276v26H118zm0 202h276v26H118zM142 168h26v176h-26zm202 0h26v176h-26z" fill="#f1ecdf"/><path d="M244 228h24v56h-24z" fill="#c99b55"/></svg>`;

export const DOCUMENT_CSS = `*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{margin:0;background:#e9e5da;color:#1d211c;font:14px/1.55 "DM Sans",Arial,sans-serif}
.sheet{position:relative;max-width:820px;margin:24px auto;padding:0 0 40px;background:#fff;box-shadow:0 10px 40px rgba(14,52,44,.18)}
.band{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:34px 56px;background:#0e342c;color:#f1ecdf}
.band .mark{width:58px;height:58px;border-radius:14px;outline:1px solid rgba(201,155,85,.6)}
.wordmark{display:flex;align-items:center;gap:16px}.wordmark b{display:block;font:700 26px/1 "Playfair Display",Georgia,serif;letter-spacing:.04em}.wordmark b i{font-style:normal;color:#c99b55}.wordmark small{display:block;margin-top:6px;font:500 10px "DM Mono",monospace;letter-spacing:.22em;color:#d8c596}
.band .doc{text-align:right}.band .doc h1{margin:0;font:700 30px/1 "Playfair Display",Georgia,serif;color:#fff}.band .doc span{display:block;margin-top:8px;font:500 12px "DM Mono",monospace;letter-spacing:.08em;color:#d8c596}
.rule{height:4px;background:linear-gradient(90deg,#c99b55,#e6d1a5 60%,#c99b55)}
.body{padding:34px 56px 0}.label{display:block;margin-bottom:4px;font:500 10px "DM Mono",monospace;letter-spacing:.16em;text-transform:uppercase;color:#8a7a5a}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:36px}.parties p{margin:4px 0}.parties .seller{text-align:right}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:28px 0;background:#e6dfcf;border:1px solid #e6dfcf}.facts div{padding:12px 14px;background:#faf7f0}.facts b{font-size:14px}
h2{margin:30px 0 10px;font:700 18px "Playfair Display",Georgia,serif;color:#0e342c}
.scope{white-space:pre-wrap;margin:0}
table.items{width:100%;border-collapse:collapse;margin-top:8px}.items th{padding:10px 10px;background:#0e342c;color:#f1ecdf;font:500 10px "DM Mono",monospace;letter-spacing:.12em;text-transform:uppercase;text-align:left}.items th.num{text-align:right}.items td{padding:11px 10px;border-bottom:1px solid #ece6d8;vertical-align:top}.items tr:nth-child(even) td{background:#fbf9f4}.num{text-align:right;white-space:nowrap}
.totals{width:min(380px,100%);margin:18px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:16px;padding:7px 4px;border-bottom:1px solid #f0ebdf}.totals .discount{color:#7a4a2f}.totals .grand{margin-top:6px;padding:12px;background:#0e342c;color:#fff;border:0;font-size:18px;font-weight:600}.totals .grand span:last-child{color:#e6d1a5}
.panel{margin-top:28px;padding:18px 20px;border:1px solid #e6dfcf;border-left:4px solid #c99b55;background:#fbf9f4}.panel h2{margin-top:0}
.respond{margin-top:28px;padding:20px;background:#f1ecdf;border-radius:4px}.respond a{color:#0e342c;font-weight:600;word-break:break-all}
.missing{color:#a84137;font-style:italic}
.foot{margin:36px 56px 0;padding-top:14px;border-top:1px solid #e6dfcf;color:#6e675b;font-size:11px;display:flex;justify-content:space-between;gap:20px}
.stamp{position:absolute;top:170px;right:56px;transform:rotate(-12deg);padding:8px 18px;border:3px solid #a84137;color:#a84137;font:700 22px "DM Mono",monospace;letter-spacing:.12em;background:rgba(255,255,255,.85)}
.actions{max-width:820px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:10px}.actions button{border:0;padding:12px 18px;background:#0e342c;color:#fff;font:600 13px "DM Sans",Arial,sans-serif;cursor:pointer;border-radius:6px}
@media(max-width:640px){.sheet{margin:0;box-shadow:none}.band,.body{padding-left:20px;padding-right:20px}.band{flex-direction:column;align-items:flex-start}.band .doc{text-align:left}.parties{grid-template-columns:1fr}.parties .seller{text-align:left}.facts{grid-template-columns:1fr 1fr}.foot{margin:30px 20px 0;flex-direction:column}.actions{padding:0 12px}.stamp{top:210px;right:20px}}
@media print{body{background:#fff}.sheet{max-width:none;margin:0;box-shadow:none}.actions{display:none}tr,.panel,.totals{break-inside:avoid}@page{size:A4;margin:12mm 0}}`;

export function documentHead(title) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@500&family=DM+Sans:wght@400;600&family=Playfair+Display:wght@700&display=swap" rel="stylesheet"><style>${DOCUMENT_CSS}</style></head>`;
}

export function letterhead({ title, reference }) {
  return `<header class="band"><div class="wordmark">${BRAND_MARK}<span><b>FORM <i>&amp;</i> FRAME</b><small>BESPOKE MEDIA WALLS · DESIGN · BUILD · INSTALL</small></span></div><div class="doc"><h1>${escapeHtml(title)}</h1><span>${escapeHtml(reference)}</span></div></header><div class="rule"></div>`;
}

// Seller block. Missing legal details are shown as missing, never invented.
export function sellerBlock(settings) {
  if (!settings?.legal_name) return `<p class="missing">Company details not yet configured in Settings.</p>`;
  return `<p><b>${escapeHtml(settings.legal_name)}</b></p>${settings.billing_address ? `<p>${multiline(settings.billing_address)}</p>` : ""}<p>${escapeHtml(settings.contact_email || "")}${settings.contact_phone ? `<br>${escapeHtml(settings.contact_phone)}` : ""}</p>${settings.company_number ? `<p>Company no. ${escapeHtml(settings.company_number)}</p>` : ""}${settings.vat_number ? `<p>VAT no. ${escapeHtml(settings.vat_number)}</p>` : ""}`;
}

export const printBar = `<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>`;
