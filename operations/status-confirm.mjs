// Confirmation wording for money/commitment-changing status changes (issue #30).
// One table is shared by the workspace buttons and the legacy <select data-record-status> controls so
// the two paths cannot drift apart (before: the select path never asked).
const TEXT = Object.freeze({
  "quote:sent": "Record this quotation as sent?\n\nSend it to the customer yourself first. Form & Frame does not email customers.",
  "quote:accepted": "Record that the customer accepted this quotation?\n\nAccepted quotations are locked.",
  "quote:rejected": "Record that the customer declined this quotation?",
  "quote:expired": "Mark this quotation as expired?",
  "invoice:sent": "Record this invoice as issued?\n\nIssue it to the customer yourself. Form & Frame does not email invoices, and sent invoices are locked.",
  "invoice:void": "Void this invoice?\n\nA void invoice cannot be reopened. Create a corrected invoice if one is needed.",
  "work_order:completed": "Mark this job as completed?",
  "work_order:cancelled": "Cancel this build job? It will drop out of the schedule.",
  "appointment:cancelled": "Cancel this booked appointment? The time will become available again. No message is sent to the customer."
});

// kind: quote | invoice | work_order | appointment (also accepts the workspace aliases job/…)
export function confirmTextFor(kind, value) {
  const normalised = kind === "job" ? "work_order" : kind;
  return TEXT[`${normalised}:${value}`] || null;
}

// Returns true when the change may proceed. `ask` is window.confirm (injectable for tests).
export function confirmStatusChange(kind, value, ask) {
  const text = confirmTextFor(kind, value);
  return text ? Boolean(ask(text)) : true;
}
