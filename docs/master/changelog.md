# Changelog

## 1.0.0 : 18 October 2026

First complete Master Book and Live Master, written for FRAME issue #44 against `main` at `31a08f6ee1fa507d4f78c30ede78c4b1fda746a4`.

- Chapters, 17 diagrams, 43 screenshots, feature matrix, security and testing chapters, roadmap, evidence inventory, build script.
- Corrections made while writing, after checking the code: staff module count is 21 (one without a test); enquiries have no "set status" action; appointment double-booking is prevented by an exclusion constraint (not only by the blocked-time trigger); the staff workspace only reads `request_uploads`, nothing on `main` writes uploads; a `#desk` anchor does not exist.

Rules for later versions: bump the version in the README, record the new commit SHA, rerun `verify-evidence.mjs` (it fails if a cited file or pattern moved), regenerate screenshots if the UI changed, and list the change here.

### Owner decisions recorded (18 October 2026, after first draft)
- Thiago and Antonio both hold the Owner role with identical permissions and full Owner Dashboard access; no Manager role for now (Manager kept only as an optional proposed row).
- Stripe configuration, production domain and professional business e-mail: pending, configured by Mark on 19 Oct (not verified); no values recorded.

- 1.0.0 (quality gate, 18 Oct 2026): contents page numbers fixed for modules M1 to M9; one diagram referenced, ten unused screenshots removed; PDF screenshots re-encoded as JPEG; evidence row E-01 now states the analysed commit; statement of which Draft PRs would change the book (README).
