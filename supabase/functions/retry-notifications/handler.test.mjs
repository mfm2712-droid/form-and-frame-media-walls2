import assert from "node:assert/strict";
import test from "node:test";
import { createNotificationRetryHandler } from "./handler.mjs";

const now = new Date("2026-10-05T10:00:00.000Z");
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const token = "fictional-retry-token";

function setup({ events = [], enquiries = [], vars = {}, fetcher = async () => new Response("{}", { status:200 }) } = {}) {
  const settings = { SUPABASE_URL:"https://fictional-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"fictional-service-key", NOTIFICATION_RETRY_TOKEN:token, ...vars };
  const state = { events:structuredClone(events), enquiries, requests:[], errors:[] };
  const admin = {
    async rpc(name, args) {
      assert.ok(["claim_new_enquiry_notification", "claim_notification_event"].includes(name));
      const event = name === "claim_notification_event"
        ? state.events.find(row => row.id === args.p_event_id)
        : state.events.find(row => row.request_id === args.p_request_id && row.channel === args.p_channel);
      if (!event || event.claim_until === "active" || event.next_attempt_at > now.toISOString()) {
        return { data:[{ event_id:event?.id, claimed:false, current_status:event?.delivery_status || "missing" }], error:null };
      }
      event.claim_until = "active";
      event.attempt_count++;
      event.delivery_status = "pending";
      event.next_attempt_at = new Date(now.getTime() + Math.min(2 ** event.attempt_count, 16) * 60_000).toISOString();
      return { data:[{ event_id:event.id, claimed:true, current_status:"pending" }], error:null };
    },
    from(table) {
      const query = { table, filter:{}, where:[], patch:null };
      query.select = () => query;
      query.in = (column, value) => { query.where.push(row => value.includes(row[column])); return query; };
      query.lte = (column, value) => { query.where.push(row => row[column] <= value); return query; };
      query.order = () => query;
      query.limit = count => {
        const rows = state.events.filter(row => query.where.every(predicate => predicate(row))).slice(0, count);
        return Promise.resolve({ data:rows, error:null });
      };
      query.eq = (column, value) => {
        if (query.patch) {
          const row = state.events.find(item => item[column] === value);
          if (row) Object.assign(row, query.patch);
          return Promise.resolve({ error:null });
        }
        query.filter[column] = value;
        return query;
      };
      query.maybeSingle = async () => ({ data:state.enquiries.find(row => row.id === query.filter.id) || null, error:null });
      query.update = patch => { query.patch = patch; return query; };
      return query;
    }
  };
  const handler = createNotificationRetryHandler({
    env:name => settings[name], createAdmin:async () => admin, fetcher,
    now:() => new Date(now), logError:message => state.errors.push(message)
  });
  const post = auth => handler(new Request("https://edge.example.test/retry", {
    method:"POST", headers:auth ? { authorization:`Bearer ${auth}`, "content-type":"application/json" } : { "content-type":"application/json" }, body:"{}"
  }));
  return { handler, post, state };
}

function pending(channel, overrides = {}) {
  return { id:`${channel}-event`, request_id:requestId, channel, event_type:"new_enquiry", payload:{ reference:"FF-261005-ABCD" }, delivery_status:"failed", attempt_count:1, next_attempt_at:"2026-10-05T09:00:00.000Z", claim_until:null, ...overrides };
}
const enquiry = { id:requestId, reference:"FF-261005-ABCD", customer_name:"Fictional Customer", postcode:"SL1 1AA", message:"Fictional brief" };

test("requires the private retry token and POST method", async () => {
  const { handler, post } = setup();
  assert.equal((await post("wrong-token")).status, 401);
  assert.equal((await post(token)).status, 200);
  assert.equal((await handler(new Request("https://edge.example.test/retry", { method:"GET" }))).status, 405);
});

test("retries a due failed email from the saved enquiry and records success", async () => {
  let sent;
  const { post, state } = setup({
    events:[pending("email")], enquiries:[enquiry],
    vars:{ RESEND_API_KEY:"fictional-resend-key", NOTIFICATION_EMAIL:"owner@example.test", NOTIFICATION_FROM:"Form & Frame <noreply@example.test>" },
    fetcher:async (url, options) => { sent={ url, options }; return new Response("{}", { status:200 }); }
  });
  const response = await post(token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status:"complete", scanned:1, claimed:1, sent:1, failed:0, skipped:0 });
  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.options.headers["Idempotency-Key"], "form-frame-new-enquiry-email/email-event");
  assert.match(JSON.parse(sent.options.body).html, /FF-261005-ABCD/);
  assert.equal(state.events[0].delivery_status, "sent");
  assert.equal(state.events[0].claim_until, null);
  assert.equal(state.events[0].next_attempt_at, null);
});

