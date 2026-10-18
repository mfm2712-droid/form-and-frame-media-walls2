# Form & Frame Media Walls: final production-readiness audit

## 1. Executive summary

The public website and the staff Operations app are in good technical shape. All 183 existing tests passed before any change, and the production build boundary is strict and tested. The enquiry backend is carefully built: origin allow-list, body limit, honeypot, rate limiting by hashed address, idempotency keys, and tracked notifications. In my browser simulations an enquiry was never silently lost.

The audit found one HIGH content issue, three MEDIUM issues and several LOW issues. All of the fixable ones are fixed on the branch `audit/final-production-audit-2026-10-17`. Nothing was pushed, merged or deployed.

Two things could not be verified from this environment and need Mark:

1. The four "Completed works" before/after cases are presented as finished projects. I cannot confirm that they are real jobs with real photos. See finding H-2.
2. The live Vercel deployment, live HTTP headers, and the signed-in staff app could not be reached. See section 19.

**Final decision: READY WITH MINOR ISSUES.** See section 20 for the conditions.

## 2. Repository and branch audited

- Repository: `mfm2712-droid/form-and-frame-media-walls2` (public).
- Production branch: `main`. Vercel project `form-and-frame` is connected to it (stated in `OPERATIONS_HUB.md`; the Vercel project exists, but its deployment list returned 403, so deployment status is not verified).
- Audit branch with fixes: `audit/final-production-audit-2026-10-17`, one commit on top of `main`.

## 3. Commit SHA

Base audited: `31a08f6ee1fa507d4f78c30ede78c4b1fda746a4` (2026-10-16, "Fix Android status-bar icon…"). The clone was shallow (depth 1), so older history was not inspected.

## 4. Audit date

2026-10-17.

## 5. Technology stack

- Public site: one static `index.html` (about 179 KB, one inline script block, no framework, no npm dependencies, no `package.json`).
- Staff app: static ES-module PWA in `operations/` (no build step). It loads `@supabase/supabase-js@2.117.2` at runtime from `esm.sh`.
- Backend: Supabase (project ref pinned to `otqzhocismdjbvvsjnpe`): 10 SQL migrations, three Edge Functions (`submit-enquiry`, `push-new-enquiry`, `retry-notifications`), Resend for email, Web Push.
- Hosting: Vercel (`vercel.json`, build `node scripts/build-public.mjs`, output `dist/public`). A GitHub Pages deployment also exists (workflow `pages-build-deployment` ran on every push).
- CI: `.github/workflows/quality.yml` on Node 24. Last run on the audited SHA: success (read through the GitHub API).
- Local audit used Node 22.22.0 and Chromium (Playwright 1.56).

## 6. Page and route inventory

| Route | Source | Purpose | Indexed |
|---|---|---|---|
| `/` | `index.html` | Public site: drawing, survey, configurator, process, works, enquiry form | Yes |
| `/operations/` | `operations/index.html` | Staff sign-in and Operations app (Supabase Auth + RLS) | No (added by this audit) |
| `/robots.txt`, `/sitemap.xml` | new | Search files | n/a |
| Not published (correctly) | `anthony-roadmap.html`, `owner-desk-approval-preview.html`, `docs/`, `supabase/` | Internal | n/a |

Public page sections: A-01 drawing, A-02 survey, A-03 specify (configurator), A-04 process, A-05 works, A-06 request a survey (was A-07). The A-06 "client feedback" plate was removed (H-1).

## 7. Functional test results

Run against the built site in a local browser with the enquiry endpoint intercepted. No real request reached Supabase and no real enquiry was created.

| Check | Result |
|---|---|
| Navigation anchors `#drawing #survey #specify #works #request` resolve | PASS |
| `#top` anchor | PASS (empty marker div by design; my first script flagged it wrongly) |
| Mobile menu opens, sets `aria-expanded`, closes with Escape and on link click | PASS |
| Empty submit shows 4 validation errors, sends nothing, focuses first invalid field | PASS |
| Success response shows the reference | PASS |
| Payload carries idempotency key and required fields; honeypot empty | PASS |
| HTTP 429 shows a wait message and keeps the form | PASS |
| HTTP 500 shows an error and keeps the form | PASS |
| Retry after failure reuses the same idempotency key (no duplicates) | PASS |
| Offline / network failure keeps the form | PASS (message fixed, see L-3) |
| HTTP 201 without a reference is not shown as success | PASS |
| Configurator controls, chat assistant, share and copy actions | NOT TESTED (only loaded and checked for console errors; no page errors) |
| Staff app after sign-in (pipeline, calendar, quotes, invoices, push) | NOT TESTED (no staff session) |
| Real email delivery, real push delivery | NOT TESTED (no credentials, and test data must not reach customers) |

