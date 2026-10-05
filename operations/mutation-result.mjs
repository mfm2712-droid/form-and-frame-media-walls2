export function requirePersistedRow(result) {
  if (result?.error) throw result.error;
  const row = result?.data;
  if (!row || Array.isArray(row) || typeof row.id !== "string" || !row.id) {
    throw new Error("The database did not confirm a saved row.");
  }
  return row;
}
