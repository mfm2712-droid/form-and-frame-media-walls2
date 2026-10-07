export function surveyReadiness({ appointments = [], requestId } = {}) {
  const surveys = appointments.filter(item => item.request_id === requestId && item.kind === "survey");
  const completed = surveys.some(item => item.status === "completed");
  const booked = surveys.some(item => ["scheduled", "confirmed"].includes(item.status));
  return { completed, booked };
}

export function canIssueQuote({ assessmentRequired = false, appointments = [], requestId } = {}) {
  if (!assessmentRequired) return true;
  return surveyReadiness({ appointments, requestId }).completed;
}
