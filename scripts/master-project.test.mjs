import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const doc = await readFile(new URL("../docs/MASTER_PROJECT.md", import.meta.url), "utf8");
const root = new URL("../", import.meta.url);
const exists = async p => access(new URL(p, root)).then(() => true, () => false);

async function sources(dir) {
  const out = [];
  for (const e of await readdir(new URL(dir, root), { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const rel = `${dir}${e.name}`;
    if (e.isDirectory()) out.push(...await sources(`${rel}/`));
    else if (/\.(mjs|js|ts|sql)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(rel);
  }
  return out;
}

test("every environment variable named in the doc is read by real code", async () => {
  const code = (await Promise.all([...await sources("supabase/"), ...await sources("scripts/"), ...await sources("operations/")].map(f => readFile(new URL(f, root), "utf8")))).join("\n");
  const section = doc.slice(doc.indexOf("## 8."), doc.indexOf("## 9."));
  const names = new Set([...section.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(m => m[1]));
  assert.ok(names.size >= 12);
  for (const name of names) assert.ok(code.includes(name), `${name} is documented but not referenced in code`);
});

test("migrations, functions and scripts named in the doc exist", async () => {
  for (const [, file] of doc.matchAll(/`(supabase\/(?:functions\/)?[\w./-]+\.(?:sql|md))`/g)) assert.ok(await exists(file), file);
  for (const [, file] of doc.matchAll(/`(scripts\/[\w.-]+\.(?:mjs|py))`/g)) assert.ok(await exists(file), file);
  for (const name of ["submit-enquiry", "push-new-enquiry", "retry-notifications"]) assert.ok(await exists(`supabase/functions/${name}/handler.mjs`), name);
  const migrations = await readdir(new URL("supabase/migrations/", root));
  assert.match(doc, new RegExp(`${migrations.length} SQL migrations`));
  const generated = new Set(["operations/config.js"]); // written by build-public.mjs, not committed
  for (const file of [...doc.matchAll(/`(operations\/[\w.-]+)`/g)].map(m => m[1]).filter(f => !generated.has(f))) assert.ok(await exists(file), file);
});

test("tables named in the doc are created by migrations", async () => {
  const sql = (await Promise.all((await readdir(new URL("supabase/migrations/", root))).map(f => readFile(new URL(`supabase/migrations/${f}`, root), "utf8")))).join("\n");
  const tables = doc.slice(doc.indexOf("Tables (public):"), doc.indexOf("Views:")).match(/`[a-z_]+`/g).map(t => t.slice(1, -1)).filter(t => !["owner", "staff"].includes(t));
  for (const t of tables) assert.match(sql, new RegExp(`create table (if not exists )?public\\.${t}\\b`), t);
});

test("no credential-shaped strings and no claim that Stripe exists", () => {
  assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{10,}\.|sk_(live|test)_|pk_(live|test)_|whsec_|\bre_[A-Za-z0-9]{10,}|service_role\s*[:=]\s*\S{20,}|postgres:\/\//);
  assert.match(doc, /Stripe or any payment-provider code: none/);
});
