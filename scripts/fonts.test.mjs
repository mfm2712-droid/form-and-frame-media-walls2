import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [publicHtml, staffHtml, staffCss, vercel] = await Promise.all([read("../index.html"), read("../operations/index.html"), read("../operations/styles.css"), read("../vercel.json")]);
const record = JSON.parse(await read("../assets/fonts/FONTS.json"));

test("no page or stylesheet requests Google Fonts any more", () => {
  for (const [name, source] of Object.entries({ publicHtml, staffHtml, staffCss })) {
    assert.equal(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(source), false, `${name} still references Google Fonts`);
  }
  assert.equal(/googleapis|gstatic/.test(vercel), false, "CSP must not allow Google font hosts");
});

test("every font file is a record-matching woff2 with font-display: swap and a licence file", async () => {
  const onDisk = (await readdir(new URL("../assets/fonts/", import.meta.url))).filter(f => f.endsWith(".woff2")).sort();
  assert.deepEqual(record.files.map(f => f.file).sort(), onDisk, "FONTS.json must list exactly the shipped fonts");
  for (const entry of record.files) {
    const data = await readFile(new URL(`../assets/fonts/${entry.file}`, import.meta.url));
    assert.equal(data.subarray(0, 4).toString("latin1"), "wOF2", `${entry.file} is not woff2`);
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256, `${entry.file} changed without updating FONTS.json`);
    assert.equal(data.length, entry.bytes);
    assert.equal(entry.licence, "SIL OFL 1.1");
    assert.match(await read(`../assets/fonts/${entry.licenceFile}`), /SIL Open Font License/);
  }
});

test("@font-face rules cover each used family, point at shipped files, swap, and subset to latin", () => {
  const shipped = new Set(record.files.map(f => f.file));
  const rules = [...(publicHtml + staffCss).matchAll(/@font-face\{([^}]*)\}/g)].map(m => m[1]);
  assert.equal(rules.length, record.files.length, "one @font-face per shipped file");
  for (const rule of rules) {
    assert.match(rule, /font-display:swap/);
    assert.match(rule, /unicode-range:U\+0000-00FF/);
    const file = /url\(\/assets\/fonts\/([^)]+)\)/.exec(rule)?.[1];
    assert.ok(shipped.has(file), `${file} is not shipped`);
  }
  for (const [page, families] of [[publicHtml, ["Bricolage Grotesque", "IBM Plex Sans", "IBM Plex Mono"]], [staffCss, ["DM Sans", "DM Mono", "Playfair Display"]]]) {
    for (const family of families) assert.ok(page.includes(`font-family:"${family}"`), `${family} must be declared`);
  }
});

test("critical fonts are preloaded with crossorigin, and only files that exist", () => {
  const shipped = new Set(record.files.map(f => f.file));
  for (const html of [publicHtml, staffHtml]) {
    const preloads = [...html.matchAll(/<link rel="preload" href="\/assets\/fonts\/([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map(m => m[1]);
    assert.ok(preloads.length >= 1 && preloads.length <= 2);
    for (const file of preloads) assert.ok(shipped.has(file));
  }
  assert.match(publicHtml, /preload" href="\/assets\/fonts\/bricolage-grotesque-latin-opsz-normal\.woff2"/);
});

test("fonts are cached long-term and immutable", () => {
  const rule = JSON.parse(vercel).headers.find(r => r.source === "/assets/fonts/(.*)");
  assert.match(rule.headers.find(h => h.key === "Cache-Control").value, /max-age=31536000, immutable/);
});
