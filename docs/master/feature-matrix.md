# 7. Feature matrix

Statuses are exactly: IMPLEMENTED, VERIFIED, PARTIAL, BROKEN, PLANNED, NOT IMPLEMENTED, BLOCKED (definitions in the [README](README.md)). **VERIFIED** names its proof in the Tests column (an automated test run on Node 24 for this book, or an observed headless-browser run). "Version" is the commit the row was assessed on: `31a08f6` is `main`; rows that exist only in a Draft PR say so in Dependencies and show the PR. Test counts are the static count of `test()` calls (the runner reports 183 in total; the static count is 182, one test is declared in a form the counter misses).

::: wide
| Feature | Route | Component | Backend | Status | Tests (proof) | Dependencies / notes | Issue | PR | Version |
|---|---|---|---|---|---|---|---|---|---|
| Public site shell, nav, sections | `/` | `index.html` | static | [[VERIFIED]] | observed render 1440/390; `check-public-build.mjs` run | Google Fonts | | | 31a08f6 |
| Configurator and guide price | `/#specify` | `index.html` inline JS | none (localStorage) | [[IMPLEMENTED]] | none touch pricing | prices unconfirmed | | | 31a08f6 |
| Survey vs proposal slider | `/#survey` | `index.html` | none | [[IMPLEMENTED]] | none | "real Burnham job" claim unconfirmed | #12 | #26 | 31a08f6 |
| Enquiry form UI and validation | `/#request` | `index.html` | none until submit | [[VERIFIED]] | observed validation messages | | | | 31a08f6 |
| Enquiry submit, end to end | `/#request` | form + `submit-enquiry` | Edge fn + DB | [[IMPLEMENTED]] | live path not observed | needs live Supabase config | | | 31a08f6 |
| `submit-enquiry` handler logic | n/a | `handler.mjs` | Edge fn | [[VERIFIED]] | `handler.test.mjs` (27) | injected mocks, not Deno | | | 31a08f6 |
| Public enquiry rate limit | n/a | `consume_public_enquiry_slot` | DB | [[IMPLEMENTED]] | mocked RPC only in handler tests | `ENQUIRY_RATE_LIMIT_SECRET` | | | 31a08f6 |
| Project assistant (rule-based) | `/` | `index.html` | none | [[IMPLEMENTED]] | opens (observed); replies untested | no language model | | | 31a08f6 |
| "Completed works" section | `/#works` | `index.html`, `assets/cases` | none | [[BLOCKED]] | n/a | needs Mark to validate the four projects | #12 | #26 | 31a08f6 |
| "Sample review" testimonials | `/#testimonials` | `index.html` | none | [[BROKEN]] | n/a | placeholder text visible publicly; removed by PR #8 | #12 | #8 | 31a08f6 |
| Published phone/e-mail | `/` | none | none | [[BLOCKED]] | n/a | none published; needs verified details | #12 | #26 | 31a08f6 |
| Privacy notice / terms | `/` | none | none | [[NOT IMPLEMENTED]] | n/a | needed before taking money or data at scale | | | 31a08f6 |
| robots.txt, sitemap.xml | `/robots.txt` | none | none | [[PLANNED]] | PR #8 test | in PR #8 only | | #8 | 31a08f6 |
| Security headers and CSP | all | `vercel.json` | Vercel | [[PLANNED]] | `csp.test.mjs` in PR #27 | none on main | #10 | #27, #8 | 31a08f6 |
| Self-hosted supabase-js (no CDN) | `/operations/` | `operations/vendor/` | none | [[PLANNED]] | `vendor-integrity.test.mjs` in PR #27 | main loads esm.sh | #11 | #27 | 31a08f6 |
| Build boundary and config guard | build | `build-public.mjs`, `public-config.mjs` | none | [[VERIFIED]] | `public-config.test.mjs` (6); CI steps replayed | | | | 31a08f6 |
| CI quality workflow | GitHub | `quality.yml` | Actions | [[VERIFIED]] | all steps replayed on Node 24 | PRs not targeting main skip CI | | | 31a08f6 |
| Staff sign-in (magic link) | `/operations/` | `app.js` | Supabase Auth | [[IMPLEMENTED]] | sign-in screen observed; live link not tried | redirect allow-list unverified | #16 | | 31a08f6 |
| Staff access check | `/operations/` | `staff-access.mjs` | `profiles` | [[VERIFIED]] | `staff-access.test.mjs` (3); signed-out message observed | | | #20 adds session tests | 31a08f6 |
| Demo mode | `/operations/` | `app.js startDemo` | none | [[VERIFIED]] | observed run, no config | fictional data | | | 31a08f6 |
| Today view and metrics | `/operations/` | `today-view.mjs` | DB reads | [[VERIFIED]] | `today-view.test.mjs`; demo observed | | | | 31a08f6 |
| Enquiry list and workspace | `/operations/` | `enquiry-workspace*.mjs` | `consultation_requests` | [[VERIFIED]] | `enquiry-workspace*.test.mjs` (17); demo observed | | | | 31a08f6 |
| Quote draft and status | workspace | `app.js` | `quotes` | [[IMPLEMENTED]] | transitions and tax maths verified by `workflow.test.mjs` (3) | live screens not observed | | | 31a08f6 |
| Quote/job/invoice numbers | workspace | `app.js` (browser) | unique column | [[PARTIAL]] | none | random suffix; server sequence in PR #41 | #15, #29 | #41 | 31a08f6 |
| Jobs (work orders) | workspace | `app.js` | `work_orders` | [[IMPLEMENTED]] | `business-migration.test.mjs` (static) | | | | 31a08f6 |
| Calendar and availability | `/operations/` | `calendar-records.mjs` | `appointments`, blocks | [[VERIFIED]] | `calendar-records`, `availability-list` tests (18); demo observed | | | | 31a08f6 |
| Appointments and follow-ups | workspace | `app.js` | DB | [[IMPLEMENTED]] | static migration test | no customer message sent | | | 31a08f6 |
| Invoices (draft, sent, void) | Money | `app.js` | `invoices` | [[IMPLEMENTED]] | static migration test | marking sent sends nothing | | | 31a08f6 |
| Printable invoice document | Money | `invoice-document.mjs` | `business_settings` | [[VERIFIED]] | `invoice-document.test.mjs` (5) | needs seller details | | | 31a08f6 |
| Payment recording (idempotent) | Money | `payment-idempotency.mjs` | `invoice_payments` | [[VERIFIED]] | `payment-idempotency.test.mjs` (4) | triggers block overpayment | | | 31a08f6 |
| Payment void / correction | Money | none | none | [[PLANNED]] | `payment-reversals.pglite.test.mjs` in PR #43 | no way to fix a wrong payment on main | #14 | #43 | 31a08f6 |
| Finance panel (5 figures) | Money | `project-model.mjs` | `invoice_balances` | [[PARTIAL]] | `project-model.test.mjs` | no ranges, ageing, export | #33 | | 31a08f6 |
| Business settings (seller details) | Money | `app.js` | `business_settings` | [[IMPLEMENTED]] | static migration test | owner-only write by RLS | #37 | | 31a08f6 |
| Notification centre logic | Alerts | `notification-centre.mjs` | `notification_events` | [[VERIFIED]] | `notification-centre.test.mjs` (8) | | | | 31a08f6 |
| Notification centre screen | Alerts | `notification-view.mjs` | DB | [[IMPLEMENTED]] | no test file; bell hidden in demo | | | | 31a08f6 |
| Web Push to devices | n/a | `push-new-enquiry` | Edge fn | [[IMPLEMENTED]] | handler logic `handler.test.mjs` (17); no real device run | VAPID secrets | | | 31a08f6 |
| Notification retry worker | n/a | `retry-notifications` | Edge fn + cron | [[IMPLEMENTED]] | handler tests (8) + migration tests (8) | cron script manual | | | 31a08f6 |
| Retry cap and dead letter | n/a | none | DB | [[PLANNED]] | `notification-retry-cap.draft.test.mjs` in PR #22 | unbounded retries on main | #13 | #22 | 31a08f6 |
| Activity history | Money, workspace | `activity-label.mjs` | `workflow_activity` | [[IMPLEMENTED]] | `activity-label.test.mjs` | actor shown as id | #35 | | 31a08f6 |
| PWA install, service worker | `/operations/` | `service-worker.js` | none | [[IMPLEMENTED]] | `service-worker.test.mjs` (4), badge test (5); no real install | | | | 31a08f6 |
| Financial data access control | DB | RLS `is_staff()` | Postgres | [[BROKEN]] | reproduced by baseline test in PR #23 (run now, passes) | any staff account reads money tables | #9, #28 | #23, #42 | 31a08f6 |
| Role-aware money UI | `/operations/` | `role-capabilities.mjs` | none | [[PLANNED]] | `role-gating.app.test.mjs` in PR #42 | needs PR #20 harness | #28 | #42 | 31a08f6 |
| Manager role (optional) | n/a | none | `profiles.role` | [[NOT IMPLEMENTED]] | n/a | not needed for now: Mark decided 18 Oct that both Owners (Thiago, Antonio) have identical full access; proposed row only | #9 | #23 | 31a08f6 |
| User management UI | n/a | none | none | [[NOT IMPLEMENTED]] | n/a | roles set in DB | #31 | | 31a08f6 |
| Customer entity and de-duplication | n/a | none | none | [[NOT IMPLEMENTED]] | n/a | customer = enquiry row | #32 | | 31a08f6 |
| Stripe / online payments | n/a | none | none | [[NOT IMPLEMENTED]] | `stripe-absence.test.mjs` in PR #25 | 12 owner decisions; Stripe config pending, Mark configures 19 Oct (not verified) | #18 | #25 | 31a08f6 |
| Customer e-mail / SMS | n/a | none | none | [[NOT IMPLEMENTED]] | n/a | | | | 31a08f6 |
| Browser / E2E / accessibility tests | n/a | none | none | [[NOT IMPLEMENTED]] | n/a | no Playwright/axe on main | #36 | #20 | 31a08f6 |
| Master project doc | docs | `MASTER_PROJECT.md` | none | [[PLANNED]] | `master-project.test.mjs` in PR #19 | | #17 | #19 | 31a08f6 |
:::

Rows marked [[VERIFIED]] are proven at the level of their named proof only: a unit test is not a live run, and a demo-mode observation is not a signed-in production observation.

*Evidence: every row's proof is named in its Tests column; run logs are E-37 to E-40; code locations in the other chapters' evidence lines.*
