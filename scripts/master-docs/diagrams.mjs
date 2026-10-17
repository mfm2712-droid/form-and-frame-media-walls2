// Generates the SVG diagrams in docs/master/assets/diagrams/. Pure Node, no network.
// Legend used everywhere: green = exists on main; dotted amber = only in an open Draft PR;
// dashed oak = planned, not implemented anywhere; red = broken/missing.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Diagram, sequence, legend, C } from "./svg-kit.mjs";
const out = resolve(process.argv[2] || "docs/master/assets/diagrams");
mkdirSync(out, { recursive: true });
const save = (name, svg) => writeFileSync(resolve(out, name + ".svg"), svg);
const LEG = [["real", "on main"], ["pr", "only in open Draft PR"], ["planned", "planned / not built"], ["external", "external service"]];

// 01 platform map
{
  const d = new Diagram(1240, 640, "Platform map: public site to payments (real vs planned)");
  d.group(20, 50, 250, 560, "Public (anonymous)");
  d.group(300, 50, 300, 560, "Supabase project otqzhocismdjbvvsjnpe");
  d.group(630, 50, 590, 560, "Owner Desk /operations/ (staff sign-in)");
  d.node("site", 40, 100, 210, 70, "Public website", "index.html (static)", "real");
  d.node("form", 40, 210, 210, 70, "Survey request form", "#request, 1 network call", "real");
  d.node("conf", 40, 320, 210, 70, "Configurator + assistant", "browser-only, localStorage", "real");
  d.node("sub", 330, 100, 240, 70, "Edge fn submit-enquiry", "validate, rate limit, save", "real");
  d.node("db", 330, 230, 240, 90, "Postgres + RLS", "consultation_requests,\nquotes, work_orders, invoices ...", "real");
  d.node("auth", 330, 360, 240, 60, "Supabase Auth", "email magic link", "real");
  d.node("evt", 330, 450, 240, 70, "notification_events", "outbox + retry worker", "real");
  d.node("enq", 660, 100, 170, 60, "Enquiries", "customer = enquiry row", "real");
  d.node("quo", 860, 100, 170, 60, "Quotes", "draft > sent > accepted", "real");
  d.node("job", 1050, 100, 150, 60, "Jobs", "work_orders", "real");
  d.node("inv", 860, 220, 170, 60, "Invoices", "draft > sent > void", "real");
  d.node("pay", 1050, 220, 150, 60, "Payments", "manual recording", "real");
  d.node("cal", 660, 220, 170, 60, "Calendar", "appointments, blocks", "real");
  d.node("act", 860, 330, 170, 60, "Activity log", "workflow_activity", "real");
  d.node("set", 1050, 440, 150, 60, "Business settings", "owner-only write", "real");
  d.node("nc", 660, 330, 170, 60, "Notification centre", "inbox + prefs + push", "real");
  d.node("cust", 660, 440, 170, 60, "Customer records", "no separate entity (#32)", "planned");
  d.node("fin", 860, 440, 170, 60, "Finance panel v2", "range, aged debt (#33)", "planned");
  d.node("stripe", 1050, 330, 150, 60, "Stripe", "no code anywhere", "planned");
  d.node("email", 40, 450, 210, 60, "Resend (email)", "owner alert on enquiry", "external");
  d.node("push", 40, 540, 210, 60, "Web Push (VAPID)", "phone / desktop alert", "external");
  d.edge("site", "form", { kind: "real" }); d.edge("form", "sub", { from: "r", to: "l", label: "POST", via: [[290, 245], [290, 135]] });
  d.edge("sub", "db", { label: "insert", from: "b", to: "t" });
  d.edge("sub", "evt", { from: "r", to: "r", via: [[586, 135], [586, 470], [570, 470]], label: "claim", lx: 586, ly: 180 });
  d.edge("evt", "email", { from: "l", to: "r", label: "send" });
  d.edge("evt", "push", { from: "l", to: "r", via: [[290, 485], [290, 570]], label: "dispatch" });
  d.edge("db", "enq", { from: "r", to: "l", label: "RLS read", via: [[604, 275], [604, 130]], lx: 604, ly: 225 });
  d.edge("auth", "db", { from: "t", to: "b", label: "JWT" });
  d.edge("enq", "quo", {}); d.edge("quo", "job", {}); d.edge("quo", "inv", { from: "b", to: "t" }); d.edge("job", "pay", { from: "b", to: "t", via: [[1125, 190], [1125, 220]] });
  d.edge("inv", "pay", {});
  d.edge("pay", "stripe", { from: "b", to: "t", kind: "planned", label: "planned" });
  d.edge("nc", "evt", { from: "l", to: "r", kind: "real", via: [[618, 360], [618, 500], [570, 500]], label: "reads", lx: 618, ly: 430 });
  legend(d, 640, 616, LEG);
  save("01-platform-map", d.render());
}

