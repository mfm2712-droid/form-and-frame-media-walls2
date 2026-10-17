# 8. Security

Scope: what the code on `main` (`31a08f6`) enforces, what it does not, and what Draft PRs propose. Nothing here was tested against production or against a real Supabase project, and no penetration testing was done. Pending weaknesses are described at the level of the missing control, with no steps to exploit them.

## 8.1 Summary

| Area | State on main | Evidence | Status |
|---|---|---|---|
| Who can sign in | Supabase Auth, e-mail magic link; the app then needs a `profiles` row with role `owner` or `staff`. | E-32 | [[IMPLEMENTED]] |
| Anonymous access to data | Tables have RLS; anonymous users have no policies, intake goes through a service-role Edge Function. | E-33 | [[IMPLEMENTED]] |
| Separation of money from general staff | **None.** One helper, `is_staff()`, gates almost every policy. | E-34 | [[BROKEN]] (P0 #9, #28) |
| Owner-only writes | `business_settings` only. | E-34 | [[IMPLEMENTED]] |
| Hard deletes of quotes, jobs, invoices, payments | Not allowed through the API (no delete policies). | E-34 | [[IMPLEMENTED]] |
| Overpayment, status skips, edits of accepted quotes and sent invoices | Blocked by database triggers. | E-35 | [[IMPLEMENTED]] |
| Content-Security-Policy and security headers | None configured on `main`. | E-23, E-24 | [[PLANNED]] (#10, PR #27, PR #8) |
| Third-party script integrity | `supabase-js` is imported from esm.sh at an exact version (2.117.2) but without an integrity check. | E-24 | [[PLANNED]] (#11, PR #27) |
| Webhooks | None exist, so none to sign. | E-36 | [[NOT IMPLEMENTED]] |
| Secret handling | Server secrets live in Supabase; the public build never reads them and refuses unsafe config. | E-19, E-21 | [[VERIFIED]] (`public-config.test.mjs`, build guard run) |

## 8.2 Roles and the current permission model

`profiles.role` accepts `owner` and `staff`. The helper `is_staff()` is true for both. Policies for customer enquiries, uploads, availability, appointments, follow-ups, quotes, jobs (including agreed total and actual cost), invoices, payments and the activity log all use it. Only writes to `business_settings` require `owner`.

**Consequence:** there is effectively one role for everything except invoice seller settings. Hiding buttons in the interface is not a control; the database permits the reads and writes (see the demo-mode screenshots: the money tab is simply visible to a staff user).

### Current versus proposed

The proposal is Draft PR #23 (`PERMISSION_MATRIX.md`) with the UI changes in PR #42. **Nothing is applied.** The migration sits outside `supabase/migrations/` on purpose, and PR #23 states it must not be applied before PR #42 ships, otherwise the app would show errors to staff.

::: matrix
| Object | Owner now | Staff now | Owner proposed | Manager (optional, not needed for now) | Staff proposed |
|---|---|---|---|---|---|
| Customer details (enquiries) | S I U | S I U | S I U | S I U | S I U (decision A) |
| Uploads, availability blocks | S I U D | S I U D | S I U D | S I U D | S I U D |
| Appointments, follow-ups | S I U | S I U | S I U | S I U | S I U |
| Quotes | S I U | S I U | S I U | S I U | none |
| Jobs with agreed total and actual cost | S I U | S I U | S I U | S I U (not actual cost) | none (money-free view) |
| Invoices | S I U | S I U | S I U | S I U drafts only | none |
| Payments | S I | S I | S I | S | none |
| Business settings | S I U | S | S I U | S | none |
| Activity log | S | S | S | S | S (no money rows) |
| Notifications, push, preferences | own rows, team outbox | own rows, team outbox | unchanged | unchanged | unchanged |
| Delete quotes, jobs, invoices, payments | none | none | none | none | none |
:::

S select, I insert, U update, D delete. The "now" columns are read from the migrations; the "proposed" columns are copied from PR #23 and are a proposal only. The Manager column is kept only as an optional, proposed row: **Mark decided on 18 October 2026 that Thiago and Antonio both hold the Owner role with identical permissions and full Owner Dashboard access, and that no Manager role is needed for now.** That is a decision, not something seen in the code or the live database: which accounts actually hold `owner` in Supabase is **not verified**. Remaining open decisions: A (may staff see customer phone and e-mail), C (who may send or void invoices and record payments; with two equal Owners this is now an Owner-only question), D (may staff update job status). Decision B is closed (no Manager).

## 8.3 Authentication and sessions

- Sign-in is a Supabase magic link sent to the e-mail the user types (`signInWithOtp`, `shouldCreateUser:false`, redirect back to the current page, `app.js:561`), so the form itself does not create new accounts; the server-side sign-up setting is not verified. Sessions are held by `supabase-js` in the browser (default local storage, persisted).
- The access check rejects a signed-in account without a profile (message shown, no data loaded). Unit-tested (`staff-access.test.mjs`) and the signed-out screen was observed.
- **Not verified:** the Supabase redirect allow-list and site URL that make the magic link land on `/operations/` (#16); session expiry settings; whether sign-ups are disabled in the Supabase project; password or multi-factor options. These are dashboard settings and not in the repository.
- There is no sign-out-everywhere or inactivity timeout in the code.

## 8.4 Client (customer) data protection

- Customer personal data (name, phone, e-mail, postcode, project brief, visit window) is stored in `consultation_requests`. Anonymous visitors cannot read it; staff can.
- Uploaded photos would be private in the `project-uploads` bucket with 10-minute signed links; no code on `main` writes uploads (see Backend).
- There is no privacy notice or retention rule on the site (NOT IMPLEMENTED), no export or erase tool, and no data-processing record in the repository. Whether these are legally required is not assessed here.
- The notification e-mail to the internal address contains the enquiry summary. Delivery needs the Resend API key and sender names listed in Backend.
- This book's screenshots contain only the demo-mode fictional records and the public site; no production data was read.

## 8.5 Secrets handling (names only)

Server-side secret **names** are listed in the Backend chapter (for example `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ENQUIRY_RATE_LIMIT_SECRET`, the VAPID key pair). Values live in Supabase function secrets and Vault and were never opened for this book; no `.env` file was read. The browser receives only the project URL and the public publishable key through a generated `public-config.js`. The build refuses a service-role key or a production build without config (verified by `public-config.test.mjs` and by running the guard in CI order).

## 8.6 Content-Security-Policy, headers, dependencies

- **CSP / headers:** none on `main`. PR #27 adds a Report-Only CSP with tests; PR #8 adds headers and `robots.txt`. Neither is merged.
- **Dependencies:** the repository has no `package.json` and no lockfile, so there is no npm audit surface. Runtime dependencies are `supabase-js` (esm.sh), Google Fonts (CSS and font files), and Deno-side imports in the Edge Functions. A dependency vulnerability scan was **not run** (no paid or networked scanners).
- **Service worker:** registered with scope `./` (the `/operations/` folder); tested for its caching rules (`service-worker.test.mjs`).

## 8.7 Webhooks

There are no inbound webhooks (the only trace of the word is a `webhook` value allowed in the `notification_events.channel` check; no code uses it). When Stripe is built, signature verification and idempotent event handling are required; the design is in PR #25 (documentation only).

## 8.8 Pending weaknesses (no exploit detail)

| # | Weakness | Priority | Issue | PR |
|---|---|---|---|---|
| 1 | Money and customer data are available to every signed-in staff account; the UI does not hide it either. | P0 | #9, #28 | #23, #42 |
| 2 | Quote, job and invoice numbers are generated in the browser. | P0 | #15, #29 | #41 |
| 3 | No CSP or security headers. | P1 | #10 | #27, #8 |
| 4 | Third-party script loaded without integrity check. | P1 | #11 | #27 |
| 5 | Notification retries have no upper limit. | P1 | #13 | #22 |
| 6 | A wrongly recorded payment cannot be corrected; only an out-of-band database edit would do. | P1 | #14 | #43 |
| 7 | Magic-link redirect configuration unverified. | P1 | #16 | |
| 8 | No automated browser-level tests for sign-in or role gating. | P1 | #20, #36 | #20 |
| 9 | Unvalidated public claims (completed works, testimonials) could mislead customers. | P1 | #12 | #26, #8 |

*Evidence: E-11, E-12, E-19, E-21, E-23, E-24, E-32 to E-36.*

## 8.9 Payments and domain configuration (pending)

Stripe configuration, the production domain and a professional business e-mail address are being configured by Mark on 19 October 2026. Until then they are **pending, configured by Mark on 19 Oct (not verified)**: no keys, domain names, addresses or webhook endpoints are recorded in this book, and none were checked. When they exist, CSP, webhook signature verification, the magic-link redirect allow-list (#16) and the e-mail sender settings must be re-checked against them.
