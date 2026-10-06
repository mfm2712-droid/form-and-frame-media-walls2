export function calendarWindow(date, mode = "month") {
  const anchor = new Date(date);
  if (!Number.isFinite(anchor.getTime()) || !["month", "week"].includes(mode)) throw new Error("Invalid calendar period.");
  const start = mode === "month" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + (mode === "month" ? 42 : 7));
  return { start, end };
}

async function overlappingRows(client, table, { start, end }) {
  const rows = [], seen = new Set();
  let expectedCount = null, offset = 0;
  // Request exact coverage rather than treating a server row cap as completeness.
  while (true) {
    const { data, error, count } = await client.from(table).select("*", { count:"exact" })
      .lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString())
      .order("starts_at").order("id").range(offset, offset + 249);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new Error("Calendar coverage could not be verified.");
    if (expectedCount !== null && expectedCount !== count) throw new Error("Calendar changed while loading. Refresh this period.");
    expectedCount = count;
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error("Calendar changed while loading. Refresh this period.");
      seen.add(row.id); rows.push(row);
    }
    offset += data.length;
    if (rows.length === count) return rows;
    if (!data.length || rows.length > count) throw new Error("Calendar coverage is incomplete. Refresh this period.");
  }
}

export async function loadCalendarRecords(client, period) {
  const [blocks, appointments] = await Promise.all([
    overlappingRows(client, "availability_blocks", period),
    overlappingRows(client, "appointments", period)
  ]);
  return { blocks, appointments };
}
