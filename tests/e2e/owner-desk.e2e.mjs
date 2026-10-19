// End-to-end browser test of the Owner Desk and the customer quotation page,
// using only fictional demo records. Nothing leaves the machine: the desk runs in
// demo mode, and the customer page's call to the quote-response server function is
// answered by the real handler.mjs, whose database calls run against the demo store.
//
// Run: python3 -m http.server 8765 --bind 127.0.0.1   (from the repository root)
//      PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/e2e/owner-desk.e2e.mjs
import assert from "node:assert/strict";
import { createQuoteResponseHandler } from "../../supabase/functions/quote-response/handler.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const ORIGIN = process.env.E2E_ORIGIN || "http://127.0.0.1:8765";
const DESK = `${ORIGIN}/operations/`;
const SHOTS = process.env.E2E_SHOTS || "";
const results = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
const desk = await context.newPage();
desk.setDefaultTimeout(8000);
const pageErrors = [];
desk.on("pageerror", error => pageErrors.push(`desk: ${error.message}`));

// The real server function, with its database calls answered by the demo store in the desk tab.
const handler = createQuoteResponseHandler({
  env:name => ({ SUPABASE_URL:"https://fictional.invalid", SUPABASE_SERVICE_ROLE_KEY:"not-a-real-key", ALLOWED_ORIGINS:ORIGIN })[name],
  createAdmin:() => ({ rpc:(name, args) => desk.evaluate(([fn, values]) => window.ffDemo.rpc(fn, values), [name, args]) })
});
const functionCalls = [];
await context.route(/\/functions\/v1\/quote-response/, async route => {
  const request = route.request();
  const response = await handler(new Request("https://fictional.invalid/functions/v1/quote-response", { method:request.method(), headers:request.headers(), body:request.method() === "POST" ? request.postData() : undefined }));
  const text = await response.text();
  functionCalls.push({ body:request.postData(), status:response.status, text });
  await route.fulfill({ status:response.status, headers:Object.fromEntries(response.headers), body:text });
});

async function step(name, run) {
  try { await run(); results.push([true, name]); console.log(`PASS ${name}`); }
  catch (error) {
    results.push([false, name]); console.log(`FAIL ${name}: ${String(error.message).split("\n")[0]}`);
    if (SHOTS) await desk.screenshot({ path:`${SHOTS}/fail-${results.length}.png`, fullPage:true }).catch(() => {});
  }
}
const toast = text => desk.waitForFunction(pattern => new RegExp(pattern).test(document.querySelector("#toast")?.textContent || ""), text);
const act = (name, id) => desk.locator(`[data-act="${name}"]${id === undefined ? "" : `[data-id="${id}"]`}`).first();
const confirm = () => desk.click("#confirmForm button.primary, #confirmForm button.danger");

// Opens a customer link in its own tab and returns what the customer can see.
async function openAsCustomer(link) {
  const customer = await context.newPage();
  customer.setDefaultTimeout(8000);
  customer.on("pageerror", error => pageErrors.push(`customer: ${error.message}`));
  await customer.goto(link);
  await customer.waitForFunction(() => !/Loading your quotation/.test(document.querySelector("main")?.textContent || ""));
  assert.equal(new URL(customer.url()).search, "", "the private token is removed from the address bar");
  return customer;
}
// A closed link must show none of the quotation, customer or price details.
async function assertShowsNothing(customer, label) {
  const text = await customer.locator("main").textContent();
  for (const secret of [customerName, "FFQ-", "£", "MDF", "Labour", "Fictional terms", "SL9 9ZZ", "e2e.customer@example.com"]) {
    assert.ok(!text.includes(secret), `${label} must not show "${secret}"`);
  }
  assert.equal(await customer.locator("[data-choice]").count(), 0, `${label} offers no buttons`);
}

const customerName = `E2E Fictional Customer ${Date.now().toString(36)}`;
let leadId, firstLink, revisionLink, quoteV1, quoteV2;

