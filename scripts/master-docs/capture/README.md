# Screenshot capture (reference scripts)

These are the scripts used to take the Master Book screenshots. They need `puppeteer-core` (installed outside the repo, in a scratch folder, because the repository has no package.json) and a local Chrome at `/usr/bin/google-chrome`; paths inside are the ones used on the build box and must be adjusted elsewhere.

1. Build the public site with the CI fictional configuration (see `.github/workflows/quality.yml`) and serve `dist/public` (`serve.mjs`); serve `operations/` without `config.js` for the staff app demo mode.
2. `shots.mjs` / `shots2.mjs` capture 1440 px and 390 px views. `live-check.mjs` checks the Live Master at both widths.
3. Convert PNG to WebP (quality about 80) to keep the repository small. 33 WebP screenshots total about 3 MB.

The build itself (`node scripts/build-master-docs.mjs`) needs none of this: screenshots are committed under `docs/master/assets/screenshots/`.
