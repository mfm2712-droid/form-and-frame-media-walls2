// Role-aware visibility for the staff app (issue #28).
// This is a USABILITY / DEFENCE-IN-DEPTH layer only. Row level security in the database is the
// real control (see docs/PERMISSION_MATRIX.md and the unapplied draft in PR #23). The UI must
// behave sensibly both before that draft is applied (everyone can still read everything) and
// after (staff are denied money tables), so it never relies on a denied query succeeding.
import { nextJobStep } from "./enquiry-workspace.mjs";

const NONE = Object.freeze({ role: null, known: false, money: false, costEntry: false, settingsRead: false, settingsWrite: false, reversePayments: false });

// Decision (Mark, 2026-10-18): Thiago and Anthony are both owners with identical permissions; no Manager
// role is needed now, so no UI copy mentions one. The manager branch below stays dormant.
// owner: everything. manager (dormant): money read/write drafts, no actual-cost entry, settings read-only.
// staff (and any unknown role): operational records only, no money.
export function capabilitiesFor(role) {
  if (role === "owner") return Object.freeze({ role, known: true, money: true, costEntry: true, settingsRead: true, settingsWrite: true, reversePayments: true });
  if (role === "manager") return Object.freeze({ role, known: true, money: true, costEntry: false, settingsRead: true, settingsWrite: false, reversePayments: false });
  if (role === "staff") return Object.freeze({ role, known: true, money: false, costEntry: false, settingsRead: false, settingsWrite: false, reversePayments: false });
  return NONE;
}

// Money columns on work orders. Staff never display or use them.
export const WORK_ORDER_MONEY_FIELDS = Object.freeze(["agreed_total_pence", "actual_cost_pence"]);

export function stripWorkOrderMoney(row) {
  const copy = { ...row };
  for (const field of WORK_ORDER_MONEY_FIELDS) copy[field] = null;
  copy.accepted_quote_id = null;
  return copy;
}

export const MONEY_ENTITY_TYPES = Object.freeze(["quote", "invoice", "payment"]);
export const filterActivityForCaps = (rows, caps) => caps.money ? rows : rows.filter(row => !MONEY_ENTITY_TYPES.includes(row.entity_type));

// Loads job rows for a role without money access: prefer the money-free view from the permissions
// draft; if it does not exist yet (draft not applied) fall back to the base table and strip money
// fields client-side. A failure of BOTH is returned as an error so the dashboard fails closed.
export async function loadWorkOrdersForCaps(loadRows, caps) {
  // loadBusinessRows() throws on a database error, so normalise throws into { error } results.
  const attempt = async table => { try { return await loadRows(table); } catch (error) { return { data: null, error }; } };
  if (caps.money) return attempt("work_orders");
  const view = await attempt("work_orders_staff_view");
  if (!view.error) return view;
  const base = await attempt("work_orders");
  if (base.error) return base;
  return { data: (base.data || []).map(stripWorkOrderMoney), error: null, source: "base_table_stripped" };
}

const MONEY_ACTIONS = new Set(["create-quote", "send-quote", "accept-quote", "create-job", "create-invoice", "send-invoice", "record-payment"]);

// Staff cannot act on money steps, so the "next step" never points at one.
export function roleAdjustedAction(action, rel, caps) {
  if (caps.money || !MONEY_ACTIONS.has(action.id)) return action;
  const job = rel?.job;
  const step = job && job.status !== "completed" ? nextJobStep(job.status) : null;
  if (step && job.status !== "cancelled") return { id: "advance-job", label: step.label, hint: "Quotes, invoices and payments are handled by the owners.", primary: true };
  return { id: "none", label: "Waiting on the owners", hint: "Quotes, invoices and payments are handled by the owners.", primary: false };
}