Interactive element inventory (public page): 1 nav toggle, 5 nav links, staff link, 2 hero buttons, configurator controls (chips, selects, number inputs, photo upload), preview-width switch, chat launcher and panel, 2 share dialogs, enquiry form (5 inputs, 1 select, 1 textarea, honeypot, submit). The form and navigation are evidenced above; the rest are NOT TESTED beyond load.

## 8. Visual audit findings

Viewports 375, 390, 430, 768, 1024, 1440, 1920: no horizontal overflow at any width (PASS), exactly one `h1` at each width. Screenshots at 375 and 1440 reviewed before and after the changes; the layout is intact and the removal of the reviews plate leaves no gap. Brand identity was preserved.

Limits: web fonts could not load in this sandbox, so the screenshots use fallback fonts. Tablet and large-desktop screenshots were measured for overflow but not inspected by eye.

## 9. Security findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| S-1 | MEDIUM | No security headers in `vercel.json` | Fixed (nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy) |
| S-2 | MEDIUM | Staff app imports `supabase-js` from `esm.sh` without Subresource Integrity (version is pinned). A compromise of that host would run code in the staff app | Open, recommendation below |
| S-3 | LOW | No Content-Security-Policy | Open, recommendation below |
| S-4 | LOW | Saved configurator state from `localStorage` is copied into state without per-field validation; only self-affecting, output is escaped | Open |

Passed checks:

- No secrets found in the tracked files (pattern scan for JWTs, `sk_`, Resend keys, private keys, tokens). Only the public anon key pattern is built by the build script, and the build check forbids server secrets in the staff config. Git history beyond the shallow clone was not scanned.
- Edge Function `submit-enquiry`: origin allow-list, 32 KB body limit, strict validation, honeypot, HMAC-hashed client address for rate limiting, 10 per hour, idempotency, escaped HTML in the notification email. PASS by code review and the existing test suite.
- Staff app output escaping: customer-supplied fields (name, message, email, phone, postcode) go through `esc()` before `innerHTML` in every place I traced. This is a static review of the interpolations, not a runtime proof. NOT TESTED signed-in.
- Dependency vulnerabilities: NOT APPLICABLE for npm (no `package.json`); the one runtime dependency was not audited against an advisory database.

Recommendations (not applied because they cannot be tested without a staff session):

- Self-host `supabase-js` (or add an SRI hash) so the staff app does not run third-party code at load.
- Add a CSP, tested against a signed-in staff session. It needs `script-src` for the inline block (use a hash), `https://esm.sh` until self-hosted, `connect-src` for `https://otqzhocismdjbvvsjnpe.supabase.co` and its websocket, and `style-src`/`font-src` for Google Fonts.

No credentials were rotated.

## 10. Performance measurements

Lab only (local server, no network latency, web fonts blocked), so these are optimistic and are not real-user data. No real-user field data (CrUX) was available.

| Profile | LCP | CLS | Load | Requests | Transfer |
|---|---|---|---|---|---|
| Desktop 1440 | 280 ms | 0 | 169 ms | 11 | 63 KB |
| Mobile 390, CPU x4 | 528 ms | 0.0018 | 942 ms | 11 | 63 KB |

Targets LCP 2.5 s, CLS 0.1: met in the lab. INP: NOT TESTED (needs real interaction data). `index.html` is 179 KB (47 KB gzipped); the case images total about 425 KB as WebP. Google Fonts use `display=swap`. Real-world LCP will include font and network time and should be checked on the live site.

## 11. SEO findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| E-1 | MEDIUM | Canonical, Open Graph image and structured-data URL pointed to the GitHub Pages copy, not the Vercel production site | Fixed (now `https://form-and-frame.vercel.app/`) |
| E-2 | MEDIUM | No `robots.txt` or `sitemap.xml` | Fixed |
| E-3 | MEDIUM | Staff app had no `noindex` | Fixed (meta tag and `X-Robots-Tag` header) |
| E-4 | LOW | GitHub Pages still publishes a second copy of the site | Open: consider disabling Pages |
| E-5 | LOW | Structured data has no phone or email; the page itself shows no telephone or email at all | Open: owner must supply real contact details |

Passed: one `h1`, heading order, `lang="en-GB"`, title and meta description describe the business accurately, no images without `alt`. Structured data uses only details that appear on the page (name, address, areas served). Assumption to confirm: that `form-and-frame.vercel.app` is the intended public address. If a custom domain is coming, the canonical, sitemap and `robots.txt` must change with it (the build check enforces the current address).

## 12. Accessibility findings

axe-core 4.10.2, WCAG 2.0/2.1/2.2 A and AA plus best practice, at 390 and 1440 px.

