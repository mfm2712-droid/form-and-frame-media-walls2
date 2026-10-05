export const PIPELINE_STAGES = [
  { label: "New enquiry", className: "pipeline-new" },
  { label: "Needs review", className: "pipeline-negotiating" },
  { label: "Visit requested", className: "pipeline-visit" },
  { label: "Visit marked confirmed", className: "pipeline-visit" },
  { label: "Quote sent", className: "pipeline-quote" },
  { label: "Accepted job", className: "pipeline-wip" },
];

const STATUS_TO_PIPELINE_INDEX = Object.freeze({
  new: 0,
  reviewing: 1,
  date_requested: 2,
  confirmed: 3,
  quoted: 4,
  won: 5,
});

export function pipelineIndexForStatus(status) {
  return Object.hasOwn(STATUS_TO_PIPELINE_INDEX, status) ? STATUS_TO_PIPELINE_INDEX[status] : -1;
}

export function isQuoteFollowUp(status) {
  return status === "quoted";
}

export function isConfirmedVisitStatus(status) {
  return status === "confirmed";
}
