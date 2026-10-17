# Signed-out test plan for the private docs project

Purpose: after Mark deploys the separate docs project with **Vercel Authentication (All Deployments)**, prove that an unauthenticated visitor cannot read anything. Nothing here has been run against a real URL yet (no deployment exists).

## Expected result for every request

A signed-out request must get **HTTP 401** (Vercel's "Authentication Required" page) or a **3xx redirect whose `Location` points to `vercel.com/login` or `vercel.com/sso-api`**. A **200 with the Master content is a failure**. Also the body must not contain Master text such as `Form & Frame Master Book`.

## Paths to check

| Path | What it is |
|---|---|
| `/` and `/index.html` | Live Master (one self-contained page, search index is inline JavaScript) |
| `/HOSTING.txt` | hosting note |
| `/FORM_AND_FRAME_MASTER_BOOK.pdf` | the Master Book |
| `/robots.txt` | disallow-all file (still must be protected) |
| `/assets/diagrams/01-*.svg` ... | diagrams |
| `/assets/screenshots/public/fold-desktop-1440.webp` | public site screenshots |
| `/assets/screenshots/staff-demo/desktop-1440-today-plan.webp` | staff demo screenshots |
| `/does-not-exist`, `/.git/config`, `/vercel.json` | must not leak or return 200 |

There is **no separate search-index JSON**: search is built from the page inline. If a future build adds one (for example `/search-index.json`), add it to `PATHS` in `check-private.sh`.

## Commands

Automated, all paths, also tries HEAD and a GET with a browser User-Agent:

```bash
bash scripts/master-docs/check-private.sh https://<your-docs-project>.vercel.app
```

Manual equivalent for one path:

```bash
curl -s -o /dev/null -D - https://<docs>.vercel.app/FORM_AND_FRAME_MASTER_BOOK.pdf | head -5   # expect 401, or 30x to vercel.com/login
curl -s https://<docs>.vercel.app/ | grep -c "Master Book"                                     # expect 0
```

Also check the **production alias** and one **deployment-specific URL** (`<project>-<hash>-<team>.vercel.app`): both must be protected (this is what "All Deployments" is for).

## Then, signed in (manual)

1. Open the URL in a private window: you should land on Vercel login. Sign in as the Vercel account owner: Live loads, menu, search, zoom work; the PDF opens.
2. Sign in with a different Vercel account (Hobby: any account other than the owner): access must be refused.
4. On the **public site**, `https://<public-site>/docs/master/live/index.html` and `/FORM_AND_FRAME_MASTER_BOOK.pdf` must return 404.
3. Check response headers on a signed-in page: `X-Robots-Tag: noindex...`, `Cache-Control: private, no-store`.

## Not covered

Anything about the account's plan or Vercel's internal behaviour; only observable responses are tested.
