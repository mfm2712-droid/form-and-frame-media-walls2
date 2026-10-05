import test from "node:test";
import assert from "node:assert/strict";
import { createEnquiryHandler, hashClientAddress } from "./handler.mjs";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const referenceUuid = "987e6543-e21b-43d3-b654-012345678901";
const origin = "https://form.example.test";

function validPayload(overrides = {}) {
  return {
    idempotency_key: uuid,
    customer_name: "Fictional Customer",
    email: "CUSTOMER@example.test",
    phone: "",
    postcode: "sl1 1aa",
    wall_width: "4.2 m",
    preferred_start: null,
    preferred_end: null,
    message: "A fictional project enquiry.",
    guide_low: 5560,
    guide_high: 6640,
    project_spec: { finish: "fictional oak", tv: "fictional 65 inch" },
    ...overrides
  };
}

function makeAdmin(options = {}) {
  const state = { requests: [], events: [], requestInsertCount: 0, rateLimitCalls:[], rateLimits:new Map(), rateLimitKeys:new Set(), options };
  const admin = {
    async rpc(name, args) {
      if (name === "consume_public_enquiry_slot") {
        state.rateLimitCalls.push(args);
        if (options.rateLimitError) return { data:null, error:options.rateLimitError };
        if (state.rateLimitKeys.has(args.p_idempotency_key)) {
          return { data:[{ allowed:true, retry_after_seconds:0 }], error:null };
        }
        const count = (state.rateLimits.get(args.p_fingerprint) || 0) + 1;
        state.rateLimits.set(args.p_fingerprint, count);
        const allowed = count <= (options.rateLimit ?? args.p_limit);
        if (allowed) state.rateLimitKeys.add(args.p_idempotency_key);
        return { data:[{ allowed, retry_after_seconds:1800 }], error:null };
      }
      if (options.rpcError) return { data:null, error:options.rpcError };
      assert.equal(name, "claim_new_enquiry_notification");
      let event = state.events.find(row => row.request_id === args.p_request_id && row.channel === args.p_channel && row.event_type === "new_enquiry");
      if (!event) {
        event = { id:`event-${state.events.length + 1}`, request_id:args.p_request_id, channel:args.p_channel, event_type:"new_enquiry", payload:args.p_payload, delivery_status:"pending", attempt_count:0, claim_until:null };
        state.events.push(event);
      }
      if (!args.p_enabled) {
        if (event.delivery_status !== "sent") event.delivery_status = "not_configured";
        return { data:[{ event_id:event.id, claimed:false, current_status:event.delivery_status }], error:null };
      }
      if (event.delivery_status === "not_configured") event.delivery_status = "pending";
      if (event.delivery_status === "sent") return { data:[{ event_id:event.id, claimed:false, current_status:"sent" }], error:null };
      if (event.claim_until) return { data:[{ event_id:event.id, claimed:false, current_status:event.delivery_status }], error:null };
      event.delivery_status = "pending";
      event.attempt_count++;
      event.claim_until = "active-claim";
      return { data:[{ event_id:event.id, claimed:true, current_status:"pending" }], error:null };
    },
    from(table) {
      const query = { table, operation: "", record: null, patch: null, filter: null };
      query.select = () => { query.returning = true; return query; };
      query.eq = (column, value) => {
        query.filter = [column, value];
        if (query.operation === "update") return Promise.resolve(updateRow());
        return query;
      };
      query.maybeSingle = async () => {
        if (options.lookupError) return { data: null, error: options.lookupError };
        const [column, value] = query.filter || [];
        return { data: state.requests.find(item => item[column] === value) || null, error: null };
      };
      query.insert = record => { query.operation = "insert"; query.record = record; return query; };
      query.single = async () => {
        if (table === "consultation_requests") {
          state.requestInsertCount++;
          if (options.insertConflict) {
            const existing = { id: "saved-race-id", reference: "FF-2601-02-ABCD", idempotency_key: query.record.idempotency_key };
            state.requests.push(existing);
            return { data: null, error: { code: "23505" } };
          }
          if (state.requests.some(item => item.idempotency_key === query.record.idempotency_key)) {
            return { data:null, error:{ code:"23505" } };
          }
          const saved = { id: "saved-request-id", ...query.record };
          state.requests.push(saved);
          if (options.insertThenThrow) throw options.insertThenThrow;
          return { data: { id: saved.id, reference: saved.reference }, error: null };
        }
        throw new Error(`Unexpected insert into ${table}`);
      };
      query.update = patch => { query.operation = "update"; query.patch = patch; return query; };
      function updateRow() {
        if (options.updateThrow) throw options.updateThrow;
        if (options.updateError) return { error: options.updateError };
        const [column, value] = query.filter || [];
        const row = state.events.find(item => item[column] === value);
        if (row) Object.assign(row, query.patch);
        return { error: null };
      }
      return query;
    }
  };
  return { admin, state };
}

