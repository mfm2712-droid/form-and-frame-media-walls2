import test from "node:test";
import assert from "node:assert/strict";
import { invoiceSettingsReady, renderInvoiceDocument } from "./invoice-document.mjs";

const settings = { legal_name:"Form & Frame Ltd", billing_address:"1 Workshop Road\nSlough", contact_email:"accounts@formandframe.co.uk", contact_phone:"01753 000 000", company_number:"12345678", vat_number:"GB123456789", payment_instructions:"Bank transfer · account details supplied separately", invoice_footer:"Thank you for your business." };
const invoice = { invoice_number:"FFI-20261005-AB12", status:"sent", issue_date:"2026-10-05", due_date:"2026-10-19", bill_to_name:"Fictional Customer", bill_to_address:"1 Example Street\nSlough", subtotal_pence:100000, tax_pence:20000, total_pence:120000, tax_rate_basis_points:2000 };
const balance = { paid_pence:30000, outstanding_pence:90000 };
const workOrder = { title:"Media wall installation", work_order_number:"FFJ-20261005-CD34" };

test("invoice seller setup requires legal name, address and a contact email", () => {
  assert.equal(invoiceSettingsReady(settings), true);
  assert.equal(invoiceSettingsReady({ ...settings, legal_name:"" }), false);
  assert.equal(invoiceSettingsReady({ ...settings, billing_address:"" }), false);
  assert.equal(invoiceSettingsReady({ ...settings, contact_email:"not-an-email" }), false);
});

test("invoice print document contains saved billing facts and a draft warning", () => {
  const html = renderInvoiceDocument({ settings, invoice:{ ...invoice, status:"draft" }, balance, workOrder, customerEmail:"customer@example.test" });
  assert.match(html, /DRAFT · NOT SENT/);
  assert.match(html, /FFI-20261005-AB12/);
  assert.match(html, /1,000\.00/);
  assert.match(html, /200\.00/);
  assert.match(html, /900\.00/);
  assert.match(html, /Bank transfer/);
  assert.match(html, /customer@example\.test/);
  assert.match(html, /@page\{size:A4/);
});

test("sent invoice document does not contain a draft stamp", () => {
  const html = renderInvoiceDocument({ settings, invoice, balance, workOrder });
  assert.doesNotMatch(html, /DRAFT · NOT SENT/);
  assert.match(html, /VAT · 20\.00%/);
});

test("invoice customer and company text are HTML escaped", () => {
  const html = renderInvoiceDocument({
    settings:{ ...settings, legal_name:"<script>seller</script>" },
    invoice:{ ...invoice, bill_to_name:"<img src=x onerror=alert(1)>" },
    balance, workOrder:{ ...workOrder, title:"<svg onload=alert(1)>" }
  });
  assert.doesNotMatch(html, /<script>seller|<img src=x|<svg onload/);
  assert.match(html, /&lt;script&gt;seller&lt;\/script&gt;/);
});

test("invoice totals must be internally consistent", () => {
  assert.throws(() => renderInvoiceDocument({ settings, invoice:{ ...invoice, total_pence:119999 }, balance, workOrder }), /totals could not be verified/);
  assert.throws(() => renderInvoiceDocument({ settings:{}, invoice, balance, workOrder }), /legal business name/);
});
