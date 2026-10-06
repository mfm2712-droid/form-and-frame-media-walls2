import test from "node:test";
import assert from "node:assert/strict";
import { getTodayAgenda } from "./today-view.mjs";

test("today agenda includes only today's enquiries and overlapping requested visit windows", () => {
  const now = new Date(2026, 9, 4, 12);
  const items = [
    { id: "new-today", created_at: new Date(2026, 9, 4, 9).toISOString(), status: "new" },
    { id: "older", created_at: new Date(2026, 9, 3, 23, 59).toISOString(), status: "reviewing" },
    { id: "visit-today", created_at: new Date(2026, 8, 20).toISOString(), status: "date_requested", preferred_start: new Date(2026, 9, 4, 16).toISOString(), preferred_end: new Date(2026, 9, 4, 18).toISOString() },
    { id: "window-overlap", status: "confirmed", preferred_start: new Date(2026, 9, 3, 23).toISOString(), preferred_end: new Date(2026, 9, 4, 2).toISOString() },
    { id: "not-a-visit", status: "reviewing", preferred_start: new Date(2026, 9, 4, 10).toISOString(), preferred_end: new Date(2026, 9, 4, 11).toISOString() },
    { id: "tomorrow", status: "date_requested", preferred_start: new Date(2026, 9, 5, 9).toISOString(), preferred_end: new Date(2026, 9, 5, 10).toISOString() },
    { id: "incomplete-window", status: "date_requested", preferred_start: new Date(2026, 9, 4, 9).toISOString() }
  ];

  const agenda = getTodayAgenda(items, now);
  assert.deepEqual(agenda.todayNewEnquiries.map(item => item.id), ["new-today"]);
  assert.deepEqual(agenda.todayVisitWindows.map(item => item.id), ["window-overlap", "visit-today"]);
});

test("today agenda handles an empty list and invalid dates", () => {
  assert.deepEqual(getTodayAgenda([], new Date(2026, 9, 4)), { todayNewEnquiries: [], todayVisitWindows: [] });
  assert.deepEqual(getTodayAgenda([{ id: "invalid", created_at: "bad-date", status: "date_requested", preferred_start: "bad-date", preferred_end: "bad-date" }], new Date(2026, 9, 4)), { todayNewEnquiries: [], todayVisitWindows: [] });
});

// ---------------------------------------------------------------------------
// Real Operations wiring: loads operations/index.html and app.js in headless
// Chromium with an in-memory, fictional stand-in for supabase-js. Every
// non-local request is answered locally, so no remote service is contacted.
// Skipped when Playwright and its Chromium build are not installed.
// ---------------------------------------------------------------------------
import { after } from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const operationsDir = dirname(fileURLToPath(import.meta.url));

async function loadChromium() {
  const candidates = ["playwright", pathToFileURL(join(dirname(dirname(process.execPath)), "lib", "node_modules", "playwright", "index.mjs")).href];
  for (const candidate of candidates) {
    try { return (await import(candidate)).chromium; } catch { /* try the next location */ }
  }
  return null;
}

let browser = null, browserSkip = false;
try {
  const chromium = await loadChromium();
  if (!chromium) browserSkip = "Playwright is not installed; real-wiring browser tests skipped.";
  else browser = await chromium.launch();
} catch (error) {
  browserSkip = `Chromium could not start (${error.message.split("\n")[0]}); real-wiring browser tests skipped.`;
}
after(async () => { await browser?.close(); });

const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST_A = "22222222-2222-4222-8222-222222222222";
const REQUEST_B = "33333333-3333-4333-8333-333333333333";
const APPOINTMENT_TODAY = "55555555-5555-4555-8555-555555555555";
const FOLLOW_UP = "77777777-7777-4777-8777-777777777777";

