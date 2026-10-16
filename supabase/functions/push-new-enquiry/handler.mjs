const response = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
});

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

export function isValidVapidSubject(value) {
  if (typeof value !== "string" || !value || /[\s<>]/.test(value)) return false;
  if (/^mailto:/i.test(value)) {
    const [, , domain = ""] = /^mailto:([^\s@]+)@([^\s@]+)$/i.exec(value) || [];
    return !!domain && domain.includes(".") && !/\.(?:invalid|test|example|localhost|local)$/i.test(domain);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !/\.(?:invalid|test|example|localhost|local)$/i.test(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const NOTIFICATION_CATEGORIES = ["new_enquiries", "quotations", "acceptances", "appointments", "jobs", "invoices_payments"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPushHandler({ env, createAdmin, sendPush, logError = () => {} }) {
  return async request => {
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = (env("ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean);
    const cors = origin && allowedOrigins.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
    const reply = (body, status) => {
      const result = response(body, status);
      for (const [name, value] of Object.entries(cors)) result.headers.set(name, value);
      return result;
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: {
        ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Max-Age": "600"
      } });
    }
    if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const dispatchAuthorised = sameSecret(bearer, env("PUSH_DISPATCH_TOKEN"));
    if (!dispatchAuthorised && !bearer) return reply({ error: "Unauthorized." }, 401);
    let body;
    try { body = await request.json(); } catch { return reply({ error: "Invalid request." }, 400); }
    // A signed-in staff member may only send a fixed test alert to their own devices.
    const selfTest = !dispatchAuthorised && body?.test === true;
    if (!dispatchAuthorised && !selfTest) return reply({ error: "Unauthorized." }, 401);
    const enquiryPush = !selfTest && typeof body?.request_id === "string" && /^[0-9a-f-]{36}$/i.test(body.request_id)
      && typeof body.reference === "string" && /^FF-[A-Z0-9-]{6,24}$/i.test(body.reference);
    const workflowPush = !selfTest && !enquiryPush && typeof body?.event_id === "string" && /^[0-9a-f-]{36}$/i.test(body.event_id)
      && typeof body.title === "string" && body.title.length > 0 && body.title.length <= 80
      && typeof body.body === "string" && body.body.length > 0 && body.body.length <= 180
      && ["today", "work", "calendar", "money"].includes(body.view)
      && (body.category == null || NOTIFICATION_CATEGORIES.includes(body.category))
      && (body.request_id == null || (typeof body.request_id === "string" && UUID_PATTERN.test(body.request_id)))
      && (body.exclude_user_id == null || (typeof body.exclude_user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.exclude_user_id)));
    if (!selfTest && !enquiryPush && !workflowPush) return reply({ error: "Invalid notification reference." }, 422);

    const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublic = env("VAPID_PUBLIC_KEY"), vapidPrivate = env("VAPID_PRIVATE_KEY"), vapidSubject = env("VAPID_SUBJECT");
    if (!url || !serviceKey || !vapidPublic || !vapidPrivate || !isValidVapidSubject(vapidSubject)) return reply({ status: "not_configured" }, 200);
    try {
      const admin = await createAdmin(url, serviceKey);
      let recipientIds, category = null;
      if (selfTest) {
        const { data: authData, error: authError } = await admin.auth.getUser(bearer);
        const userId = authData?.user?.id;
        if (authError || !userId) return reply({ error: "Unauthorized." }, 401);
        const { data: staffRows, error: staffError } = await admin.from("profiles").select("id").in("role", ["owner", "staff"]);
        if (staffError) throw staffError;
        if (!(staffRows || []).some(row => row.id === userId)) return reply({ error: "Unauthorized." }, 401);
        recipientIds = [userId];
      } else {
        category = enquiryPush ? "new_enquiries" : (body.category || null);
        const { data: owners, error: ownerError } = await admin.from("profiles").select("id").in("role", ["owner", "staff"]);
        if (ownerError) throw ownerError;
        recipientIds = (owners || []).map(owner => owner.id).filter(id => !workflowPush || id !== body.exclude_user_id);
        if (!recipientIds.length) return reply({ status: workflowPush ? "no_recipients" : "no_owner" }, 200);
        if (category) {
          // Honour each person's category switches. A missing row (or table) means everything is on.
          const { data: preferences, error: preferenceError } = await admin.from("notification_preferences").select("*").in("user_id", recipientIds);
          if (!preferenceError && preferences?.length) {
            const muted = new Set(preferences.filter(row => row[category] === false).map(row => row.user_id));
            recipientIds = recipientIds.filter(id => !muted.has(id));
            if (!recipientIds.length) return reply({ status: "no_recipients" }, 200);
          }
        }
      }
      const { data: subscriptions, error: subscriptionError } = await admin.from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth_secret").in("user_id", recipientIds);
      if (subscriptionError) throw subscriptionError;
      if (!subscriptions?.length) return reply({ status: "no_subscriptions" }, 200);

      const expired = [];
      let delivered = 0, failures = 0;
      // Lock-screen text is deliberately generic: no names, contact details or amounts.
      const payload = JSON.stringify(selfTest ? {
        title: "Test notification",
        body: "Push alerts are working on this device.",
        tag: "ff-test-alert",
        url: "./?view=today"
      } : enquiryPush ? {
        title: "New Form & Frame enquiry",
        body: `Enquiry ${body.reference} is ready to review.`,
        tag: `enquiry-${body.request_id}`,
        url: `./?enquiry=${encodeURIComponent(body.request_id)}`
      } : {
        title: body.title,
        body: body.body,
        tag: `workflow-${body.event_id}`,
        url: body.request_id ? `./?enquiry=${encodeURIComponent(body.request_id)}` : `./?view=${encodeURIComponent(body.view)}`
      });
      await Promise.all(subscriptions.map(async subscription => {
        try {
          const result = await sendPush({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, payload, { TTL: selfTest ? 300 : 3600, urgency: "high" });
          if (result?.statusCode === 404 || result?.statusCode === 410) expired.push(subscription.id);
          else delivered++;
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) expired.push(subscription.id);
          else failures++;
        }
      }));
      if (expired.length) {
        const { error } = await admin.from("push_subscriptions").delete().in("id", expired);
        if (error) logError("Expired push subscription cleanup failed.");
      }
      // Treat partial delivery as failed so the notification outbox retries
      // transient failures for a specific owner's device. The stable tag in
      // the payload prevents repeated alerts from stacking on devices that
      // already received it.
      const status = failures > 0 ? "failed" : delivered > 0 ? "sent" : "no_subscriptions";
      return reply({ status, delivered, failed: failures, removed: expired.length }, 200);
    } catch {
      logError("Push delivery failed.");
      return reply({ status: "failed" }, 200);
    }
  };
}