// 02 front/back
{
  const d = new Diagram(1200, 560, "Front end / back end");
  d.group(20, 50, 360, 490, "Browser");
  d.group(420, 50, 250, 230, "Vercel (static hosting)");
  d.group(710, 50, 470, 490, "Supabase");
  d.node("ls", 40, 100, 320, 70, "Static files loaded", "HTML / JS / CSS / icons / service worker", "light");
  d.node("ops", 40, 300, 320, 90, "Staff PWA /operations/", "app.js + ES modules, service worker\nsupabase-js via https://esm.sh (pinned)", "real");
  d.node("pub", 40, 400, 320, 80, "Public site", "index.html, inline JS + CSS\nno framework, no bundler", "real");
  d.node("dist", 450, 90, 190, 70, "dist/public", "built by scripts/build-public.mjs", "real");
  d.node("cfg", 450, 180, 190, 70, "public-config.js\noperations/config.js", "anon key + URL + VAPID public", "real");
  d.node("st", 740, 100, 190, 70, "Storage", "private bucket project-uploads", "real");
  d.node("au", 960, 100, 190, 70, "Auth", "magic link (OTP)", "real");
  d.node("pg", 740, 305, 190, 80, "Postgres + RLS", "REST (PostgREST), triggers,\nrealtime channel", "real");
  d.node("sec", 960, 305, 190, 80, "pg_cron + Vault", "retry schedule (SQL script)", "real");
  d.node("ef", 740, 400, 190, 90, "Edge Functions", "submit-enquiry\npush-new-enquiry\nretry-notifications", "real");
  d.node("sc", 960, 400, 190, 90, "Function secrets", "names only in docs", "light");
  d.edge("dist", "ls", { from: "l", to: "r", label: "served", via: [[420, 125], [420, 135], [360, 135]], lx: 410, ly: 150 });
  d.edge("ops", "pg", { from: "r", to: "l", label: "supabase-js: REST + Auth (JWT)" });
  d.edge("pub", "ef", { from: "r", to: "l", label: "POST submit-enquiry" });
  d.edge("sec", "ef", { from: "b", to: "t", via: [[1055, 395], [835, 395]], label: "" });
  d.text(430, 385, "Vercel serves files only: no server code,", { size: 11.5 });
  d.text(430, 403, "no database. vercel.json holds buildCommand", { size: 11.5 });
  d.text(430, 421, "and outputDirectory only (no headers).", { size: 11.5 });
  legend(d, 40, 520, [["real", "on main"], ["light", "supporting"]]);
  save("02-front-back", d.render());
}

// 03 supabase components
{
  const d = new Diagram(1160, 510, "Supabase components used by Form & Frame (main)");
  d.node("anon", 30, 90, 150, 60, "anon key", "public website", "external");
  d.node("svc", 30, 200, 150, 60, "service role", "Edge Functions only", "external");
  d.node("jwt", 30, 415, 150, 60, "staff JWT", "owner / staff", "external");
  d.node("ef", 260, 80, 230, 70, "submit-enquiry", "verify_jwt = true", "real");
  d.node("pn", 260, 170, 230, 70, "push-new-enquiry", "verify_jwt = false\nbearer PUSH_DISPATCH_TOKEN", "real");
  d.node("rn", 260, 260, 230, 70, "retry-notifications", "verify_jwt = false\nbearer NOTIFICATION_RETRY_TOKEN", "real");
  d.node("cron", 260, 350, 230, 50, "pg_cron + pg_net", "scheduled via Vault token", "real");
  d.node("rest", 580, 410, 200, 70, "PostgREST + RLS", "is_staff() policies", "real");
  d.node("pg", 850, 90, 280, 190, "Postgres", "18 tables, 2 views\nSECURITY DEFINER functions\n(empty search_path)\ntriggers: status guards, overlap,\noverpayment, activity log, push queue", "real");
  d.node("stor", 850, 310, 280, 60, "Storage: project-uploads", "private, staff read", "real");
  d.node("auth", 580, 90, 200, 70, "Auth", "OTP e-mail, shouldCreateUser=false", "real");
  d.edge("anon", "ef", {});
  d.edge("svc", "pn", {});
  d.edge("jwt", "rest", { from: "r", to: "l" });
  d.edge("cron", "rn", { from: "t", to: "b", label: "POST" });
  d.edge("ef", "pg", { from: "r", to: "l", via: [[520, 115], [520, 70], [830, 70], [830, 125]], label: "service-role rpc", lx: 680, ly: 70 });
  d.edge("rn", "pg", { from: "r", to: "l", via: [[540, 295], [540, 250], [850, 250]], label: "" });
  d.edge("pn", "pg", { from: "r", to: "l", via: [[560, 205], [850, 205]] });
  d.edge("auth", "pg", { from: "r", to: "l", via: [[800, 125], [800, 140], [850, 140]] });
  d.edge("rest", "pg", { from: "r", to: "b", via: [[820, 445], [820, 295], [990, 295], [990, 280]] });
  legend(d, 30, 482, LEG);
  save("03-supabase-components", d.render());
}