await step("demo sign-in opens the desk with fictional data", async () => {
  await desk.goto(DESK);
  await desk.waitForSelector(".queues");
  assert.match(await desk.locator(".demo-banner").textContent(), /fictional data/);
});

await step("company details saved in Settings", async () => {
  await desk.goto(`${DESK}#/settings`); await desk.waitForSelector("#settingsForm");
  await desk.fill('[name="legalName"]', "Fictional Trading Ltd");
  await desk.fill('[name="billingAddress"]', "1 Fictional Street\nTesttown");
  await desk.fill('[name="contactEmail"]', "hello@example.com");
  await desk.fill('[name="vatNumber"]', "GB000000000");
  await desk.fill('[name="defaultTerms"]', "Fictional terms: 50% deposit.");
  await desk.click("#settingsForm button.primary");
  await toast("Company details saved");
});

await step("create an enquiry", async () => {
  await desk.goto(`${DESK}#/enquiries`); await desk.waitForSelector("#enquirySearch");
  await act("new-enquiry").click();
  await desk.fill('#customerForm [name="customerName"]', customerName);
  await desk.fill('#customerForm [name="email"]', "e2e.customer@example.com");
  await desk.fill('#customerForm [name="postcode"]', "SL9 9ZZ");
  await desk.fill('#customerForm [name="message"]', "Fictional 4 m media wall with a 65-inch TV.");
  await desk.click("#customerForm button.primary");
  await desk.waitForFunction(name => document.querySelector(".ws-top h1")?.textContent === name, customerName);
  leadId = desk.url().split("/customer/")[1];
  assert.ok(leadId);
});

await step("edit customer details", async () => {
  await act("edit-customer").click();
  await desk.fill('#customerForm [name="phone"]', "07700 900 123");
  await desk.fill('#customerForm [name="address"]', "9 Fictional Road\nTesttown");
  await desk.click("#customerForm button.primary");
  await desk.waitForFunction(() => /07700 900 123/.test(document.querySelector("#ws-customer").textContent) && /9 Fictional Road/.test(document.querySelector("#ws-customer").textContent));
});

await step("create a quotation with items, a 10% discount and 20% VAT", async () => {
  await act("new-quote").click(); await desk.waitForSelector("#quoteForm");
  const rows = desk.locator("#quoteLines tr.line");
  await rows.nth(0).locator('[name="description"]').fill("MDF"); await rows.nth(0).locator('[name="description"]').dispatchEvent("change");
  assert.equal(await rows.nth(0).locator('[name="unit"]').inputValue(), "sheet");
  await rows.nth(0).locator('[name="quantity"]').fill("12");
  await rows.nth(0).locator('[name="unitPrice"]').fill("38.50");
  await act("add-line").click();
  await rows.nth(1).locator('[name="description"]').fill("Labour"); await rows.nth(1).locator('[name="description"]').dispatchEvent("change");
  await rows.nth(1).locator('[name="quantity"]').fill("3.5");
  await rows.nth(1).locator('[name="unitPrice"]').fill("240");
  assert.equal(await desk.inputValue('[name="taxPercent"]'), "20", "VAT defaults to 20% because a VAT number is saved");
  assert.match(await desk.inputValue('[name="terms"]'), /Fictional terms/, "default terms are filled in");
  await desk.check('[name="applyDiscount"]'); await desk.check('[name="discountPreset"][value="10"]');
  const totals = await desk.locator("#quoteTotals").textContent();
  for (const figure of ["£1,302.00", "−£130.20", "£1,171.80", "£234.36", "£1,406.16"]) assert.ok(totals.includes(figure), `totals show ${figure}`);
  await desk.click("#quoteForm button.primary");
  await toast("Quotation draft saved");
  assert.match(await desk.locator("#ws-quote").textContent(), /£1,406\.16/);
});

