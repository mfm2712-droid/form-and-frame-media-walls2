import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// FRAME-005: guard the public page against fictional/unverified content and
// basic accessibility regressions. Reads the source file only.
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("no unvalidated completed works, testimonials or reviews are published", () => {
  for (const banned of ["Completed works", "id=\"rWorks\"", "assets/cases/", "BURNHAM ·", "LANGLEY ·", "WINDSOR · COMPACT", "SLOUGH · FULL-WIDTH", "A real Burnham job", "Sample review", "testimonial-card", "★", "ratingValue", "aggregateRating", "\"@type\":\"Review\""]) {
    assert.equal(html.includes(banned), false, `index.html must not contain: ${banned}`);
  }
  assert.equal(/href="#works"/.test(html), false, "No navigation link may point to the removed works section.");
  assert.equal(/og:image/.test(html), false, "No og:image until a validated image exists.");
});

test("no invented contact details are published and none are left as visible placeholders", () => {
  assert.equal(/href="(tel|mailto):[^"?#]+/.test(html.replace(/mailto:\?subject/g, "")), false, "No tel:/mailto: link with a recipient until Mark supplies one.");
  assert.equal(/\+44|\b0[1-9]\d{8,10}\b/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), false, "No phone number in page markup.");
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(/"(telephone|email|sameAs)"/.test(ld), false, "JSON-LD must not carry unconfirmed contact fields.");
  assert.equal(/to be supplied by Mark/i.test(html), false, "Placeholders live in docs/pending-mark, never on the public page.");
});

test("unverified commercial promises are not made", () => {
  for (const claim of ["free site survey", "free measured survey", "within one working day", "years of experience", "fully insured", "guarantee"]) {
    assert.equal(html.toLowerCase().includes(claim), false, `Unconfirmed claim: ${claim}`);
  }
});

test("in-page links resolve and ids are unique", () => {
  const ids = [...html.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids: " + ids.filter((x, i) => ids.indexOf(x) !== i).join(","));
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const [, target] of markup.matchAll(/href="#([^"]+)"/g)) {
    if (target === "") continue;
    assert.ok(ids.includes(target), `href="#${target}" has no target`);
  }
  for (const [, target] of markup.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(ids.includes(target), `aria-controls ${target} missing`);
});

test("accessibility basics: skip link, one h1, labelled controls, described form errors", () => {
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /<main id="main"/);
  assert.equal((html.replace(/<script[\s\S]*?<\/script>/g, "").match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<html lang="en-GB">/);
  const formStart = html.indexOf('<form class="form" id="form"');
  const form = html.slice(formStart, html.indexOf("</form>", formStart));
  for (const id of ["cName", "cContact", "cPost", "cWidth", "cMsg"]) {
    assert.ok(form.includes(`<label for="${id}">`), `${id} needs a <label for>`);
    assert.ok(new RegExp(`id="${id}"[^>]*aria-describedby="${id}-err"`).test(form), `${id} must point at its error message`);
    assert.ok(form.includes(`id="${id}-err"`), `${id}-err element missing`);
    assert.ok(new RegExp(`id="${id}"[^>]*aria-required="true"`).test(form), `${id} must be aria-required`);
  }
  assert.match(form, /<form[^>]*novalidate/);
  assert.match(form, /id="formStatus" role="status" aria-live="polite"/);
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const [, attrs, text] of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const visible = text.replace(/<[^>]+>/g, "").replace(/&[#\w]+;/g, "x").trim();
    assert.ok(visible || /aria-label=/.test(attrs), `button without accessible name: ${attrs}`);
  }
});

test("staff link is relative so it follows the real deployment domain", () => {
  assert.match(html, /class="staff-access" href="\/operations\/"/);
});
