import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const $ = id => document.getElementById(id);
const esc = value => String(value || "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const format = value => new Intl.DateTimeFormat("en-GB", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value));
const plusDays = (days, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
let demo = false, db = null, demoLeads = [], demoBlocks = [];

function renderCalendar(blocks){
  const start = plusDays(0, 0); start.setHours(0,0,0,0); const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const cells = Array.from({length:14}, (_, i) => { const day = new Date(start); day.setDate(start.getDate()+i); const end = new Date(day); end.setHours(23,59,59,999); const events = blocks.filter(b => new Date(b.starts_at) <= end && new Date(b.ends_at) >= day); return `<div class="cal-day ${day.getDay()===0||day.getDay()===6?"outside":""}"><div class="cal-day-head">${names[day.getDay()]}<b>${day.getDate()}</b></div>${events.map(event => `<div class="cal-event ${event.kind}" title="${esc(event.title)}">${esc(event.title)}<button class="unblock" data-id="${event.id}">Remove</button></div>`).join("")}</div>`; }).join("");
  $("calendar").innerHTML = `<div class="cal-grid">${cells}</div>`;
}
function render(items, blocks){
  const count = status => items.filter(x => x.status === status).length;
  $("stats").innerHTML = [["New",count("new")],["Reviewing",count("reviewing")],["Confirmed",count("confirmed")],["Quoted",count("quoted")]].map(x => `<div class="stat"><b>${x[1]}</b><span>${x[0].toUpperCase()}</span></div>`).join("");
  $("leads").innerHTML = items.length ? items.map(lead => `<article class="lead"><div class="lead-top"><div><h3>${esc(lead.customer_name)} <small>· ${esc(lead.reference)}</small></h3><p>${esc(lead.postcode)} · ${esc(lead.email || lead.phone)} · ${esc(lead.wall_width)}</p></div><select data-id="${lead.id}" class="status">${["new","reviewing","date_requested","confirmed","quoted","won","lost","archived"].map(s => `<option ${lead.status===s?"selected":""}>${s}</option>`).join("")}</select></div><p>${esc(lead.message || "No customer note.")}</p><small>${format(lead.created_at)} · ${esc(lead.source)} · guide £${lead.guide_low || "—"}–£${lead.guide_high || "—"}</small></article>`).join("") : "No enquiries yet.";
  renderCalendar(blocks);
}
function setBlockDefaults(){ const a=plusDays(2,8),b=plusDays(4,18),local=d=>d.toISOString().slice(0,16); $("blockStart").value=local(a); $("blockEnd").value=local(b); }
function loadDemo(){ render(demoLeads,demoBlocks); }
async function loadLive(){ const [{data:leads,error},{data:blocks}]=await Promise.all([db.from("consultation_requests").select("*").order("created_at",{ascending:false}).limit(60),db.from("availability_blocks").select("*").gte("ends_at",new Date().toISOString()).order("starts_at").limit(50)]); if(error){$("leads").textContent=error.message;return;}render(leads||[],blocks||[]); }
async function load(){ return demo ? loadDemo() : loadLive(); }
function startDemo(){
  demo=true; $("setup").hidden=true; $("hub").hidden=false; $("demoTag").hidden=false; $("signOut").hidden=true;
  demoLeads=[
    {id:"d1",reference:"FF-DEMO-1042",customer_name:"Amelia Grant",email:"amelia.grant@example.com",postcode:"SL4 2HT",wall_width:"3.5 – 4.5 m",message:"75-inch TV, concealed storage and a linear fire. Tuesday or Thursday survey preferred.",status:"new",source:"assistant",guide_low:6950,guide_high:8250,created_at:new Date().toISOString()},
    {id:"d2",reference:"FF-DEMO-1041",customer_name:"Hugo Clarke",phone:"07700 900 441",postcode:"SL1 5QJ",wall_width:"Over 4.5 m",message:"Full-width cinema wall with walnut shelving. Room photos attached.",status:"reviewing",source:"website",guide_low:9800,guide_high:11600,created_at:plusDays(-1).toISOString()},
    {id:"d3",reference:"FF-DEMO-1040",customer_name:"Saira Patel",email:"saira.patel@example.com",postcode:"SL3 8LA",wall_width:"Under 3.5 m",message:"Compact chimney breast, existing fire to remove, pale oak finish.",status:"date_requested",source:"website",guide_low:4900,guide_high:6100,created_at:plusDays(-2).toISOString()}
  ];
  demoBlocks=[
    {id:"b1",title:"HOLIDAY — family break",kind:"holiday",starts_at:plusDays(2,0).toISOString(),ends_at:plusDays(4,23).toISOString()},
    {id:"b2",title:"Workshop installation",kind:"blocked",starts_at:plusDays(6,8).toISOString(),ends_at:plusDays(7,18).toISOString()},
    {id:"b3",title:"Extra survey availability",kind:"available",starts_at:plusDays(9,10).toISOString(),ends_at:plusDays(9,16).toISOString()}
  ]; setBlockDefaults(); loadDemo();
}
async function startLive(){ const {data:{session}}=await db.auth.getSession();if(!session)return;$("setup").hidden=true;$("hub").hidden=false;setBlockDefaults();loadLive();db.channel("ff-operations").on("postgres_changes",{event:"*",schema:"public",table:"consultation_requests"},loadLive).subscribe(); }
const cfg=window.FF_OPERATIONS_CONFIG;
if(!cfg?.supabaseUrl||cfg.supabaseUrl.includes("YOUR_PROJECT")){ $("setupCopy").textContent="Demo mode: this is how staff access will look with live inquiries and calendar controls."; startDemo(); }
else { db=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey); $("login").addEventListener("submit",async e=>{e.preventDefault();const {error}=await db.auth.signInWithOtp({email:$("email").value,options:{emailRedirectTo:location.href}});$("loginMsg").textContent=error?error.message:"Secure sign-in link sent — check your inbox.";}); startLive(); }
$("refresh").addEventListener("click",load); $("unblockAll").addEventListener("click",load);
$("leads").addEventListener("change",async e=>{if(!e.target.matches(".status"))return;const id=e.target.dataset.id;if(demo){demoLeads.find(x=>x.id===id).status=e.target.value;loadDemo();}else{await db.from("consultation_requests").update({status:e.target.value}).eq("id",id);loadLive();}});
$("block").addEventListener("submit",async e=>{e.preventDefault();const kind=$("blockKind").value,title=$("blockTitle").value,record={id:crypto.randomUUID(),title:kind==="holiday"?"HOLIDAY — "+title:title,kind,starts_at:new Date($("blockStart").value).toISOString(),ends_at:new Date($("blockEnd").value).toISOString()};if(new Date(record.ends_at)<=new Date(record.starts_at))return;if(demo){demoBlocks.push(record);loadDemo();}else{await db.from("availability_blocks").insert({title:record.title,starts_at:record.starts_at,ends_at:record.ends_at,kind:kind==="holiday"?"blocked":kind});loadLive();}});
$("calendar").addEventListener("click",async e=>{const id=e.target.dataset.id;if(!id)return;if(demo){demoBlocks=demoBlocks.filter(x=>x.id!==id);loadDemo();}else{await db.from("availability_blocks").delete().eq("id",id);loadLive();}});
$("signOut").addEventListener("click",async()=>{if(db)await db.auth.signOut();location.reload();});

