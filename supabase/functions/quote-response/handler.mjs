// Public customer quotation portal. The customer's link carries a random 64-hex
// token; only its SHA-256 hash is stored, and the database functions are callable
// by the server role alone. No payment is ever taken here.
const DEFAULT_ORIGINS = ["https://form-and-frame.vercel.app"];
const DECISIONS = ["accepted", "rejected", "changes_requested"];
const CLOSED_STATES = ["answered", "replaced", "expired", "closed"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));

async function sendDecisionEmails({ env, fetcher, admin, decision, quote, customer, logError }) {
  const key = String(env("RESEND_API_KEY") || "").trim();
  const from = String(env("NOTIFICATION_FROM") || "").trim();
  if (!key || !from || !quote || !customer) return;
  const label = decision === "accepted" ? "accepted" : decision === "rejected" ? "declined" : "requested changes to";
  const safeName = escapeHtml(customer.customer_name || "there");
  const safeNumber = escapeHtml(quote.quote_number || "your quotation");
  const safeReference = escapeHtml(customer.reference || "");
  const customerHtml = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2824"><h2>Quotation update received</h2><p>Hello ${safeName},</p><p>We have recorded that you ${label} quotation <b>${safeNumber}</b>${safeReference ? ` for enquiry ${safeReference}` : ""}.</p><p>Form &amp; Frame will be in touch with the next steps. If you requested changes, we will review them and send a revised quotation if needed.</p><p>Kind regards,<br>Form &amp; Frame</p></div>`;
  const sends = [];
  if (emailPattern.test(String(customer.email || ""))) sends.push({
    to:customer.email,
    subject:`Quotation ${quote.quote_number} — response received`,
    html:customerHtml,
    key:`form-frame-quote-decision-customer/${quote.id}/${decision}`
  });
  const notifyTo = String(env("NOTIFICATION_EMAIL") || "").trim();
  if (emailPattern.test(notifyTo)) sends.push({
    to:notifyTo,
    subject:`Customer ${label} quotation ${quote.quote_number}`,
    html:`<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2824"><h2>Quotation response</h2><p><b>${safeName}</b> has ${label} <b>${safeNumber}</b>${safeReference ? ` (${safeReference})` : ""}.</p><p>Decision: <b>${escapeHtml(decision)}</b></p></div>`,
    key:`form-frame-quote-decision-owner/${quote.id}/${decision}`
  });
  await Promise.all(sends.map(async email => {
    try {
      const sent = await fetcher("https://api.resend.com/emails", {
        method:"POST",
        headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json", "Idempotency-Key":email.key },
        body:JSON.stringify({ from, to:[email.to], subject:email.subject, html:email.html }),
        signal:AbortSignal.timeout(10_000)
      });
      if (!sent.ok) logError(`Quote decision email provider returned HTTP ${sent.status}.`);
    } catch { logError("Quote decision email provider could not be reached."); }
  }));
}

// A closed link may only reveal why it is closed and how to contact Form & Frame:
// never the customer's details, prices or terms, even if more were returned.
export function closedView(data) {
  const view = { open:false, state:CLOSED_STATES.includes(data?.state) ? data.state : "closed" };
  if (DECISIONS.includes(data?.decision)) view.decision = data.decision;
  for (const key of ["seller_name", "seller_email", "seller_phone"]) if (typeof data?.[key] === "string" && data[key]) view[key] = data[key];
  return view;
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createQuoteResponseHandler({ env, createAdmin, fetcher = fetch, logError = () => {} }) {
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
      if (result.error || !result.data || typeof result.data !== "object") return respond({ error:"This link has expired or is no longer valid. Please contact Form & Frame." }, 404);
      return respond({ ok:true, quote:result.data.open === true ? result.data : closedView(result.data) });
    }
    if (action !== "respond") return respond({ error:"Invalid request" }, 400);
    const decision = String(body?.decision || "");
    const message = String(body?.message || "").slice(0, 2000);
    if (!DECISIONS.includes(decision)) return respond({ error:"Choose accept, decline or request changes." }, 400);
    if (decision === "changes_requested" && message.trim().length < 3) return respond({ error:"Please describe the changes you would like." }, 400);
    let quoteContext = null, customerContext = null;
    try {
      const { data:link } = await db.from("quote_response_links").select("quote_id").eq("token_hash", tokenHash).maybeSingle();
      if (link?.quote_id) {
        const [{ data:quote }, { data:customer }] = await Promise.all([
          db.from("quotes").select("id, quote_number, request_id").eq("id", link.quote_id).maybeSingle(),
          db.from("consultation_requests").select("customer_name, email, reference").eq("id", link.quote_id).maybeSingle()
        ]);
        quoteContext = quote;
        customerContext = customer;
        if (quote?.request_id) {
          const { data:properCustomer } = await db.from("consultation_requests").select("customer_name, email, reference").eq("id", quote.request_id).maybeSingle();
          customerContext = properCustomer;
        }
      }
    } catch { /* The database RPC remains the source of truth for the decision. */ }
    const result = await db.rpc("record_customer_quote_decision", { p_token_hash:tokenHash, p_decision:decision, p_message:message });
    if (result.error) {
      logError(`quote-response decision refused: ${result.error.code || "unknown"}`);
      return respond({ error:"This quotation can no longer be answered online. It may have expired, been replaced or already been answered. Please contact Form & Frame." }, 409);
    }
    await sendDecisionEmails({ env, fetcher, admin:db, decision, quote:quoteContext, customer:customerContext, logError });
    return respond({ ok:true, decision });
  };
}
