// Team assignment helpers for the two-person Form & Frame team.
// Profiles are read through Supabase RLS and only id and full_name are
// used, so emails and other private profile fields never reach the UI.

export const UNASSIGNED_VALUE = "";
export const UNASSIGNED_LABEL = "Unassigned";
export const FALLBACK_MEMBER_LABEL = "Team member";
export const UNKNOWN_MEMBER_LABEL = "Unknown team member";

const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[character]));

// A neutral label keeps the control readable when a profile has no full name.
export function memberLabel(profile) {
  const fullName = String(profile?.full_name ?? "").trim();
  return fullName || FALLBACK_MEMBER_LABEL;
}

// Every assignment control lists the explicit Unassigned choice first.
export function assignmentOptions(profiles) {
  const members = (Array.isArray(profiles) ? profiles : [])
    .filter(profile => profile && typeof profile.id === "string" && profile.id.trim() !== "")
    .map(profile => ({ value:profile.id, label:memberLabel(profile) }));
  return [{ value:UNASSIGNED_VALUE, label:UNASSIGNED_LABEL }, ...members];
}

// Resolve a record's assigned_to UUID to the visible team member's label.
export function assignmentLabel(assignedTo, profiles) {
  const id = String(assignedTo ?? "").trim();
  if (!id) return UNASSIGNED_LABEL;
  const member = (Array.isArray(profiles) ? profiles : []).find(profile => profile && profile.id === id);
  return member ? memberLabel(member) : UNKNOWN_MEMBER_LABEL;
}

export function assignmentOptionsHtml(profiles, currentValue) {
  const selected = String(currentValue ?? "").trim();
  return assignmentOptions(profiles).map(option => `<option value="${esc(option.value)}"${option.value === selected ? " selected" : ""}>${esc(option.label)}</option>`).join("");
}

// While the profile lookup is failing, assignment stays disabled but still
// shows the record's current state instead of pretending nobody is assigned.
export function assignmentUnavailableOptionsHtml(assignedTo) {
  const id = String(assignedTo ?? "").trim();
  const unassigned = `<option value="${UNASSIGNED_VALUE}"${id ? "" : " selected"}>${UNASSIGNED_LABEL}</option>`;
  return id ? `${unassigned}<option value="${esc(id)}" selected>${UNKNOWN_MEMBER_LABEL}</option>` : unassigned;
}