// Browser-side fake: fictional records only, with recorded writes, injectable
// failures and a manual realtime trigger.
const fakeSupabaseModule = `
const today = new Date(); today.setHours(0, 0, 0, 0);
const at = (days, hour) => { const value = new Date(today); value.setDate(value.getDate() + days); value.setHours(hour, 0, 0, 0); return value.toISOString(); };
const tables = {
  profiles: [{ id:"${OWNER}", role:"owner", full_name:"Fictional Owner" }],
  consultation_requests: [
    { id:"${REQUEST_A}", reference:"FF-TEST-0001", customer_name:"Fictional Customer A", email:"a@example.com", phone:null, postcode:"ZZ1 1ZZ", wall_width:"4 m", message:"Fictional test record", status:"new", source:"test", guide_low:5000, guide_high:6000, created_at:at(0, 0) },
    { id:"${REQUEST_B}", reference:"FF-TEST-0002", customer_name:"Fictional Customer B", email:"b@example.com", phone:null, postcode:"ZZ2 2ZZ", wall_width:"3 m", message:"Fictional test record", status:"reviewing", source:"test", guide_low:4000, guide_high:5000, created_at:at(-1, 9) }
  ],
  availability_blocks: [{ id:"44444444-4444-4444-8444-444444444444", title:"Fictional block", kind:"blocked", starts_at:at(3, 8), ends_at:at(3, 18) }],
  appointments: [
    { id:"${APPOINTMENT_TODAY}", request_id:"${REQUEST_A}", kind:"survey", status:"scheduled", starts_at:at(0, 14), ends_at:at(0, 15), location:"ZZ1 1ZZ", assigned_to:null },
    { id:"66666666-6666-4666-8666-666666666666", request_id:"${REQUEST_B}", kind:"survey", status:"confirmed", starts_at:at(5, 10), ends_at:at(5, 11), location:"ZZ2 2ZZ", assigned_to:null }
  ],
  follow_up_tasks: [{ id:"${FOLLOW_UP}", request_id:"${REQUEST_B}", title:"Fictional follow-up", due_at:at(0, 0), completed_at:null, cancelled_at:null }],
  quotes: [], work_orders: [], invoices: [], invoice_balances: [], workflow_activity: [], business_settings: [], push_subscriptions: []
};
const fake = window.__ffFake = { writes:[], failures:[], realtime:[] };
function query(table) {
  const state = { op:"select", patch:null, filters:[], single:false, from:0, to:null };
  const run = () => {
    if (state.op !== "select") {
      fake.writes.push({ table, op:state.op, patch:state.patch, filters:state.filters });
      const failure = fake.failures.findIndex(item => item.table === table && item.op === state.op);
      if (failure >= 0) return { data:null, error:fake.failures.splice(failure, 1)[0].error, count:null };
    }
    const rows = (tables[table] || []).filter(row => state.filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value : kind === "in" ? value.includes(row[key]) : kind === "is" ? (row[key] ?? null) === value : true));
    let result = rows;
    if (state.op === "update") { rows.forEach(row => Object.assign(row, state.patch)); }
    else if (state.op === "insert") { const row = { id:crypto.randomUUID(), ...state.patch }; tables[table].push(row); result = [row]; }
    const page = state.to === null ? result : result.slice(state.from, state.to + 1);
    return state.single ? { data:page[0] || null, error:null, count:result.length } : { data:page, error:null, count:result.length };
  };
  const builder = {
    select() { return builder; },
    insert(patch) { state.op = "insert"; state.patch = patch; return builder; },
    update(patch) { state.op = "update"; state.patch = patch; return builder; },
    upsert(patch) { state.op = "upsert"; state.patch = patch; return builder; },
    delete() { state.op = "delete"; return builder; },
    eq(key, value) { state.filters.push(["eq", key, value]); return builder; },
    in(key, value) { state.filters.push(["in", key, value]); return builder; },
    is(key, value) { state.filters.push(["is", key, value]); return builder; },
    gt() { return builder; }, gte() { return builder; }, lt() { return builder; }, lte() { return builder; },
    order() { return builder; }, limit() { return builder; },
    range(from, to) { state.from = from; state.to = to; return builder; },
    maybeSingle() { state.single = true; return builder; },
    single() { state.single = true; return builder; },
    then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    catch(reject) { return Promise.resolve().then(run).catch(reject); }
  };
  return builder;
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data:{ session:{ user:{ id:"${OWNER}" } } }, error:null }),
      getUser: async () => ({ data:{ user:{ id:"${OWNER}" } }, error:null }),
      signInWithOtp: async () => ({ error:null }),
      signOut: async () => ({ error:null })
    },
    from: query,
    channel() { const channel = { on(_event, _filter, callback) { fake.realtime.push(callback); return channel; }, subscribe() { return channel; } }; return channel; },
    removeChannel: async () => {}
  };
}
`;

