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
