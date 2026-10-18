// Business document numbers (quote / build job / invoice).
// When the optional server-side numbering migration (supabase/drafts/*server_side_numbering*)
// has been applied, numbers come from database sequences via the `allocate_document_number`
// RPC. When it has NOT been applied, behaviour is exactly the previous browser-generated
// number, now with a bounded retry if the unique constraint is hit.

export const DOCUMENT_KINDS = Object.freeze({
  quote: { prefix: "FFQ", column: "quote_number" },
  work_order: { prefix: "FFJ", column: "work_order_number" },
  invoice: { prefix: "FFI", column: "invoice_number" }
});

export function localDocumentNumber(kind, now = new Date(), randomId = () => crypto.randomUUID()) {
  const spec = DOCUMENT_KINDS[kind];
  if (!spec) throw new Error("Unknown document kind.");
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `${spec.prefix}-${day}-${randomId().slice(0, 4).toUpperCase()}`;
}

// PostgREST reports an unknown function as PGRST202 (HTTP 404); Postgres as 42883.
export function isFunctionMissing(error) {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "PGRST202" || code === "42883" || Number(error.status) === 404;
}

export function isUniqueViolation(error) {
  return Boolean(error) && String(error.code || "") === "23505";
}

const serverFormat = { quote: /^FFQ-\d{6,}$/, work_order: /^FFJ-\d{6,}$/, invoice: /^FFI-\d{6,}$/ };

// Returns { number, source: "server" | "local" }. A cached `state.serverSupported === false`
// skips the RPC once the function is known to be missing (until page reload).
export async function allocateDocumentNumber(db, kind, state = {}, deps = {}) {
  if (!DOCUMENT_KINDS[kind]) throw new Error("Unknown document kind.");
  if (state.serverSupported !== false) {
    const { data, error } = await db.rpc("allocate_document_number", { kind });
    if (!error) {
      if (typeof data !== "string" || !serverFormat[kind].test(data)) throw new Error("The server returned an unexpected document number.");
      state.serverSupported = true;
      return { number: data, source: "server" };
    }
    if (!isFunctionMissing(error)) throw error; // permission/network problems must not be hidden
    state.serverSupported = false;
  }
  return { number: localDocumentNumber(kind, deps.now?.() ?? new Date(), deps.randomId), source: "local" };
}

// Inserts a row, allocating its number. In the browser-generated fallback a unique
// violation on the number is retried with a fresh number (bounded). Server numbers are
// never retried locally: a failure is surfaced.
export async function insertWithNumber(db, kind, buildRow, state = {}, deps = {}) {
  const spec = DOCUMENT_KINDS[kind];
  const table = { quote: "quotes", work_order: "work_orders", invoice: "invoices" }[kind];
  const attempts = deps.maxAttempts ?? 3;
  let last;
  for (let i = 0; i < attempts; i++) {
    const { number, source } = await allocateDocumentNumber(db, kind, state, deps);
    last = await db.from(table).insert({ ...buildRow(), [spec.column]: number }).select("id").single();
    const unique = isUniqueViolation(last?.error) && new RegExp(spec.column).test(`${last.error.message || ""} ${last.error.details || ""}`);
    if (!(source === "local" && unique)) return last;
  }
  return last;
}
