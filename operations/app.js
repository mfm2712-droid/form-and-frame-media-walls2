import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg = window.FF_OPERATIONS_CONFIG;
const $ = id => document.getElementById(id);
const esc = value => String(value || "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
if (!cfg?.supabaseUrl || cfg.supabaseUrl.includes("YOUR_PROJECT")) $("setupCopy").textContent = "Add the Supabase public values to operations/config.js to activate this hub.";
else {
  const db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const format = value => new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value));
  async function load(){
    const { data:{ session } } = await db.auth.getSession();
    if (!session) return;
    $("setup").hidden = true; $("hub").hidden = false;
    const [{ data: leads, error }, { data: blocks }] = await Promise.all([
      db.from("consultation_requests").select("*").order("created_at", { ascending:false }).limit(60),
      db.from("availability_blocks").select("*").gte("ends_at", new Date().toISOString()).order("starts_at").limit(30)
    ]);
    if (error) { $("leads").textContent = error.message; return; }
    const items = leads || [], count = status => items.filter(x => x.status === status).length;
    $("stats").innerHTML = [["New",count("new")],["Reviewing",count("reviewing")],["Confirmed",count("confirmed")],["Quoted",count("quoted")]].map(x => `<div class="stat"><b>${x[1]}</b><span>${x[0].toUpperCase()}</span></div>`).join("");
    $("leads").innerHTML = items.length ? items.map(lead => `<article class="lead"><div class="lead-top"><div><h3>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></h3><p>${esc(lead.postcode)} · ${esc(lead.email || lead.phone)} · ${esc(lead.wall_width)}</p></div><select data-id="${lead.id}" class="status">${["new","reviewing","date_requested","confirmed","quoted","won","lost","archived"].map(s => `<option ${lead.status===s?"selected":""}>${s}</option>`).join("")}</select></div><p>${esc(lead.message || "No customer note.")}</p><small>${format(lead.created_at)} · ${esc(lead.source)} · guide £${lead.guide_low || "—"}–£${lead.guide_high || "—"}</small></article>`).join("") : "No enquiries yet.";
    $("calendar").innerHTML = (blocks || []).length ? blocks.map(block => `<div class="event"><div><b>${esc(block.title)}</b><span>${format(block.starts_at)} → ${format(block.ends_at)}</span></div><button class="quiet unblock" data-id="${block.id}">Unblock</button></div>`).join("") : "No upcoming blocks.";
  }
  $("login").addEventListener("submit", async e => { e.preventDefault(); const { error } = await db.auth.signInWithOtp({ email: $("email").value, options:{ emailRedirectTo: location.href } }); $("loginMsg").textContent = error ? error.message : "Secure sign-in link sent — check your inbox."; });
  $("refresh").addEventListener("click", load); $("unblockAll").addEventListener("click", load);
  $("leads").addEventListener("change", async e => { if (!e.target.matches(".status")) return; await db.from("consultation_requests").update({ status:e.target.value }).eq("id", e.target.dataset.id); load(); });
  $("block").addEventListener("submit", async e => { e.preventDefault(); await db.from("availability_blocks").insert({ title:$("blockTitle").value, starts_at:new Date($("blockStart").value).toISOString(), ends_at:new Date($("blockEnd").value).toISOString(), kind:"blocked" }); e.target.reset(); load(); });
  $("calendar").addEventListener("click", async e => { const id=e.target.dataset.id; if (!id) return; await db.from("availability_blocks").delete().eq("id", id); load(); });
  $("signOut").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
  db.channel("ff-operations").on("postgres_changes", { event:"*", schema:"public", table:"consultation_requests" }, load).subscribe(); load();
}

