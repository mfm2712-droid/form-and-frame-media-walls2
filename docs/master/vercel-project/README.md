# Separate Vercel project for the Form & Frame Master (private docs)

**Status: nothing here has been deployed.** This folder only prepares configuration. Creating the project and switching on protection are steps for Mark (or someone he delegates) in the Vercel dashboard.

The Master Book and Live Master contain internal architecture, security findings and product decisions. They must **never** be served from the public site's project (`form-and-frame`), only from a **separate** project that sits behind Vercel Authentication.

## What this folder contains

| File | Purpose |
|---|---|
| `vercel.json` | Static project: output `public/`, no build, no rewrites or redirects, `X-Robots-Tag: noindex...`, security headers, `Cache-Control: private, no-store`. |
| `build-static.sh` | Copies `docs/master/live/` + `FORM_AND_FRAME_MASTER_BOOK.pdf` into `public/` (git-ignored) and adds a `robots.txt` that disallows everything. |
| `SIGNED_OUT_TEST_PLAN.md` | What to test after deploying, signed out. |
| `../../../scripts/master-docs/check-private.sh` | Runs those checks against a base URL. |

## Steps for Mark (dashboard, about 10 minutes)

Regenerate first if sources changed: `node scripts/build-master-docs.mjs` (Node 24), then:

1. `bash docs/master/vercel-project/build-static.sh` creates `docs/master/vercel-project/public/`.
2. In Vercel: **Add New... > Project**. Import the GitHub repo `mfm2712-droid/form-and-frame-media-walls2` as a **new, separate** project. Name it for example `form-and-frame-master-docs` (not the name of the public project).
3. Project settings, **Build and Output Settings**: set **Root Directory** to `docs/master/vercel-project`. Framework Preset **Other**. Leave Build Command and Install Command empty; Output Directory `public`. Because `public/` is git-ignored, either (a) remove `public/` from `.gitignore` and commit the assembled output after running `build-static.sh` (simplest, nothing runs on Vercel), or (b) set Build Command to `bash build-static.sh` and Output Directory `public` (Vercel runs it from the root directory; it needs the `docs/master` tree, so enable "Include source files outside of the Root Directory" in the project settings, which is on by default). Option (a) is the safer default.
4. Before the first deploy completes, open **Settings > Deployment Protection**:
   - Enable **Vercel Authentication**.
   - Set its scope to **All Deployments** (this includes the production deployment and its static assets, so the PDF and images are covered, not just previews). The default "Standard Protection" covers all except production domains, so check production explicitly.
   - Do **not** enable Password Protection, Trusted IPs or other add-ons: those are paid features on some plans and were not approved. Do not add a Protection Bypass for Automation, and do not share any "shareable link".
5. Settings > Git: leave production branch as is, but turn **off** preview comments if you do not want PR noise; only the signed-in Vercel account owner can open any deployment.
6. Deploy, then run the signed-out checks: `bash scripts/master-docs/check-private.sh https://<your-docs-project>.vercel.app` (see `SIGNED_OUT_TEST_PLAN.md`). Expect HTTP 401 or a 3xx redirect to `vercel.com/login` for every path. If any path returns 200 with content, **turn the deployment off** and fix protection before sharing the URL.
7. Open it signed in as the Vercel account owner (Hobby). Other readers receive the PDF or the `live/` folder by a private channel.

## Plan: Hobby (confirmed by Mark, 18 Oct 2026) and what that means

- Mark's account is on the **Hobby** plan. On the Deployment Protection page, **Vercel Authentication is selectable** (scope **All Deployments**) and **Password Protection is locked** (paid). So this setup uses Vercel Authentication only. Do not click any "Upgrade" prompt.
- **Hobby is for personal, non-commercial use under Vercel's terms.** These are internal company documents of a business (Form & Frame Ltd). **Mark must decide and accept** whether using Hobby for this project is acceptable to him; this repository cannot decide that and I have not verified Vercel's current terms for his case. If he does not accept it, the alternatives that cost nothing are the local/static bundle (`docs/master/live/` from disk or `npx serve docs/master/live`, plus the PDF) or sharing the files inside the team only.
- Vercel Authentication on Hobby lets only the **account owner (Mark)** open the deployments (Hobby has a single seat; it is not a team-sharing feature). Anyone else (Thiago, Antonio) cannot be invited on Hobby without upgrading; give them the PDF/zip by another private channel instead. (Hobby seat limits are as I understand them, not verified for this account.)
- Settings to use: Deployment Protection > **Vercel Authentication: Enabled, All Deployments**. Leave Password Protection, Trusted IPs, Protection Bypass for Automation and shareable links **off/unused**.

## Is the public website able to serve these docs? (checked in this repository)

Read-only checks on the `frame/master-book` tree (same tree as PR #45):

- The public project's `vercel.json` is just `{"buildCommand": "node scripts/build-public.mjs", "outputDirectory": "dist/public"}`: no `rewrites`, `redirects`, `routes` or `cleanUrls` that could point outside `dist/public`. Vercel serves only the output directory.
- `scripts/build-public.mjs` copies an explicit allow-list (`index.html`, `assets/`, a named list of `operations/` files, generated config files). `docs/` is not on it.
- A production-style build with the fictional CI configuration produced 45 files in `dist/public`; none has `master`, `docs` or `pdf` in its path and none contains the text "Master Book". `scripts/check-public-build.mjs` passes.
- The Master build writes its PDF to `dist/master`, not `dist/public`.
- A PR preview of the public project (PR #45 included) therefore serves only `dist/public`. The sources are uploaded to the builder but are not served.
- Residual risk: a future edit that widens the allow-list or adds a rewrite. No file change was judged necessary. A root `.vercelignore` with `docs/master` is **not recommended**: it would also hide the files this docs project needs if you use the Root Directory approach. Keep the separate project and rerun the checks in `SIGNED_OUT_TEST_PLAN.md` plus a check that `https://<public-site>/docs/master/live/index.html` returns 404.

## What stays out

No secrets, environment variables, analytics or serverless functions are needed. Do not add any.
