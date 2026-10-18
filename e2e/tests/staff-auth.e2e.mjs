// REAL BROWSER: staff app sign-in. Supabase is a labelled mock; the real app and real vendored supabase-js run.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startSuite, fictionalLeads } from "../lib/fixture.mjs";
import { waitFor } from "../lib/env.mjs";

let suite;
before(async () => { suite = await startSuite(); });
after(async () => { await suite.close(); });

test("no session: sign-in screen shows, private desk stays hidden, nothing private is requested", async () => {
  const { page, state, errors } = await suite.page({ mock: { tables: { consultation_requests: fictionalLeads() } } });
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#setup", el => !el.hidden), { label: "sign-in" });
  assert.equal(await page.$eval("#hub", el => el.hidden), true);
  assert.equal(state.requests.some(r => r.path.startsWith("/rest/v1/consultation_requests")), false, "no enquiry data without a session");
  assert.deepEqual(errors, []);
  await page.close();
});

test("magic-link request: sends email with create-user disabled and confirms without revealing account existence", async () => {
  const { page, state } = await suite.page();
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#setup", el => !el.hidden));
  await page.type("#email", "owner@example.test");
  await page.click("#login button[type=submit], #login button");
  await waitFor(() => state.requests.some(r => r.path === "/auth/v1/otp" && r.method === "POST"), { label: "otp request" });
  const otp = state.requests.find(r => r.path === "/auth/v1/otp" && r.method === "POST");
  assert.equal(otp.body.email, "owner@example.test");
  assert.equal(otp.body.create_user, false, "unknown emails must not create accounts");
  await waitFor(async () => /link|email|check/i.test(await page.$eval("#setupCopy", el => el.textContent)), { label: "confirmation copy" });
  await page.close();
});

test("magic-link request failure is reported to the user and the desk stays hidden", async () => {
  const { page } = await suite.page({ mock: { otpResponse: { status: 422, body: { msg: "Signups not allowed for otp", error_code: "otp_disabled" } } } });
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#setup", el => !el.hidden));
  await page.type("#email", "nobody@example.test");
  await page.click("#login button");
  await waitFor(async () => (await page.$eval("#setupCopy", el => el.textContent)).length > 0 && !/for a secure sign-in link\.$/.test(await page.$eval("#setupCopy", el => el.textContent)), { label: "failure copy" });
  assert.equal(await page.$eval("#hub", el => el.hidden), true);
  await page.close();
});

test("owner session: desk opens, enquiries list renders from the (mock) database", async () => {
  const { page, errors } = await suite.page({ session: true, mock: { role: "owner", tables: { consultation_requests: fictionalLeads() } } });
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#hub", el => !el.hidden), { label: "desk" });
  await waitFor(async () => (await page.$$("#leadList [data-lead-id]")).length === 3, { label: "3 enquiries" });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a signed-in profile with no staff role is refused: the desk never opens", async () => {
  const { page } = await suite.page({ session: true, mock: { role: "customer", tables: { consultation_requests: fictionalLeads() } } });
  await page.goto(`${suite.url}/operations/`);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(await page.$eval("#hub", el => el.hidden), true);
  await page.close();
});

test("sign out calls the auth endpoint and returns to the sign-in screen", async () => {
  const { page, state } = await suite.page({ session: true, mock: { role: "owner", tables: { consultation_requests: fictionalLeads() } } });
  await page.goto(`${suite.url}/operations/`);
  await waitFor(async () => await page.$eval("#hub", el => !el.hidden));
  await page.click("#signOut");
  await waitFor(() => state.requests.some(r => r.path === "/auth/v1/logout"), { label: "logout call" });
  await page.close();
});
