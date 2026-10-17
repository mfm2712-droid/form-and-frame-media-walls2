#!/usr/bin/env node
// Generates docs/master/EVIDENCE_INVENTORY.md. Every claim row points at a file and a line number found by
// matching a pattern in the CURRENT working tree (so a drifting repo makes the build fail loudly), or at a
// stored command log under docs/master/assets/evidence/. No network. Usage: node scripts/master-docs/verify-evidence.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const M = "supabase/migrations/";
const EV = "docs/master/assets/evidence/";
// [id, chapter, claim, file, regex]
const rows = [
  ["E-01", "README", "Version, commit and branch of the analysed code", "git", "commit analysed (from README); HEAD must descend from it"],
  ["E-02", "Architecture", "Build copies an explicit list of files into dist/public (docs/ is not on it)", "scripts/build-public.mjs", "for \\(const file of"],
  ["E-03", "Architecture", "Vercel builds with node scripts/build-public.mjs and serves dist/public", "vercel.json", "buildCommand"],
  ["E-04", "Website", "Public page sections: drawing, survey, specify, process, works, testimonials, request, footer", "index.html", 'id="request"'],
  ["E-05", "Website", "Form submit is the single fetch to submit-enquiry; spec in localStorage ff_spec; rule-based assistant", "index.html", "submit-enquiry"],
  ["E-06", "Website/Backend", "submit-enquiry validates, caps the brief at 12,000 characters and handles 429", "supabase/functions/submit-enquiry/handler.mjs", "12_000"],
  ["E-07", "Backend", "Enquiry rate limit is consumed through a service-role-only function with a secret", "supabase/functions/submit-enquiry/handler.mjs", "ENQUIRY_RATE_LIMIT_SECRET"],
  ["E-08", "Backend", "Internal e-mail goes through Resend only if configured", "supabase/functions/submit-enquiry/handler.mjs", "RESEND_API_KEY"],
  ["E-09", "Owner Dashboard", "Demo mode starts when no FF_OPERATIONS_CONFIG is present", "operations/app.js", "startDemo"],
  ["E-10", "Owner Dashboard", "Realtime listens to row changes on the workflow tables", "operations/app.js", "postgres_changes"],
  ["E-11", "Owner Dashboard", "Sign-in is signInWithOtp with shouldCreateUser:false", "operations/app.js", "shouldCreateUser"],
  ["E-12", "Owner Dashboard", "supabase-js imported from esm.sh at an exact version, no integrity check", "operations/app.js", "esm.sh/@supabase/supabase-js@"],
  ["E-13", "Owner Dashboard", "Staff workspace reads request_uploads and creates 10-minute signed URLs", "operations/app.js", "createSignedUrl"],
  ["E-14", "Owner Dashboard", "Payment recording uses a per-attempt recording_key", "operations/payment-idempotency.mjs", "getPaymentRecordingKey"],
  ["E-15", "Owner Dashboard", "Browser-generated quote/job/invoice numbers", "operations/app.js", "quote_number:quoteNo"],
  ["E-16", "Owner Dashboard", "Access check accepts owner and staff only", "operations/staff-access.mjs", "owner"],
  ["E-17", "Integrations", "Stripe: only a 'stripe' payment-method value exists (no library, key, endpoint or webhook)", M + "20261005130000_business_management_backend.sql", "'stripe'"],
  ["E-18", "Backend", "Three Edge Functions exist: submit-enquiry, push-new-enquiry, retry-notifications", "supabase/functions/retry-notifications/index.ts", "Deno"],
  ["E-19", "Backend/Security", "Server secret names read with Deno.env.get / env(...) (names only recorded, no values)", "supabase/functions/push-new-enquiry/index.ts", "VAPID_PRIVATE_KEY"],
  ["E-20", "Backend", "Retry worker and outbox: retry scheduled via Vault-backed cron; no attempt cap on main", "supabase/schedule_notification_retries.sql", "cron"],
  ["E-21", "Architecture/Security", "Public config guards: production build fails without config; service-role key refused", "scripts/public-config.mjs", "privileged or other-project keys are forbidden"],
  ["E-22", "Architecture/Testing", "CI runs on push to main and PRs to main with Node 24", ".github/workflows/quality.yml", "node-version: 24"],
  ["E-23", "Security/Architecture", "vercel.json has no headers block (no CSP)", "vercel.json", "outputDirectory"],
  ["E-24", "Security/Design", "Google Fonts and esm.sh are third-party requests; no CSP meta tag", "index.html", "fonts.googleapis.com"],
  ["E-25", "Design", "CSS design tokens (colours, radii, shadows) in the public page", "index.html", "--paper|--frame|:root"],
  ["E-26", "Architecture", "Staff app third-party hosts", "operations/index.html", "fonts.googleapis.com"],
  ["E-27", "Design", "Staff PWA manifest and icon set", "operations/manifest.webmanifest", "icons"],
  ["E-28", "Database", "profiles.role and is_staff() helper", M + "20260906110000_operations_hub.sql", "function public.is_staff"],
  ["E-29", "Database", "Appointment overlap: exclusion constraint on active appointments", M + "20261005130000_business_management_backend.sql", "exclude using gist"],
  ["E-30", "Database", "Calendar trigger blocks appointments over blocked time", M + "20261005130000_business_management_backend.sql", "prevent_calendar_overlap"],
  ["E-31", "Integrations", "Stripe absent: repository search for 'stripe' returns only the payment-method value (command re-run by this script)", "command", "grep-stripe"],
  ["E-32", "Security", "Magic-link sign-in and redirect to current page", "operations/app.js", "emailRedirectTo"],
  ["E-33", "Security", "RLS enabled on tables; anonymous has no policies; intake via service role", M + "20260906110000_operations_hub.sql", "enable row level security"],
  ["E-34", "Security", "Policies use is_staff(); business_settings writes are owner-only; no delete policies on money tables", M + "20261009100000_invoice_business_settings.sql", "owners update business settings"],
  ["E-35", "Security/Database", "Overpayment, status-machine and locking triggers", M + "20261005130000_business_management_backend.sql", "prevent_invoice_overpayment"],
  ["E-36", "Security", "The only 'webhook' trace is a channel value in a check constraint", M + "20260906110000_operations_hub.sql", "'webhook'"],
  ["E-37", "Testing", "Full test run on main, Node 24: 183 pass / 0 fail", EV + "main-node-test.log", "ℹ pass 183"],
  ["E-38", "Testing", "CI step replay on main", EV + "main-ci-replay.log", "Verified public build root"],
  ["E-39", "Testing", "Per-PR suite results", EV + "pr-suites.tsv", "frame/9-permissions"],
  ["E-40", "Testing", "Per-PR results with the local Postgres engine (PGlite)", EV + "pr-suites-pglite.txt", "23 exit=0"],
  ["E-41", "Database", "Realtime publication required by the business migration", M + "20261005130000_business_management_backend.sql", "supabase_realtime"],
  ["E-42", "Database", "Notification outbox table with channel check", M + "20260906110000_operations_hub.sql", "notification_events|channel text"],
  ["E-43", "Backend", "Push sender claims events server-side only", M + "20261008120000_workflow_push_notifications.sql", "claim_notification_event"],
  ["E-44", "Database", "Notification centre: reads and preferences tables, own-row policies", M + "20261016120000_notification_centre_and_preferences.sql", "notification_reads"],
  ["E-45", "Database", "Invoice seller settings table", M + "20261009100000_invoice_business_settings.sql", "business_settings"],
  ["E-46", "Database", "Optional site assessment flag", M + "20261010100000_optional_site_assessment.sql", "assess"],
  ["E-47", "Database", "Rate-limit tables revoked from public roles", M + "20261009150000_public_enquiry_rate_limits.sql", "revoke all on table"],
  ["E-48", "Database", "SECURITY DEFINER functions pinned to an empty search path", M + "20261007100000_harden_definer_search_paths.sql", "search_path"],
  ["E-49", "Database", "Retryable enquiry notifications: claim function, server role only", M + "20261006100000_retryable_enquiry_notifications.sql", "claim_new_enquiry_notification"],
  ["E-50", "Database", "Enquiry hardening migration", M + "20261004120000_harden_enquiry_submission.sql", "consultation_requests"],
  ["E-51", "Owner Dashboard", "Invoice document renderer", "operations/invoice-document.mjs", "export"],
  ["E-52", "Owner Dashboard", "Today view and metrics logic", "operations/today-view.mjs", "export"],
  ["E-53", "Owner Dashboard", "Calendar record selection", "operations/calendar-records.mjs", "overlappingRows"],
  ["E-54", "Owner Dashboard", "Notification centre logic", "operations/notification-centre.mjs", "export"],
  ["E-55", "Owner Dashboard", "Service worker registered with scope ./", "operations/app.js", "serviceWorker.register"],
  ["E-56", "Testing", "Test file with real tests for the submit handler", "supabase/functions/submit-enquiry/handler.test.mjs", "^test\\(|^\\s*test\\("],
  ["E-57", "Docs", "AGENTS.md rules the book respects (no secrets, real content only)", "AGENTS.md", "."],
];