await step("edit the draft: fixed discount recalculates", async () => {
  await act("edit-quote").click(); await desk.waitForSelector("#quoteForm");
  await desk.locator("#quoteLines tr.line").nth(0).locator('[name="quantity"]').fill("10");
  await desk.check('[name="discountPreset"][value="fixed"]'); await desk.fill('[name="fixedAmount"]', "100");
  // 10 × £38.50 + 3.5 × £240 = £1,225; less £100 = £1,125; VAT £225; total £1,350
  assert.ok((await desk.locator("#quoteTotals").textContent()).includes("£1,350.00"));
  await desk.click("#quoteForm button.primary");
  await toast("Quotation saved");
  assert.match(await desk.locator("#ws-quote").textContent(), /£1,350\.00/);
});

await step("preview the branded PDF", async () => {
  await act("preview-quote").click(); await desk.waitForSelector("#preview[open]");
  const text = await desk.frameLocator("#previewFrame").locator("body").textContent();
  for (const expected of ["FORM & FRAME", "Quotation", customerName, "MDF", "Labour", "−£100.00", "VAT at 20%", "£1,350.00", "Fictional Trading Ltd", "Fictional terms", "DRAFT · NOT SENT"]) assert.ok(text.includes(expected), `PDF shows ${expected}`);
  await desk.click("#previewClose");
});

await step("create the secure link; the quotation is sent and locked", async () => {
  quoteV1 = await desk.locator('#ws-quote [data-act="send-quote"]').first().getAttribute("data-id");
  await desk.click('#ws-quote [data-act="send-quote"]'); await act("issue-link").click();
  await desk.waitForSelector("#responseLink");
  firstLink = await desk.inputValue("#responseLink");
  assert.match(firstLink, /\/quote-response\.html\?token=[a-f0-9]{64}$/);
  await act("close-dialog").click();
  assert.match(await desk.locator(".ws-status").textContent(), /Sent/);
  assert.equal(await desk.locator('#ws-quote [data-act="edit-quote"]').count(), 0);
});

await step("customer opens the link and sees the full quotation", async () => {
  const customer = await openAsCustomer(firstLink);
  const text = await customer.locator("main").textContent();
  for (const expected of [customerName, "MDF", "£1,350.00", "VAT at 20%", "Fictional terms", "No payment is taken"]) assert.ok(text.includes(expected), `customer sees ${expected}`);
  assert.equal(await customer.locator("[data-choice]").count(), 3);
  await customer.close();
});

await step("customer requests changes; an empty request is refused", async () => {
  const customer = await openAsCustomer(firstLink);
  await customer.click('[data-choice="changes_requested"]');
  const before = functionCalls.length;
  await customer.click('#step button[type="submit"]');
  assert.equal(functionCalls.length, before, "nothing is sent without a message");
  await customer.fill("#step textarea", "Could the shelves be oak instead?");
  await customer.click('#step button[type="submit"]');
  await customer.waitForSelector(".done");
  assert.match(await customer.locator("main").textContent(), /Request sent/);
  await customer.close();
});

await step("the used link shows nothing on reopening and cannot answer again", async () => {
  const customer = await openAsCustomer(firstLink);
  assert.match(await customer.locator("main").textContent(), /Changes requested/);
  await assertShowsNothing(customer, "used link");
  await customer.close();
  const reuse = await handler(new Request("https://fictional.invalid/", { method:"POST", headers:{ origin:ORIGIN, "content-type":"application/json" }, body:JSON.stringify({ token:firstLink.split("token=")[1], decision:"accepted" }) }));
  assert.equal(reuse.status, 409, "a used link cannot accept");
});

