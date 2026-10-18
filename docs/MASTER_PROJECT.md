# Form & Frame — master project reference

Describes **real code only**, as of `origin/main` @ 31a08f6 (16 Oct 2026). Anything not in the repository is listed under "Not in the repository" and must be treated as pending, never as done. Secrets are never recorded here: environment variables appear by **name only**. `scripts/master-project.test.mjs` fails if this file names a migration, function, environment variable or script that does not exist, or contains a credential-shaped string.

## 1. What it is
A static public website plus a mobile-first staff app ("Operations"), backed by one dedicated Supabase project (ref pinned in `supabase/config.toml`; `AGENTS.md` forbids touching any other project, including Lumi). No framework, no package.json/dependencies: plain HTML/JS/ES modules, tests with `node --test`.

## 2. Repository map
| Path | Purpose |
|---|---|
| `index.html` | Public site: SVG elevation viewer, survey-vs-proposal slider, live configurator with guide price range, process, enquiry form, "project assistant" panel, share/brief/pro-forma sheets. One inline script. |
| `operations/` | Staff app (`index.html`, `app.js`, ES modules `*.mjs`, `service-worker.js`, `manifest.webmanifest`, icons). Each module has a sibling `*.test.mjs`. `config.example.js` documents the runtime config shape. |
| `supabase/migrations/` | 10 SQL migrations, `20260906110000` … `20261016120000` (see §5). |
| `supabase/functions/` | Edge functions `submit-enquiry`, `push-new-enquiry`, `retry-notifications` (each: `index.ts` shim + testable `handler.mjs` + `handler.test.mjs`). |
| `supabase/*.sql` | Operator scripts, not migrations: `audit_remote_schema.sql`, `audit_public_enquiry_retention.sql`, `schedule_enquiry_rate_limit_cleanup.sql`, `schedule_notification_retries.sql`. `ACTIVATION_RUNBOOK.md` is the activation procedure and record. |
| `scripts/` | `build-public.mjs`, `public-config.mjs`, `check-public-build.mjs`, `check-inline-scripts.mjs`, `png-info.mjs`, `generate-notification-badge.py`, tests. |
| `assets/cases/` | Before/after photos used by the public "Completed works" section (authenticity pending the owner — see §9). |
| `.github/workflows/quality.yml` | CI (see §7). |
| `vercel.json` | `buildCommand`, `outputDirectory` = `dist/public`. |
| `docs/` | `MASTER_DOCUMENTATION.html` (visual handover; not shipped), this file. |
| `AGENTS.md`, `OPENCODE_NEXT_TASK.md`, `OPERATIONS_HUB.md`, `OVERNIGHT_OPERATIONS_HANDOFF.md`, `anthony-roadmap.html`, `owner-desk-approval-preview.html` | Working/handoff documents; not shipped by the build. |

## 3. Build and deployment boundary
`node scripts/build-public.mjs` writes `dist/public` containing only: `index.html`, `robots.txt`, `sitemap.xml`, `assets/`, `public-config.js`, and `operations/` (an explicit file allow-list plus every icon named by the manifest/service worker, and a generated `operations/config.js`). Backend source, docs and planning files are excluded. `scripts/public-config.mjs` validates build-time variables and refuses a build that sets only one of the pair; `VERCEL_ENV=production` without them fails. `scripts/check-public-build.mjs` asserts the boundary after building. Deployment target is Vercel (static); no deploy has been run by this documentation work.

## 4. Public site → server flow
Browser form → `POST <supabase>/functions/v1/submit-enquiry` (function `verify_jwt = true`, called with the public anon key). Handler: method/CORS against `ALLOWED_ORIGINS`, body size cap, field validation, honeypot field, per-edge-address rate limit (HMAC with `ENQUIRY_RATE_LIMIT_SECRET`, fail-closed), idempotent insert into `consultation_requests`, then tracked email (Resend) and push events through the claim functions. A saved enquiry never fails because notification failed. Local storage on the public page holds only configurator preferences (`ff_spec`, `ff_view`), enforced by `check-public-build.mjs`.

