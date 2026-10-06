// Complete staff-visible financial coverage; never silently total a capped page.
export async function loadBusinessRows(client, table, order, ascending = false) {
  if (!["consultation_requests", "quotes", "work_orders", "invoice_balances", "invoices"].includes(table)) throw new Error("Unsupported business table.");
  const rows = [], seen = new Set();
  let expected = null;
  while (true) {
    const { data, count, error } = await client.from(table).select("*", { count:"exact" })
      .order(order, { ascending }).order("id").range(rows.length, rows.length + 249);
    if (error) throw error;
    if (!Array.isArray(data) || !Number.isSafeInteger(count) || count < 0) throw new Error("Business record coverage could not be verified.");
    if (expected !== null && expected !== count) throw new Error("Business records changed while loading. Refresh the desk.");
    expected = count;
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error("Business records changed while loading. Refresh the desk.");
      seen.add(row.id); rows.push(row);
    }
    if (rows.length === count) return { data:rows, error:null };
    if (!data.length || rows.length > count) throw new Error("Business records are incomplete. Refresh the desk.");
  }
}
