// E2E environment: builds the site with FICTIONAL public config, serves it on a random local port and
// launches the installed Chrome. No real Supabase project, key or network service is contacted:
// every request to the fictional Supabase origin is intercepted by lib/mock-supabase.mjs.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const repo = resolve(fileURLToPath(new URL("../../", import.meta.url)));
// The build guard only accepts this project ref. The origin is NEVER contacted: every request to it is intercepted and answered by the mock, anon key has a fictional signature.
export const FICTIONAL_ORIGIN = "https://otqzhocismdjbvvsjnpe.supabase.co";
const b64 = value => Buffer.from(value).toString("base64url");
export const FICTIONAL_ANON_KEY = `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64('{"role":"anon","ref":"otqzhocismdjbvvsjnpe"}')}.${b64("fictional-signature")}`;
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain", ".xml": "application/xml" };

export function buildSite() {
  const result = spawnSync(process.execPath, ["scripts/build-public.mjs"], { cwd: repo, encoding: "utf8", env: { ...process.env, VERCEL_ENV: "production", FF_PUBLIC_SUPABASE_URL: FICTIONAL_ORIGIN, FF_PUBLIC_SUPABASE_ANON_KEY: FICTIONAL_ANON_KEY } });
  if (result.status !== 0) throw new Error(`build-public failed:\n${result.stdout}\n${result.stderr}`);
  return join(repo, "dist/public");
}

export function serve(root) {
  return new Promise(resolvePromise => {
    const server = createServer(async (req, res) => {
      let path = decodeURIComponent(req.url.split("?")[0]);
      if (path.endsWith("/")) path += "index.html";
      try { const body = await readFile(join(root, path)); res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }); res.end(body); }
      catch { res.writeHead(404); res.end("not found"); }
    }).listen(0, "127.0.0.1", () => resolvePromise({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

export async function launch() {
  const executablePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(path => { try { return spawnSync(path, ["--version"]).status === 0; } catch { return false; } });
  if (!executablePath) throw new Error("No Chrome found. Set CHROME_PATH.");
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--hide-scrollbars", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] /* DNS is disabled: WebSockets (realtime) cannot be intercepted, so nothing may leave the machine */ });
}

export const wait = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
export async function waitFor(fn, { timeout = 8000, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) { const value = await fn(); if (value) return value; if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await wait(50); }
}