await step("desk shows the change request and creates a revision", async () => {
  await desk.waitForFunction(() => /Revision requested/.test(document.querySelector(".ws-status")?.textContent || ""));
  assert.match(await desk.locator("#ws-quote").textContent(), /shelves be oak/);
  await desk.click('.next-step [data-act="revise-quote"]'); await desk.waitForSelector("#quoteForm");
  assert.equal(await desk.locator("#quoteLines tr.line").count(), 2, "the revision starts from version 1's lines");
  await desk.locator("#quoteLines tr.line").nth(1).locator('[name="description"]').fill("Labour (oak shelving)");
  await desk.click("#quoteForm button.primary");
  await toast("Revision .* saved");
  quoteV2 = await desk.locator('#ws-quote [data-act="send-quote"]').first().getAttribute("data-id");
  assert.notEqual(quoteV2, quoteV1);
  await desk.click('#ws-quote [data-act="send-quote"]'); await act("issue-link").click();
  await desk.waitForSelector("#responseLink");
  revisionLink = await desk.inputValue("#responseLink");
  await act("close-dialog").click();
  const versions = await desk.evaluate(id => window.ffDemo.db.quotes.filter(quote => quote.request_id === id).map(quote => `${quote.version}:${quote.status}`).sort(), leadId);
  assert.deepEqual(versions, ["1:superseded", "2:sent"]);
});

await step("customer accepts the revision", async () => {
  const customer = await openAsCustomer(revisionLink);
  assert.match(await customer.locator("main").textContent(), /Labour \(oak shelving\)/);
  await customer.click('[data-choice="accepted"]');
  await customer.click('#step button[type="submit"]');
  await customer.waitForSelector(".done");
  assert.match(await customer.locator("main").textContent(), /quotation accepted/i);
  await customer.close();
  await desk.waitForFunction(() => /Accepted/.test(document.querySelector(".ws-status")?.textContent || ""));
});

await step("an accepted link shows nothing on reopening", async () => {
  const customer = await openAsCustomer(revisionLink);
  assert.match(await customer.locator("main").textContent(), /already accepted/);
  await assertShowsNothing(customer, "accepted link");
  await customer.close();
});

await step("an expired link shows nothing", async () => {
  const token = await desk.evaluate(async id => {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(random))), byte => byte.toString(16).padStart(2, "0")).join("");
    // A link that expired yesterday on a quotation that is still sent.
    const quote = window.ffDemo.db.quotes.find(item => item.status === "sent" && item.request_id !== id);
    window.ffDemo.db.quote_response_links.push({ id:crypto.randomUUID(), quote_id:quote.id, token_hash:hash, expires_at:new Date(Date.now() - 86400000).toISOString(), used_at:null, viewed_at:null, decision:null, created_at:new Date().toISOString() });
    return random;
  }, leadId);
  const customer = await openAsCustomer(`${ORIGIN}/quote-response.html?token=${token}`);
  assert.match(await customer.locator("main").textContent(), /This link has expired/);
  await assertShowsNothing(customer, "expired link");
  const text = await customer.locator("main").textContent();
  assert.ok(!/Lindqvist|FFQ-DEMO|2,158/.test(text), "no details of the other quotation either");
  await customer.close();
});

await step("an unknown link shows nothing", async () => {
  const customer = await openAsCustomer(`${ORIGIN}/quote-response.html?token=${"e".repeat(64)}`);
  assert.match(await customer.locator("main").textContent(), /could not open this quotation/);
  await assertShowsNothing(customer, "unknown link");
  await customer.close();
});

await step("create the job", async () => {
  await desk.click('.next-step [data-act="create-job"]'); await confirm();
  await toast("Job created");
  await desk.goto(`${DESK}#/jobs`); await desk.waitForSelector(".board");
  assert.match(await desk.locator(".lane", { hasText:"Accepted · awaiting scheduling" }).textContent(), new RegExp(customerName));
});

await step("book the installation; it appears in the calendar", async () => {
  await desk.goto(`${DESK}#/customer/${leadId}`); await desk.waitForSelector(".ws-top");
  await desk.click('.next-step [data-act="book-appointment"]'); await desk.waitForSelector("#appointmentForm");
  const day = new Date(); day.setDate(day.getDate() + 20);
  const pad = number => String(number).padStart(2, "0");
  await desk.fill('[name="startsAt"]', `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T09:00`);
  await desk.click("#appointmentForm button.primary");
  await toast("Installation booked");
  await desk.click('#ws-appointments a[href*="calendar"]'); await desk.waitForSelector(".cal");
  assert.ok(await desk.locator(".cal a.ev-installation", { hasText:customerName }).count() >= 1);
});

