// FRAME-007: delivery contract of the retry worker, with every external service mocked
// (fictional Supabase admin client, fictional Resend/push fetcher). No network, no secrets.
import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationRetryHandler } from "./handler.mjs";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const RID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = "fictional-retry-token";
const EMAIL_ENV = { RESEND_API_KEY: "re_fictional_secret_key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" };
const ENQUIRY = { id: RID, reference: "FF-261005-ABCD", customer_name: "Fictional Customer", postcode: "SL1 1AA", message: "Fictional brief" };

function harness({ events, enquiries = [ENQUIRY], vars = {}, fetcher, failUpdate = false }) {
  const settings = { SUPABASE_URL: "https://fictional-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "fictional-service-key", NOTIFICATION_RETRY_TOKEN: TOKEN, ...vars };
  const state = { events: structuredClone(events), logs: [], calls: [] };
  const admin = {
    async rpc(name, args) {
      const ev = name === "claim_notification_event" ? state.events.find(e => e.id === args.p_event_id) : state.events.find(e => e.request_id === args.p_request_id && e.channel === args.p_channel);
      if (!ev) return { data: [{ claimed: false, current_status: "missing" }], error: null };
      ev.attempt_count++;
      return { data: [{ event_id: ev.id, claimed: true, current_status: "pending" }], error: null };
    },
    from(table) {
      const q = { where: [], filter: {}, patch: null };
      q.select = () => q;
      q.in = (c, v) => { q.where.push(r => v.includes(r[c])); return q; };
      q.lte = (c, v) => { q.where.push(r => r[c] <= v); return q; };
      q.order = () => q;
      q.limit = n => Promise.resolve({ data: state.events.filter(r => q.where.every(p => p(r))).slice(0, n), error: null });
      q.update = p => { q.patch = p; return q; };
      q.eq = (c, v) => {
        if (q.patch) {
          if (failUpdate) return Promise.resolve({ error: new Error("db down: fictional-service-key") });
          Object.assign(state.events.find(r => r[c] === v), q.patch); return Promise.resolve({ error: null });
        }
        q.filter[c] = v; return q;
      };
      q.maybeSingle = async () => ({ data: enquiries.find(r => r.id === q.filter.id) || null, error: null });
      return q;
    }
  };
  const recorded = async (url, options) => { state.calls.push({ url, options, body: options?.body ? JSON.parse(options.body) : null }); return fetcher(url, options); };
  const handler = createNotificationRetryHandler({ env: n => settings[n], createAdmin: async () => admin, fetcher: recorded, now: () => new Date(NOW), logError: m => state.logs.push(m) });
  const run = async () => (await handler(new Request("https://edge.example.test/r", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" }))).json();
  return { run, state };
}
const due = (channel, extra = {}) => ({ id: `${channel}-1`, request_id: RID, channel, event_type: "new_enquiry", payload: {}, delivery_status: "failed", attempt_count: 1, next_attempt_at: "2026-10-05T09:00:00.000Z", claim_until: null, error: "old", ...extra });
const ok = () => new Response("{}", { status: 200 });

test("email template: fixed sender, single recipient, reference subject, escaped customer text", async () => {
  const hostile = { ...ENQUIRY, customer_name: "<img src=x onerror=alert(1)>", message: "</p><script>alert('x')</script> & more" };
  const { run, state } = harness({ events: [due("email")], enquiries: [hostile], vars: EMAIL_ENV, fetcher: ok });
  assert.equal((await run()).sent, 1);
  const call = state.calls[0];
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.Authorization, `Bearer ${EMAIL_ENV.RESEND_API_KEY}`);
  assert.deepEqual(call.body.to, ["owner@example.test"], "owner mailbox only: never the customer");
  assert.equal(call.body.from, EMAIL_ENV.NOTIFICATION_FROM);
  assert.equal(call.body.subject, "New Form & Frame enquiry — FF-261005-ABCD");
  assert.equal(/<script|<img/i.test(call.body.html), false, "customer-controlled text is HTML-escaped");
  assert.match(call.body.html, /&lt;script&gt;/);
  assert.match(call.body.html, /^<h2>New enquiry: FF-261005-ABCD<\/h2>/);
  assert.ok(call.options.signal instanceof AbortSignal, "provider call is bounded by a timeout");
  assert.equal(state.events[0].delivery_status, "sent");
  assert.equal(state.events[0].error, null);
  assert.equal(state.events[0].next_attempt_at, null);
});

test("an empty message gets a fixed fallback line", async () => {
  const { run, state } = harness({ events: [due("email")], enquiries: [{ ...ENQUIRY, message: "" }], vars: EMAIL_ENV, fetcher: ok });
  await run(); assert.match(state.calls[0].body.html, /No additional message\./);
});

test("the provider idempotency key is stable across retries of the same event and distinct between events", async () => {
  const events = [due("email", { id: "evt-a" }), due("email", { id: "evt-b", channel: "email", request_id: "223e4567-e89b-42d3-a456-426614174000" })];
  const { run, state } = harness({ events, enquiries: [ENQUIRY, { ...ENQUIRY, id: "223e4567-e89b-42d3-a456-426614174000" }], vars: EMAIL_ENV, fetcher: async () => new Response("", { status: 500 }) });
  await run();
  state.events.forEach(e => { e.next_attempt_at = "2026-10-05T09:00:00.000Z"; });
  await run();
  const keys = state.calls.map(c => c.options.headers["Idempotency-Key"]);
  assert.equal(keys.length, 4);
  assert.equal(keys[0], keys[2]); assert.equal(keys[1], keys[3]);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys[0], "form-frame-new-enquiry-email/evt-a");
});

test("provider failures are recorded with a generic status line only, and stay in the retry queue", async () => {
  for (const status of [429, 500, 503]) {
    const { run, state } = harness({ events: [due("email")], vars: EMAIL_ENV, fetcher: async () => new Response(`secret echo ${EMAIL_ENV.RESEND_API_KEY}`, { status }) });
    const result = await run();
    assert.equal(result.failed, 1); assert.equal(state.calls.length, 1, "one provider call per claim");
    const ev = state.events[0];
    assert.equal(ev.delivery_status, "failed");
    assert.equal(ev.error, `Email provider returned HTTP ${status}.`);
    assert.equal(JSON.stringify(ev).includes(EMAIL_ENV.RESEND_API_KEY), false, "provider body/secret never stored");
    assert.ok(["pending", "failed"].includes(ev.delivery_status), "still selectable by the next run");
  }
});

test("network errors are recorded generically and never log secrets or customer data", async () => {
  const { run, state } = harness({ events: [due("email")], vars: EMAIL_ENV, fetcher: async () => { throw new Error(`connect refused for ${EMAIL_ENV.RESEND_API_KEY} / Fictional Customer`); } });
  assert.equal((await run()).failed, 1);
  assert.equal(state.events[0].error, "Notification provider could not be reached.");
  assert.equal(state.events[0].delivery_status, "failed");
  const everything = JSON.stringify([state.logs, state.events]);
  for (const secret of [EMAIL_ENV.RESEND_API_KEY, "Fictional Customer", "fictional-service-key", "owner@example.test"]) assert.equal(everything.includes(secret), false, `${secret} must not be recorded or logged`);
});

test("a result that cannot be saved is logged generically and counted as failed", async () => {
  const { run, state } = harness({ events: [due("email")], vars: EMAIL_ENV, fetcher: ok, failUpdate: true });
  const result = await run();
  assert.equal(result.failed, 1); assert.equal(result.sent, 0, "never reports sent when it could not record it");
  assert.deepEqual(state.logs, ["Notification retry result could not be recorded."]);
  assert.equal(JSON.stringify(state.logs).includes("fictional-service-key"), false);
});

test("missing email configuration marks not_configured, makes no provider call and stops retrying", async () => {
  for (const missing of Object.keys(EMAIL_ENV)) {
    const vars = { ...EMAIL_ENV, [missing]: "" };
    const { run, state } = harness({ events: [due("email")], vars, fetcher: ok });
    const result = await run();
    assert.equal(state.calls.length, 0, `no call when ${missing} is unset`);
    assert.equal(result.skipped, 1);
    assert.equal(state.events[0].delivery_status, "not_configured");
    assert.equal(state.events[0].next_attempt_at, null);
  }
});

test("an enquiry that no longer exists fails the event without calling any provider", async () => {
  const { run, state } = harness({ events: [due("email")], enquiries: [], vars: EMAIL_ENV, fetcher: ok });
  assert.equal((await run()).failed, 1);
  assert.equal(state.calls.length, 0);
  assert.equal(state.events[0].error, "Notification provider could not be reached.");
});

test("each run handles at most 10 due events", async () => {
  const events = Array.from({ length: 15 }, (_, i) => due("email", { id: `e${i}`, request_id: RID, next_attempt_at: `2026-10-05T09:${String(10 + i)}:00.000Z`, channel: "email" }));
  const { run } = harness({ events, vars: EMAIL_ENV, fetcher: ok });
  assert.equal((await run()).scanned, 10);
});

test("push retries: private dispatch token, minimal body, and outcome mapping", async () => {
  const mapping = { sent: "sent", no_owner: "not_configured", no_recipients: "not_configured", no_subscriptions: "not_configured", not_configured: "not_configured", partial: "failed", whatever: "failed" };
  for (const [pushStatus, expected] of Object.entries(mapping)) {
    const { run, state } = harness({ events: [due("push")], vars: { PUSH_DISPATCH_TOKEN: "fictional-push-token" }, fetcher: async () => new Response(JSON.stringify({ status: pushStatus }), { status: 200 }) });
    await run();
    const call = state.calls[0];
    assert.equal(call.url, "https://fictional-project.supabase.co/functions/v1/push-new-enquiry");
    assert.equal(call.options.headers.Authorization, "Bearer fictional-push-token");
    assert.deepEqual(call.body, { request_id: RID, reference: "FF-261005-ABCD" }, "no name, postcode or message goes to the push function");
    assert.equal(state.events[0].delivery_status, expected, `push status ${pushStatus}`);
  }
  const noToken = harness({ events: [due("push")], fetcher: ok });
  await noToken.run(); assert.equal(noToken.state.calls.length, 0); assert.equal(noToken.state.events[0].delivery_status, "not_configured");
  const http = harness({ events: [due("push")], vars: { PUSH_DISPATCH_TOKEN: "t" }, fetcher: async () => new Response("", { status: 502 }) });
  await http.run(); assert.equal(http.state.events[0].error, "Push function returned HTTP 502.");
});

test("CURRENT BEHAVIOUR (issue draft 5): there is no attempt ceiling, a hopeless event is retried forever", async () => {
  // If this test fails because the handler/migration now caps attempts, update it together with
  // supabase/drafts/20261018100000_notification_retry_cap_DRAFT.sql — do not delete the retry-forever evidence silently.
  const { run, state } = harness({ events: [due("email", { attempt_count: 500 })], vars: EMAIL_ENV, fetcher: async () => new Response("", { status: 401 }) });
  assert.equal((await run()).claimed, 1);
  assert.equal(state.calls.length, 1, "attempt 501 still calls the provider");
});