async function openDesk({ width = 390, height = 844, search = "" } = {}) {
  const context = await browser.newContext({ viewport:{ width, height }, timezoneId:"Europe/London", locale:"en-GB" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "esm.sh") return route.fulfill({ contentType:"text/javascript", body:fakeSupabaseModule });
    if (url.hostname !== "ops.test" || !url.pathname.startsWith("/operations/")) return route.fulfill({ status:204, body:"" });
    if (url.pathname === "/operations/config.js") return route.fulfill({ contentType:"text/javascript", body:'window.FF_OPERATIONS_CONFIG={supabaseUrl:"https://fictional.invalid",supabaseAnonKey:"fictional-public-key"};' });
    const file = normalize(join(operationsDir, url.pathname === "/operations/" ? "index.html" : url.pathname.slice("/operations/".length)));
    if (!file.startsWith(operationsDir)) return route.fulfill({ status:404, body:"" });
    const type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/javascript";
    try { return route.fulfill({ contentType:type, body:await readFile(file) }); } catch { return route.fulfill({ status:404, body:"" }); }
  });
  await page.goto(`https://ops.test/operations/${search}`);
  await page.waitForSelector("#hub:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#businessState")?.textContent.startsWith("All saved"));
  return { page, pageErrors, close:() => context.close() };
}

