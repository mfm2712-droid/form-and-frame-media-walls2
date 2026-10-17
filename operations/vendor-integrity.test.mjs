import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const dir = new URL("./vendor/", import.meta.url);
const info = JSON.parse(await readFile(new URL("VENDOR.json", dir), "utf8"));
const bytes = await readFile(new URL(info.vendoredFile, dir));
const app = await readFile(new URL("./app.js", import.meta.url), "utf8");

test("vendored supabase-js matches the integrity hashes recorded in VENDOR.json", () => {
  assert.equal(`sha384-${createHash("sha384").update(bytes).digest("base64")}`, info.sriSha384);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), info.sha256Hex);
});

test("VENDOR.json pins the same version the staff app and edge functions use, with registry integrity for every package", async () => {
  assert.equal(info.version, "2.117.2");
  assert.match(app.split("\n")[0], new RegExp(`from "\\./vendor/${info.vendoredFile.replace(/\./g, "\\.")}"`));
  for (const functionName of ["submit-enquiry", "push-new-enquiry", "retry-notifications"]) {
    const source = await readFile(new URL(`../supabase/functions/${functionName}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /esm\.sh\/@supabase\/supabase-js@2\.117\.2/, `${functionName} should still be on the same supabase-js version`);
  }
  for (const [name, pkg] of Object.entries(info.npmPackages)) {
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/=]+$/, `${name} needs a registry integrity hash`);
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//);
  }
  assert.equal(info.npmPackages["@supabase/supabase-js"].version, info.version);
});

test("the vendored module is self-contained: no remote or bare imports, header names licence and version", () => {
  const source = bytes.toString("utf8");
  assert.match(source, /^\/\*! @supabase\/supabase-js 2\.117\.2 \(MIT/);
  assert.equal(/(?:^|[;}\s])import\s*(?:[\w{*][^;]*?from\s*)?["'](?!\.)/m.test(source), false, "no static import of a remote or bare specifier");
  assert.equal(/import\(\s*["']https?:/.test(source), false);
  assert.equal(/esm\.sh|cdn\.jsdelivr|unpkg\.com/.test(source), false);
});

test("the vendored module loads offline and exposes a working client factory", async () => {
  const { createClient } = await import(new URL(info.vendoredFile, dir));
  assert.equal(typeof createClient, "function");
  const client = createClient("https://example.invalid", "fictional-anon-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  for (const member of ["auth", "from", "channel", "removeChannel", "rpc"]) assert.ok(member in client, `client.${member}`);
  assert.equal(typeof client.auth.signInWithOtp, "function");
  assert.equal(typeof client.auth.signOut, "function");
  assert.equal(typeof client.auth.getUser, "function");
});
