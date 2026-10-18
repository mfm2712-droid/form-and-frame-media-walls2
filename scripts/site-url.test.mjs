import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_SITE_URL, resolveSiteUrl } from "../site-config.mjs";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("every canonical/sitemap URL in the sources uses the single site-URL constant", async () => {
  for (const file of ["index.html", "robots.txt", "sitemap.xml"]) {
    const origins = [...(await read(file)).matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map(m => m[0])
      .filter(o => !/schema\.org|w3\.org|sitemaps\.org|supabase\.co|fonts\.|esm\.sh/i.test(o));
    assert.ok(origins.length > 0, `${file} should name the site URL`);
    for (const origin of origins) assert.equal(origin, DEFAULT_SITE_URL, `${file} uses ${origin}`);
  }
});

test("resolveSiteUrl defaults, overrides with an https origin and rejects insecure values", () => {
  assert.equal(resolveSiteUrl({}), DEFAULT_SITE_URL);
  assert.equal(resolveSiteUrl({ FF_SITE_URL: "https://example.test/path?x=1" }), "https://example.test");
  assert.throws(() => resolveSiteUrl({ FF_SITE_URL: "http://example.test" }), /https/);
  assert.throws(() => resolveSiteUrl({ FF_SITE_URL: "not a url" }));
});
