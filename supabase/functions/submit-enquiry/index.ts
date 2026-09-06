import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "https://mfm2712-droid.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  try {
    const body = await request.json();
    const name = String(body.customer_name || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();
    const postcode = String(body.postcode || "").trim();
    if (name.length < 2 || !postcode || (!email && !phone)) throw new Error("Name, postcode and one contact method are required.");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const reference = `FF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    const record = {
      reference, customer_name: name, email: email || null, phone: phone || null, postcode,
      wall_width: body.wall_width || null, message: body.message || null,
      project_spec: body.project_spec || {}, guide_low: body.guide_low || null, guide_high: body.guide_high || null,
      preferred_start: body.preferred_start || null, preferred_end: body.preferred_end || null,
      source: body.source === "assistant" ? "assistant" : "website"
    };
    const { data, error } = await admin.from("consultation_requests").insert(record).select("id, reference").single();
    if (error) throw error;

    await admin.from("notification_events").insert({ request_id: data.id, channel: "email", event_type: "new_enquiry", payload: record });
    const resendKey = Deno.env.get("RESEND_API_KEY"), notifyTo = Deno.env.get("NOTIFICATION_EMAIL"), from = Deno.env.get("NOTIFICATION_FROM");
    if (resendKey && notifyTo && from) {
      const subject = `New Form & Frame enquiry — ${reference}`;
      const html = `<h2>New enquiry: ${reference}</h2><p><b>${name}</b> · ${postcode}</p><p>${body.message || "No additional message."}</p><p>Guide: £${body.guide_low || "—"}–£${body.guide_high || "—"} ex VAT</p>`;
      const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [notifyTo], subject, html }) });
      await admin.from("notification_events").update({ sent_at: new Date().toISOString(), error: sent.ok ? null : await sent.text() }).eq("request_id", data.id).eq("event_type", "new_enquiry");
    }
    return new Response(JSON.stringify({ reference: data.reference }), { status: 201, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Unable to submit enquiry" }), { status: 400, headers });
  }
});

