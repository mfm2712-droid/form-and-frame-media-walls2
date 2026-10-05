import test from "node:test";
import assert from "node:assert/strict";
import { createPushHandler, isValidVapidSubject } from "./handler.mjs";

const id = "123e4567-e89b-42d3-a456-426614174000";
const env = {
  PUSH_DISPATCH_TOKEN:"fictional-dispatch-token",
  SUPABASE_URL:"https://fictional.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"fictional-service-key",
  VAPID_PUBLIC_KEY:"fictional-public-vapid",
  VAPID_PRIVATE_KEY:"fictional-private-vapid",
  VAPID_SUBJECT:"mailto:owner@formandframe.co.uk"
};

function setup({ subscriptions = [], owners = [{ id:"owner-id" }], sendPush = async () => ({ statusCode:201 }), envOverrides = {} } = {}) {
  const config = { ...env, ...envOverrides };
  const state = { events:[], deleted:[], sent:[] };
  const admin = { from(table) {
    const query = { table, operation:"", record:null, patch:null, filter:null };
    query.select = () => query;
    query.eq = async (column, value) => {
      query.filter = [column, value];
      if (table === "profiles" && column === "role") return { data:value === "owner" ? owners : [], error:null };
      if (table === "notification_events") return { error:null };
      return query;
    };
    query.in = async (column, value) => {
      if (table === "profiles" && column === "role") return { data:owners.filter(owner => value.includes(owner.role || "owner")), error:null };
      if (table === "push_subscriptions" && query.operation !== "delete") return { data:subscriptions.filter(item => value.includes(item.user_id)), error:null };
      state.deleted.push(...value); return { error:null };
    };
    query.insert = record => { query.operation="insert"; query.record=record; return query; };
    query.single = async () => {
      if (table !== "notification_events") throw new Error("Unexpected insert table");
      state.events.push(query.record);
      return { data:{ id:"event-id" }, error:null };
    };
    query.update = patch => { query.operation="update"; query.patch=patch; return query; };
    query.delete = () => { query.operation="delete"; return query; };
    return query;
  } };
  const handler = createPushHandler({
    env:name => config[name], createAdmin:async () => admin,
    sendPush:async (...args) => { state.sent.push(args); return sendPush(...args); }
  });
  const request = (token = config.PUSH_DISPATCH_TOKEN, body = { request_id:id, reference:"FF-261005-ABCD" }) => new Request("https://edge.example.test/push", {
    method:"POST", headers:{ authorization:`Bearer ${token}`, "content-type":"application/json" }, body:JSON.stringify(body)
  });
  return { handler, request, state };
}

test("accepts only a valid VAPID mailto or HTTPS contact URI", () => {
  assert.equal(isValidVapidSubject("mailto:owner@formandframe.co.uk"), true);
  assert.equal(isValidVapidSubject("mailto:ops@example.invalid"), false);
  assert.equal(isValidVapidSubject("https://formandframe.co.uk/contact"), true);
  assert.equal(isValidVapidSubject("owner@formandframe.co.uk"), false);
  assert.equal(isValidVapidSubject("http://formandframe.co.uk"), false);
  assert.equal(isValidVapidSubject("https://user:secret@formandframe.co.uk"), false);
  assert.equal(isValidVapidSubject("https://formandframe.example.invalid"), false);
  assert.equal(isValidVapidSubject(""), false);
});

test("does not attempt delivery with an invalid VAPID contact", async () => {
  const { handler, request, state } = setup({ subscriptions:[{ id:"sub", user_id:"owner-id", endpoint:"https://push.example/active", p256dh:"p256dh", auth_secret:"auth" }], envOverrides:{ VAPID_SUBJECT:"ops@example.invalid" } });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "not_configured");
  assert.equal(state.sent.length, 0);
});

test("requires its private dispatch token and validates methods", async () => {
  const { handler, request } = setup();
  assert.equal((await handler(request("wrong"))).status, 401);
  assert.equal((await handler(new Request("https://edge.example.test/push", { method:"GET" }))).status, 405);
});

test("does not send when Anthony has not opted in any owner device", async () => {
  const { handler, request, state } = setup({ subscriptions:[] });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "no_subscriptions");
  assert.equal(state.sent.length, 0);
});

