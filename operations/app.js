import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = id => document.getElementById(id);
const esc = value => String(value || "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const money = value => new Intl.NumberFormat("en-GB", { style:"currency", currency:"GBP", maximumFractionDigits:0 }).format(Number(value || 0));
const format = value => new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value));
const plusDays = (days, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
const local = date => new Date(date).toISOString().slice(0, 16);
let demo = false, db = null, demoLeads = [], demoBlocks = [], selectedId = null;

function projectFor(lead) {
  if (lead.project) return lead.project;
  const spec = lead.project_spec || {}, total = Number(lead.guide_high || lead.guide_low || 0);
  return { title:`${lead.customer_name || "Customer"}'s media wall`, location:lead.postcode || "Survey location pending", image:"../assets/cases/burnham-library-after.webp", geometry:`${lead.wall_width || "Measured survey pending"} · ${spec.tv_size || "TV specification pending"}`, system:spec.finish || "Bespoke fitted joinery — confirm finish at survey", materials:["#8b6243", "#173d33", "#cba35d"], materialLabel:"Oak, matte lacquer and aged brass palette", materialsCost:Math.round(total * .44), equipmentCost:Math.round(total * .20), labourCost:Math.round(total * .36), total };
}

function renderCalendar(blocks) {
  const start = plusDays(0, 0); start.setHours(0, 0, 0, 0); const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = Array.from({ length:14 }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index); const end = new Date(day); end.setHours(23, 59, 59, 999);
    const events = blocks.filter(item => new Date(item.starts_at) <= end && new Date(item.ends_at) >= day);
    return `<div class="cal-day ${day.getDay() === 0 || day.getDay() === 6 ? "outside" : ""}"><div class="cal-day-head">${names[day.getDay()]}<b>${day.getDate()}</b></div>${events.map(event => `<div class="cal-event ${event.kind}" title="${esc(event.title)}">${esc(event.title)}<button class="unblock" data-id="${event.id}" aria-label="Remove ${esc(event.title)}">Remove</button></div>`).join("")}</div>`;
  }).join("");
  $("calendar").innerHTML = `<div class="cal-grid">${cells}</div>`;
}

function renderProject(lead) {
  const p = projectFor(lead);
  $("projectPanel").innerHTML = `<p>PROJECT BRIEF</p><h2>${esc(p.title)}</h2><img src="${esc(p.image)}" alt="Proposed finish reference for ${esc(p.title)}"><div class="project-spec"><b>${esc(p.location)}</b><br>${esc(p.geometry)}<br>${esc(p.system)}</div><p>MATERIAL PALETTE</p><div class="material-row" title="${esc(p.materialLabel)}">${p.materials.map(colour => `<i class="material" style="--c:${colour}"></i>`).join("")}</div><small>${esc(p.materialLabel)}</small><div class="mini-plan" aria-label="Indicative media wall elevation"></div><p>INDICATIVE COST PLAN</p><div class="cost"><div><span>Materials & fitted joinery</span><b>${money(p.materialsCost)}</b></div><div><span>Fire, LED & electrical</span><b>${money(p.equipmentCost)}</b></div><div><span>Workshop & installation labour</span><b>${money(p.labourCost)}</b></div><div class="total"><span>GUIDE TOTAL EX. VAT</span><b>${money(p.total)}</b></div></div><button id="confirmVisit" data-id="${esc(lead.id)}">Confirm site visit</button>`;
}