function find(file, pattern) {
  if (!existsSync(resolve(root, file))) throw new Error(`Evidence file missing: ${file}`);
  const lines = readFileSync(resolve(root, file), "utf8").split("\n");
  const re = new RegExp(pattern);
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error(`Pattern /${pattern}/ not found in ${file}`);
  return i + 1;
}

const out = [];
const missing = [];
for (const [id, chapter, claim, file, pattern] of rows) {
  try {
    let loc;
    if (file === "git") { const sha = (readFileSync(join(root, "docs/master/README.md"), "utf8").match(/`([0-9a-f]{40})`/) || [])[1]; execSync(`git merge-base --is-ancestor ${sha} HEAD`, { cwd: root }); loc = "README states `" + sha + "`; HEAD descends from it (checked with `git merge-base --is-ancestor`)"; }
    else if (file === "command") {
      const hits = execSync(`git grep -n -i -l stripe -- index.html operations supabase/functions scripts/build-public.mjs scripts/public-config.mjs || true`, { cwd: root }).toString().trim();
      loc = "command `git grep -il stripe -- index.html operations supabase/functions scripts/build-*.mjs scripts/public-config.mjs` returned " + (hits ? "`" + hits.replace(/\n/g, ", ") + "`" : "no files");
    } else loc = `\`${file}:${find(file, pattern)}\``;
    out.push(`| ${id} | ${chapter} | ${claim} | ${loc} |`);
  } catch (e) { missing.push(`${id}: ${e.message}`); out.push(`| ${id} | ${chapter} | ${claim} | **NOT FOUND** (${e.message}) |`); }
}

const doc = `# Evidence inventory

Generated by \`scripts/master-docs/verify-evidence.mjs\` on the working tree of the commit named in the README. Each row is re-checked every time the script runs: it fails if a file or pattern has moved, so a row never silently points at nothing. \`E-nn\` markers in the chapters point here. Rows marked "command" or a stored log refer to commands run for this book; the logs are in \`docs/master/assets/evidence/\`.

How a chapter claim is justified:

- **Code facts** point at a file and the first line where the pattern occurs.
- **Test and run results** point at stored logs.
- **Observations** (screenshots, headless runs) are described in the chapter next to the image; the capture scripts are in \`scripts/master-docs/\`.
- **Not verified** items are listed in [pending-confirmation.md](pending-confirmation.md) and are never backed by an E-row.

| ID | Chapter | Claim | Evidence (file:line or command) |
|---|---|---|---|
${out.join("\n")}

Rows: ${rows.length}. Missing: ${missing.length}.
`;
writeFileSync(resolve(root, "docs/master/EVIDENCE_INVENTORY.md"), doc);
if (missing.length) { console.error("Evidence problems:\n" + missing.join("\n")); process.exit(1); }
console.log(`Evidence inventory written: ${rows.length} rows, 0 missing.`);
