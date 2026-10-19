import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteResponseHandler, hashToken } from "./handler.mjs";

const ORIGIN = "https://form-and-frame.vercel.app";
const token = "a".repeat(64);
function setup(rpcResult = { data:{ quote_number:"FFQ-1" }, error:null }) {
  const calls = [];
  const handler = createQuoteResponseHandler({
    env:name => ({ SUPABASE_URL:"https://otqzhocismdjbvvsjnpe.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"server-only" })[name],
    createAdmin:() => ({ rpc:async (name, args) => { calls.push({ name, args }); return typeof rpcResult === "function" ? rpcResult(name) : rpcResult; } })
  });
  const post = (body, origin = ORIGIN) => handler(new Request("https://example.test/quote-response", { method:"POST", headers:{ origin, "content-type":"application/json" }, body:JSON.stringify(body) }));
  return { calls, post, handler };
}

test("the raw token never reaches the database, only its SHA-256 hash", async () => {
  const { calls, post } = setup();
  const response = await post({ token, action:"view" });
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, "get_quote_for_response");
  assert.equal(calls[0].args.p_token_hash, await hashToken(token));
  assert.notEqual(calls[0].args.p_token_hash, token);
});

test("decisions are limited, a change request needs a message, and the origin is checked", async () => {
  const { calls, post } = setup({ data:{ ok:true }, error:null });
  assert.equal((await post({ token, decision:"paid" })).status, 400);
  assert.equal((await post({ token, decision:"changes_requested", message:"" })).status, 400);
  assert.equal((await post({ token:"short", decision:"accepted" })).status, 400);
  assert.equal((await post({ token, decision:"accepted" }, "https://evil.example")).status, 403);
  assert.equal(calls.length, 0, "nothing reaches the database for invalid requests");
  const ok = await post({ token, decision:"changes_requested", message:"Oak shelves please" });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], { name:"record_customer_quote_decision", args:{ p_token_hash:await hashToken(token), p_decision:"changes_requested", p_message:"Oak shelves please" } });
});

test("a used, expired or replaced link gets a clear refusal without database detail", async () => {
  const { post } = setup({ data:null, error:{ message:"Invalid or expired link", code:"P0001" } });
  const response = await post({ token, decision:"accepted" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /can no longer be answered online/);
  assert.doesNotMatch(JSON.stringify(body), /P0001|Invalid or expired/);
});

test("a valid link returns the quotation; a closed one returns only its state, even if the database sent more", async () => {
  const open = { open:true, state:"open", quote_number:"FFQ-1", customer_name:"Fictional Customer", total_pence:120000, terms:"Fictional terms" };
  let { post } = setup({ data:open, error:null });
  let body = await (await post({ token, action:"view" })).json();
  assert.equal(body.quote.customer_name, "Fictional Customer");
  for (const state of ["answered", "replaced", "expired", "closed"]) {
    const leaky = { open:false, state, decision:"accepted", seller_email:"hello@example.com", quote_number:"FFQ-1", customer_name:"Fictional Customer", total_pence:120000, line_items:[{}], terms:"x", scope:"x", reference:"FF-1" };
    ({ post } = setup({ data:leaky, error:null }));
    const response = await post({ token, action:"view" });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.deepEqual(body.quote, { open:false, state, decision:"accepted", seller_email:"hello@example.com" }, `${state} link shows only its state`);
  }
  ({ post } = setup({ data:{ open:"yes", customer_name:"Fictional Customer" }, error:null }));
  assert.deepEqual((await (await post({ token, action:"view" })).json()).quote, { open:false, state:"closed" }, "anything not strictly open is treated as closed");
});

test("an unknown, used or reused link cannot be answered and reveals nothing", async () => {
  let answered = false;
  const { post } = setup(() => {
    if (answered) return { data:null, error:{ message:"Invalid or expired link", code:"P0001" } };
    answered = true; return { data:{ ok:true, decision:"accepted" }, error:null };
  });
  assert.equal((await post({ token, decision:"accepted" })).status, 200, "first answer is recorded");
  const reuse = await post({ token, decision:"rejected" });
  assert.equal(reuse.status, 409, "the same link cannot answer twice");
  assert.doesNotMatch(await reuse.text(), /Fictional|FFQ|pence|P0001/);
  const unknown = setup({ data:null, error:{ message:"Invalid or expired link", code:"P0001" } });
  const view = await unknown.post({ token:"c".repeat(64), action:"view" });
  assert.equal(view.status, 404);
  assert.doesNotMatch(await view.text(), /Invalid or expired link|P0001/);
});

test("a customer decision confirms by email and alerts the owner", async () => {
  const sent = [];
  const tokenHash = await hashToken(token);
  const rows = {
    quote_response_links:[{ token_hash:tokenHash, quote_id:"quote-1" }],
    quotes:[{ id:"quote-1", request_id:"request-1", quote_number:"FFQ-TEST-1" }],
    consultation_requests:[{ id:"request-1", customer_name:"Fictional Customer", email:"customer@example.test", reference:"FF-TEST-1" }]
  };
  const find = (table, filters) => (rows[table] || []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null;
  const admin = {
    from(table) {
      const query = { filters:{} };
      const chain = { select:() => chain, eq:(key, value) => { query.filters[key] = value; return chain; }, maybeSingle:async () => ({ data:find(table, query.filters), error:null }) };
      return chain;
    },
    rpc:async () => ({ data:{ ok:true, decision:"accepted" }, error:null })
  };
  const handler = createQuoteResponseHandler({
    env:name => ({ SUPABASE_URL:"https://otqzhocismdjbvvsjnpe.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"server-only", RESEND_API_KEY:"fictional-resend-key", NOTIFICATION_EMAIL:"owner@example.test", NOTIFICATION_FROM:"Form & Frame <noreply@example.test>" })[name],
    createAdmin:() => admin,
    fetcher:async (url, options) => { sent.push({ url, options }); return new Response("{}", { status:200 }); }
  });
  const response = await handler(new Request("https://example.test/quote-response", { method:"POST", headers:{ origin:ORIGIN, "content-type":"application/json" }, body:JSON.stringify({ token, decision:"accepted" }) }));
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
  const emails = sent.map(item => JSON.parse(item.options.body));
  assert.deepEqual(emails.map(email => email.to[0]).sort(), ["customer@example.test", "owner@example.test"]);
  assert.match(emails.find(email => email.to[0] === "customer@example.test").html, /Quotation update received/);
});