function setup({ vars = {}, adminOptions = {}, fetcher = async () => new Response("{}", { status: 200 }) } = {}) {
  const { admin, state } = makeAdmin(adminOptions);
  const environment = {
    ALLOWED_ORIGINS: origin,
    SUPABASE_URL: "https://fictional-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fictional-test-only-key",
    ENQUIRY_RATE_LIMIT_SECRET: "fictional-rate-limit-secret-with-at-least-32-characters",
    ...vars
  };
  let adminFactoryCalls = 0;
  const handler = createEnquiryHandler({
    env: name => environment[name],
    createAdmin: async () => { adminFactoryCalls++; return admin; },
    fetcher,
    now: () => new Date("2026-10-04T12:00:00.000Z"),
    randomUUID: () => referenceUuid,
    logError: () => {}
  });
  return { handler, state, get adminFactoryCalls() { return adminFactoryCalls; } };
}

function post(handler, payload, headers = {}) {
  return handler(new Request("https://edge.example.test/submit-enquiry", {
    method: "POST",
    headers: { origin, "cf-connecting-ip":"203.0.113.8", "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload)
  }));
}

test("preflight permits only an explicitly allowed origin", async () => {
  const { handler, state } = setup();
  const allowed = await handler(new Request("https://edge.example.test/submit-enquiry", { method: "OPTIONS", headers: { origin } }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  const rejected = await handler(new Request("https://edge.example.test/submit-enquiry", { method: "OPTIONS", headers: { origin: "https://attacker.example" } }));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  const blockedPost = await handler(new Request("https://edge.example.test/submit-enquiry", {
    method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: JSON.stringify(validPayload())
  }));
  assert.equal(blockedPost.status, 403);
  const noOrigin = await handler(new Request("https://edge.example.test/submit-enquiry", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validPayload())
  }));
  assert.equal(noOrigin.status, 403);
  assert.equal(state.requests.length, 0);
});

test("rejects unsupported methods, malformed JSON and oversized payloads", async () => {
  const { handler, state } = setup();
  assert.equal((await handler(new Request("https://edge.example.test/submit-enquiry", { method: "GET", headers: { origin } }))).status, 405);
  assert.equal((await post(handler, "{" )).status, 400);
  assert.equal((await post(handler, "x".repeat(32_769))).status, 413);
  assert.equal(state.requests.length, 0);
});

test("cancels an oversized streamed body as soon as the byte limit is crossed", async () => {
  const { handler, state, adminFactoryCalls } = setup();
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(20_000)); },
    cancel() { cancelled = true; }
  });
  const response = await handler(new Request("https://edge.example.test/submit-enquiry", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
    duplex: "half"
  }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(state.requests.length, 0);
  assert.equal(adminFactoryCalls, 0);
});

test("rejects invalid fields before creating a database client", async () => {
  const { handler, state, adminFactoryCalls } = setup();
  const invalid = await post(handler, validPayload({ email: "not-an-email" }));
  assert.equal(invalid.status, 422);
  assert.equal(state.requests.length, 0);
  assert.equal(adminFactoryCalls, 0);
});

test("rate-limit fingerprints are keyed, stable, and never equal the source address", async () => {
  const first = await hashClientAddress("203.0.113.8", "fictional-rate-limit-secret-with-at-least-32-characters");
  const repeated = await hashClientAddress("203.0.113.8", "fictional-rate-limit-secret-with-at-least-32-characters");
  const differentSecret = await hashClientAddress("203.0.113.8", "different-fictional-secret-with-at-least-32-characters");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(repeated, first);
  assert.notEqual(differentSecret, first);
  assert.notEqual(first, "203.0.113.8");
  assert.equal(await hashClientAddress("not-an-address", "fictional-rate-limit-secret-with-at-least-32-characters"), null);
  assert.equal(await hashClientAddress("203.0.113.8", "short"), null);
});

