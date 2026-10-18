import { PERIODS } from "./finance-overview.mjs";

// Owner-only. Callers must not call this without the money capability; it still refuses to render
// anything when `canSeeMoney` is false (defence in depth).
export function financeOverviewHtml(overview, { esc, moneyPence, canSeeMoney = false } = {}) {
  if (!canSeeMoney) return "";
  const label = PERIODS.find(period => period.id === overview.period)?.label || overview.period;
  const options = PERIODS.map(period => `<option value="${esc(period.id)}"${period.id === overview.period ? " selected" : ""}>${esc(period.label)}</option>`).join("");
  const card = (name, value, note) => `<div><span>${esc(name)}</span><b>${esc(value)}</b>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
  return `<div class="section-head"><div><p>FINANCE OVERVIEW · OWNERS ONLY</p><h3>Invoices &amp; cash — ${esc(label)}</h3></div><label class="finance-period"><span class="sr-only">Period</span><select id="financePeriod" aria-label="Finance period">${options}</select></label></div>`
    + `<div class="business-metrics finance-grid">`
    + card("Invoiced", moneyPence(overview.billedPence), `${overview.invoicesIssued} sent invoice${overview.invoicesIssued === 1 ? "" : "s"} issued in period`)
    + card("Paid so far", moneyPence(overview.paidPence), "against those invoices")
    + card("Outstanding now", moneyPence(overview.outstandingPence), `${overview.openInvoices} open invoice${overview.openInvoices === 1 ? "" : "s"}, all dates`)
    + card("Overdue now", moneyPence(overview.overduePence), `${overview.overdueCount} invoice${overview.overdueCount === 1 ? "" : "s"} past due`)
    + `</div><p class="finance-aged"><b>Overdue by age</b> · 1–30 days ${esc(moneyPence(overview.aged["1-30"]))} · 31–60 days ${esc(moneyPence(overview.aged["31-60"]))} · 61+ days ${esc(moneyPence(overview.aged["61+"]))}</p>`
    + `<small class="finance-note">Recorded sent invoices only — quotes and website guide prices are not counted. "Paid" counts payments recorded against invoices issued in the period.</small>`;
}
