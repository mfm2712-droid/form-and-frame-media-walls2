const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function enquiryTargetFromSearch(search = "") {
  const value = new URLSearchParams(search).get("enquiry") || "";
  return UUID.test(value) ? value : null;
}

export function operationsViewFromSearch(search = "") {
  const value = new URLSearchParams(search).get("view") || "";
  return ["today", "work", "calendar", "money"].includes(value) ? value : null;
}