// 04 ERD (from migrations)
{
  const d = new Diagram(1280, 730, "Database map from supabase/migrations (arrows = foreign keys, child to parent)");
  const T = (id, x, y, w, h, t, s, k = "data") => d.node(id, x, y, w, h, t, s, k, { align: "left" });
  T("prof", 30, 280, 190, 110, "profiles", "id > auth.users\nfull_name\nrole owner|staff", "real");
  T("req", 300, 250, 220, 190, "consultation_requests", "reference (unique)\nstatus enum\ncustomer_name, email, phone\npostcode, wall_width, message\nproject_spec jsonb\nguide_low/high, idempotency_key\nassigned_to > profiles");
  T("quo", 620, 60, 200, 130, "quotes", "quote_number unique\nversion, status\nsubtotal/tax/total pence\nrequest_id > requests");
  T("wo", 620, 260, 200, 130, "work_orders", "work_order_number unique\nstatus, agreed_total_pence\nactual_cost_pence\naccepted_quote_id > quotes");
  T("app", 620, 460, 200, 110, "appointments", "kind survey|installation\nstatus, starts/ends\nrequest_id, work_order_id");
  T("fu", 300, 500, 220, 90, "follow_up_tasks", "title, due_at\ncompleted/cancelled_at\nrequest_id, work_order_id");
  T("inv", 920, 260, 200, 130, "invoices", "invoice_number unique\nstatus draft|sent|void\ntotal_pence, due_date\nwork_order_id > work_orders");
  T("pay", 1070, 60, 190, 120, "invoice_payments", "amount_pence > 0\nmethod incl. 'stripe'\nrecording_key unique\nexternal_payment_id,\nprovider_event_id");
  T("act", 920, 460, 200, 100, "workflow_activity", "entity_type, event_type\nfrom/to status\nactor_id > profiles");
  T("ne", 300, 60, 220, 120, "notification_events", "request_id > requests\nchannel email|push|webhook\ndelivery_status, attempts\nnext_attempt_at");
  T("up", 30, 450, 190, 70, "request_uploads", "request_id > requests");
  T("blk", 30, 540, 190, 70, "availability_blocks", "kind, starts/ends");
  T("ps", 30, 60, 190, 90, "push_subscriptions", "user_id > profiles\nendpoint unique");
  T("np", 30, 170, 190, 80, "notification_preferences", "user_id > profiles");
  T("nr", 300, 630, 220, 60, "notification_reads", "event_id > notification_events\nuser_id > profiles");
  T("bs", 620, 610, 200, 70, "business_settings", "singleton row\nowner-only write", "real");
  T("rl", 920, 610, 330, 70, "enquiry_rate_limits, enquiry_rate_limit_keys", "service-role only (no policies)", "real");
  d.edge("req", "prof", { from: "l", to: "r", via: [[260, 345], [260, 335]] });
  d.edge("quo", "req", { from: "l", to: "t", via: [[570, 125], [570, 230], [410, 230]] });
  d.edge("wo", "req", { from: "l", to: "r" });
  d.edge("wo", "quo", { from: "t", to: "b" });
  d.edge("app", "req", { from: "l", to: "r", via: [[570, 515], [570, 415], [520, 415]] });
  d.edge("fu", "req", { from: "t", to: "b" });
  d.edge("inv", "wo", { from: "l", to: "r" });
  d.edge("pay", "inv", { from: "b", to: "t", via: [[1165, 230], [1020, 230]] });
  d.edge("ne", "req", { from: "b", to: "t" });
  d.edge("up", "req", { from: "r", to: "l", via: [[270, 485], [270, 400]] });
  d.edge("ps", "prof", { from: "b", to: "t", via: [[125, 150], [125, 280]], lx: 125, ly: 200 });
  legend(d, 640, 700, [["real", "own-row / special"], ["data", "table"]]);
  save("04-database-map", d.render());
}

// 05 auth flow
{
  const d = new Diagram(1200, 470, "Staff sign-in and access check (operations/app.js + staff-access.mjs)");
  d.node("a", 30, 100, 170, 70, "Open /operations/", "service worker shell loads", "real");
  d.node("b", 250, 100, 170, 70, "Enter work email", "Send secure link", "real");
  d.node("c", 470, 100, 190, 70, "signInWithOtp", "shouldCreateUser = false\nemailRedirectTo = page URL", "real");
  d.node("d", 710, 100, 190, 70, "Email link opened", "session stored by supabase-js", "real");
  d.node("e", 950, 100, 210, 70, "checkStaffAccess()", "auth.getUser + profiles.role", "real");
  d.node("i", 30, 250, 210, 60, "unavailable", "network/profile error\nRetry access", "light");
  d.node("h", 290, 250, 210, 60, "signed_out", "\"Your session has ended\"", "light");
  d.node("g", 550, 250, 210, 60, "unassigned", "signed in, no profile role\nmessage + Sign out", "light");
  d.node("f", 950, 250, 210, 60, "authorized", "role owner | staff > Owner Desk", "real");
  d.node("j", 950, 360, 210, 60, "Business data", "RLS: is_staff() (owner|staff)", "real");
  d.node("k", 30, 360, 460, 60, "Not yet verified in the live project (#16)", "redirect URL allow-list, e-mail delivery, session expiry", "broken");
  d.edge("a", "b", {}); d.edge("b", "c", {}); d.edge("c", "d", { label: "email" }); d.edge("d", "e", {});
  d.edge("e", "f", { from: "b", to: "t" });
  d.edge("e", "g", { from: "b", to: "t", via: [[1055, 205], [655, 205]] });
  d.edge("e", "h", { from: "b", to: "t", via: [[1055, 205], [395, 205]] });
  d.edge("e", "i", { from: "b", to: "t", via: [[1055, 205], [135, 205]] });
  d.edge("f", "j", { from: "b", to: "t" });
  legend(d, 640, 440, [["real", "on main"], ["light", "state"], ["broken", "unverified"]]);
  save("05-auth-flow", d.render());
}

