// FRAME-004: authentication, session and role-gating behaviour of the real operations/app.js,
// run against a fake DOM and a mocked Supabase client (no network, no credentials).
import test from "node:test";
import assert from "node:assert/strict";
import { bootStaffApp, mockClient } from "./test-support/app-harness.mjs";

const config = { supabaseUrl: "https://example.invalid", supabaseAnonKey: "fictional-anon-key" };
const BUSINESS_TABLES = ["quotes", "work_orders", "invoices", "invoice_payments", "business_settings", "consultation_requests", "appointments", "follow_up_tasks"];

async function withApp(options, run) {
  const client = options.client || mockClient(options.clientOptions);
  const app = await bootStaffApp({ config, client, ...options.boot });
  try { return await run({ app, client }); } finally { await app.restore(); }
}

test("login: requests a magic link for the typed email, never creates users, and returns to the current staff page", async () => {
  await withApp({ clientOptions: {} }, async ({ app, client }) => {
    app.$("email").value = "team.member@example.test";
    await app.$("login").fire("submit");
    assert.equal(client.log.otp.length, 1);
    assert.deepEqual(client.log.otp[0], { email: "team.member@example.test", options: { emailRedirectTo: app.location.href, shouldCreateUser: false } });
    assert.equal(client.log.otp[0].options.shouldCreateUser, false, "unknown emails must not be able to self-register");
    assert.match(app.$("loginMsg").textContent, /Secure sign-in link sent/);
  });
});

test("login: the submit button is disabled while sending and re-enabled afterwards; a repeated submit sends again only when asked", async () => {
  let release;
  const client = mockClient();
  client.auth.signInWithOtp = async arg => { client.log.otp.push(arg); await new Promise(resolve => { release = resolve; }); return { error: null }; };
  await withApp({ client }, async ({ app }) => {
    const button = { disabled: false };
    const pending = app.$("login").fire("submit", { submitter: button });
    await app.settle();
    assert.equal(button.disabled, true);
    assert.match(app.$("loginMsg").textContent, /Sending secure sign-in link/);
    release(); await pending;
    assert.equal(button.disabled, false);
  });
});

test("login: a provider error or a network exception shows a plain message and never leaks the raw error to the page", async () => {
  for (const clientOptions of [{ otpError: new Error("Signups not allowed for otp (internal detail)") }, { otpRejects: new TypeError("Failed to fetch") }]) {
    await withApp({ clientOptions }, async ({ app, client }) => {
      const button = { disabled: false };
      await app.$("login").fire("submit", { submitter: button });
      assert.equal(client.log.otp.length, 1);
      assert.match(app.$("loginMsg").textContent, /sign-in link couldn't be sent/);
      assert.equal(/internal detail|Failed to fetch|Signups/.test(app.$("loginMsg").textContent), false);
      assert.equal(button.disabled, false, "the form must be usable again after a failure");
    });
  }
});

test("logout: signs out of Supabase and reloads; both sign-out buttons share the same path", async () => {
  await withApp({ clientOptions: {} }, async ({ app, client }) => {
    await app.$("signOut").fire("click");
    assert.equal(client.log.signOut, 1);
    assert.equal(app.calls.reload, 1);
    await app.$("accessSignOut").fire("click");
    assert.equal(client.log.signOut, 2);
    assert.equal(app.calls.reload, 2);
  });
});

test("signed out (no session): the desk stays hidden, the login form is shown and no business table is queried", async () => {
  await withApp({ clientOptions: { session: null, userError: { name: "AuthSessionMissingError" } } }, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, true);
    assert.equal(app.$("setup").hidden, false);
    assert.equal(app.$("login").hidden, false);
    assert.match(app.$("setupCopy").textContent, /session has ended/i);
    assert.deepEqual(client.log.queries, []);
  });
});

test("session expiry: a stored session whose user can no longer be verified is treated as signed out", async () => {
  await withApp({ clientOptions: { session: { access_token: "expired-fictional" }, user: null } }, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, true);
    assert.equal(app.$("login").hidden, false);
    assert.deepEqual(client.log.queries, []);
  });
});

test("session or network errors fail closed with a retry path rather than showing an empty or stale desk", async () => {
  await withApp({ clientOptions: { sessionError: new Error("network down") } }, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, true);
    assert.match(app.$("loginMsg").textContent, /couldn't verify your session/);
    assert.deepEqual(client.log.queries, []);
  });
  await withApp({ clientOptions: { session: { access_token: "t" }, userError: new Error("Connection failed") } }, async ({ app, client }) => {
    assert.equal(app.$("hub").hidden, true);
    assert.equal(app.$("accessActions").hidden, false, "retry/sign-out actions are offered");
    assert.equal(app.$("login").hidden, true);
    assert.match(app.$("setupCopy").textContent, /couldn't verify your staff access/);
    assert.deepEqual(client.log.queries, []);
  });
});

