// REAL BROWSER: public website. Supabase endpoint is a labelled mock (lib/mock-supabase.mjs).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startSuite } from "../lib/fixture.mjs";
import { waitFor } from "../lib/env.mjs";

let suite;
before(async () => { suite = await startSuite(); });
after(async () => { await suite.close(); });

for (const width of [360, 390, 768, 1280]) {
  test(`home page renders at ${width}px without horizontal overflow, errors or unvalidated content`, async () => {
    const { page, errors } = await suite.page({ width, mobile: width < 768 });
    await page.goto(`${suite.url}/`, { waitUntil: "load" });
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: document.querySelectorAll("h1").length,
      title: document.title,
      text: document.body.innerText,
      brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute("href")).filter(h => h.length > 1 && !document.querySelector(h)),
      canonical: document.querySelector('link[rel="canonical"]')?.href
    }));
    assert.ok(info.overflow <= 1, `horizontal overflow ${info.overflow}px`);
    assert.equal(info.h1, 1);
    assert.match(info.title, /Form & Frame/);
    assert.deepEqual(info.brokenAnchors, [], "every in-page link must have a target");
    assert.equal(/Completed works|Sample review|★/.test(info.text), false);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test("empty enquiry form shows field errors, focuses the first and sends nothing", async () => {
  const { page, state } = await suite.page();
  await page.goto(`${suite.url}/`);
  await page.evaluate(() => document.getElementById("request").scrollIntoView());
  await page.click("#formSubmit");
  const invalid = await page.evaluate(() => [...document.querySelectorAll("#form .row.invalid input, #form .row.invalid textarea, #form .row.invalid select")].map(el => el.id));
  assert.deepEqual(invalid, ["cName", "cContact", "cPost", "cWidth"], "the four enforced required fields are flagged (cMsg is aria-required but not enforced: documented finding)");
  assert.equal(await page.evaluate(() => document.activeElement.id), "cName");
  assert.equal(state.requests.some(r => r.path.includes("submit-enquiry")), false);
  await page.close();
});

test("valid enquiry is POSTed to submit-enquiry with the expected payload and the reference is shown", async () => {
  const { page, state } = await suite.page();
  await page.goto(`${suite.url}/`);
  await page.type("#cName", "E2E Fictional Person");
  await page.type("#cContact", "e2e@example.test");
  await page.type("#cPost", "SL1 3XE");
  await page.select("#cWidth", await page.$eval("#cWidth option:not([value=''])", o => o.value));
  await page.type("#cMsg", "Fictional end-to-end test enquiry. Please ignore.");
  await page.click("#formSubmit");
  await waitFor(async () => (await page.$eval("#loggedRef", el => el.textContent)).includes("FF-E2E-0001"), { label: "reference shown" });
  const post = state.requests.find(r => r.method === "POST" && r.path === "/functions/v1/submit-enquiry");
  assert.ok(post, "submit-enquiry must be called");
  assert.equal(post.body.customer_name, "E2E Fictional Person");
  assert.equal(post.body.email, "e2e@example.test");
  assert.equal(post.body.phone, "");
  assert.equal(post.body.postcode, "SL1 3XE");
  assert.equal(post.body.company_website, "", "honeypot must stay empty for humans");
  assert.equal(post.body.source, "website");
  assert.match(post.body.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.equal(await page.$eval("#form", el => el.style.display), "none");
  await page.close();
});

test("a server error shows a friendly message, keeps the form and does not claim success", async () => {
  const { page } = await suite.page({ mock: { enquiryResponse: { status: 500, body: { error: "Temporary problem, please retry." } } } });
  await page.goto(`${suite.url}/`);
  await page.type("#cName", "E2E Fictional Person");
  await page.type("#cContact", "07700 900333");
  await page.type("#cPost", "SL1 3XE");
  await page.select("#cWidth", await page.$eval("#cWidth option:not([value=''])", o => o.value));
  await page.type("#cMsg", "Fictional failing submission.");
  await page.click("#formSubmit");
  await waitFor(async () => /Temporary problem/.test(await page.$eval("#formStatus", el => el.textContent)), { label: "error message" });
  assert.notEqual(await page.$eval("#form", el => el.style.display), "none");
  assert.equal(await page.$eval("#logged", el => el.style.display === "block"), false, "the success panel must stay hidden");
  assert.equal(await page.$eval("#formSubmit", el => el.disabled), false, "form is usable again");
  await page.close();
});

test("rate-limited response tells the visitor how long to wait", async () => {
  const { page } = await suite.page({ mock: { enquiryResponse: { status: 429, body: { error: "slow down", retry_after_seconds: 600 } } } });
  await page.goto(`${suite.url}/`);
  await page.type("#cName", "E2E Fictional Person"); await page.type("#cContact", "e2e@example.test"); await page.type("#cPost", "SL1 3XE");
  await page.select("#cWidth", await page.$eval("#cWidth option:not([value=''])", o => o.value)); await page.type("#cMsg", "Fictional rate limited.");
  await page.click("#formSubmit");
  await waitFor(async () => /about 10 minutes/.test(await page.$eval("#formStatus", el => el.textContent)), { label: "retry message" });
  await page.close();
});

test("mobile navigation toggle opens and closes the menu and the sticky CTA is reachable", async () => {
  const { page } = await suite.page({ width: 390, mobile: true });
  await page.goto(`${suite.url}/`);
  const before = await page.$eval("#navToggle", el => el.getAttribute("aria-expanded"));
  await page.click("#navToggle");
  const after = await page.$eval("#navToggle", el => el.getAttribute("aria-expanded"));
  assert.notEqual(before, after);
  await page.click("#navToggle");
  assert.equal(await page.$eval("#navToggle", el => el.getAttribute("aria-expanded")), before);
  await page.close();
});