// 06 RLS
{
  const d = new Diagram(1200, 540, "Row Level Security today (main) vs proposal (PR #23, unapplied)");
  d.group(20, 50, 560, 450, "Today: supabase/migrations on main");
  d.group(610, 50, 570, 450, "Proposal: PR #23 draft (NOT applied anywhere)", "planned");
  d.node("s1", 40, 90, 150, 60, "anon", "no policy: no rows", "external");
  d.node("s2", 40, 180, 150, 60, "signed in, no profile", "is_staff() = false", "external");
  d.node("s3", 40, 270, 150, 60, "staff", "profiles.role = staff", "light");
  d.node("s4", 40, 360, 150, 60, "owner", "profiles.role = owner", "light");
  d.node("fn", 240, 230, 130, 90, "is_staff()", "owner OR staff", "real");
  d.node("t1", 440, 80, 130, 110, "customers,\nquotes, jobs,\ninvoices, payments", "full read/write\nfor all staff", "broken");
  d.node("t2", 440, 230, 130, 80, "business_settings", "write: owner only", "real");
  d.node("t3", 440, 350, 130, 80, "push, prefs, reads", "own rows only", "real");
  d.edge("s2", "fn", { from: "r", to: "t", via: [[305, 210]] });
  d.edge("s3", "fn", { from: "r", to: "l", via: [[215, 300], [215, 275]] });
  d.edge("fn", "t1", { from: "r", to: "l", via: [[405, 275], [405, 135]], label: "" });
  d.edge("fn", "t2", { from: "r", to: "l" });
  d.edge("s4", "t2", { from: "r", to: "b", via: [[300, 390], [300, 340], [505, 340], [505, 310]], label: "owner only", lx: 380, ly: 340 });
  d.edge("s4", "t3", { from: "r", to: "l", via: [[260, 390], [260, 390]] });
  d.node("p1", 640, 90, 170, 60, "Owner", "all money + settings", "pr");
  d.node("p2", 640, 180, 170, 60, "Manager", "read + draft; no actual cost", "planned");
  d.node("p3", 640, 270, 170, 60, "Staff", "no money tables", "pr");
  d.node("pt1", 880, 90, 270, 70, "quotes, invoices, payments", "Owner / Manager only", "pr");
  d.node("pt2", 880, 180, 270, 70, "work_orders (agreed/actual cost)", "staff gets a money-free view", "pr");
  d.node("pt3", 880, 270, 270, 70, "customer contact details", "decision A pending: may staff see?", "planned");
  d.text(640, 380, "Open decisions for Mark: A customer contact for staff, B does Manager exist,", { size: 11.5 });
  d.text(640, 398, "C who can send/void invoices and record payments, D staff job-status updates.", { size: 11.5 });
  d.text(640, 430, "UI gating that must ship first: PR #42 (stacked on #20).", { size: 11.5, fill: C.bad });
  d.edge("p1", "pt1", { kind: "pr" }); d.edge("p3", "pt2", { kind: "pr", from: "r", to: "b", via: [[850, 300], [850, 265], [1015, 265], [1015, 250]] });
  d.edge("p2", "pt1", { kind: "planned", from: "r", to: "l", via: [[845, 210], [845, 125]] });
  legend(d, 30, 516, [["real", "on main"], ["broken", "P0 finding"], ["pr", "Draft PR"], ["planned", "decision pending"]]);
  save("06-rls", d.render());
}

