// Public customer quotation portal. The customer's link carries a random 64-hex
// token; only its SHA-256 hash is stored, and the database functions are callable
// by the server role alone. No payment is ever taken here.
const DEFAULT_ORIGINS = ["https://form-and-frame.vercel.app"];
const DECISIONS = ["accepted", "rejected", "changes_requested"];

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createQuoteResponseHandler({ env, createAdmin, logError = () => {} }) {
  const origins = String(env("ALLOWED_ORIGINS") || "").split(",").map(item => item.trim()).filter(Boolean);
  const allowed = origins.length ? origins : DEFAULT_ORIGINS;
  return async request => {
    const origin = request.headers.get("origin") || "";
    const headers = { "Content-Type":"application/json", "Cache-Control":"no-store", Vary:"Origin", "Access-Control-Allow-Headers":"content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
    if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status:allowed.includes(origin) ? 204 : 403, headers });
    if (!allowed.includes(origin)) return respond({ error:"Origin not allowed" }, 403);
    if (request.method !== "POST") return respond({ error:"Method not allowed" }, 405);
    let body;
    try { body = await request.json(); } catch { return respond({ error:"Invalid request" }, 400); }
    const token = String(body?.token || "");
    const action = String(body?.action || "respond");
    if (!/^[a-f0-9]{64}$/.test(token)) return respond({ error:"This link is not valid." }, 400);
    const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return respond({ error:"The service is not configured." }, 503);
    const db = createAdmin(url, key);
    const tokenHash = await hashToken(token);

    if (action === "view") {
      const result = await db.rpc("get_quote_for_response", { p_token_hash:tokenHash });
      if (result.error || !result.data) return respond({ error:"This link has expired or is no longer valid. Please contact Form & Frame." }, 404);
      return respond({ ok:true, quote:result.data });
    }
    if (action !== "respond") return respond({ error:"Invalid request" }, 400);
    const decision = String(body?.decision || "");
    const message = String(body?.message || "").slice(0, 2000);
    if (!DECISIONS.includes(decision)) return respond({ error:"Choose accept, decline or request changes." }, 400);
    if (decision === "changes_requested" && message.trim().length < 3) return respond({ error:"Please describe the changes you would like." }, 400);
    const result = await db.rpc("record_customer_quote_decision", { p_token_hash:tokenHash, p_decision:decision, p_message:message });
    if (result.error) {
      logError(`quote-response decision refused: ${result.error.code || "unknown"}`);
      return respond({ error:"This quotation can no longer be answered online. It may have expired, been replaced or already been answered. Please contact Form & Frame." }, 409);
    }
    return respond({ ok:true, decision });
  };
}
