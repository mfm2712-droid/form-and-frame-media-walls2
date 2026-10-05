const transitions = Object.freeze({
  quote:{ draft:["sent"], sent:["accepted", "rejected", "expired", "superseded"] },
  work_order:{ accepted:["ready_to_build", "in_progress", "cancelled"], ready_to_build:["in_progress", "cancelled"], in_progress:["quality_check", "cancelled"], quality_check:["in_progress", "ready_for_install", "cancelled"], ready_for_install:["installation_scheduled", "cancelled"], installation_scheduled:["installed", "cancelled"], installed:["completed"] },
  appointment:{ scheduled:["confirmed", "cancelled", "completed"], confirmed:["cancelled", "completed"] },
  invoice:{ draft:["sent"], sent:["void"] }
});

export function allowedNextStatuses(type, current) {
  return [current, ...(transitions[type]?.[current] || [])];
}

export function poundsToPence(value) {
  if (typeof value === "string" && !value.trim()) return null;
  const pounds = Number(value);
  if (!Number.isFinite(pounds) || pounds < 0) return null;
  const pence = Math.round(pounds * 100);
  return Number.isSafeInteger(pence) ? pence : null;
}

export function calculateTax(subtotalPence, ratePercent) {
  if (!Number.isSafeInteger(subtotalPence) || subtotalPence < 0) return null;
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  const rateBasisPoints = Math.round(rate * 100);
  const taxPence = Math.round(subtotalPence * rateBasisPoints / 10000);
  const totalPence = subtotalPence + taxPence;
  if (!Number.isSafeInteger(taxPence) || !Number.isSafeInteger(totalPence)) return null;
  return { taxRateBasisPoints:rateBasisPoints, taxPence, totalPence };
}

export function taxRateForAmount(subtotalPence, taxPence) {
  if (!Number.isSafeInteger(subtotalPence) || subtotalPence < 0 || !Number.isSafeInteger(taxPence) || taxPence < 0) return null;
  if (subtotalPence === 0) return taxPence === 0 ? 0 : null;
  const rateBasisPoints = Math.round(taxPence * 10000 / subtotalPence);
  if (rateBasisPoints > 10000 || Math.round(subtotalPence * rateBasisPoints / 10000) !== taxPence) return null;
  return rateBasisPoints;
}
