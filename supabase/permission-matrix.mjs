// Single source of truth for the proposed Owner / Manager / Staff matrix.
// Letters: S select, I insert, U update, D delete, "-" none. "s*" = filtered select.
// Derived from the real tables in supabase/migrations/*. PROPOSAL: not applied.
export const ROLES = ["owner", "manager", "staff"];

export const PERMISSION_MATRIX = {
  profiles:               { owner: "S",   manager: "S",   staff: "S" },
  consultation_requests:  { owner: "SIU", manager: "SIU", staff: "SIU" },
  request_uploads:        { owner: "SIUD", manager: "SIUD", staff: "SIUD" },
  availability_blocks:    { owner: "SIUD", manager: "SIUD", staff: "SIUD" },
  appointments:           { owner: "SIU", manager: "SIU", staff: "SIU" },
  follow_up_tasks:        { owner: "SIU", manager: "SIU", staff: "SIU" },
  quotes:                 { owner: "SIU", manager: "SIU", staff: "-" },
  work_orders:            { owner: "SIU", manager: "SIU", staff: "-" },
  work_orders_staff_view: { owner: "S",   manager: "S",   staff: "S" },
  invoices:               { owner: "SIU", manager: "SIU", staff: "-" },
  invoice_payments:       { owner: "SI",  manager: "S",   staff: "-" },
  invoice_balances:       { owner: "S",   manager: "S",   staff: "-" },
  work_order_financial_summary: { owner: "S", manager: "S", staff: "-" },
  workflow_activity:      { owner: "S",   manager: "S",   staff: "s*" },
  business_settings:      { owner: "SIU", manager: "S",   staff: "-" }
};

// Tables that hold money, quotes, customers' prices or seller financial data.
export const FINANCIAL_TABLES = ["quotes", "work_orders", "invoices", "invoice_payments", "invoice_balances", "work_order_financial_summary", "business_settings"];

export function allows(table, role, op) {
  const cell = PERMISSION_MATRIX[table]?.[role];
  if (!cell) throw new Error(`No matrix entry for ${table}/${role}`);
  return cell.toLowerCase().replace("*", "").includes(op.toLowerCase());
}
