const response = (body, status) => new Response(JSON.stringify(body), {
  status,
  headers:{ "Content-Type":"application/json", "Cache-Control":"no-store" }
});

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

const escapeHtml = value => String(value || "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[character]);

async function finish(admin, eventId, patch) {
  const { error } = await admin.from("notification_events").update({ ...patch, claim_until:null }).eq("id", eventId);
  if (error) throw error;
}

export function createNotificationRetryHandler({ env, createAdmin, fetcher = fetch, now = () => new Date(), logError = () => {} }) {
  return async request => {
    if (request.method !== "POST") return response({ error:"Method not allowed." }, 405);
    if (!sameSecret(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), env("NOTIFICATION_RETRY_TOKEN"))) {
      return response({ error:"Unauthorized." }, 401);
    }

    const url = env("SUPABASE_URL"), serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRoleKey) return response({ error:"Notification retry is not configured." }, 503);
    try {
      const admin = await createAdmin(url, serviceRoleKey);
      const { data:dueEvents, error:readError } = await admin.from("notification_events")
        .select("id, request_id, channel, event_type, payload, attempt_count")
        .in("delivery_status", ["pending", "failed"])
        .lte("next_attempt_at", now().toISOString())
        .order("next_attempt_at", { ascending:true })
        .limit(10);
      if (readError) throw readError;

      let claimed = 0, sent = 0, failed = 0, skipped = 0;
      for (const event of dueEvents || []) {
        const supportedEvent = event.event_type === "new_enquiry"
          ? !!event.request_id && ["email", "push"].includes(event.channel)
          : event.event_type === "workflow_update" && event.channel === "push" && !event.request_id;
        if (!supportedEvent) { skipped++; continue; }
        let claim;
        try {
          const { data, error } = event.event_type === "new_enquiry"
            ? await admin.rpc("claim_new_enquiry_notification", {
                p_request_id:event.request_id,
                p_channel:event.channel,
                p_payload:event.payload || {},
                p_enabled:true
              })
            : await admin.rpc("claim_notification_event", { p_event_id:event.id });
          if (error) throw error;
          claim = Array.isArray(data) ? data[0] : data;
          if (!claim?.claimed || !claim.event_id) { skipped++; continue; }
          claimed++;
        } catch {
          logError("Notification retry claim failed.");
          failed++;
          continue;
        }

        let status = "failed", sentAt = null, errorText = "Notification retry failed.";
        try {
          if (event.event_type === "new_enquiry" && event.channel === "email") {
            const { data:enquiry, error:enquiryError } = await admin.from("consultation_requests")
              .select("reference, customer_name, postcode, message")
              .eq("id", event.request_id).maybeSingle();
            if (enquiryError || !enquiry) throw enquiryError || new Error("The saved enquiry is unavailable.");
            const key = env("RESEND_API_KEY"), to = env("NOTIFICATION_EMAIL"), from = env("NOTIFICATION_FROM");
            if (!key || !to || !from) {
              status = "not_configured";
              errorText = "Email notification is not configured.";
            } else {
              const sentResponse = await fetcher("https://api.resend.com/emails", {
                method:"POST",
                headers:{
                  Authorization:`Bearer ${key}`,
                  "Content-Type":"application/json",
                  "Idempotency-Key":`form-frame-new-enquiry-email/${claim.event_id}`
                },
                body:JSON.stringify({
                  from, to:[to], subject:`New Form & Frame enquiry — ${enquiry.reference}`,
                  html:`<h2>New enquiry: ${escapeHtml(enquiry.reference)}</h2><p><b>${escapeHtml(enquiry.customer_name)}</b> · ${escapeHtml(enquiry.postcode)}</p><p>${escapeHtml(enquiry.message || "No additional message.")}</p>`
                }),
                signal:AbortSignal.timeout(10_000)
              });
              status = sentResponse.ok ? "sent" : "failed";
              errorText = sentResponse.ok ? null : `Email provider returned HTTP ${sentResponse.status}.`;
              sentAt = sentResponse.ok ? now().toISOString() : null;
            }
          } else {
            const token = env("PUSH_DISPATCH_TOKEN");
            if (!token) {
              status = "not_configured";
              errorText = "Push notification is not configured.";
            } else {
              let pushBody;
              if (event.event_type === "new_enquiry") {
                const { data:enquiry, error:enquiryError } = await admin.from("consultation_requests")
                  .select("reference").eq("id", event.request_id).maybeSingle();
                if (enquiryError || !enquiry) throw enquiryError || new Error("The saved enquiry is unavailable.");
                pushBody = { request_id:event.request_id, reference:enquiry.reference };
              } else {
                pushBody = {
                  event_id:event.id,
                  title:event.payload?.title,
                  body:event.payload?.body,
                  view:event.payload?.view,
                  exclude_user_id:event.payload?.exclude_user_id || null
                };
              }
              const pushed = await fetcher(`${url.replace(/\/+$/, "")}/functions/v1/push-new-enquiry`, {
                method:"POST",
                headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
                body:JSON.stringify(pushBody),
                signal:AbortSignal.timeout(8_000)
              });
              if (!pushed.ok) {
                status = "failed";
                errorText = `Push function returned HTTP ${pushed.status}.`;
              } else {
                const pushResult = await pushed.json().catch(() => ({}));
                status = pushResult.status === "sent" ? "sent" : (pushResult.status === "no_owner" || pushResult.status === "no_recipients" || pushResult.status === "no_subscriptions" || pushResult.status === "not_configured" ? "not_configured" : "failed");
                errorText = status === "failed" ? `Push dispatch status: ${pushResult.status || "unknown"}.` : null;
                sentAt = status === "sent" ? now().toISOString() : null;
              }
            }
          }
        } catch {
          status = "failed";
          errorText = "Notification provider could not be reached.";
        }

        try {
          const result = {
            delivery_status:status,
            sent_at:sentAt,
            error:errorText
          };
          if (status === "sent" || status === "not_configured") result.next_attempt_at = null;
          await finish(admin, claim.event_id, result);
          if (status === "sent") sent++;
          else if (status === "failed") failed++;
          else skipped++;
        } catch {
          logError("Notification retry result could not be recorded.");
          failed++;
        }
      }
      return response({ status:"complete", scanned:(dueEvents || []).length, claimed, sent, failed, skipped }, 200);
    } catch {
      logError("Notification retry batch failed.");
      return response({ error:"Notification retry could not be completed." }, 503);
    }
  };
}