test("sends a privacy-minimal push to subscribed owner devices and removes expired endpoints", async () => {
  const subscriptions = [
    { id:"active", user_id:"owner-id", endpoint:"https://push.example/active", p256dh:"p256dh", auth_secret:"auth" },
    { id:"expired", user_id:"owner-id", endpoint:"https://push.example/expired", p256dh:"p256dh", auth_secret:"auth" }
  ];
  const { handler, request, state } = setup({
    subscriptions,
    sendPush:async subscription => { if (subscription.endpoint.endsWith("expired")) throw Object.assign(new Error("Gone"), { statusCode:410 }); return { statusCode:201 }; }
  });
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.status, "sent");
  assert.equal(result.delivered, 1);
  assert.deepEqual(state.deleted, ["expired"]);
  assert.equal(JSON.parse(state.sent[0][1]).url, `./?enquiry=${id}`);
  assert.match(JSON.parse(state.sent[0][1]).body, /FF-261005-ABCD/);
  assert.equal(JSON.stringify(state.sent).includes("customer"), false);
  assert.equal(JSON.stringify(state.sent).includes("postcode"), false);
});

test("does not report delivery when every saved device endpoint has expired", async () => {
  const subscriptions = [
    { id:"expired-a", user_id:"owner-id", endpoint:"https://push.example/expired-a", p256dh:"p256dh-a", auth_secret:"auth-a" },
    { id:"expired-b", user_id:"owner-id", endpoint:"https://push.example/expired-b", p256dh:"p256dh-b", auth_secret:"auth-b" }
  ];
  const { handler, request, state } = setup({
    subscriptions,
    sendPush:async () => { throw Object.assign(new Error("Gone"), { statusCode:410 }); }
  });
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.status, "no_subscriptions");
  assert.equal(result.delivered, 0);
  assert.deepEqual(state.deleted, ["expired-a", "expired-b"]);
  assert.equal(state.sent.length, 2);
});

test("reports partial device delivery as failed so the outbox retries transient failures", async () => {
  const subscriptions = [
    { id:"anthony-device", user_id:"owner-id", endpoint:"https://push.example/anthony", p256dh:"p256dh-a", auth_secret:"auth-a" },
    { id:"second-device", user_id:"owner-id", endpoint:"https://push.example/second", p256dh:"p256dh-b", auth_secret:"auth-b" }
  ];
  const { handler, request, state } = setup({
    subscriptions,
    sendPush:async subscription => {
      if (subscription.endpoint.endsWith("second")) throw Object.assign(new Error("Temporary provider error"), { statusCode:503 });
      return { statusCode:201 };
    }
  });
  const response = await handler(request());
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.status, "failed");
  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 1);
  assert.equal(state.sent.length, 2);
});

test("sends a privacy-minimal workflow alert to teammates but not its actor", async () => {
  const subscriptions = [
    { id:"actor-device", user_id:"223e4567-e89b-42d3-a456-426614174000", endpoint:"https://push.example/actor", p256dh:"p256dh-a", auth_secret:"auth-a" },
    { id:"teammate-device", user_id:"323e4567-e89b-42d3-a456-426614174000", endpoint:"https://push.example/teammate", p256dh:"p256dh-b", auth_secret:"auth-b" }
  ];
  const owners = [{ id:"223e4567-e89b-42d3-a456-426614174000", role:"owner" }, { id:"323e4567-e89b-42d3-a456-426614174000", role:"staff" }];
  const { handler, request, state } = setup({
    subscriptions, owners,
    sendPush:async subscription => ({ statusCode:201 })
  });
  const response = await handler(request(env.PUSH_DISPATCH_TOKEN, {
    event_id:id, title:"Visit booked", body:"Survey appointment was added to the calendar.",
    view:"calendar", exclude_user_id:"223e4567-e89b-42d3-a456-426614174000"
  }));
  const result = await response.json();
  assert.equal(result.status, "sent", JSON.stringify(result));
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0][0].endpoint, /teammate/);
  const payload = JSON.parse(state.sent[0][1]);
  assert.equal(payload.title, "Visit booked");
  assert.equal(payload.tag, `workflow-${id}`);
  assert.equal(payload.url, "./?view=calendar");
  assert.doesNotMatch(JSON.stringify(payload), /customer|postcode|amount|invoice number/i);
});

test("rejects workflow alerts with an external navigation target or missing event id", async () => {
  const { handler, request, state } = setup({ subscriptions:[{ id:"sub", user_id:"owner-id", endpoint:"https://push.example/active", p256dh:"p256dh", auth_secret:"auth" }] });
  const bad = await handler(request(env.PUSH_DISPATCH_TOKEN, {
    event_id:id, title:"Unsafe", body:"Open link", view:"https://attacker.example"
  }));
  assert.equal(bad.status, 422);
  assert.equal(state.sent.length, 0);
});
