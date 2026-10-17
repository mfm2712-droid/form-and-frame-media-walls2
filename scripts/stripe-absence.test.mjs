import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

// FRAME-008 guard: no payment-provider implementation may appear before Mark approves the
// commercial flow (docs/STRIPE_DESIGN.md section 2). When approved, delete this test in the
// same PR that adds the implementation, citing the approval.
const root = new URL("../", import.meta.url);
async function files(dir) {
  const out = [];
  for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "docs", "planning", "assets"].includes(e.name)) continue;
    if (e.isDirectory()) out.push(...await files(`${dir}${e.name}/`));
    else if (/\.(mjs|js|ts|html|json|toml|yml)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(`${dir}${e.name}`);
  }
  return out;
}

test("no Stripe SDK, endpoint, key or webhook handler exists in code", async () => {
  const hits = [];
  for (const f of await files("")) {
    const text = await readFile(new URL(f, root), "utf8");
    if (/api\.stripe\.com|js\.stripe\.com|from ["']stripe|require\(["']stripe|STRIPE_(SECRET|WEBHOOK|PUBLISHABLE)|Stripe-Signature|\b(sk|pk|rk)_(live|test)_|whsec_/i.test(text)) hits.push(f);
  }
  assert.deepEqual(hits, [], "Stripe code appeared before the commercial flow was approved");
});

test("the only Stripe trace in the schema is the pre-existing method value and provider id columns", async () => {
  const sql = (await Promise.all((await readdir(new URL("supabase/migrations/", root))).map(f => readFile(new URL(`supabase/migrations/${f}`, root), "utf8")))).join("\n");
  assert.match(sql, /'stripe'/);
  assert.match(sql, /external_payment_id text unique/);
  assert.match(sql, /provider_event_id text unique/);
  assert.equal(/create table (if not exists )?public\.\w*stripe/i.test(sql), false);
});

test("the design document lists the pending commercial decisions and states nothing is implemented", async () => {
  const doc = await readFile(new URL("docs/STRIPE_DESIGN.md", root), "utf8");
  assert.match(doc, /design only/i);
  assert.equal((doc.match(/^\| \d+ \|/gm) || []).length >= 12, true);
  assert.doesNotMatch(doc, /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]/);
});
