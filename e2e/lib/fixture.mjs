// Shared test harness: one Chrome + one static server per test file. All data is FICTIONAL.
import { buildSite, serve, launch } from "./env.mjs";
import { installMock, seedSession } from "./mock-supabase.mjs";

export async function startSuite() {
  const root = buildSite();
  const { server, url } = await serve(root);
  const browser = await launch();
  return {
    url, browser,
    async page({ width = 1280, height = 900, mobile = false, mock = {}, session = false, dialogs = null } = {}) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error" && !/Failed to load resource|WebSocket connection/.test(message.text())) errors.push(message.text()); });
      if (session) await seedSession(page);
      const state = await installMock(page, mock);
      const dialogLog = [];
      page.on("dialog", async dialog => { dialogLog.push(dialog.message()); if (dialogs === "accept") await dialog.accept(); else await dialog.dismiss(); });
      return { page, state, errors, dialogLog };
    },
    async close() { await browser.close(); server.close(); }
  };
}

const days = n => new Date(Date.now() + n * 86400000).toISOString();
export const fictionalLeads = () => [
  { id: "lead-1", reference: "FF-E2E-001", customer_name: "Amelia Grant", email: "amelia@example.test", phone: "", postcode: "SL4 2HT", wall_width: "4.2 m wall", message: "E2E fictional enquiry one.", status: "reviewing", source: "website", guide_low: 6950, guide_high: 8250, created_at: days(-1), site_assessment_required: false },
  { id: "lead-2", reference: "FF-E2E-002", customer_name: "A. Grant", email: "AMELIA@example.test", phone: "07700 900111", postcode: "SL4 2HT", wall_width: "3.1 m wall", message: "E2E fictional repeat enquiry.", status: "new", source: "website", guide_low: 4900, guide_high: 6100, created_at: days(-3), site_assessment_required: false },
  { id: "lead-3", reference: "FF-E2E-003", customer_name: "Hugo Clarke", email: "", phone: "07700 900222", postcode: "SL1 5QJ", wall_width: "5.8 m wall", message: "E2E fictional enquiry three.", status: "quoted", source: "website", guide_low: 9800, guide_high: 11600, created_at: days(-5), site_assessment_required: false }
];

const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
export const fictionalMoney = () => ({
  quotes: [{ id: "q-1", request_id: "lead-3", quote_number: "FFQ-20261001-AAAA", version: 1, status: "sent", subtotal_pence: 800000, tax_rate_basis_points: 2000, tax_pence: 160000, total_pence: 960000, scope: "E2E fictional scope", valid_until: day(20), sent_at: new Date().toISOString(), created_at: new Date(Date.now() - 4 * 86400000).toISOString() }],
  work_orders: [{ id: "w-1", request_id: "lead-1", work_order_number: "FFJ-20261002-BBBB", title: "E2E fictional media wall", status: "accepted", agreed_total_pence: 500000, actual_cost_pence: 120000, planned_start: null, target_completion: null, created_at: new Date(Date.now() - 2 * 86400000).toISOString() }],
  invoice_balances: [
    { id: "i-1", work_order_id: "w-1", invoice_number: "FFI-20261003-CCCC", status: "sent", issue_date: day(-3), due_date: day(-1), currency: "GBP", subtotal_pence: 100000, tax_pence: 20000, total_pence: 120000, paid_pence: 20000, outstanding_pence: 100000, overdue: true },
    { id: "i-2", work_order_id: "w-1", invoice_number: "FFI-20261004-DDDD", status: "sent", issue_date: day(-2), due_date: day(28), currency: "GBP", subtotal_pence: 50000, tax_pence: 10000, total_pence: 60000, paid_pence: 0, outstanding_pence: 60000, overdue: false }
  ],
  invoices: []
});

export const fictionalNotifications = () => [
  { id: "n-1", request_id: "lead-1", channel: "push", event_type: "new_enquiry", payload: { reference: "FF-E2E-001", customer_name: "Amelia Grant" }, created_at: new Date(Date.now() - 3600e3).toISOString() },
  { id: "n-2", request_id: "lead-2", channel: "push", event_type: "new_enquiry", payload: { reference: "FF-E2E-002", customer_name: "A. Grant" }, created_at: new Date(Date.now() - 7200e3).toISOString() }
];
export const numberingRpc = { allocate_document_number: body => ({ quote: "FFQ-000001", work_order: "FFJ-000001", invoice: "FFI-000001" })[body.kind] };