const writes = page => page.evaluate(() => window.__ffFake.writes);
const noticeText = page => page.$eval("#notice", el => el.hidden ? "" : el.textContent);
const isVisible = (page, selector) => page.$eval(selector, el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");

test("Today Cancel asks first, then cancels the booked appointment", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk();
  try {
    page.once("dialog", dialog => dialog.dismiss());
    await page.click(`#todayAppointments [data-cancel-appointment="${APPOINTMENT_TODAY}"]`);
    await page.waitForTimeout(150);
    assert.deepEqual(await writes(page), [], "a dismissed confirmation must not write");

    page.once("dialog", dialog => dialog.accept());
    await page.click(`#todayAppointments [data-cancel-appointment="${APPOINTMENT_TODAY}"]`);
    await page.waitForFunction(() => /Appointment cancelled/.test(document.querySelector("#notice").textContent));
    const [write] = await writes(page);
    assert.equal(write.table, "appointments");
    assert.equal(write.op, "update");
    assert.deepEqual(write.patch, { status:"cancelled" });
    assert.deepEqual(write.filters.find(([kind, key]) => kind === "eq" && key === "id"), ["eq", "id", APPOINTMENT_TODAY]);
    assert.equal(await page.$(`[data-cancel-appointment="${APPOINTMENT_TODAY}"]`), null, "a cancelled appointment no longer offers actions");
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("Today Done marks the booked appointment complete", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk();
  try {
    await page.click(`#todayAppointments [data-complete-appointment="${APPOINTMENT_TODAY}"]`);
    await page.waitForFunction(() => /Appointment marked complete/.test(document.querySelector("#notice").textContent));
    const [write] = await writes(page);
    assert.equal(write.table, "appointments");
    assert.deepEqual(write.patch, { status:"completed" });
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("Today Complete closes a due follow-up and re-enables after a failure", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk();
  try {
    await page.evaluate(() => window.__ffFake.failures.push({ table:"follow_up_tasks", op:"update", error:{ code:"08006", message:"fictional network failure" } }));
    await page.click(`#todayPayments [data-complete-followup="${FOLLOW_UP}"]`);
    await page.waitForFunction(() => /couldn't confirm this change/.test(document.querySelector("#notice").textContent));
    assert.equal(await page.$eval(`[data-complete-followup="${FOLLOW_UP}"]`, el => el.disabled), false);

    await page.click(`#todayPayments [data-complete-followup="${FOLLOW_UP}"]`);
    await page.waitForFunction(() => /Follow-up completed/.test(document.querySelector("#notice").textContent));
    const last = (await writes(page)).at(-1);
    assert.equal(last.table, "follow_up_tasks");
    assert.ok(typeof last.patch.completed_at === "string");
    assert.equal(await page.$(`[data-complete-followup="${FOLLOW_UP}"]`), null);
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("Today Open switches a phone to Work and reveals the chosen enquiry", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk({ width:390 });
  try {
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "today");
    await page.click(`#todayEnquiries [data-open-enquiry="${REQUEST_A}"]`);
    await page.waitForFunction(() => document.activeElement?.id === "projectPanel");
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "work");
    assert.equal(await page.$eval(".mobile-nav [aria-current=page]", el => el.dataset.mobileView), "work");
    assert.equal(await page.$eval("#leadList .lead.selected", el => el.dataset.leadId), REQUEST_A);
    assert.equal(await isVisible(page, "#projectPanel"), true);
    assert.match(await page.$eval("#projectPanel h2", el => el.textContent), /Fictional Customer A/);
    assert.deepEqual(await writes(page), [], "opening an enquiry must not write");
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("a push link is used once, then refreshes and live updates keep the user's choice", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk({ search:`?enquiry=${REQUEST_A}&view=money` });
  try {
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "work");
    assert.equal(await page.$eval("#leadList .lead.selected", el => el.dataset.leadId), REQUEST_A);
    assert.equal(await page.evaluate(() => location.search), "", "consumed push parameters are removed from the address bar");

    await page.click(`#leadList [data-lead-id="${REQUEST_B}"] h3`);
    await page.waitForFunction(id => document.querySelector("#leadList .lead.selected")?.dataset.leadId === id, REQUEST_B);

    await page.click('.mobile-nav [data-mobile-view="money"]');
    await page.click("#refresh");
    await page.evaluate(() => window.__ffFake.realtime[0]());
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "money");
    assert.equal(await page.$eval("#leadList .lead.selected", el => el.dataset.leadId), REQUEST_B);
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("a push-link view target opens that view once without an enquiry", { skip:browserSkip }, async () => {
  const { page, close } = await openDesk({ search:"?view=calendar" });
  try {
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "calendar");
    assert.equal(await page.evaluate(() => location.search), "");
    await page.click('.mobile-nav [data-mobile-view="today"]');
    await page.click("#refresh");
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.body.dataset.mobileView), "today");
  } finally { await close(); }
});

test("a calendar exclusion violation (23P01) explains the booking conflict; other errors stay generic", { skip:browserSkip }, async () => {
  const { page, pageErrors, close } = await openDesk({ width:1280, height:900 });
  try {
    await page.click(`#leadList [data-lead-id="${REQUEST_A}"] h3`);
    await page.waitForSelector(`#appointmentDraft[data-request-id="${REQUEST_A}"]`, { state:"attached" });
    await page.evaluate(() => { for (const details of document.querySelectorAll("#projectPanel details")) details.open = true; });
    await page.fill("#appointmentDraft [name=startsAt]", "2030-01-08T10:00");
    await page.fill("#appointmentDraft [name=endsAt]", "2030-01-08T11:00");
    await page.evaluate(() => window.__ffFake.failures.push({ table:"appointments", op:"insert", error:{ code:"23P01", message:"conflicting key value violates exclusion constraint" } }));
    await page.click("#appointmentDraft button");
    await page.waitForFunction(() => /overlaps a booked appointment or blocked time/.test(document.querySelector("#notice").textContent));
    assert.match(await noticeText(page), /Nothing was changed/);
    assert.equal(await page.$eval("#notice", el => el.dataset.kind), "warning");
    assert.equal(await page.$eval("#appointmentDraft [name=startsAt]", el => el.value), "2030-01-08T10:00", "the entered time is kept so it can be adjusted");
    assert.equal(await page.$eval("#appointmentDraft button", el => el.disabled), false);

    await page.evaluate(() => window.__ffFake.failures.push({ table:"availability_blocks", op:"insert", error:{ code:"23P01", message:"The availability block overlaps a reserved appointment." } }));
    await page.click("#block button");
    await page.waitForFunction(() => /overlaps a booked appointment or blocked time/.test(document.querySelector("#notice").textContent));

    await page.evaluate(() => window.__ffFake.failures.push({ table:"appointments", op:"insert", error:{ code:"42501", message:"permission denied" } }));
    await page.click("#appointmentDraft button");
    await page.waitForFunction(() => /couldn't confirm this change/.test(document.querySelector("#notice").textContent));
    assert.doesNotMatch(await noticeText(page), /overlaps/);
    assert.equal(await page.$eval("#notice", el => el.dataset.kind), "error");
    assert.deepEqual(pageErrors, []);
  } finally { await close(); }
});

test("Today actions are wired outside the business section in the real markup", async () => {
  const [html, app] = await Promise.all([readFile(join(operationsDir, "index.html"), "utf8"), readFile(join(operationsDir, "app.js"), "utf8")]);
  const todayAt = html.indexOf('class="today-panel"'), businessAt = html.indexOf('id="business"');
  assert.ok(todayAt > 0 && businessAt > todayAt, "the Today panel precedes, and is not nested in, the business section");
  assert.match(app, /querySelector\("\.today-panel"\)\.addEventListener\("click"/);
  assert.match(app, /window\.history\.replaceState/);
  assert.match(app, /CALENDAR_CONFLICT_CODE = "23P01"/);
});