test("allows ten new enquiries per edge address, then reports a retry delay", async () => {
  const { handler, state } = setup();
  for (let index = 1; index <= 10; index++) {
    const idempotencyKey = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    assert.equal((await post(handler, validPayload({ idempotency_key:idempotencyKey }))).status, 201);
  }
  const response = await post(handler, validPayload({ idempotency_key:"00000000-0000-4000-8000-000000000011" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "1800");
  const limited = await response.json();
  assert.match(limited.error, /too many enquiries/i);
  assert.equal(limited.retry_after_seconds, 1800);
  assert.equal(state.rateLimitCalls.length, 11);
  assert.equal(state.requests.length, 10);
  assert.doesNotMatch(state.rateLimitCalls[0].p_fingerprint, /203\.0\.113\.8/);
});

test("concurrent submissions with the same idempotency key consume one rate-limit slot", async () => {
  const { handler, state } = setup({ adminOptions:{ rateLimit:1 } });
  const payload = validPayload();
  const [first, retry] = await Promise.all([post(handler, payload), post(handler, payload)]);
  const results = await Promise.all([first.json(), retry.json()]);
  assert.deepEqual([first.status, retry.status].sort(), [200, 201]);
  assert.equal(new Set(results.map(result => result.reference)).size, 1);
  assert.equal(state.requests.length, 1);
  assert.equal(state.rateLimitCalls.length, 2);
  assert.equal(state.rateLimitKeys.size, 1);
  assert.equal(state.rateLimits.values().next().value, 1);
  assert.ok(state.rateLimitCalls.every(call => call.p_idempotency_key === uuid));
});

test("fails closed when edge address or rate-limit database protection is unavailable", async () => {
  const missingAddress = setup();
  assert.equal((await post(missingAddress.handler, validPayload(), { "cf-connecting-ip":"" })).status, 503);
  assert.equal(missingAddress.state.requests.length, 0);

  const databaseUnavailable = setup({ adminOptions:{ rateLimitError:new Error("fictional rate limiter outage") } });
  assert.equal((await post(databaseUnavailable.handler, validPayload())).status, 503);
  assert.equal(databaseUnavailable.state.requests.length, 0);

  const secretMissing = setup({ vars:{ ENQUIRY_RATE_LIMIT_SECRET:"" } });
  assert.equal((await post(secretMissing.handler, validPayload())).status, 503);
  assert.equal(secretMissing.adminFactoryCalls, 0);
});

test("rejects coerced, fractional, or reversed guide-price values", async () => {
  const { handler, state, adminFactoryCalls } = setup();
  const invalidEstimates = [
    { guide_low: "5560" },
    { guide_low: null },
    { guide_high: true },
    { guide_low: 5_560.5 },
    { guide_low: 6_640, guide_high: 5_560 }
  ];
  for (const estimate of invalidEstimates) assert.equal((await post(handler, validPayload(estimate))).status, 422);
  assert.equal(state.requests.length, 0);
  assert.equal(adminFactoryCalls, 0);
});

test("stores a complete preferred visit window as an unconfirmed request", async () => {
  const { handler, state } = setup();
  const response = await post(handler, validPayload({
    preferred_start: "2026-10-12T09:00:00+01:00",
    preferred_end: "2026-10-12T11:00:00+01:00"
  }));
  assert.equal(response.status, 201);
  assert.equal(state.requests[0].preferred_start, "2026-10-12T08:00:00.000Z");
  assert.equal(state.requests[0].preferred_end, "2026-10-12T10:00:00.000Z");
});

test("rejects partial, malformed, and reversed preferred visit windows before persistence", async () => {
  const { handler, state, adminFactoryCalls } = setup();
  const invalidWindows = [
    { preferred_start: "2026-10-12T09:00:00Z", preferred_end: null },
    { preferred_start: "not-a-date", preferred_end: "2026-10-12T11:00:00Z" },
    { preferred_start: "2026-10-12T12:00:00Z", preferred_end: "2026-10-12T11:00:00Z" },
    { preferred_start: "2026-02-30T09:00:00Z", preferred_end: "2026-02-30T11:00:00Z" },
    { preferred_start: "2026-10-12T09:00:00+24:00", preferred_end: "2026-10-12T11:00:00+24:00" }
  ];
  for (const window of invalidWindows) assert.equal((await post(handler, validPayload(window))).status, 422);
  assert.equal(state.requests.length, 0);
  assert.equal(adminFactoryCalls, 0);
});

test("discards honeypot submissions without persistence", async () => {
  const { handler, state, adminFactoryCalls } = setup();
  const response = await post(handler, validPayload({ company_website: "spam.example" }));
  assert.equal(response.status, 400);
  assert.equal(state.requests.length, 0);
  assert.equal(adminFactoryCalls, 0);
});

test("returns unavailable when server credentials are missing", async () => {
  const { handler, adminFactoryCalls } = setup({ vars: { SUPABASE_SERVICE_ROLE_KEY: "" } });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 503);
  assert.equal(adminFactoryCalls, 0);
});

test("persists a normalized fictional enquiry and tracks unconfigured email", async () => {
  const { handler, state } = setup();
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.notification, "not_configured");
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].email, "customer@example.test");
  assert.equal(state.requests[0].postcode, "SL1 1AA");
  assert.equal(state.requests[0].reference, "FF-261004-987E");
  assert.equal(state.events[0].delivery_status, "not_configured");
});

