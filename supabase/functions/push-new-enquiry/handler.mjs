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

export function createPushHandler({ env, createAdmin, sendPush, logError = () => {} }) {
  return async request => {
    if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
    if (!sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), env("PUSH_DISPATCH_TOKEN"))) {
      return response({ error: "Unauthorized." }, 401);
    }
    let body;
    try { body = await request.json(); } catch { return response({ error: "Invalid request." }, 400); }
    const enquiryPush = typeof body?.request_id === "string" && /^[0-9a-f-]{36}$/i.test(body.request_id)
      && typeof body.reference === "string" && /^FF-[A-Z0-9-]{6,24}$/i.test(body.reference);
    const workflowPush = typeof body?.event_id === "string" && /^[0-9a-f-]{36}$/i.test(body.event_id)
      && typeof body.title === "string" && body.title.length > 0 && body.title.length <= 80
      && typeof body.body === "string" && body.body.length > 0 && body.body.length <= 180
      && ["today", "work", "calendar", "money"].includes(body.view)
      && (body.exclude_user_id == null || (typeof body.exclude_user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.exclude_user_id)));
    if (!enquiryPush && !workflowPush) return response({ error: "Invalid notification reference." }, 422);

    const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublic = env("VAPID_PUBLIC_KEY"), vapidPrivate = env("VAPID_PRIVATE_KEY"), vapidSubject = env("VAPID_SUBJECT");
    if (!url || !serviceKey || !vapidPublic || !vapidPrivate || !isValidVapidSubject(vapidSubject)) return response({ status: "not_configured" }, 200);
    try {
      const admin = await createAdmin(url, serviceKey);
      const { data: owners, error: ownerError } = await admin.from("profiles").select("id").in("role", ["owner", "staff"]);
      if (ownerError) throw ownerError;
      const recipientIds = (owners || []).map(owner => owner.id)
        .filter(id => !workflowPush || id !== body.exclude_user_id);
      if (!recipientIds.length) return response({ status: workflowPush ? "no_recipients" : "no_owner" }, 200);
      const { data: subscriptions, error: subscriptionError } = await admin.from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth_secret").in("user_id", recipientIds);
      if (subscriptionError) throw subscriptionError;
      if (!subscriptions?.length) return response({ status: "no_subscriptions" }, 200);

      const expired = [];
      let delivered = 0, failures = 0;
      const payload = JSON.stringify(enquiryPush ? {
        title: "New Form & Frame enquiry",
        body: `Enquiry ${body.reference} is ready to review.`,
        tag: `enquiry-${body.request_id}`,
        url: `./?enquiry=${encodeURIComponent(body.request_id)}`
      } : {
        title: body.title,
        body: body.body,
        tag: `workflow-${body.event_id}`,
        url: `./?view=${encodeURIComponent(body.view)}`
      });
      await Promise.all(subscriptions.map(async subscription => {
        try {
          const result = await sendPush({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, payload, { TTL: 3600 });
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
      return response({ status, delivered, failed: failures, removed: expired.length }, 200);
    } catch {
      logError("Push delivery failed.");
      return response({ status: "failed" }, 200);
    }
  };
}
