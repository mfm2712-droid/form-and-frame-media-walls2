import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPng, badgeReport } from "../scripts/png-info.mjs";

const read = name => readFile(new URL(`./${name}`, import.meta.url));
const manifest = JSON.parse(await read("manifest.webmanifest"));
const worker = await read("service-worker.js").then(buffer => buffer.toString("utf8"));
const app = await read("app.js").then(buffer => buffer.toString("utf8"));
const file = src => src.split("?")[0].replace(/^\.\//, "");

// Android shows ONLY the alpha channel of a badge, tinted. An opaque image becomes a solid square.
for (const [name, size] of [["notification-badge-ff.png", 96], ["notification-badge-ff-192.png", 192]]) {
  test(`${name} is a true-alpha white FF mask that Android cannot turn into a square`, async () => {
    const report = badgeReport(readPng(await read(name)));
    assert.equal(report.width, size); assert.equal(report.height, size);
    assert.equal(report.hasAlphaChannel, true, "needs a real alpha channel");
    assert.ok(report.transparentShare > 0.5, `mostly transparent, got ${report.transparentShare}`);
    assert.ok(report.opaqueShare + report.partialShare < 0.45, "the glyph must not fill the canvas");
    assert.ok(report.opaqueShare > 0.1, "the glyph must be solid enough to read");
    assert.deepEqual(report.cornerAlphas, [0, 0, 0, 0], "corners must be transparent");
    assert.equal(report.edgeVisiblePixels, 0, "nothing may touch the canvas edge");
    assert.equal(report.nonWhiteVisiblePixels, 0, "visible pixels must be pure white (no colour)");
    assert.ok(report.partialShare > 0.02, "edges must be anti-aliased so small sizes stay legible");
    assert.ok(report.bboxWidthShare > 0.75 && report.bboxHeightShare > 0.55, "the monogram must fill the icon area");
  });
}

test("the badge reads as two F letters: two separate vertical stems with a gap between", async () => {
  const png = readPng(await read("notification-badge-ff.png"));
  const row = y => Array.from({ length:png.width }, (_, x) => png.rgba[(y * png.width + x) * 4 + 3] > 128);
  const runs = y => row(y).reduce((count, on, x, all) => count + (on && !all[x - 1] ? 1 : 0), 0);
  assert.equal(runs(70), 2, "two stems at the bottom, one per F");
  assert.equal(runs(55), 2);
  assert.ok(runs(18) <= 2, "top bars");
});

test("manifest declares the badge as a monochrome icon and keeps full-colour icons separate", () => {
  const mono = manifest.icons.filter(icon => icon.purpose === "monochrome");
  assert.ok(mono.length >= 2, "monochrome icons at 96 and 192");
  assert.ok(mono.some(icon => icon.sizes === "96x96") && mono.some(icon => icon.sizes === "192x192"));
  for (const icon of manifest.icons.filter(icon => icon.type === "image/png" && icon.purpose !== "monochrome")) {
    assert.doesNotMatch(icon.purpose, /monochrome/);
    assert.notEqual(icon.purpose, "any maskable", "any and maskable must be separate declarations");
  }
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable" && icon.sizes === "512x512"));
});

test("the service worker's badge is the same asset the manifest declares as monochrome", () => {
  const badge = /const NOTIFICATION_BADGE = "([^"]+)"/.exec(worker)?.[1];
  assert.ok(badge, "worker defines NOTIFICATION_BADGE");
  assert.ok(manifest.icons.some(icon => icon.purpose === "monochrome" && icon.src === badge), "manifest and worker must name the identical URL");
  assert.match(worker, /badge:NOTIFICATION_BADGE/);
  assert.match(worker, /icon:NOTIFICATION_ICON/);
  assert.equal(file(/const NOTIFICATION_ICON = "([^"]+)"/.exec(worker)[1]), "icon-192.png", "expanded notification keeps the green-and-gold logo");
});

test("the worker takes over immediately and the app registers one stable worker URL", () => {
  assert.match(worker, /addEventListener\("install", \(\) => self\.skipWaiting\(\)\)/);
  assert.match(worker, /clients\.claim\(\)/);
  assert.doesNotMatch(worker, /addEventListener\("fetch"/, "no fetch handler, so no stale pages");
  const registrations = [...app.matchAll(/serviceWorker\.register\("([^"]+)"/g)].map(match => match[1]);
  assert.ok(registrations.length >= 2);
  assert.ok(registrations.every(url => url === "./service-worker.js"), `stable URL expected, got ${registrations}`);
});
