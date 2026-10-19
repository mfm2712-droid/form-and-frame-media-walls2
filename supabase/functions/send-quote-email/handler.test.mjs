import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteEmailHandler, hashToken } from "./handler.mjs";

const ORIGIN = "https://form-and-frame.vercel.app";
const token = "a".repeat(64);
const tokenHash = await hashToken(token);

function setup() {
  const sent = [];
  const rows = {
    profiles:[{ id:"staff-1", role:"owner" }],
    quote_response_links:[{ token_hash:tokenHash, quote_id:"quote-1", expires_at:"2099-01-01T00:00:00.000Z", used_at:null }],
    quotes:[{ id:"quote-1", request_id:"request-1", quote_number:"FFQ-TEST-1", status:"sent", total_pence:120000, valid_until:"2099-01-01" }],
    consultation_requests:[{ id:"request-1", customer_name:"Fictional Customer", email:"customer@example.test", reference:"FF-TEST-1" }]
  };
  const find = (table, filters) => (rows[table] || []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null;
  const admin = {
    auth:{ getUser:async () => ({ data:{ user:{ id:"staff-1" } }, error:null }) },
    from(table) {
      const query = { filters:{} };
      const chain = {
        select:() => chain,
        eq:(key, value) => { query.filters[key] = value; return chain; },
        maybeSingle:async () => ({ data:find(table, query.filters), error:null })
      };
      return chain;
    }
  };
  const handler = createQuoteEmailHandler({
    env:name => ({
      ALLOWED_ORIGINS:ORIGIN,
      SUPABASE_URL:"https://otqzhocismdjbvvsjnpe.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:"server-only",
      RESEND_API_KEY:"fictional-resend-key",
      NOTIFICATION_FROM:"Form & Frame <noreply@example.test>"
    })[name],
    createAdmin:() => admin,
    fetcher:async (url, options) => { sent.push({ url, options }); return new Response("{}", { status:200 }); }
  });
  const post = body => handler(new Request("https://example.test/send-quote-email", { method:"POST", headers:{ origin:ORIGIN, authorization:"Bearer staff-session", "content-type":"application/json" }, body:JSON.stringify(body) }));
  return { sent, post };
}

test("sends a quotation email only from an authenticated staff session", async () => {
  const { sent, post } = setup();
  const responseUrl = `${ORIGIN}/quote-response.html?token=${token}`;
  const response = await post({ token, response_url:responseUrl });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].options.headers["Idempotency-Key"], `form-frame-quote-email/quote-1/${tokenHash}`);
  const email = JSON.parse(sent[0].options.body);
  assert.deepEqual(email.to, ["customer@example.test"]);
  assert.match(email.html, /View quotation/);
});