// 07 edge functions
{
  const d = new Diagram(1200, 520, "Edge Functions: callers, authentication, secrets (names only), data touched");
  const cols = [
    ["submit-enquiry", "caller: public website\nauth: gateway JWT (anon key)\n+ Origin allow-list\n+ honeypot + rate limit", "ALLOWED_ORIGINS\nENQUIRY_RATE_LIMIT_SECRET\nRESEND_API_KEY, NOTIFICATION_EMAIL\nNOTIFICATION_FROM\nPUSH_DISPATCH_TOKEN\nSUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY", "consultation_requests (insert)\nnotification_events (claim)\nconsume_public_enquiry_slot()"],
    ["push-new-enquiry", "caller: submit-enquiry, retry\nworker, staff app\nauth: bearer PUSH_DISPATCH_TOKEN\n(verify_jwt = false)", "ALLOWED_ORIGINS\nPUSH_DISPATCH_TOKEN\nVAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY\nVAPID_SUBJECT\nSUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY", "profiles, notification_preferences\npush_subscriptions (read, prune)"],
    ["retry-notifications", "caller: pg_cron (SQL script)\nauth: bearer\nNOTIFICATION_RETRY_TOKEN\n(verify_jwt = false)", "NOTIFICATION_RETRY_TOKEN\nRESEND_API_KEY, NOTIFICATION_EMAIL\nNOTIFICATION_FROM, PUSH_DISPATCH_TOKEN\nSUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY", "notification_events (due, max 10)\nconsultation_requests (read)\nclaim_* rpc"]
  ];
  cols.forEach(([name, caller, secrets, data], i) => {
    const x = 30 + i * 385;
    d.node("f" + i, x, 60, 350, 50, name, "", "real");
    d.node("c" + i, x, 130, 350, 100, "Caller / auth", caller, "light", { align: "left" });
    d.node("s" + i, x, 250, 350, 130, "Secrets (names only)", secrets, "external", { align: "left" });
    d.node("d" + i, x, 400, 350, 80, "Data touched", data, "data", { align: "left" });
  });
  legend(d, 30, 500, [["real", "function"], ["external", "secret names, values never in repo"]]);
  save("07-edge-functions", d.render());
}

// 08 notifications
{
  const d = new Diagram(1200, 540, "Notifications pipeline (main)");
  d.node("f", 30, 80, 200, 60, "Public enquiry", "submit-enquiry saved it", "real");
  d.node("w", 30, 220, 200, 70, "Staff workflow change", "quote / job / appointment /\ninvoice / payment", "real");
  d.node("trg", 270, 320, 230, 60, "DB triggers", "queue_workflow_push_notification", "real");
  d.node("ev", 290, 130, 210, 80, "notification_events", "channel, delivery_status\nattempt_count, next_attempt_at", "real");
  d.node("em", 600, 70, 190, 60, "Resend e-mail", "owner alert, reference only", "external");
  d.node("pu", 600, 170, 200, 60, "push-new-enquiry", "Web Push to subscribed devices", "real");
  d.node("dev", 880, 170, 190, 60, "Staff devices", "push_subscriptions", "external");
  d.node("rt", 600, 290, 200, 70, "retry-notifications", "pg_cron, max 10 per run,\nbackoff capped at 16 min", "real");
  d.node("nc", 880, 290, 190, 70, "Notification centre", "inbox, mark read, prefs", "real");
  d.node("dead", 600, 400, 330, 60, "Retry cap + dead-letter state", "unbounded today; draft in PR #22 (unapplied)", "pr");
  d.edge("f", "ev", { from: "r", to: "l", via: [[260, 110], [260, 160], [290, 160]] });
  d.edge("w", "trg", { from: "r", to: "l", via: [[250, 255], [250, 350], [270, 350]] });
  d.edge("trg", "ev", { from: "t", to: "b", via: [[395, 320], [395, 210]] });
  d.edge("ev", "em", { from: "r", to: "l", via: [[550, 160], [550, 100], [600, 100]] });
  d.edge("ev", "pu", { from: "r", to: "l", via: [[550, 190], [550, 200], [600, 200]] });
  d.edge("pu", "dev", {});
  d.edge("rt", "ev", { from: "l", to: "b", via: [[560, 325], [560, 250], [460, 250], [460, 210]] });
  d.edge("ev", "nc", { from: "t", to: "t", via: [[395, 110], [1000, 110], [1000, 290]], label: "reads", lx: 1000, ly: 250 });
  d.edge("dead", "rt", { kind: "pr", from: "t", to: "b", via: [[700, 400], [700, 360]] });
  d.text(30, 440, "E-mail = one internal alert per enquiry (to NOTIFICATION_EMAIL). No customer-facing e-mail exists.", { size: 11.5 });
  d.text(30, 460, "No SMS, no WhatsApp, no customer confirmation message (the app says so on screen).", { size: 11.5 });
  legend(d, 30, 516, LEG);
  save("08-notifications", d.render());
}