test("retries push without sending customer details to the push provider", async () => {
  let sent;
  const { post, state } = setup({
    events:[pending("push")], enquiries:[enquiry], vars:{ PUSH_DISPATCH_TOKEN:"fictional-push-token" },
    fetcher:async (url, options) => { sent={ url, options }; return Response.json({ status:"sent", delivered:1 }); }
  });
  const response = await post(token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sent, 1);
  assert.equal(sent.url, "https://fictional-project.supabase.co/functions/v1/push-new-enquiry");
  assert.deepEqual(JSON.parse(sent.options.body), { request_id:requestId, reference:"FF-261005-ABCD" });
  assert.equal(state.events[0].delivery_status, "sent");
});

test("retries a workflow push without loading or exposing customer or financial details", async () => {
  let sent;
  const workflowEvent = {
    id:"123e4567-e89b-42d3-a456-426614174001", request_id:null, channel:"push", event_type:"workflow_update",
    payload:{ title:"Visit booked", body:"Survey appointment was added to the calendar.", view:"calendar", exclude_user_id:requestId },
    delivery_status:"failed", attempt_count:0, next_attempt_at:"2026-10-05T09:00:00.000Z", claim_until:null
  };
  const { post, state } = setup({
    events:[workflowEvent], vars:{ PUSH_DISPATCH_TOKEN:"fictional-push-token" },
    fetcher:async (url, options) => { sent={ url, options }; return Response.json({ status:"sent", delivered:1 }); }
  });
  const response = await post(token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status:"complete", scanned:1, claimed:1, sent:1, failed:0, skipped:0 });
  assert.deepEqual(JSON.parse(sent.options.body), {
    event_id:workflowEvent.id, title:"Visit booked", body:"Survey appointment was added to the calendar.", view:"calendar", exclude_user_id:requestId
  });
  assert.equal(state.events[0].delivery_status, "sent");
});

test("does not send an event whose retry time has not arrived", async () => {
  let calls = 0;
  const { post, state } = setup({ events:[pending("email", { next_attempt_at:"2026-10-05T10:01:00.000Z" })], fetcher:async () => { calls++; return new Response("{}", { status:200 }); } });
  const response = await post(token);
  assert.equal((await response.json()).scanned, 0);
  assert.equal(calls, 0);
  assert.equal(state.events[0].attempt_count, 1);
});

test("keeps an enquiry notification failed for exponential backoff after provider errors", async () => {
  const { post, state } = setup({
    events:[pending("email")], enquiries:[enquiry],
    vars:{ RESEND_API_KEY:"fictional-resend-key", NOTIFICATION_EMAIL:"owner@example.test", NOTIFICATION_FROM:"Form & Frame <noreply@example.test>" },
    fetcher:async () => new Response("{}", { status:503 })
  });
  const response = await post(token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).failed, 1);
  assert.equal(state.events[0].delivery_status, "failed");
  assert.equal(state.events[0].claim_until, null);
  assert.equal(state.events[0].next_attempt_at, "2026-10-05T10:04:00.000Z");
});

test("only retries supported enquiry and workflow notification events", async () => {
  let calls = 0;
  const { post, state } = setup({
    events:[pending("sms"), pending("email", { event_type:"invoice_due" })],
    enquiries:[enquiry], fetcher:async () => { calls++; return Response.json({ status:"sent" }); }
  });
  const response = await post(token);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).skipped, 2);
  assert.equal(calls, 0);
  assert.equal(state.errors.length, 0);
});

test("fails closed when private retry configuration is missing", async () => {
  const { handler } = setup({ vars:{ SUPABASE_SERVICE_ROLE_KEY:"" } });
  const response = await handler(new Request("https://edge.example.test/retry", {
    method:"POST", headers:{ authorization:`Bearer ${token}` }, body:"{}"
  }));
  assert.equal(response.status, 503);
});
