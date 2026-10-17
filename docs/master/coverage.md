# 12. Coverage summary

## 12.1 What is documented

| Area | Documented | Notes |
|---|---|---|
| Identity and design system | Yes | Public and staff palettes, fonts, components, responsive rules from the CSS. |
| Platform map and architecture | Yes | 17 diagrams. |
| Public site | All sections, at desktop and mobile | Placeholder content flagged. |
| Owner Dashboard | Modules M1 to M14 | Only demo-mode screens are shown; the rest are "not verifiable". |
| Backend, database, integrations | Yes | From the ten migrations and three Edge Functions. |
| Journeys | Customer, owner, staff | Broken and missing steps marked. |
| Feature matrix | 49 rows | Statuses limited to the seven allowed. |
| Security | Yes | No exploit detail. |
| Testing | Local runs on Node 24; Preview and production not verified. | |
| Roadmap | Issues #9 to #18, #28 to #40, PRs #8, #19 to #27, #41 to #43 | |
| Evidence inventory | 57 rows, re-checked on each build | |

## 12.2 Screenshots and diagrams

| Type | Count |
|---|---|
| Public site, desktop 1440 | 13 (full page, fold, dark fold, 8 section crops, chat open, form validation) |
| Public site, mobile 390 | 11 (fold, 8 section crops, nav open, chat open) |
| Staff app demo mode, desktop 1440 | 10 |
| Staff app demo mode, mobile 390 | 7 |
| Staff sign-in screen (no data), desktop and mobile | 2 |
| **Total screenshots** | **43** (WebP, about 3 MB) |
| Diagrams (SVG, generated from `diagrams.mjs`) | 17 |

Public screenshots come from the repository's own build with the CI fictional configuration, served locally. Staff screenshots are DEMO MODE with the built-in fictional data; they are captioned as such.

## 12.3 Tests

183 of 183 pass on `main` (Node 24); Draft PR suites pass (see Testing). No live, Preview or production test.

## 12.4 Not covered

Production, Preview, live Supabase, signed-in money screens, and real delivery of e-mail or push: see [Pending confirmation](pending-confirmation.md).