// 09 stripe (planned)
{
  const d = new Diagram(1200, 520, "Stripe: NOT IMPLEMENTED (design only, PR #25). Everything dashed is planned.");
  d.node("dec", 30, 70, 230, 80, "12 commercial decisions", "owner must answer first\n(PR #25 section 2)", "broken");
  d.node("sec", 620, 70, 260, 70, "STRIPE_SECRET_KEY\nSTRIPE_WEBHOOK_SECRET", "names reserved; values: none", "planned");
  d.node("inv", 30, 220, 230, 70, "invoices (sent)", "exists on main", "real");
  d.node("cl", 330, 220, 220, 70, "create-payment-link fn", "JWT + role check, server amount", "planned");
  d.node("st", 620, 220, 200, 70, "Stripe Checkout / Link", "test mode first", "planned");
  d.node("wh", 900, 220, 270, 70, "stripe-webhook fn", "verify signature over raw body", "planned");
  d.node("pa", 330, 350, 220, 70, "payment_attempts", "never counted as money", "planned");
  d.node("rec", 620, 350, 250, 70, "Reconciliation + refunds", "needs reversal model (PR #43 draft)", "planned");
  d.node("ip", 900, 350, 270, 80, "invoice_payments", "method 'stripe', provider_event_id unique\n(columns exist on main; nothing writes them)", "real");
  d.edge("dec", "inv", { from: "b", to: "t", kind: "planned", label: "approve first" });
  d.edge("inv", "cl", { kind: "planned" }); d.edge("cl", "st", { kind: "planned" }); d.edge("st", "wh", { kind: "planned", label: "event" });
  d.edge("wh", "ip", { kind: "planned", from: "b", to: "t", label: "idempotent insert" });
  d.edge("cl", "pa", { kind: "planned", from: "b", to: "t" });
  d.edge("ip", "rec", { kind: "planned", from: "l", to: "r" });
  d.text(30, 480, "Verified absent: no Stripe import, endpoint or key in index.html, operations/, supabase/functions or scripts (see EVIDENCE_INVENTORY E-31).", { size: 11.5, fill: C.bad });
  save("09-stripe-planned", d.render());
}

// 10 vercel / deploy
{
  const d = new Diagram(1200, 440, "Build and hosting (Vercel) - values are env var NAMES only");
  d.node("gh", 30, 90, 170, 70, "GitHub repo", "main + frame/* branches", "external");
  d.node("vb", 270, 90, 200, 70, "Vercel build", "node scripts/build-public.mjs", "real");
  d.node("env", 270, 220, 260, 120, "Build env var names", "VERCEL_ENV\nFF_PUBLIC_SUPABASE_URL\nFF_PUBLIC_SUPABASE_ANON_KEY\nFF_OPERATIONS_VAPID_PUBLIC_KEY", "light");
  d.node("out", 560, 90, 190, 70, "dist/public", "index.html, assets/,\noperations/, config js", "real");
  d.node("prod", 830, 60, 220, 70, "Production", "VERCEL_ENV=production needs both keys\n(build fails otherwise)", "real");
  d.node("prev", 830, 160, 220, 70, "Preview", "per PR; config optional", "real");
  d.node("host", 830, 270, 340, 90, "Not verified by this book", "live deployment state, domain settings,\nVercel env values, response headers", "broken");
  d.edge("gh", "vb", {}); d.edge("env", "vb", { from: "t", to: "b" }); d.edge("vb", "out", {}); d.edge("out", "prod", { from: "r", to: "l", via: [[790, 125], [790, 95]] }); d.edge("out", "prev", { from: "r", to: "l", via: [[790, 125], [790, 195]] });
  d.text(30, 400, "Guards in scripts/public-config.mjs: project ref pinned, anon-role JWT only, service keys refused.", { size: 11.5 });
  save("10-vercel", d.render());
}

// 11 CI/CD
{
  const d = new Diagram(1200, 400, ".github/workflows/quality.yml (job 'verify', Node 24, Ubuntu)");
  const steps = [["Checkout", "persist-credentials: false"], ["Setup Node 24", "no package cache"], ["node --test", "TZ=Europe/London"], ["Syntax checks", "29 node --check cmds\n(3 with strip-types)"], ["check-inline-scripts", "parses inline JS"], ["Prod build must FAIL", "no config = error"], ["Fictional-config build", "anon JWT, fake sig"], ["check-public-build", "allowed files only"]];
  steps.forEach(([t, s], i) => d.node("s" + i, 20 + (i % 4) * 290, 110 + Math.floor(i / 4) * 130, 250, 70, `${i + 1}. ${t}`, s, "real"));
  for (let i = 0; i < 7; i++) { if (i === 3) d.edge("s3", "s4", { from: "b", to: "t", via: [[865, 200], [865, 215], [145, 215], [145, 240]] }); else d.edge("s" + i, "s" + (i + 1), {}); }
  d.node("trig", 20, 52, 400, 36, "Triggers: push to main, pull_request to main", "", "light");
  d.node("note", 600, 52, 560, 36, "PRs targeting other branches (e.g. audit branch) do not run this workflow", "", "broken");
  d.text(20, 345, "Not in CI: browser tests, accessibility audit, live Supabase, RLS in real Postgres (PGlite tests run only with PGLITE_MODULE).", { size: 11.5 });
  d.text(20, 365, "Vercel Preview is a separate check outside this workflow.", { size: 11.5 });
  save("11-ci-cd", d.render());
}

