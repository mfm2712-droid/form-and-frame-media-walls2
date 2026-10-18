import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SAMPLE_WORKS, SHOW_SAMPLE_WORKS, sampleWorksEnabled } from "../site-works.mjs";
import { SAMPLE_INTRO, SAMPLE_LABEL, WORKS_MARKER, renderWorksSection } from "./works-section.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

test("flag off (or no data) renders nothing", () => {
  assert.equal(renderWorksSection(SAMPLE_WORKS, false), "");
  assert.equal(renderWorksSection([], true), "");
});

test("flag on renders one card per sample, each with a visible 'Sample project' label, and the illustrative-sample intro", () => {
  const html = renderWorksSection(SAMPLE_WORKS, true);
  assert.equal(html.split('class="work"').length - 1, SAMPLE_WORKS.length);
  assert.equal(html.split(`class="sample-tag">${SAMPLE_LABEL}<`).length - 1, SAMPLE_WORKS.length);
  assert.equal(html.split(`class="sample-note">${SAMPLE_LABEL}<`).length - 1, SAMPLE_WORKS.length);
  assert.ok(html.includes(SAMPLE_INTRO));
  assert.match(SAMPLE_INTRO, /illustrative samples, not real completed jobs/);
  assert.equal(/Completed works|real Burnham/i.test(html), false, "never presented as completed jobs");
  assert.equal(/★|testimonial|review/i.test(html), false);
});

test("data file: four samples, verbatim names, images exist, nothing else invented", async () => {
  assert.equal(SHOW_SAMPLE_WORKS, true);
  assert.deepEqual(SAMPLE_WORKS.map(w => w.place.split(" · ")[0]), ["BURNHAM", "LANGLEY", "SLOUGH", "WINDSOR"]);
  const archive = (await readFile(resolve(root, "docs/pending-mark/works-section.html.txt"), "utf8")).replaceAll("&quot;", '"');
  for (const work of SAMPLE_WORKS) {
    assert.ok(archive.includes(work.place) && archive.includes(work.spec), `${work.place} must match the archived text`);
    for (const image of [work.before, work.after]) assert.ok((await readdir(resolve(root, "assets/cases"))).includes(image.split("/").pop()));
  }
  assert.deepEqual(Object.keys(SAMPLE_WORKS[0]).sort(), ["after", "before", "place", "spec"]);
});

test("the environment override of the flag works and defaults to the file value", () => {
  assert.equal(sampleWorksEnabled({}), SHOW_SAMPLE_WORKS);
  assert.equal(sampleWorksEnabled({ FF_SHOW_SAMPLE_WORKS: "0" }), false);
  assert.equal(sampleWorksEnabled({ FF_SHOW_SAMPLE_WORKS: "false" }), false);
  assert.equal(sampleWorksEnabled({ FF_SHOW_SAMPLE_WORKS: "1" }), true);
});

test("source page keeps exactly one works marker and no works markup", async () => {
  const html = await readFile(resolve(root, "index.html"), "utf8");
  assert.equal(html.split(WORKS_MARKER).length - 1, 1);
  assert.equal(html.includes('id="rWorks"'), false);
});

function build(flag) {
  const b64 = v => Buffer.from(v).toString("base64url");
  const key = `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64('{"role":"anon","ref":"otqzhocismdjbvvsjnpe"}')}.${b64("fictional-signature")}`;
  const env = { ...process.env, VERCEL_ENV: "production", FF_PUBLIC_SUPABASE_URL: "https://otqzhocismdjbvvsjnpe.supabase.co", FF_PUBLIC_SUPABASE_ANON_KEY: key, FF_SHOW_SAMPLE_WORKS: flag };
  return env;
}

for (const flag of ["0", "1"]) {
  test(`build output with the flag ${flag === "1" ? "on" : "off"}: section, photos and build check agree`, async () => {
    const copy = await mkdtemp(join(tmpdir(), "ff-works-"));
    try {
      for (const entry of ["index.html", "robots.txt", "sitemap.xml", "site-config.mjs", "site-works.mjs", "assets", "scripts", "operations", "package.json"]) await cp(resolve(root, entry), join(copy, entry), { recursive: true }).catch(() => {});
      await cp(resolve(root, "supabase/config.toml"), join(copy, "supabase/config.toml")).catch(() => {});
      const env = build(flag);
      const built = spawnSync(process.execPath, ["scripts/build-public.mjs"], { cwd: copy, env, encoding: "utf8" });
      assert.equal(built.status, 0, built.stderr);
      const html = await readFile(join(copy, "dist/public/index.html"), "utf8");
      const hasCases = (await readdir(join(copy, "dist/public/assets"))).includes("cases");
      if (flag === "1") {
        assert.ok(html.includes('id="works"') && html.includes(SAMPLE_INTRO));
        assert.equal(html.split('class="sample-tag"').length - 1, 4);
        assert.equal(hasCases, true);
      } else {
        assert.equal(/id="works"|rWorks|BURNHAM|assets\/cases/.test(html), false);
        assert.equal(hasCases, false);
      }
      const check = spawnSync(process.execPath, ["scripts/check-public-build.mjs"], { cwd: copy, env, encoding: "utf8" });
      assert.equal(check.status, 0, check.stdout + check.stderr);
    } finally { await rm(copy, { recursive: true, force: true }); }
  });
}
