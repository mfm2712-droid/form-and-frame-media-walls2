# 9. Testing and quality

<a id="how-this-book-is-built"></a>
## 9.0 How this book is built

Rebuild with `node scripts/master-docs/diagrams.mjs` (diagrams), `node scripts/master-docs/verify-evidence.mjs` (evidence inventory), then `node scripts/build-master-docs.mjs` (Live site and PDF). Node only, no network at build time; the PDF step needs a local Chrome or Chromium. Screenshots were captured with `puppeteer-core` against a local server and optimised to WebP; the capture scripts are in `scripts/master-docs/`.

## 9.1 Where each result comes from

| Environment | What was done for this book | Result |
|---|---|---|
| **Local (Node 24.22.0)** | Full test suite and every CI step replayed on a clean worktree of `main@31a08f6`. | **183 of 183 pass**, 0 fail, 0 skipped (E-37). |
| **Local, per Draft PR** | Each Draft PR checked out and its suite run (table below). | All pass (E-37). |
| **Preview (Vercel)** | Not touched. | **Not verified.** |
| **Production** | Not touched; no production URL, account or data was opened. | **Not verified.** |
| **Live Supabase** | Not touched. | **Not verified.** |

## 9.2 CI replay on main (Node 24)

| Step (as in `.github/workflows/quality.yml`) | Result |
|---|---|
| `node --test` over the tracked test files | exit 0: 183 tests, 183 pass |
| `node --check` over 29 listed JavaScript files | 0 failures |
| Inline script parse (`index.html`: 1 block; `operations/index.html`: 0) | exit 0 |
| Production build with no config must fail | failed as expected |
| Build with the fictional CI config | exit 0 |
| `check-public-build.mjs` | "Verified public build root: assets, index.html, operations, public-config.js" |

CI itself runs only on pushes to `main` and on pull requests that target `main`; PRs stacked on other branches do not trigger it. The last remote CI status was not read for this book.

## 9.3 Draft PR suites (run locally on Node 24)

| PR | Branch | Tests | Pass | Skipped | Notes |
|---|---|---|---|---|---|
| #8 | audit/final-production-audit-2026-10-17 | 186 | 186 | 0 | |
| #19 | frame/17-master-docs | 187 | 187 | 0 | |
| #20 | frame/16-auth-tests | 197 | 197 | 0 | |
| #22 | frame/13-notifications | 201 | 201 | 0 | 5 skipped without the optional local Postgres engine; 0 with it |
| #23 | frame/9-permissions | 200 | 200 | 0 | 11 skipped without it; 0 with it (real RLS on a throwaway local database) |
| #25 | frame/18-stripe-design | 186 | 186 | 0 | |
| #26 | frame/12-public-site-main | 189 | 189 | 0 | |
| #27 | frame/10-csp-sri-main | 193 | 193 | 0 | |
| #41 | frame/15-server-numbering | 199 | 199 | 0 | 6 skipped without the engine; 0 with it |
| #42 | frame/28-role-gating | 213 | 213 | 0 | |
| #43 | frame/14-payment-reversals | 200 | 200 | 0 | 8 skipped without the engine; 0 with it |

Passing tests in a PR say that PR's code matches its own tests. They say nothing about whether the PR is approved, merged or applied.

## 9.4 Test inventory on main

31 test files, 182 `test()` calls by static count (the runner reports 183; one test is declared in a way the counter misses).

| Area | Files (tests) |
|---|---|
| Staff app logic | activity-label (3), assignment (5), availability-list (14), business-records (4), calendar-records (4), datetime-local (2), enquiry-workspace-view (7), enquiry-workspace (10), invoice-document (5), mutation-result (2), notification-badge (5), notification-centre (8), payment-idempotency (4), pipeline (2), project-model (2), push-support (4), push-target (3), quote-readiness (4), service-worker (4), staff-access (3), today-view (2), workflow (3) |
| Build | scripts/public-config (6) |
| Database (static migration reading) | business-migration (9), config (3), notification-centre-migration (4), notification-retry (8) |
| Edge Functions (handler logic with mocks) | submit-enquiry (27), push-new-enquiry (17), retry-notifications (8) |

## 9.5 Gaps

- No test runs the public page in a browser, drives the staff app against a database, or exercises Supabase Auth, RLS, Edge Functions on Deno, or a real push or e-mail delivery.
- The migration tests read SQL text; the only real-database RLS tests are in Draft PRs #22, #23, #41, #43.
- No accessibility, performance or visual regression tests. This book's headless screenshots are observations, not a test suite.
- No coverage measurement is configured.

*Evidence: E-22, E-37 to E-40, E-56.*