## 5. Database (from migrations)
Tables (public): `profiles` (role `owner|staff`), `consultation_requests`, `request_uploads`, `availability_blocks`, `notification_events`, `quotes`, `work_orders`, `appointments`, `follow_up_tasks`, `invoices`, `invoice_payments`, `workflow_activity`, `push_subscriptions`, `business_settings`, `enquiry_rate_limits`, `enquiry_rate_limit_keys`, `notification_preferences`, `notification_reads`. Views: `invoice_balances`, `work_order_financial_summary` (`security_invoker`). Enums include `request_status`, `quote_status`, `work_order_status`, `appointment_kind/status`, `invoice_status` (`draft|sent|void`).
Functions (security definer unless noted): `is_staff` (owner or staff), claim functions `claim_new_enquiry_notification` / `claim_notification_event` (service role only), `consume_public_enquiry_slot`, `cleanup_public_enquiry_rate_limits`, workflow guards/triggers (`enforce_workflow_status_transition`, `enforce_quote_assessment_gate`, `protect_accepted_quote`, `validate_accepted_work_order_quote`, `protect_paid_invoice_balance`, `prevent_invoice_overpayment`, `prevent_calendar_overlap`), audit triggers (`log_workflow_record_created/update`, `log_availability_block_deleted`), `queue_workflow_push_notification`, touch helpers. RLS: every business table is staff-gated via `is_staff()`; `business_settings` writes are owner-only (migration `20261009100000`). **Known gap (audit, unresolved on main):** any staff account can read/write quotes, work orders, invoices and payments — there is no manager tier; see the FRAME-002 patch for the proposed matrix.

## 6. Staff app (Operations)
Hosted at `/operations/` (noindex). Auth: Supabase Auth email magic link (`signInWithOtp`, `shouldCreateUser:false`); users must exist in Supabase Auth and have a `profiles` row. Sections: Today (`#desk`), Enquiries (`#leads`), Calendar (`#availability`), Money (`#business`). Features present in code: enquiry command centre and status pipeline, quotes, build jobs (work orders), appointments with overlap protection, follow-up tasks, invoices (browser-generated number, printable document, owner-set seller details) and manually recorded payments with an idempotency key kept across reloads, activity log, Realtime subscriptions, web-push opt-in per device, notification centre with per-user read state and category preferences. A demo mode with clearly fictional data exists in `app.js`. The service worker handles push only (no fetch handler, no caching).

## 7. Tests and CI
`.github/workflows/quality.yml` (push to main, PRs to main; Node 24): `TZ=Europe/London node --test`; `node --check` on the listed modules and the two `index.ts`; `node scripts/check-inline-scripts.mjs`; a production build that must fail without public config; a build with a fictional (clearly non-secret-shaped) JWT; `node scripts/check-public-build.mjs`. Baseline on main: 183 tests, all offline.

## 8. Environment variables (names only; values live in Vercel / Supabase secrets)
| Name | Where | Used by |
|---|---|---|
| `FF_PUBLIC_SUPABASE_URL`, `FF_PUBLIC_SUPABASE_ANON_KEY` | Vercel build | `scripts/public-config.mjs` → `public-config.js`, `operations/config.js` (browser-safe) |
| `FF_OPERATIONS_VAPID_PUBLIC_KEY` | Vercel build | `operations/config.js` (public push key) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secrets | all three functions (service role never in browser) |
| `ALLOWED_ORIGINS`, `ENQUIRY_RATE_LIMIT_SECRET` | Edge Function secrets | `submit-enquiry` |
| `RESEND_API_KEY`, `NOTIFICATION_EMAIL`, `NOTIFICATION_FROM` | Edge Function secrets | `submit-enquiry`, `retry-notifications` |
| `PUSH_DISPATCH_TOKEN` | Edge Function secrets | `submit-enquiry`, `retry-notifications`, `push-new-enquiry` |
| `NOTIFICATION_RETRY_TOKEN` | Edge Function secret (+ Vault entry `form_frame_notification_retry_token` read by the cron job) | `retry-notifications` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Edge Function secrets | `push-new-enquiry` |
Never add a value for any of these to the repository.

## 9. Not in the repository / pending
- **Stripe or any payment-provider code: none.** Payments are manual records only (`invoice_payments`). Design: see the FRAME-008 document if present.
- Live state of Supabase and Vercel (deployments, secrets, cron, sender domain, staff accounts) is **unverified** from code; `supabase/ACTIVATION_RUNBOOK.md` records only what was done on 5 Oct 2026.
- Business contact details (phone, email) are not in the site; the footer/JSON-LD street address is unverified.
- The four "Completed works" (Burnham, Langley, Slough, Windsor) and their photos await the owner's confirmation. Main also still carries four "Sample review" testimonials (PR #8, unmerged, removes them).
- Custom domain, privacy notice, SMTP/auth-email sender, role tiers beyond owner/staff.

## 10. Related unmerged work
PR #8 (`audit/final-production-audit-2026-10-17`): removes sample reviews, adds security headers, SEO files, accessibility fixes. Left open on purpose. Local, unpushed FRAME patches (permissions matrix, CSP/vendored supabase-js, auth tests, public-site fixes, notification tests/retry-cap draft) are indexed in the audit workspace; none is applied.
