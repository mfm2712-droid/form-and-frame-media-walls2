# Self-hosted fonts

Replaces the Google Fonts stylesheet (fonts.googleapis.com / fonts.gstatic.com) so visitors' browsers make no third-party request
for fonts (privacy, fewer connections, shorter critical path, tighter CSP).

- Source: Fontsource npm packages (`@fontsource/*` and `@fontsource-variable/bricolage-grotesque`, version 5.3.0), the open-licence
  redistribution of the Google Fonts families. Only the **latin** subset, **woff2**, was taken. The `unicode-range` in the page
  `@font-face` rules is the same latin range Google serves.
- Public site: Bricolage Grotesque (variable, opsz + wght 200-800), IBM Plex Sans 400/500/600, IBM Plex Mono 400/500/600.
- Staff app (`/operations/`): DM Sans 400/500/600, DM Mono 400/500, Playfair Display 600/700.
- All use `font-display: swap`. Preloaded as critical: Bricolage Grotesque and IBM Plex Sans 400 (public), DM Sans 400 (staff app).
- Licences: every family is SIL Open Font License 1.1; texts are in `licenses/`. Keep them with the font files.
- Integrity: `FONTS.json` records bytes and SHA-256 of each file; `scripts/fonts.test.mjs` fails if a file changes without the record.
- Upgrading: re-download from the same packages, rewrite `FONTS.json` (hashes), keep the licence files.
- Not covered: `anthony-roadmap.html` (an internal page that is excluded from the public build) still links Google Fonts.