test("protected views: a signed-in account with no team profile (or an unknown role) cannot reach any business record", async () => {
  for (const role of [null, "customer", "admin"]) {
    await withApp({ clientOptions: { session: { access_token: "t" }, user: { id: "u1" }, role } }, async ({ app, client }) => {
      assert.equal(app.$("hub").hidden, true, `role ${role}`);
      assert.equal(app.$("setup").hidden, false);
      assert.equal(app.$("accessActions").hidden, false);
      assert.match(app.$("setupCopy").textContent, /has not been added to the Form & Frame team/);
      assert.deepEqual(client.log.queries.filter(table => table !== "profiles"), [], "only the profile lookup may run");
      for (const table of BUSINESS_TABLES) assert.equal(client.log.queries.includes(table), false, `${table} must not be queried`);
    });
  }
});

test("a profile read error fails closed (no desk)", async () => {
  await withApp({ clientOptions: { session: { access_token: "t" }, user: { id: "u1" }, role: "owner", profileError: new Error("denied") } }, async ({ app }) => {
    assert.equal(app.$("hub").hidden, true);
    assert.match(app.$("setupCopy").textContent, /couldn't verify your staff access/);
  });
});

test("role gating in the UI: owner sees invoice-seller settings, staff does not (UI only; RLS is the real control)", async () => {
  await withApp({ clientOptions: { session: { access_token: "t" }, user: { id: "owner-1" }, role: "owner" } }, async ({ app }) => {
    assert.equal(app.$("hub").hidden, false);
    assert.equal(app.$("setup").hidden, true);
    assert.equal(app.$("invoiceSettings").hidden, false);
  });
  await withApp({ clientOptions: { session: { access_token: "t" }, user: { id: "staff-1" }, role: "staff" } }, async ({ app }) => {
    assert.equal(app.$("hub").hidden, false);
    assert.equal(app.$("invoiceSettings").hidden, true);
  });
});

test("role gating in the UI: a staff account cannot submit invoice seller details", async () => {
  await withApp({ clientOptions: { session: { access_token: "t" }, user: { id: "staff-1" }, role: "staff" } }, async ({ app, client }) => {
    const form = new globalThis.HTMLFormElement(); form.id = "invoiceSettingsForm";
    const before = client.log.queries.length;
    await app.$("business").fire("submit", { target: form });
    assert.match(app.$("notice").textContent, /Only a signed-in owner can update invoice seller details/);
    assert.equal(client.log.queries.slice(before).includes("business_settings"), false, "no write attempt reaches the database");
  });
});

test("missing configuration runs the clearly labelled demo with no Supabase client and no sign-in", async () => {
  const client = mockClient();
  const app = await bootStaffApp({ config: undefined, client });
  try {
    assert.equal(app.calls.createClient.length, 0);
    assert.match(app.$("setupCopy").textContent, /Demo mode/);
    assert.equal(app.$("demoTag").hidden, false);
    assert.equal(app.$("signOut").hidden, true);
    assert.deepEqual(client.log.queries, []);
    assert.equal(client.log.otp.length, 0);
  } finally { await app.restore(); }
  const placeholder = await bootStaffApp({ config: { supabaseUrl: "https://YOUR_PROJECT.supabase.co", supabaseAnonKey: "x" }, client });
  try { assert.equal(placeholder.calls.createClient.length, 0, "placeholder config must not create a client"); } finally { await placeholder.restore(); }
});

test("the real client is created exactly once with the configured URL and anon key only", async () => {
  await withApp({ clientOptions: {} }, async ({ app }) => {
    assert.equal(app.calls.createClient.length, 1);
    assert.deepEqual(app.calls.createClient[0], [config.supabaseUrl, config.supabaseAnonKey]);
  });
});

test("expiry while the desk is open: the next refresh hides the desk, clears the lists and returns to sign-in", async () => {
  const client = mockClient({ session: { access_token: "t" }, user: { id: "owner-1" }, role: "owner" });
  await withApp({ client }, async ({ app }) => {
    assert.equal(app.$("hub").hidden, false);
    // Session expires server-side (refresh token revoked or expired).
    client.auth.getUser = async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError" } });
    const queriesBefore = client.log.queries.length;
    await app.$("refresh").fire("click");
    await app.settle();
    assert.equal(app.$("hub").hidden, true);
    assert.equal(app.$("setup").hidden, false);
    assert.equal(app.$("login").hidden, false);
    assert.match(app.$("setupCopy").textContent, /session has ended/i);
    assert.deepEqual(client.log.queries.slice(queriesBefore), [], "no record is fetched after expiry");
  });
});
