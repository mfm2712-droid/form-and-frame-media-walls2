// Single source of truth for the public site's canonical origin.
// PENDING: Mark configures the production domain on 19 Oct 2026. Until then this is the existing
// Vercel hostname already used in index.html / robots.txt / sitemap.xml (no new domain is invented).
// To switch domain: set FF_SITE_URL at build time (preferred) or change DEFAULT_SITE_URL, then run
// the tests: scripts/site-url.test.mjs fails if any source file disagrees with this constant.
export const DEFAULT_SITE_URL = "https://form-and-frame.vercel.app";

export function resolveSiteUrl(env = {}) {
  const raw = (env.FF_SITE_URL || "").trim();
  if (!raw) return DEFAULT_SITE_URL;
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("FF_SITE_URL must be an https:// origin.");
  return url.origin;
}