function render(items, blocks) {
  const count = status => items.filter(item => item.status === status).length;
  $("stats").innerHTML = [["New", count("new")], ["Reviewing", count("reviewing")], ["Confirmed", count("confirmed")], ["Quoted", count("quoted")]].map(item => `<div class="stat"><b>${item[1]}</b><span>${item[0].toUpperCase()}</span></div>`).join("");
  if (!items.some(item => item.id === selectedId)) selectedId = items[0]?.id || null;
  $("leadList").innerHTML = items.length ? items.map(lead => `<article class="lead ${lead.id === selectedId ? "selected" : ""}" data-lead-id="${esc(lead.id)}"><div class="lead-top"><div><h3>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></h3><p>${esc(lead.postcode)} · ${esc(lead.email || lead.phone)} · ${esc(lead.wall_width)}</p></div><select data-id="${esc(lead.id)}" class="status" aria-label="Status for ${esc(lead.customer_name)}">${["new","reviewing","date_requested","confirmed","quoted","won","lost","archived"].map(status => `<option value="${status}" ${lead.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select></div><p>${esc(lead.message || "No customer note.")}</p><small>${format(lead.created_at)} · ${esc(lead.source)} · guide ${money(lead.guide_low)}–${money(lead.guide_high)}</small></article>`).join("") : `<p class="empty">No enquiries yet. New website, chat and booking requests will appear here.</p>`;
  renderCalendar(blocks);
  if (items.length) renderProject(items.find(item => item.id === selectedId));
  else $("projectPanel").innerHTML = `<p>PROJECT BRIEF</p><h2>Select an enquiry</h2><p class="empty">A selected enquiry will show the customer brief, material direction and indicative commercial breakdown.</p>`;
}

function setBlockDefaults() { $("blockStart").value = local(plusDays(2, 8)); $("blockEnd").value = local(plusDays(3, 18)); $("liveDate").textContent = new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long" }).format(new Date()); }
function loadDemo() { render(demoLeads, demoBlocks); }
async function loadLive() { const [{ data:leads, error }, { data:blocks }] = await Promise.all([db.from("consultation_requests").select("*").order("created_at", { ascending:false }).limit(60), db.from("availability_blocks").select("*").gte("ends_at", new Date().toISOString()).order("starts_at").limit(50)]); if (error) { $("leadList").innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; } render(leads || [], blocks || []); }
const load = () => demo ? loadDemo() : loadLive();

function startDemo() {
  demo = true; $("setup").hidden = true; $("hub").hidden = false; $("demoTag").hidden = false; $("signOut").hidden = true;
  demoLeads = [
    { id:"d1", reference:"FF-DEMO-1042", customer_name:"Amelia Grant", email:"amelia.grant@example.com", postcode:"SL4 2HT", wall_width:"4.2 m wall", message:"75-inch TV, concealed storage and a linear fire. Tuesday or Thursday survey preferred.", status:"new", source:"project assistant", guide_low:6950, guide_high:8250, created_at:new Date().toISOString(), project:{ title:"Windsor library wall", location:"WINDSOR · SL4 2HT", image:"../assets/cases/burnham-library-after.webp", geometry:"4.2 m wall · 75” recessed TV · 1.2 m linear fire", system:"European oak library wings · warm white LED · fluted lower cabinetry", materials:["#895e3f", "#e6d1a5", "#164138"], materialLabel:"European oak · warm ivory lacquer · forest green accent", materialsCost:3650, equipmentCost:1670, labourCost:2930, total:8250 } },
    { id:"d2", reference:"FF-DEMO-1041", customer_name:"Hugo Clarke", phone:"07700 900 441", postcode:"SL1 5QJ", wall_width:"5.8 m wall", message:"Full-width cinema wall with walnut shelving. Room photos attached.", status:"reviewing", source:"website enquiry", guide_low:9800, guide_high:11600, created_at:plusDays(-1).toISOString(), project:{ title:"Slough cinema wall", location:"SLOUGH · SL1 5QJ", image:"../assets/cases/slough-cinema-after.webp", geometry:"5.8 m wall · 85” recessed TV · 1.5 m linear fire", system:"Charcoal lacquer carcasses · smoked bronze display doors · RGB scene lighting", materials:["#242826", "#7c573b", "#c29156"], materialLabel:"Charcoal lacquer · smoked oak · aged bronze", materialsCost:5100, equipmentCost:2280, labourCost:4220, total:11600 } },
    { id:"d3", reference:"FF-DEMO-1040", customer_name:"Saira Patel", email:"saira.patel@example.com", postcode:"SL3 8LA", wall_width:"3.1 m chimney breast", message:"Compact chimney breast, existing fire to remove, pale oak finish.", status:"date_requested", source:"website enquiry", guide_low:4900, guide_high:6100, created_at:plusDays(-2).toISOString(), project:{ title:"Langley chimney breast", location:"LANGLEY · SL3 8LA", image:"../assets/cases/langley-chimney-after.webp", geometry:"3.1 m chimney breast · 55” flush TV · compact fire", system:"Microcement feature · pale oak alcove storage · dimmable warm LED", materials:["#c6b293", "#8c8c80", "#382e26"], materialLabel:"Pale oak · mineral microcement · black steel", materialsCost:2620, equipmentCost:1040, labourCost:2440, total:6100 } }
  ];
  demoBlocks = [{ id:"b1", title:"HOLIDAY — family break", kind:"holiday", starts_at:plusDays(2, 0).toISOString(), ends_at:plusDays(3, 23).toISOString() }, { id:"b2", title:"Workshop installation", kind:"blocked", starts_at:plusDays(6, 8).toISOString(), ends_at:plusDays(7, 18).toISOString() }, { id:"b3", title:"Extra survey availability", kind:"available", starts_at:plusDays(9, 10).toISOString(), ends_at:plusDays(9, 16).toISOString() }];
  setBlockDefaults(); loadDemo();
}

async function startLive() { const { data:{ session } } = await db.auth.getSession(); if (!session) return; $("setup").hidden = true; $("hub").hidden = false; setBlockDefaults(); loadLive(); db.channel("ff-operations").on("postgres_changes", { event:"*", schema:"public", table:"consultation_requests" }, loadLive).subscribe(); }
const cfg = window.FF_OPERATIONS_CONFIG;
if (!cfg?.supabaseUrl || cfg.supabaseUrl.includes("YOUR_PROJECT")) { $("setupCopy").textContent = "Demo mode: preview the staff workspace with enquiries, commercial briefs and calendar controls."; startDemo(); }
else { db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey); $("login").addEventListener("submit", async event => { event.preventDefault(); const { error } = await db.auth.signInWithOtp({ email:$("email").value, options:{ emailRedirectTo:location.href } }); $("loginMsg").textContent = error ? error.message : "Secure sign-in link sent — check your inbox."; }); startLive(); }

$("refresh").addEventListener("click", load); $("unblockAll").addEventListener("click", load);
$("leadList").addEventListener("click", event => { if (event.target.closest("select")) return; const card = event.target.closest("[data-lead-id]"); if (!card) return; selectedId = card.dataset.leadId; load(); });
$("leadList").addEventListener("change", async event => { if (!event.target.matches(".status")) return; const id = event.target.dataset.id; if (demo) { demoLeads.find(item => item.id === id).status = event.target.value; loadDemo(); } else { await db.from("consultation_requests").update({ status:event.target.value }).eq("id", id); loadLive(); } });
$("block").addEventListener("submit", async event => { event.preventDefault(); const kind = $("blockKind").value, record = { id:crypto.randomUUID(), title:kind === "holiday" ? `HOLIDAY — ${$("blockTitle").value}` : $("blockTitle").value, kind, starts_at:new Date($("blockStart").value).toISOString(), ends_at:new Date($("blockEnd").value).toISOString() }; if (new Date(record.ends_at) <= new Date(record.starts_at)) return; if (demo) { demoBlocks.push(record); loadDemo(); } else { await db.from("availability_blocks").insert({ title:record.title, starts_at:record.starts_at, ends_at:record.ends_at, kind:kind === "holiday" ? "blocked" : kind }); loadLive(); } });
$("calendar").addEventListener("click", async event => { const id = event.target.dataset.id; if (!id) return; if (demo) { demoBlocks = demoBlocks.filter(item => item.id !== id); loadDemo(); } else { await db.from("availability_blocks").delete().eq("id", id); loadLive(); } });
$("projectPanel").addEventListener("click", async event => { const id = event.target.dataset.id; if (event.target.id !== "confirmVisit" || !id) return; if (demo) { demoLeads.find(item => item.id === id).status = "confirmed"; loadDemo(); } else { await db.from("consultation_requests").update({ status:"confirmed" }).eq("id", id); loadLive(); } });
$("signOut").addEventListener("click", async () => { if (db) await db.auth.signOut(); location.reload(); });
