export function getLocalDayBounds(value = new Date()) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTodayAgenda(items, now = new Date()) {
  const { start, end } = getLocalDayBounds(now);
  const todayNewEnquiries = [];
  const todayVisitWindows = [];

  for (const item of items) {
    const createdAt = validDate(item.created_at);
    if (createdAt && createdAt >= start && createdAt < end) todayNewEnquiries.push(item);

    if (item.status !== "date_requested" && item.status !== "confirmed") continue;
    const preferredStart = validDate(item.preferred_start);
    const preferredEnd = validDate(item.preferred_end);
    if (preferredStart && preferredEnd && preferredStart < end && preferredEnd > start) {
      todayVisitWindows.push(item);
    }
  }

  todayNewEnquiries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  todayVisitWindows.sort((a, b) => new Date(a.preferred_start) - new Date(b.preferred_start));
  return { todayNewEnquiries, todayVisitWindows };
}

/**
 * Returns a human-readable next-action phrase for a given enquiry status.
 * @param {string} status
 */
export function nextAction(status) {
  const actions = {
    new: "Follow up / assign",
    reviewing: "Schedule survey",
    date_requested: "Confirm visit date",
    confirmed: "Prepare for visit",
    quoted: "Follow up quote",
    won: "Close won",
    lost: "Close lost",
    archived: "No action needed",
  };
  return actions[status] || "No action needed";
}

/**
 * Returns a formatted relevant date string for the Today view,
 * preferring the preferred visit window over the created_at timestamp.
 * @param {object} item
 */
export function relevantDate(item) {
  if (item.preferred_start && item.preferred_end) {
    const start = new Date(item.preferred_start);
    const end = new Date(item.preferred_end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return `${formatDate(start)} – ${formatDate(end)}`;
    }
  }
  if (item.created_at) {
    return formatDate(validDate(item.created_at));
  }
  return undefined;
}

/**
 * Formats a Date into a concise en-GB string (e.g. "Sat 4 Oct, 9:30am").
 * @param {Date|string|null|undefined} d
 * @returns {string} A formatted date string, or "—" if the date is invalid.
 */
export function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date);
}