// sequences
save("12-seq-enquiry", sequence({
  title: "Sequence: enquiry submit to notification", w: 1180,
  actors: [{ name: "Visitor", kind: "external" }, { name: "Public site JS", kind: "real" }, { name: "submit-enquiry", kind: "real" }, { name: "Postgres", kind: "real" }, { name: "Resend", kind: "external" }, { name: "push-new-enquiry", kind: "real" }, { name: "Staff device", kind: "external" }],
  steps: [
    { from: 0, to: 1, text: "fills form, Request a survey" }, { from: 1, to: 1, text: "validate + idempotency UUID" },
    { from: 1, to: 2, text: "POST (anon key, Origin)" }, { from: 2, to: 2, text: "origin, honeypot, size, fields" },
    { from: 2, to: 3, text: "consume_public_enquiry_slot()" }, { from: 3, to: 2, text: "allowed | 429", dashed: true },
    { from: 2, to: 3, text: "insert consultation_requests" }, { from: 2, to: 3, text: "claim notification (email)" },
    { from: 2, to: 4, text: "send alert (if configured)" }, { from: 2, to: 5, text: "dispatch (bearer token)" },
    { from: 5, to: 6, text: "Web Push" }, { from: 2, to: 1, text: "{ reference }", dashed: true },
    { from: 1, to: 0, text: "shows REF FF-...", dashed: true },
    { note: "failure keeps event for retry worker", at: 3 }
  ], note: "Source: index.html submit handler, supabase/functions/submit-enquiry/handler.mjs"
}));
save("13-seq-signin", sequence({
  title: "Sequence: staff sign-in", w: 1100,
  actors: [{ name: "Staff member", kind: "external" }, { name: "Staff PWA", kind: "real" }, { name: "Supabase Auth", kind: "real" }, { name: "Email inbox", kind: "external" }, { name: "Postgres (RLS)", kind: "real" }],
  steps: [
    { from: 0, to: 1, text: "enter work email" }, { from: 1, to: 2, text: "signInWithOtp(shouldCreateUser:false)" },
    { from: 2, to: 3, text: "magic link e-mail" }, { from: 0, to: 3, text: "opens link", dashed: true }, { from: 3, to: 1, text: "redirect with session", dashed: true },
    { from: 1, to: 2, text: "auth.getUser()" }, { from: 1, to: 4, text: "select role from profiles" },
    { from: 4, to: 1, text: "owner | staff | none", dashed: true }, { from: 1, to: 4, text: "load business tables (JWT)" },
    { note: "live redirect list/e-mail: NOT VERIFIED (#16)", at: 2 }
  ], note: "Source: operations/app.js, operations/staff-access.mjs"
}));
save("14-seq-invoice-payment", sequence({
  title: "Sequence: invoice and manual payment (main)", w: 1100,
  actors: [{ name: "Owner / staff", kind: "external" }, { name: "Staff PWA", kind: "real" }, { name: "Postgres triggers", kind: "real" }, { name: "Stripe", kind: "planned" }],
  steps: [
    { from: 0, to: 1, text: "Create invoice draft (job, amounts)" }, { from: 1, to: 1, text: "browser builds FFI-date-rand number" },
    { from: 1, to: 2, text: "insert invoices (draft)" }, { from: 2, to: 2, text: "status + amount guards, activity row" },
    { from: 0, to: 1, text: "mark sent (draft > sent)" }, { from: 1, to: 2, text: "update status, sent_at" },
    { from: 0, to: 1, text: "record payment (amount, method)" }, { from: 1, to: 1, text: "stored recording_key (idempotent)" },
    { from: 1, to: 2, text: "insert invoice_payments" }, { from: 2, to: 2, text: "block overpayment, lock invoice" },
    { from: 2, to: 1, text: "ok or error", dashed: true },
    { from: 1, to: 3, text: "online payment: NOT IMPLEMENTED", kind: "planned" },
    { note: "no void/correct for payments on main (#14, PR #43)", at: 2 }
  ], note: "Source: operations/app.js lines 1336-1366, migration 20261005130000"
}));

// 15 owner desk navigation
{
  const d = new Diagram(1200, 500, "Owner Desk navigation (staff PWA, main)");
  d.node("l", 30, 200, 160, 60, "Sign-in", "magic link", "real");
  d.node("desk", 250, 200, 170, 60, "Owner Desk", "mobile bar: 4 views", "real");
  ["Today", "Work", "Calendar", "Money"].forEach((t, i) => d.node("v" + i, 500, 60 + i * 100, 170, 60, t, ["plan, metrics, money strip", "enquiry list + project panel", "month/week, blocks", "quotes, jobs, invoices"][i], "real"));
  d.node("ws", 760, 90, 210, 70, "Enquiry workspace", "10-step stepper, next action", "real");
  d.node("q", 1020, 40, 150, 56, "Quote editor", "draft only", "real");
  d.node("ap", 1020, 106, 150, 56, "Appointment", "conflict-checked", "real");
  d.node("fu", 1020, 172, 150, 56, "Follow-up", "task", "real");
  d.node("inv", 760, 290, 210, 70, "Invoices & payments", "create draft, send, record", "real");
  d.node("set", 760, 390, 210, 60, "Seller details", "owner only", "real");
  d.node("bell", 250, 340, 170, 60, "Alerts bell", "not shown in demo mode", "real");
  d.edge("l", "desk", {}); ["v0", "v1", "v2", "v3"].forEach(v => d.edge("desk", v, { from: "r", to: "l" }));
  d.edge("v1", "ws", {}); d.edge("ws", "q", { from: "r", to: "l" }); d.edge("ws", "ap", { from: "r", to: "l" }); d.edge("ws", "fu", { from: "r", to: "l" });
  d.edge("v3", "inv", {}); d.edge("v3", "set", { from: "r", to: "l", via: [[700, 350], [700, 420], [760, 420]] });
  d.edge("desk", "bell", { from: "b", to: "t" });
  save("15-owner-desk-navigation", d.render());
}