test("dispatches a privacy-minimal internal push after the enquiry is persisted", async () => {
  let dispatch;
  const { handler, state } = setup({
    vars:{ PUSH_DISPATCH_TOKEN:"fictional-push-dispatch-token" },
    fetcher:async (url, request) => {
      dispatch = { url, request };
      return Response.json({ status:"sent", delivered:1 });
    }
  });
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.push, "sent");
  assert.equal(dispatch.url, "https://fictional-project.supabase.co/functions/v1/push-new-enquiry");
  assert.equal(dispatch.request.headers.Authorization, "Bearer fictional-push-dispatch-token");
  assert.deepEqual(JSON.parse(dispatch.request.body), { request_id:"saved-request-id", reference:"FF-261004-987E" });
  assert.equal(state.requests.length, 1);
});

test("does not turn a saved enquiry into a failure when push delivery is unavailable", async () => {
  const { handler, state } = setup({
    vars:{ PUSH_DISPATCH_TOKEN:"fictional-push-dispatch-token" },
    fetcher:async () => { throw new Error("fictional push service unavailable"); }
  });
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.push, "failed_untracked");
  assert.equal(state.requests.length, 1);
});

test("returns the existing reference for a repeated idempotency key", async () => {
  const { handler, state } = setup();
  state.requests.push({ id: "prior-id", reference: "FF-2609-PRIOR", idempotency_key: uuid });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reference: "FF-2609-PRIOR", notification:"not_configured", push:"not_configured", duplicate: true });
  assert.equal(state.requestInsertCount, 0);
  assert.equal(state.rateLimitCalls.length, 0, "A retry of an already-saved request must not consume a second slot.");
  assert.equal(state.events.length, 2);
});

test("recovers a unique-index race by returning the saved enquiry", async () => {
  const { handler, state } = setup({ adminOptions: { insertConflict: true } });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reference: "FF-2601-02-ABCD", notification:"not_configured", push:"not_configured", duplicate: true });
  assert.equal(state.requestInsertCount, 1);
  assert.equal(state.events.length, 2);
});

test("recovers a committed enquiry when the insert response is lost", async () => {
  const { handler, state } = setup({
    adminOptions: { insertThenThrow: new Error("fictional connection dropped after commit") }
  });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reference: "FF-261004-987E", notification:"not_configured", push:"not_configured", duplicate: true });
  assert.equal(state.requests.length, 1);
  assert.equal(state.requestInsertCount, 1);
  assert.equal(state.events.length, 2);
});

test("a retried idempotent enquiry retries failed email and push delivery without creating duplicate events", async () => {
  let emailAttempts = 0, pushAttempts = 0;
  const { handler, state } = setup({
    vars: {
      RESEND_API_KEY:"fictional-test-key",
      NOTIFICATION_EMAIL:"owner@example.test",
      NOTIFICATION_FROM:"Form & Frame <noreply@example.test>",
      PUSH_DISPATCH_TOKEN:"fictional-push-dispatch-token"
    },
    fetcher:async url => {
      if (url === "https://api.resend.com/emails") { emailAttempts++; return new Response("{}", { status:200 }); }
      pushAttempts++;
      return Response.json({ status:"sent", delivered:1 });
    }
  });
  const saved = { id:"prior-id", reference:"FF-2609-PRIOR", idempotency_key:uuid, customer_name:"Saved Customer", email:"saved@example.test", phone:null, postcode:"SL1 1AA", wall_width:"4.2 m", message:"Original saved enquiry", project_spec:{ finish:"oak" }, guide_low:5000, guide_high:6000, source:"website" };
  state.requests.push(saved);
  state.events.push(
    { id:"email-event", request_id:saved.id, channel:"email", event_type:"new_enquiry", delivery_status:"failed", attempt_count:1, claim_until:null },
    { id:"push-event", request_id:saved.id, channel:"push", event_type:"new_enquiry", delivery_status:"failed", attempt_count:1, claim_until:null }
  );

  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.reference, saved.reference);
  assert.equal(body.notification, "sent");
  assert.equal(body.push, "sent");
  assert.equal(emailAttempts, 1);
  assert.equal(pushAttempts, 1);
  assert.equal(state.events.length, 2);
  assert.equal(state.events[0].attempt_count, 2);
  assert.equal(state.events[1].attempt_count, 2);
  assert.equal(state.events[0].delivery_status, "sent");
  assert.equal(state.events[1].delivery_status, "sent");
});

