# Vendored third-party code

`supabase-js-2.117.2.mjs` is `@supabase/supabase-js@2.117.2` (MIT) bundled with its pinned dependencies into one ES module, replacing the runtime import from `https://esm.sh`. The staff app now executes no script from a third-party host.

- Integrity: `VENDOR.json` records the SHA-384 (SRI format) and SHA-256 of the file, and the npm registry integrity hashes of every package it was built from. `operations/vendor-integrity.test.mjs` fails if the file changes without `VENDOR.json` being updated.
- Rebuild / upgrade (do this deliberately, on a throwaway checkout):
  1. `npm init -y && npm i --save-exact @supabase/supabase-js@<version> esbuild@0.28.2` (npm verifies registry integrity).
  2. Run the esbuild command in `VENDOR.json` (`build.command`), prepend the 4-line header, rename the file, update the import in `operations/app.js`, `VENDOR.json`, and the build/check scripts.
  3. Run `TZ=Europe/London node --test` and the CI steps.
- The Supabase Edge Functions (`supabase/functions/*/index.ts`) still import from esm.sh; that is Deno server code and is out of scope of this change.
- Browser `<script type="module">` imports of same-origin files cannot carry an SRI attribute; same-origin hosting under CSP `script-src 'self'` plus the recorded hash is the control.