// 16 journeys
{
  const d = new Diagram(1240, 600, "User journeys (green = works on main, red = broken or missing, amber dashed = Draft PR/planned)");
  const lane = (y, label) => { d.group(20, y, 1200, 170, label); };
  lane(50, "Customer");
  const c = [["Land on site", "real"], ["Configure wall\n(optional)", "real"], ["Request survey form", "real"], ["REF shown", "real"], ["Owner calls back\n(promise unconfirmed)", "broken"], ["Customer confirmation\ne-mail/SMS", "planned"], ["Pay online", "planned"]];
  c.forEach(([t, k], i) => d.node("c" + i, 36 + i * 170, 100, 150, 80, t, "", k));
  for (let i = 0; i < 6; i++) d.edge("c" + i, "c" + (i + 1), { kind: i >= 4 ? "planned" : "real" });
  lane(230, "Owner");
  const o = [["Gets alert\n(email + push)", "real"], ["Opens enquiry\nworkspace", "real"], ["Quote draft > sent", "real"], ["Accepted > job", "real"], ["Invoice > payment", "real"], ["Correct a payment", "broken"], ["Manage users/roles", "broken"]];
  o.forEach(([t, k], i) => d.node("o" + i, 36 + i * 170, 280, 150, 80, t, "", k));
  for (let i = 0; i < 6; i++) d.edge("o" + i, "o" + (i + 1), { kind: i >= 4 ? "broken" : "real" });
  lane(410, "Staff");
  const s = [["Sign in\n(magic link)", "real"], ["Today / Work\n/ Calendar", "real"], ["Update job,\nappointments", "real"], ["Money screens:\nstill visible", "broken"], ["Role-aware UI\n(PR #42)", "pr"], ["Least-privilege RLS\n(PR #23, unapplied)", "pr"]];
  s.forEach(([t, k], i) => d.node("s" + i, 36 + i * 170, 460, 150, 80, t, "", k));
  for (let i = 0; i < 5; i++) d.edge("s" + i, "s" + (i + 1), { kind: i >= 3 ? "pr" : "real" });
  save("16-journeys", d.render());
}

// 17 roadmap
{
  const d = new Diagram(1240, 560, "Roadmap P0 to P3 (issues and PRs; details in roadmap.md)");
  const cols = [["P0 security + money integrity", C.bad, [["#9 / PR #23", "permission matrix + RLS draft"], ["#28 / PR #42", "hide money UI by role"], ["#15 #29 / PR #41", "server-side numbering"], ["#14 / PR #43", "payment reversals"], ["#11 #10 / PR #27", "self-host supabase-js + CSP report-only"], ["#8 PR", "audit fixes, decide first"]]],
    ["P1 owner dashboard", C.oak, [["#31", "owner-only user management"], ["#32", "customer entity + de-dupe"], ["#33", "finance panel v2"], ["#34", "credit note / correction"], ["#35", "activity per record"], ["#36 / PR #20", "money-flow test harness"], ["#12 / PR #26", "contact + works validation"], ["#13 / PR #22", "retry cap + dead letter"]]],
    ["P2 quality", C.ink, [["#37", "business settings v2"], ["#38", "printable quote"], ["#39", "quote expiry job"], ["#40", "admin manual + deploy/rollback"], ["#16", "auth redirect allow-list"], ["#17 / PR #19", "MASTER_PROJECT.md"], ["#44 (this)", "Master Book + Live"]]],
    ["P3 later / blocked on owner", C.pencil, [["#18 / PR #25", "Stripe (design only)"], ["", "customer e-mail/SMS"], ["", "multi-user accounts at scale"]]]];
  cols.forEach(([t, col, items], i) => {
    const x = 20 + i * 305; d.parts.push(`<rect x="${x}" y="50" width="285" height="34" rx="4" fill="${col}"/><text x="${x + 12}" y="72" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="14" fill="#fff">${t}</text>`);
    items.forEach(([a, b], j) => d.node(`r${i}_${j}`, x, 96 + j * 56, 285, 48, a || b, a ? b : "", i === 3 ? "planned" : (a.includes("PR") && !a.startsWith("#44") ? "pr" : "light"), { align: "left" }));
  });
  save("17-roadmap", d.render());
}
console.log("diagrams written to", out);
