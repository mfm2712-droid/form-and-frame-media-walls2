const fieldLabels = Object.freeze({
  accepted_quote_id: "accepted quote",
  actual_cost_pence: "actual cost",
  assigned_to: "assignee",
  bill_to_address: "billing address",
  bill_to_name: "billing name",
  cancelled_at: "cancellation",
  completed_at: "completion",
  due_at: "due time",
  due_date: "due date",
  ends_at: "end time",
  issue_date: "issue date",
  kind: "type",
  location: "location",
  notes: "notes",
  planned_start: "planned start",
  scope: "quote scope",
  starts_at: "start time",
  status: "status",
  subtotal_pence: "subtotal",
  target_completion: "target completion",
  tax_pence: "tax amount",
  tax_rate_basis_points: "tax rate",
  title: "title",
  valid_until: "quote expiry"
});

const statusText = value => String(value || "").replaceAll("_", " ");

// Activity details deliberately describe field names only; never render stored values here.
export function activityDetailText(item) {
  if (item?.from_status) return `${statusText(item.from_status)} → ${statusText(item.to_status)}`;
  const labels = Array.isArray(item?.details?.changed_fields)
    ? [...new Set(item.details.changed_fields.filter(field => typeof field === "string").map(field => fieldLabels[field]).filter(Boolean))].sort()
    : [];
  return labels.length ? `Changed: ${labels.join(", ")}` : statusText(item?.to_status);
}
