import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONTACT_MARKER, parseContact, renderContactBlock } from "./contact-block.mjs";

test("with no configured contact details only the survey form is offered", () => {
  const html = renderContactBlock(parseContact({}));
  assert.match(html, /href="#request"/);
  assert.equal(/tel:|mailto:|@|\d{6,}/.test(html), false);
});

test("configured details are validated, escaped and rendered", () => {
  const html = renderContactBlock(parseContact({ FF_CONTACT_PHONE: "+44 1234 567 890", FF_CONTACT_EMAIL: "hello@example.test" }));
  assert.match(html, /href="tel:\+441234567890"/);
  assert.match(html, /href="mailto:hello@example\.test"/);
  assert.throws(() => parseContact({ FF_CONTACT_PHONE: "call me" }), /phone/);
  assert.throws(() => parseContact({ FF_CONTACT_EMAIL: "x@y" }), /email/);
  assert.equal(renderContactBlock({ email: "a&b@example.test" }).includes("a&amp;b@example.test"), true);
});

test("the source page carries exactly one marker and no contact data", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html.split(CONTACT_MARKER).length - 1, 1);
});