| Item | Before | After |
|---|---|---|
| No `main` landmark | moderate | Fixed (`<main id="main">`) |
| Scrollable "Schedule of works" not keyboard reachable (mobile) | serious | Fixed (`tabindex="0"`, labelled region) |
| Staff login email field and two availability date fields without an accessible name | found by script | Fixed (`aria-label`) |
| Low contrast on staff-app eyebrow text (about 2.4:1) | serious | Fixed (about 5.3:1) |
| Staff link and a few controls under 24 px target size | found | Fixed (min-height 24 px) |
| `.titlestrip` outside any landmark | moderate (best practice) | Open, LOW |

Result after fixes: public page 1 moderate best-practice item; staff login shell 0 violations. Keyboard: all 14 tab stops showed a visible 2 px outline; mobile menu works with the keyboard; `prefers-reduced-motion` rules exist. Screen reader testing: NOT TESTED. Signed-in staff screens: NOT TESTED. The staff link text is 8 px on phones (LOW, legibility).

## 13. Integration test results

| Integration | Result |
|---|---|
| Enquiry function contract (validation, idempotency, rate limit, notifications, retries) | PASS in the existing offline suite (183 tests before, 186 after) |
| Browser to function request/response handling | PASS (simulated) |
| Supabase live database, RLS, auth | NOT TESTED |
| Resend email, Web Push | NOT TESTED |
| Vercel deployment and environment variables | NOT TESTED (403 on deployments) |
| GitHub Actions on the audited SHA | PASS (success) |

## 14. Bugs discovered

| ID | Severity | Item |
|---|---|---|
| H-1 | HIGH | Four five-star "Sample review" testimonials displayed as client feedback |
| H-2 | HIGH (unverified) | "Completed works" presents four named before/after projects; authenticity not confirmable |
| S-1, E-1, E-2, E-3 | MEDIUM | Headers, canonical, search files, staff noindex |
| A-1 | MEDIUM | Keyboard-inaccessible scroll region, missing `main`, unlabeled fields, low contrast |
| L-1 | LOW | Small touch targets |
| L-2 | LOW | CI skipped four modules in its syntax check |
| L-3 | LOW | Offline error showed the browser's raw "Failed to fetch" |

## 15. Bugs fixed

- H-1: removed the testimonials plate and its CSS, renumbered the contact plate to A-06 and "7 plates" to "6 plates". Root cause: placeholder marketing content shipped to production. Presenting invented reviews as feedback risks breaching UK consumer law on fake reviews. Reversible with `git revert`; verified by build check and screenshots.
- S-1, E-1, E-2, E-3, A-1, L-1, L-2, L-3 as described above, with regression tests (`scripts/vercel-config.test.mjs`, extra assertions in `scripts/check-public-build.mjs`).

## 16. Remaining issues

1. H-2: owner must confirm the four completed works are real (or relabel them as illustrative).
2. S-2 and S-3: self-host or pin with SRI, and add a CSP after signed-in testing.
3. E-4: decide whether to turn off the GitHub Pages copy.
4. E-5: add real phone and email to the page and structured data. The page currently shows no direct contact method, only the form.
5. `.titlestrip` landmark and 8 px staff link on phones (LOW).
6. Configurator, chat assistant and the signed-in staff app were not exercised.

## 17. Test execution evidence

- `TZ=Europe/London node --test`: 183 pass, 0 fail before changes; 186 pass, 0 fail after.
- `node --check` on every `.js`/`.mjs` file, Edge Function handlers and `.ts` entry points: no errors.
- `node scripts/check-inline-scripts.mjs`: parsed 1 inline block in `index.html`.
- `git diff --check`: clean.
- Browser audits (Playwright, axe-core): overflow at 7 widths, 11 of 11 form behaviours PASS, keyboard and menu PASS.

## 18. Build results

- Production build with fictional but valid-shaped public configuration: succeeds, and `check-public-build.mjs` passes with the new root files.
- Production build without Supabase configuration: fails as required.
- The build output is in the git-ignored `dist/` and was not committed.

## 19. Deployment readiness

- Not deployed, not pushed.
- Checked: build command and output directory unchanged, CI green on the audited SHA, headers and search files are included in the build.
- Not verified: Vercel production environment variables and last deployment (403), live response headers, HTTPS and redirects (the live site was unreachable from this environment), rollback (Vercel keeps previous deployments, not confirmed here), database migration state (`docs/MASTER_DOCUMENTATION.html` says the latest migration, `20261016120000_notification_centre_and_preferences.sql`, must be applied by hand; whether it is applied in Supabase is NOT verified).

## 20. Final recommendation

**READY WITH MINOR ISSUES.**

I did not declare READY FOR PRODUCTION because essential functionality was not tested (the signed-in staff app and live services) and H-2 is unconfirmed. There are no known CRITICAL issues, the production build passes and the customer enquiry path behaved correctly in every simulated failure. Before release: confirm H-2, merge the audit branch after review, then check the live site headers, the canonical URL and one real test enquiry that Mark authorises.
