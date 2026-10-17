# Form & Frame Master Book

**Version 1.0.0 (draft for owner review) · 18 October 2026 · prepared by FRAME (Grok Bot) for Mark Ferrer Marquez**

::: note
**Commit analysed: `31a08f6ee1fa507d4f78c30ede78c4b1fda746a4`** (`origin/main`, "Fix Android status-bar icon: immediate worker takeover, monochrome manifest icons, verified FF badge", 16 Oct 2026). Repository: `mfm2712-droid/form-and-frame-media-walls2`. Tracking issue: **#44**. Everything in this book describes that commit. Work that exists only in open Draft PRs is labelled as such and is never described as part of the product today.
:::

## What this is

The Master Book is the single, evidence-based description of the Form & Frame platform: the public website, the staff **Owner Desk** (`/operations/`), the Supabase backend, the security posture, the tests, and what is still missing. It is written from the code, and every factual claim points to a row in the [Evidence Inventory](EVIDENCE_INVENTORY.md) (file and line, or the command that was run).

It has three renderings of the same source (`docs/master/*.md`):

| Rendering | File | Use |
|---|---|---|
| Editable source | `docs/master/*.md`, `docs/master/assets/` | Edit here. Update when routes, features or architecture change. |
| Book (PDF) | `FORM_AND_FRAME_MASTER_BOOK.pdf` | Print / hand-over. |
| Live Master (static HTML) | `docs/master/live/` (`FORM_AND_FRAME_LIVE_MASTER`) | Side menu, client-side search, zoomable images. **Internal only: see [Hosting the Live Master](#hosting-the-live-master).** |

## How to read the status labels

Only these seven statuses are used for features. Implemented is not the same as verified.

| Status | Meaning in this book |
|---|---|
| [[IMPLEMENTED]] | Code for it exists on `main`. No test or observed run proves that it works. |
| [[VERIFIED]] | Implemented **and** proven by a named automated test, or by a run observed while writing this book (named in the row). |
| [[PARTIAL]] | Part of the capability exists on `main`; the missing part is stated. |
| [[BROKEN]] | Observed or proven to behave wrongly, or a confirmed gap with a known bad effect. |
| [[PLANNED]] | Not on `main`. May have a design or code in an open Draft PR (named) but it is not part of the product today. |
| [[NOT IMPLEMENTED]] | No code anywhere; may be wished for or absent by design. |
| [[BLOCKED]] | Cannot proceed until an owner decision or an external action. |

Other conventions: **DEMO MODE** screenshots use the staff app's built-in fictional data and are captioned as such. A screen that needs a real sign-in or live Supabase data is marked **not verifiable** and is never mocked. "Pending Mark" marks content or facts only the owner can confirm.

## Chapters

1. [Identity and design system](design-system.md): colours, fonts, components, responsive rules, from the CSS.
2. [Platform map and architecture](architecture.md): how the pieces connect, page by page.
3. [Public website](website.md): every section, with screenshots and placeholders flagged.
4. [Owner Dashboard](owner-dashboard.md): every implemented module.
5. [Backend](backend.md), [Database](database.md), [Integrations](integrations.md): functions, tables, third parties, Stripe (absent).
6. [Journeys](journeys.md): customer, owner, staff, with broken steps marked.
7. [Feature matrix](feature-matrix.md): feature, route, component, backend, status, tests, dependencies, issue, PR, version.
8. [Security](security.md): roles, financial access, RLS, sessions, secrets handling, CSP, pending findings.
9. [Testing and quality](testing.md): what was run, local vs Preview vs production.
10. [Roadmap](roadmap.md): P0 to P3 linked to issues and PRs.
11. [Pending confirmation](pending-confirmation.md), [Coverage summary](coverage.md), [Evidence inventory](EVIDENCE_INVENTORY.md), [Changelog](changelog.md).

## Draft PRs that are not part of `main`

Open Draft PRs at the time of writing (state read from GitHub on 18 Oct 2026): #19 master project doc, #20 auth tests, #22 notification retry cap draft, #23 permission matrix and RLS draft, #25 Stripe design, #26 public site unpublish-unvalidated-works, #27 self-hosted supabase-js and CSP report-only, #41 server-side numbering draft, #42 role-aware money UI, #43 payment reversals draft; plus PR #8 (ready for review, not a draft; audit fixes) and PR #1 (draft, older Today/push fixes). **None of these is merged. This book does not merge, deploy or apply anything.** The roadmap chapter lists what each one adds.

**Baseline statement: this book describes `main` at `31a08f6` and nothing else.** If the PRs below merge, these parts of the book would change (sections affected, from each PR's stated scope; re-check against the diff at merge time):

| PR | Would change in this book |
|---|---|
| #8 (audit fixes) | Removes the sample testimonials (feature matrix row currently BROKEN; section 3.6); test counts in chapter 9 (183 on main, 186 on the branch). |
| #19 | Adds `docs/MASTER_PROJECT.md`; no behavioural change. |
| #20 | Auth tests: chapter 9 test inventory; auth rows in the feature matrix could move towards VERIFIED. |
| #22 | Notification retry cap: backend notification delivery, database, and the matrix row on retries. |
| #23 | Permission matrix and RLS draft: chapters 5b (RLS today) and 8 (roles, financial access, pending weaknesses). Not safe to apply before the app change in #42. |
| #25 | Stripe design only: chapter 5c (Stripe stays PLANNED, no code). |
| #26 | Public site: unpublishes "Completed works" and changes some copy: sections 3.5, 3.9, 3.11 and screenshots. |
| #27 | Self-hosted supabase-js and CSP report-only: section 8.6 and the public build description. |
| #41 | Server-side document numbering: invoices (M8), database, matrix. |
| #42 | Role-aware money UI (stacked on #20): M10 Money panel, M14 Roles and access. |
| #43 | Payment reversals: M9 Payments, database. |
| #1 (older draft) | Today and push fixes: M1 and M12. |

Owner decision recorded 18 Oct 2026: Thiago and Antonio both hold the Owner role with identical permissions; no Manager role for now. Stripe, production domain and business email are configured on 19 Oct 2026 and are not in this book as done.

## Hosting the Live Master

The Live Master contains internal architecture, security findings and product decisions. It is **not hosted anywhere** and must not be published on an open URL. It is delivered as a static build in `docs/master/live/`. To use it:

1. Preferred: serve it only behind authentication, for example a Vercel project with Vercel Authentication / password protection enabled, a Cloudflare Access application, or an internal web server behind SSO or HTTP basic auth.
2. Local only: open `docs/master/live/index.html` from disk, or run `npx serve docs/master/live`. It makes no network requests.
3. Never place it inside `dist/public` or in the public site's Vercel project: `scripts/build-public.mjs` copies only an explicit allow-list of files, and `docs/` is not on it (see Evidence E-21), so the Live Master stays out of the public build unless someone changes that script.

## Rebuilding

```sh
# Node 24, Google Chrome (for the PDF only). No network is used.
node scripts/master-docs/diagrams.mjs      # regenerates assets/diagrams/*.svg
node scripts/build-master-docs.mjs         # builds the Live Master + the PDF + the evidence inventory
```

Details, options and the screenshot-capture procedure are in [testing.md](testing.md#how-this-book-is-built).

## What this book does not claim

It does not claim anything about the production Supabase project, the Vercel dashboard or the live site beyond what the repository proves. The [pending-confirmation](pending-confirmation.md) chapter lists everything that could not be verified.
