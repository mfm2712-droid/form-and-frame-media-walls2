// Sends a saved quotation's secure response link to its customer. The caller
// must be an authenticated staff member; the raw link token is never stored.
const DEFAULT_ORIGINS = ["https://form-frame.co.uk", "https://www.form-frame.co.uk", "https://form-and-frame.vercel.app"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const response = (body, status, origin, allowed = false) => {
  const headers = { "Content-Type":"application/json", "Cache-Control":"no-store", Vary:"Origin" };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, x-client-info, content-type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
const pounds = pence => `£${(Number(pence || 0) / 100).toFixed(2)}`;

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return /^Bearer\s+(.+)$/i.exec(value)?.[1] || "";
}

function safeResponseUrl(value, allowedOrigins) {
  try {
    const url = new URL(String(value || ""));
    if (!allowedOrigins.includes(url.origin)) return null;
    if (!url.pathname.endsWith("/quote-response.html")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function createQuoteEmailHandler({ env, createAdmin, fetcher = fetch, logError = () => {} }) {
  return async request => {
    const origin = request.headers.get("origin") || undefined;
    const origins = String(env("ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean);
    const allowedOrigins = origins.length ? origins : DEFAULT_ORIGINS;
    const originAllowed = !!origin && allowedOrigins.includes(origin);
    if (request.method === "OPTIONS") return response(null, originAllowed ? 204 : 403, origin, originAllowed);
    if (!originAllowed) return response({ error:"Origin not allowed." }, 403, origin);
    if (request.method !== "POST") return response({ error:"Method not allowed." }, 405, origin, true);

    const url = env("SUPABASE_URL"), serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const relayKey = String(env("QUOTE_RELAY_SECRET") || "").trim();
    const relayUrl = String(env("QUOTE_RELAY_URL") || "").trim();
    if (!url || !serviceRoleKey || !relayKey || !relayUrl) return response({ error:"Quote email is not configured." }, 503, origin, true);

    let body;
    try { body = await request.json(); } catch { return response({ error:"Invalid request." }, 400, origin, true); }
    const token = String(body?.token || "");
    const responseUrl = safeResponseUrl(body?.response_url, allowedOrigins);
    if (!/^[a-f0-9]{64}$/.test(token) || !responseUrl) return response({ error:"The quotation link is not valid." }, 400, origin, true);

    const admin = await createAdmin(url, serviceRoleKey);
    const accessToken = bearer(request);
    const { data:user, error:userError } = await admin.auth.getUser(accessToken);
    if (userError || !user?.user?.id) return response({ error:"Staff sign-in is required." }, 401, origin, true);
    const { data:profile, error:profileError } = await admin.from("profiles").select("role").eq("id", user.user.id).maybeSingle();
    if (profileError || !["owner", "staff"].includes(profile?.role)) return response({ error:"Staff access is required." }, 403, origin, true);

    const tokenHash = await hashToken(token);
    const { data:link, error:linkError } = await admin.from("quote_response_links")
      .select("quote_id, expires_at, used_at").eq("token_hash", tokenHash).maybeSingle();
    if (linkError || !link) return response({ error:"This quotation link has expired or is no longer valid." }, 409, origin, true);
    if (link.used_at || new Date(link.expires_at).getTime() <= Date.now()) return response({ error:"This quotation link has expired or is no longer valid." }, 409, origin, true);

    const { data:quote, error:quoteError } = await admin.from("quotes")
      .select("id, request_id, quote_number, status, total_pence, valid_until").eq("id", link.quote_id).maybeSingle();
    const { data:requestRow, error:customerError } = quote?.request_id
      ? await admin.from("consultation_requests").select("customer_name, email, reference").eq("id", quote.request_id).maybeSingle()
      : { data:null, error:null };
    if (quoteError || !quote || quote.status !== "sent" || quote.valid_until && quote.valid_until < new Date().toISOString().slice(0, 10)) return response({ error:"This quotation is not available to send." }, 409, origin, true);
    if (customerError || !requestRow?.email || !emailPattern.test(requestRow.email)) return response({ error:"The customer has no valid email address." }, 422, origin, true);

    const name = escapeHtml(requestRow.customer_name || "there");
    const number = escapeHtml(quote.quote_number);
    const reference = escapeHtml(requestRow.reference || "");
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2824"><h2>Your Form &amp; Frame quotation ${number}</h2><p>Hello ${name},</p><p>Your quotation${reference ? ` for enquiry ${reference}` : ""} is ready. The secure page shows the full scope, pricing, terms and your options to accept, decline or request changes.</p><p><a href="${escapeHtml(responseUrl)}" style="display:inline-block;background:#65b2a1;color:#10231e;padding:12px 18px;text-decoration:none;font-weight:bold">View quotation</a></p><p>Total: <b>${pounds(quote.total_pence)}</b></p><p>This personal link expires in 30 days. No payment is taken when you accept a quotation.</p><p>Kind regards,<br>Form &amp; Frame</p></div>`;
    try {
      const sent = await fetcher(relayUrl, {
        method:"POST",
        headers:{ Authorization:`Bearer ${relayKey}`, "Content-Type":"application/json" },
        body:JSON.stringify({ to:requestRow.email, subject:`Your Form & Frame quotation ${quote.quote_number}`, html }),
        signal:AbortSignal.timeout(10_000)
      });
      if (!sent.ok) {
        logError(`Quote email provider returned HTTP ${sent.status}.`);
        return response({ error:"The quotation email could not be delivered." }, 502, origin, true);
      }
      return response({ status:"sent" }, 200, origin, true);
    } catch {
      logError("Quote email provider could not be reached.");
      return response({ error:"The quotation email could not be delivered." }, 502, origin, true);
    }
  };
}
