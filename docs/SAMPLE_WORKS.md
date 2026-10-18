# Sample projects on the public page (Refs #12)

Decision (Mark, 18 Oct 2026): the four "completed works" (Burnham, Langley, Slough, Windsor) are **fictitious**.
He wants them kept **temporarily**. They are therefore shown only as labelled samples, never as completed jobs.

- Data: `site-works.mjs` (names and specs copied verbatim from `docs/pending-mark/works-section.html.txt`; nothing added).
- Single flag: `SHOW_SAMPLE_WORKS` in `site-works.mjs`.
- Rendering: `scripts/works-section.mjs`; `index.html` only carries the marker `<!--FF:WORKS-->`.
- Labels: each card has a "Sample project" tag on the image and in the caption; the section intro reads
  "These projects are illustrative samples, not real completed jobs." The old "Completed works" heading is not used.

## Removing them (one step)
Set `SHOW_SAMPLE_WORKS = false` in `site-works.mjs`. The build then omits the section and does not copy `assets/cases/`;
`scripts/check-public-build.mjs` verifies both. (Optionally delete `assets/cases/` and the data afterwards.)
`FF_SHOW_SAMPLE_WORKS=0|1` overrides the flag for a single build (used by the tests).

## Owner name
Owner names are "Thiago" and "Anthony" (never "Antonio"). A search of this branch found no "Antonio".
