const json = (body, status, origin, allowed = false, extraHeaders = {}) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...extraHeaders
  };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, x-client-info, content-type, x-idempotency-key";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(body), { status, headers });
};

const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REQUEST_BYTES = 32_768;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function isClientAddress(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 45 || /[,\s%]/.test(value)) return false;
  const ipv4 = value.split(".");
  if (ipv4.length === 4) return ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (!value.includes(":")) return false;
  try { return new URL(`http://[${value}]/`).hostname.length > 0; }
  catch { return false; }
}

export async function hashClientAddress(address, secret) {
  if (!isClientAddress(address) || typeof secret !== "string" || secret.length < 32) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseTimestamp(value) {
  const parts = timestampPattern.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , zoneText, , zoneHourText = "0", zoneMinuteText = "0"] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const zoneHour = Number(zoneHourText), zoneMinute = Number(zoneMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function claimNotification(admin, requestId, channel, payload, enabled) {
  const { data, error } = await admin.rpc("claim_new_enquiry_notification", {
    p_request_id: requestId,
    p_channel: channel,
    p_payload: payload,
    p_enabled: enabled
  });
  if (error) throw error;
  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim?.event_id || typeof claim.claimed !== "boolean") throw new Error("Notification claim was not confirmed.");
  return claim;
}

async function finishNotification(admin, eventId, patch) {
  const update = { ...patch, claim_until: null };
  if (patch.delivery_status === "sent" || patch.delivery_status === "not_configured") update.next_attempt_at = null;
  const { error } = await admin.from("notification_events").update(update).eq("id", eventId);
  if (error) throw error;
}

async function readBodyUpTo(request, limit) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > limit) {
    const error = new Error("Request is too large.");
    error.code = "BODY_TOO_LARGE";
    throw error;
  }

  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > limit) {
        await reader.cancel().catch(() => {});
        const error = new Error("Request is too large.");
        error.code = "BODY_TOO_LARGE";
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// Dependencies are injected so the HTTP and persistence contract can be tested
// with fictional data and no database, email provider, or network access.
export function createEnquiryHandler({ env, createAdmin, fetcher = fetch, now = () => new Date(), randomUUID = () => crypto.randomUUID(), logError = () => {} }) {
  return async request => {
    const origin = request.headers.get("origin") || undefined;
    const allowedOrigins = (env("ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean);
    const originAllowed = !!origin && allowedOrigins.includes(origin);

    if (request.method === "OPTIONS") {
      return originAllowed
        ? new Response(null, { status: 204, headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-idempotency-key",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
          } })
        : json({ error: "Origin not allowed." }, 403, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin, originAllowed);
    if (!origin || !originAllowed) return json({ error: "Origin not allowed." }, 403, origin);

    let body;
    try {
      const raw = await readBodyUpTo(request, MAX_REQUEST_BYTES);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
      body = parsed;
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE") return json({ error: "Request is too large." }, 413, origin, originAllowed);
      return json({ error: "Please check the enquiry details and try again." }, 400, origin, originAllowed);
    }

    // A filled honeypot is discarded without persisting or notifying.
    if (clean(body.company_website, 200)) return json({ error: "Unable to accept this enquiry." }, 400, origin, originAllowed);

    const idempotencyKey = clean(body.idempotency_key || request.headers.get("x-idempotency-key"), 64);
    const name = clean(body.customer_name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const phone = clean(body.phone, 40);
    const postcode = clean(body.postcode, 16).toUpperCase();
    const wallWidth = clean(body.wall_width, 80);
    const message = clean(body.message, 2000);
    const preferredStartRaw = clean(body.preferred_start, 64);
    const preferredEndRaw = clean(body.preferred_end, 64);
    const hasPreferredStart = body.preferred_start !== undefined && body.preferred_start !== null && body.preferred_start !== "";
    const hasPreferredEnd = body.preferred_end !== undefined && body.preferred_end !== null && body.preferred_end !== "";
    const preferredStartDate = parseTimestamp(preferredStartRaw);
    const preferredEndDate = parseTimestamp(preferredEndRaw);
    const invalidPreferredWindow = hasPreferredStart !== hasPreferredEnd
      || (hasPreferredStart && (!preferredStartDate || !Number.isFinite(preferredStartDate.getTime())
        || !preferredEndDate || !Number.isFinite(preferredEndDate.getTime()) || preferredEndDate <= preferredStartDate));
    const low = body.guide_low, high = body.guide_high;
    const projectSpec = body.project_spec;
    if (!uuidPattern.test(idempotencyKey) || name.length < 2 || !postcode || (!email && !phone)
      || (email && !emailPattern.test(email)) || (phone && phone.replace(/\D/g, "").length < 7)
      || !wallWidth || !Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < 0 || high < low
      || invalidPreferredWindow || !projectSpec || typeof projectSpec !== "object" || Array.isArray(projectSpec)) {
      return json({ error: "Please provide a name, postcode, valid contact detail and complete project brief." }, 422, origin, originAllowed);
    }
    if (JSON.stringify(projectSpec).length > 12_000) return json({ error: "The project brief is too large." }, 422, origin, originAllowed);

    const supabaseUrl = env("SUPABASE_URL"), serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const rateLimitSecret = env("ENQUIRY_RATE_LIMIT_SECRET");
    if (!supabaseUrl || !serviceRoleKey || typeof rateLimitSecret !== "string" || rateLimitSecret.length < 32) {
      logError("Enquiry service is missing its server database configuration.");
      return json({ error: "The enquiry service is temporarily unavailable." }, 503, origin, originAllowed);
    }

    try {
      const admin = await createAdmin(supabaseUrl, serviceRoleKey);
      const requestColumns = "id, reference, customer_name, email, phone, postcode, wall_width, preferred_start, preferred_end, message, project_spec, guide_low, guide_high, source";
      const { data: prior, error: lookupError } = await admin.from("consultation_requests")
        .select(requestColumns).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (lookupError) throw lookupError;

      let savedEnquiry = prior;
      let duplicate = !!prior;
      if (!savedEnquiry) {
        const address = request.headers.get("cf-connecting-ip");
        const fingerprint = await hashClientAddress(address, rateLimitSecret);
        if (!fingerprint) {
          logError("Enquiry request is missing a valid edge client address.");
          return json({ error:"The enquiry service is temporarily unavailable." }, 503, origin, originAllowed);
        }
        let rateLimitRows;
        try {
          const { data, error } = await admin.rpc("consume_public_enquiry_slot", {
            p_idempotency_key:idempotencyKey,
            p_fingerprint:fingerprint,
            p_limit:10,
            p_window_seconds:3600
          });
          if (error) throw error;
          rateLimitRows = data;
        } catch {
          logError("Enquiry request was blocked because the rate limiter is unavailable.");
          return json({ error:"The enquiry service is temporarily unavailable." }, 503, origin, originAllowed);
        }
        const rateLimit = Array.isArray(rateLimitRows) ? rateLimitRows[0] : rateLimitRows;
        if (typeof rateLimit?.allowed !== "boolean" || !Number.isInteger(rateLimit.retry_after_seconds)) {
          logError("Enquiry request was blocked because the rate limiter returned an invalid result.");
          return json({ error:"The enquiry service is temporarily unavailable." }, 503, origin, originAllowed);
        }
        if (!rateLimit.allowed) {
          const retryAfter = Math.max(1, rateLimit.retry_after_seconds);
          return json({
            error:"Too many enquiries from this connection. Please try again later.",
            retry_after_seconds:retryAfter
          }, 429, origin, originAllowed, { "Retry-After":String(retryAfter) });
        }
        const timestamp = now();
        const reference = `FF-${timestamp.toISOString().slice(2, 10).replace(/-/g, "")}-${randomUUID().slice(0, 4).toUpperCase()}`;
        const record = {
          idempotency_key: idempotencyKey,
          reference,
          customer_name: name,
          email: email || null,
          phone: phone || null,
          postcode,
          wall_width: wallWidth,
          preferred_start: preferredStartDate?.toISOString() ?? null,
          preferred_end: preferredEndDate?.toISOString() ?? null,
          message: message || null,
          project_spec: projectSpec,
          guide_low: low,
          guide_high: high,
          source: body.source === "assistant" ? "assistant" : "website"
        };
        let insertResult;
        try {
          insertResult = await admin.from("consultation_requests").insert(record).select("id, reference").single();
        } catch (insertError) {
          insertResult = { data: null, error: insertError };
        }
        if (!insertResult?.error && insertResult?.data) savedEnquiry = { ...record, ...insertResult.data };
        else {
          // Reconcile a unique-index race or a lost insert response by the same
          // idempotency key, then continue notification delivery safely.
          const { data: existing, error: retryLookupError } = await admin.from("consultation_requests")
            .select(requestColumns).eq("idempotency_key", idempotencyKey).maybeSingle();
          if (!retryLookupError && existing) {
            savedEnquiry = existing;
            duplicate = true;
          } else throw insertResult?.error || new Error("The enquiry insert could not be confirmed.");
        }
      }

      const resendKey = clean(env("RESEND_API_KEY"), 500), notifyTo = clean(env("NOTIFICATION_EMAIL"), 254), from = clean(env("NOTIFICATION_FROM"), 254);
      const emailConfigured = !!(resendKey && notifyTo && from);
      const emailPayload = { reference: savedEnquiry.reference };
      let notificationStatus = "tracking_failed";
      let emailClaim = null;
      try {
        emailClaim = await claimNotification(admin, savedEnquiry.id, "email", emailPayload, emailConfigured);
      } catch {
        logError("Enquiry saved, but email notification tracking could not be recorded.");
      }
      if (emailClaim && !emailConfigured) notificationStatus = emailClaim.current_status;
      else if (emailClaim && !emailClaim.claimed) notificationStatus = emailClaim.current_status;
      else if (emailClaim?.claimed) {
        let deliveryStatus = "failed";
        let deliveryError = "Email delivery attempt failed; retry available.";
        let sentAt = null;
        try {
          const safeName = escapeHtml(savedEnquiry.customer_name), safePostcode = escapeHtml(savedEnquiry.postcode);
          const safeMessage = escapeHtml(savedEnquiry.message || "No additional message.");
          const sent = await fetcher("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `form-frame-new-enquiry-email/${emailClaim.event_id}`
            },
            body: JSON.stringify({ from, to: [notifyTo], subject: `New Form & Frame enquiry — ${savedEnquiry.reference}`, html: `<h2>New enquiry: ${savedEnquiry.reference}</h2><p><b>${safeName}</b> · ${safePostcode}</p><p>${safeMessage}</p>` }),
            signal: AbortSignal.timeout(10_000)
          });
          deliveryStatus = sent.ok ? "sent" : "failed";
          deliveryError = sent.ok ? null : `Email provider returned HTTP ${sent.status}.`;
          sentAt = sent.ok ? now().toISOString() : null;
        } catch {
          deliveryStatus = "failed";
        }
        try {
          await finishNotification(admin, emailClaim.event_id, {
            delivery_status: deliveryStatus,
            sent_at: sentAt,
            error: deliveryError
          });
          notificationStatus = deliveryStatus;
        } catch {
          logError("Enquiry saved, but email notification outcome could not be recorded.");
          notificationStatus = deliveryStatus === "sent" ? "sent_untracked" : "failed_untracked";
        }
      }

      // Push uses a separate server-side dispatch token. Delivery failure or a
      // concurrent retry never changes whether the enquiry itself was saved.
      const pushToken = clean(env("PUSH_DISPATCH_TOKEN"), 500);
      let pushStatus = pushToken ? "tracking_failed" : "not_configured";
      let pushClaim = null;
      try {
        pushClaim = await claimNotification(admin, savedEnquiry.id, "push", { reference:savedEnquiry.reference }, !!pushToken);
      } catch {
        logError("Enquiry saved, but push notification tracking could not be recorded.");
      }
      if (pushClaim && !pushToken) pushStatus = pushClaim.current_status;
      else if (pushClaim && !pushClaim.claimed) pushStatus = pushClaim.current_status;
      else if (pushClaim?.claimed) {
        let deliveryStatus = "failed";
        let deliveryError = "Push delivery attempt failed; retry available.";
        try {
          const baseUrl = supabaseUrl.replace(/\/+$/, "");
          const pushed = await fetcher(`${baseUrl}/functions/v1/push-new-enquiry`, {
            method: "POST",
            headers: { Authorization: `Bearer ${pushToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ request_id:savedEnquiry.id, reference:savedEnquiry.reference }),
            signal: AbortSignal.timeout(8_000)
          });
          if (!pushed.ok) deliveryError = `Push function returned HTTP ${pushed.status}.`;
          else {
            const pushResult = await pushed.json().catch(() => ({}));
            pushStatus = pushResult.status || "unknown";
            deliveryStatus = pushStatus === "sent" ? "sent" : (pushStatus === "no_owner" || pushStatus === "no_subscriptions" || pushStatus === "not_configured" ? "not_configured" : "failed");
            deliveryError = deliveryStatus === "sent" || deliveryStatus === "not_configured" ? null : `Push dispatch status: ${pushStatus}.`;
          }
        } catch {
          pushStatus = "failed_untracked";
        }
        try {
          await finishNotification(admin, pushClaim.event_id, {
            delivery_status: deliveryStatus,
            sent_at: deliveryStatus === "sent" ? now().toISOString() : null,
            error: deliveryError
          });
          if (deliveryStatus === "not_configured") pushStatus = "not_configured";
          else if (deliveryStatus === "failed" && pushStatus !== "failed_untracked") pushStatus = "failed";
        } catch {
          logError("Enquiry saved, but push notification outcome could not be recorded.");
          if (pushStatus === "sent") pushStatus = "sent_untracked";
        }
      }

      const responseBody = { reference:savedEnquiry.reference, notification:notificationStatus, push:pushStatus };
      if (duplicate) responseBody.duplicate = true;
      return json(responseBody, duplicate ? 200 : 201, origin, originAllowed);
    } catch {
      logError("Enquiry could not be saved or reconciled.");
      return json({ error: "The enquiry could not be recorded. Please try again." }, 500, origin, originAllowed);
    }
  };
}
