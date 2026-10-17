# 11. Pending confirmation and not verified

## 11.1 Needs Mark (owner decisions and content)

| # | Item | Why it is pending | Where |
|---|---|---|---|
| 1 | Real phone number and e-mail for the public site | None are published; nothing may be invented. | website.md, #12 |
| 2 | "Completed works": are the four projects real, and are the photos and descriptions Form & Frame's own? | Content is on `main` but unvalidated. | website.md, #12, PR #26 |
| 3 | Testimonials ("sample review" text) | Placeholder wording visible on the public page. Remove or replace with real reviews. | website.md, PR #8 |
| 4 | Business claims in the code: address "Unit 4, Buckingham Ave, Slough SL1", "5-7 days typical completion", "signed off before build", "One Slough workshop", postcode coverage, "free measured survey", "within one working day", the price guide and the "£££" price-range metadata | Nothing in the repository proves them. | website.md |
| 5 | Which public address is the real one (a `*.vercel.app` name appears in the metadata) | Not confirmed. | website.md |
| 6 | Permission decisions A, C, D (staff seeing customer contact details; who sends or voids invoices and records payments; staff job status updates). **Decided 18 Oct: Thiago and Antonio both hold Owner with identical permissions; no Manager role for now (decision B closed).** | Needed before PR #23 can be finalised. | security.md |
| 7 | Stripe: the 12 commercial decisions and the Stripe configuration | **Pending, configured by Mark on 19 Oct (not verified).** Design only; no values recorded. | integrations.md, PR #25 |
| 7b | Production domain and professional business e-mail | **Pending, configured by Mark on 19 Oct (not verified).** No domain or address is recorded; the public site still shows no contact e-mail. | website.md, #12 |
| 8 | Whether to publish a privacy notice and terms | Nothing exists. | security.md |
| 9 | Merge order of the Draft PRs and PR #8 | Owner decision. | roadmap.md |

## 11.2 Could not be verified in this work

| Item | Reason |
|---|---|
| Production or Preview behaviour (live site, Vercel settings, environment variable values, deployments) | Not accessed, by instruction. |
| Live Supabase project: applied migrations, RLS as deployed, Auth settings and redirect allow-list, sign-up setting, Edge Function secrets, cron jobs, Storage buckets | Not accessed; the repository is the only source. |
| Signed-in staff screens (quotes, jobs, invoices, payments, settings, notification centre, activity history) | Need real login and data; shown as *not verifiable*, never mocked. |
| Real e-mail (Resend) and Web Push delivery | Needs live secrets and devices. |
| Edge Functions running on Deno | Tests use Node with mocks. |
| Remote CI status of `main` and PRs | Not read; CI was replayed locally instead. |
| Dependency vulnerability scan | No networked scanners were used. |
| Accessibility, performance and cross-browser behaviour | Only headless Chrome (155) was used. |
| External links | Checked only where reachable from this machine; failures are in the quality report. |

## 11.3 Observations to confirm

- Money screens visible to every staff account: see security.md. Needs a decision, not just a fix.
- `#desk` is not an anchor in the staff page although some copy points to it.
- Notification retries are unbounded on `main` (#13).
- The count of 182 test declarations versus 183 reported tests is a counting difference only.
