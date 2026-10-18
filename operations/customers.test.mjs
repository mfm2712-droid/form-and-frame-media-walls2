import test from "node:test";
import assert from "node:assert/strict";
import { customerMoney, deriveCustomers, filterCustomers, normaliseEmail, normalisePhone } from "./customers.mjs";
import { customersHtml } from "./customers-view.mjs";

const lead = (id, extra = {}) => ({ id, reference: `FF-${id}`, customer_name: "Test Person", status: "new", created_at: `2026-10-0${id}T10:00:00Z`, ...extra });

test("emails and UK phone numbers are normalised for identity", () => {
  assert.equal(normaliseEmail("  A.B@Example.COM "), "a.b@example.com");
  assert.equal(normaliseEmail("not-an-email"), "");
  for (const form of ["07700 900123", "+44 7700 900123", "0044 7700 900 123", "(07700) 900-123"]) assert.equal(normalisePhone(form), "07700900123");
  assert.equal(normalisePhone("12345"), "", "too short to be an identity");
});

test("enquiries sharing an email OR a phone are one customer; unrelated ones stay separate", () => {
  const customers = deriveCustomers([
    lead(1, { customer_name: "Amelia Grant", email: "Amelia@Example.test" }),
    lead(2, { customer_name: "A. Grant", email: "amelia@example.test", phone: "07700 900111" }),
    lead(3, { customer_name: "Amelia G", phone: "+44 7700 900111" }),   // joins via phone, transitively
    lead(4, { customer_name: "Someone Else", email: "else@example.test" }),
    lead(5, { customer_name: "No Contact" })
  ]);
  assert.equal(customers.length, 3);
  const amelia = customers.find(c => c.emails.includes("amelia@example.test"));
  assert.equal(amelia.enquiryCount, 3);
  assert.equal(amelia.repeat, true);
  assert.deepEqual(amelia.enquiries.map(e => e.id), [3, 2, 1], "newest first");
  assert.equal(amelia.name, "Amelia G", "name taken from the newest enquiry that has one");
  assert.equal(customers.filter(c => !c.repeat).length, 2);
  assert.equal(customers.find(c => c.name === "No Contact").key, "lead:5");
});

test("no identity data never merges customers", () => {
  assert.equal(deriveCustomers([lead(1), lead(2), lead(3)]).length, 3);
  assert.equal(deriveCustomers([]).length, 0);
});

test("jobs, quotes and invoices roll up through the request; open enquiries exclude won/lost/archived", () => {
  const customers = deriveCustomers(
    [lead(1, { email: "a@example.test", status: "won" }), lead(2, { email: "a@example.test", status: "quoted" })],
    { quotes: [{ request_id: 1 }, { request_id: 2 }], workOrders: [{ id: "w1", request_id: 1, status: "in_progress" }, { id: "w2", request_id: 1, status: "completed" }],
      invoices: [{ work_order_id: "w1", status: "sent", total_pence: 100000, paid_pence: 40000, outstanding_pence: 60000 }, { work_order_id: "w2", status: "draft", total_pence: 5 }] });
  const [customer] = customers;
  assert.equal(customer.openEnquiries, 1);
  assert.equal(customer.jobs, 2);
  assert.equal(customer.activeJobs, 1);
  assert.equal(customer.quotes, 2);
  assert.deepEqual(customerMoney(customer, true), { billedPence: 100000, paidPence: 40000, outstandingPence: 60000 });
});

test("money is never computed or rendered without the money capability", () => {
  const [customer] = deriveCustomers([lead(1, { email: "a@example.test" })], { workOrders: [{ id: "w", request_id: 1, status: "in_progress" }], invoices: [{ work_order_id: "w", status: "sent", total_pence: 123456, paid_pence: 0, outstanding_pence: 123456 }] });
  assert.deepEqual(customerMoney(customer, false), { billedPence: null, paidPence: null, outstandingPence: null });
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const moneyPence = v => `£${(v / 100).toFixed(2)}`;
  assert.equal(customersHtml([customer], { esc, moneyPence, canSeeMoney: false }).includes("1,234") || customersHtml([customer], { esc, moneyPence, canSeeMoney: false }).includes("1234.56"), false);
  assert.match(customersHtml([customer], { esc, moneyPence, canSeeMoney: true }), /£1234\.56/);
});

test("search matches name, email, postcode, reference and phone digits; view escapes HTML", () => {
  const customers = deriveCustomers([lead(1, { customer_name: "<img src=x onerror=1>", email: "x@example.test", phone: "07700 900123", postcode: "SL4 2HT" }), lead(2, { customer_name: "Other", postcode: "SL1 1AA" })]);
  assert.equal(filterCustomers(customers, "sl4").length, 1);
  assert.equal(filterCustomers(customers, "900 123").length, 1);
  assert.equal(filterCustomers(customers, "FF-2").length, 1);
  assert.equal(filterCustomers(customers, "").length, 2);
  assert.equal(filterCustomers(customers, "zzz").length, 0);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const html = customersHtml(customers, { esc, moneyPence: String });
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img/);
  assert.match(customersHtml([], { esc, moneyPence: String }), /No customers match/);
});