await step("create and issue the invoice, then record a payment", async () => {
  await desk.goto(`${DESK}#/customer/${leadId}`); await desk.waitForSelector(".ws-top");
  await desk.click('#ws-invoice [data-act="new-invoice"]'); await desk.waitForSelector("#invoiceForm");
  assert.match(await desk.inputValue('#invoiceForm [name="billAddress"]'), /9 Fictional Road/);
  await desk.click("#invoiceForm button.primary"); await toast("Invoice draft saved");
  await desk.click('#ws-invoice [data-act="issue-invoice"]'); await confirm(); await toast("Invoice issued");
  await desk.click('#ws-invoice [data-act="record-payment"]');
  await desk.fill('#paymentForm [name="amount"]', "500"); await desk.click("#paymentForm button.primary");
  await toast("Payment of £500\\.00 recorded");
  assert.match(await desk.locator(".ws-status").textContent(), /Partially paid/);
  await desk.click('#ws-documents [data-act="preview-invoice"]'); await desk.waitForSelector("#preview[open]");
  const pdf = await desk.frameLocator("#previewFrame").locator("body").textContent();
  assert.ok(pdf.includes("Invoice") && pdf.includes("£500.00") && pdf.includes("Fictional Trading Ltd"));
  await desk.click("#previewClose");
});

await step("search documents by customer and by invoice number", async () => {
  await desk.goto(`${DESK}#/finance`); await desk.waitForSelector(".doc-table");
  await desk.fill("#financeSearch", customerName);
  const rows = await desk.locator(".doc-table tbody tr").allTextContents();
  assert.equal(rows.filter(text => /Quotation/.test(text)).length, 2, "both quotation versions");
  assert.equal(rows.filter(text => /^Invoice/.test(text)).length, 1);
  assert.equal(rows.filter(text => /^Payment/.test(text)).length, 1);
  const invoiceNumber = /FFI-[0-9]{8}-[0-9A-F]{4}/.exec(rows.join(" "))[0];
  await desk.fill("#financeSearch", invoiceNumber);
  assert.equal(await desk.locator(".doc-table tbody tr").count(), 2, "the invoice and its payment");
});

await step("delete an enquiry with confirmation, find it in Deleted and restore it", async () => {
  await desk.goto(`${DESK}#/enquiries`); await act("new-enquiry").click();
  await desk.fill('#customerForm [name="customerName"]', `${customerName} (to delete)`);
  await desk.fill('#customerForm [name="postcode"]', "SL9 9ZY");
  await desk.click("#customerForm button.primary"); await desk.waitForSelector("#ws-manage");
  await act("delete-enquiry").click();
  assert.equal(await desk.locator("#confirmForm h2").textContent(), "Are you sure you want to delete this enquiry?");
  await confirm(); await toast("Enquiry deleted");
  await desk.goto(`${DESK}#/enquiries`); await desk.click('[data-act="enquiry-filter"][data-id="deleted"]');
  await desk.fill("#enquirySearch", "(to delete)");
  await desk.click(".list-row"); await act("restore-enquiry").click(); await toast("Enquiry restored");
  await desk.goto(`${DESK}#/customer/${leadId}`); await desk.waitForSelector("#ws-manage");
  await act("delete-enquiry").click(); await confirm();
  await desk.waitForFunction(() => /must be archived instead/.test(document.querySelector("#confirmForm .form-errors")?.textContent || ""));
  await act("close-dialog").click();
});

await step("no page errors", async () => { assert.deepEqual(pageErrors, []); });

const passed = results.filter(([ok]) => ok).length;
console.log(`\n${passed}/${results.length} steps passed · ${functionCalls.length} customer-page calls went through handler.mjs`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