test("concurrent idempotent retries claim each channel at most once", async () => {
  let emailAttempts = 0, pushAttempts = 0;
  const { handler, state } = setup({
    vars: {
      RESEND_API_KEY:"fictional-test-key",
      NOTIFICATION_EMAIL:"owner@example.test",
      NOTIFICATION_FROM:"Form & Frame <noreply@example.test>",
      PUSH_DISPATCH_TOKEN:"fictional-push-dispatch-token"
    },
    fetcher:async url => {
      if (url === "https://api.resend.com/emails") { emailAttempts++; return new Response("{}", { status:200 }); }
      pushAttempts++;
      return Response.json({ status:"sent", delivered:1 });
    }
  });
  state.requests.push({ id:"prior-id", reference:"FF-2609-PRIOR", idempotency_key:uuid, customer_name:"Saved Customer", email:"saved@example.test", postcode:"SL1 1AA", message:"Original saved enquiry" });
  const responses = await Promise.all([post(handler, validPayload()), post(handler, validPayload())]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(emailAttempts, 1);
  assert.equal(pushAttempts, 1);
  assert.equal(state.events.length, 2);
});

test("sends only escaped notification content and records successful delivery", async () => {
  let sentRequest;
  const { handler, state } = setup({
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async (url, request) => { sentRequest = { url, request }; return new Response("{}", { status: 200 }); }
  });
  const response = await post(handler, validPayload({ customer_name: "<img src=x>", message: "Room has <script>alert(1)</script>" }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).notification, "sent");
  assert.equal(sentRequest.url, "https://api.resend.com/emails");
  assert.equal(sentRequest.request.headers["Idempotency-Key"], "form-frame-new-enquiry-email/event-1");
  const email = JSON.parse(sentRequest.request.body);
  assert.match(email.html, /&lt;img src=x&gt;/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.equal(state.events[0].delivery_status, "sent");
  assert.equal(state.events[0].attempt_count, 1);
});

test("records a failed notification without losing the saved enquiry", async () => {
  const { handler, state } = setup({
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async () => new Response("{}", { status: 503 })
  });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).notification, "failed");
  assert.equal(state.requests.length, 1);
  assert.equal(state.events[0].delivery_status, "failed");
  assert.equal(state.events[0].attempt_count, 1);
  assert.match(state.events[0].error, /HTTP 503/);
});

test("keeps the enquiry when notification tracking cannot be created", async () => {
  let networkCalls = 0;
  const { handler, state } = setup({
    adminOptions: { rpcError: { code: "TEST_TRACKING_FAILURE" } },
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async () => { networkCalls++; return new Response("{}", { status: 200 }); }
  });
  const response = await post(handler, validPayload());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).notification, "tracking_failed");
  assert.equal(state.requests.length, 1);
  assert.equal(networkCalls, 0);
});

test("keeps the saved enquiry successful when notification tracking insert throws", async () => {
  const { handler, state } = setup({
    adminOptions: { rpcError: new Error("fictional tracking network failure") },
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async () => { throw new Error("Email must not send without a tracking event."); }
  });
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.match(body.reference, /^FF-/);
  assert.equal(body.notification, "tracking_failed");
  assert.equal(state.requests.length, 1);
  assert.equal(state.events.length, 0);
});

test("reports delivered email truthfully when notification outcome update throws", async () => {
  let emailAttempts = 0;
  const { handler, state } = setup({
    adminOptions: { updateThrow: new Error("fictional tracking network failure") },
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async () => { emailAttempts++; return new Response("{}", { status: 200 }); }
  });
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.notification, "sent_untracked");
  assert.equal(state.requests.length, 1);
  assert.equal(state.events[0].delivery_status, "pending");
  assert.equal(emailAttempts, 1);
});

test("keeps a saved enquiry successful when failed-email tracking update throws", async () => {
  const { handler, state } = setup({
    adminOptions: { updateThrow: new Error("fictional tracking network failure") },
    vars: { RESEND_API_KEY: "fictional-test-key", NOTIFICATION_EMAIL: "owner@example.test", NOTIFICATION_FROM: "Form & Frame <noreply@example.test>" },
    fetcher: async () => { throw new Error("fictional email network failure"); }
  });
  const response = await post(handler, validPayload());
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.notification, "failed_untracked");
  assert.equal(state.requests.length, 1);
  assert.equal(state.events[0].delivery_status, "pending");
});
