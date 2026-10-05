import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("dist/public");
const rootEntries = new Set(await readdir(root));
assert.deepEqual(
  [...rootEntries].sort(),
  ["assets", "index.html", "operations", "public-config.js"],
  "The public build root must contain only the public website, authenticated staff app shell, public config, and assets."
);

for (const file of ["index.html", "public-config.js"]) {
  assert.equal((await stat(resolve(root, file))).isFile(), true, `${file} must be a file.`);
}
assert.equal((await stat(resolve(root, "assets"))).isDirectory(), true, "assets must be a directory.");
assert.equal((await stat(resolve(root, "operations/index.html"))).isFile(), true, "The staff app shell must be deployed at /operations/.");
assert.equal((await stat(resolve(root, "operations/config.js"))).isFile(), true, "The staff app must receive its browser-safe runtime config.");
assert.equal((await stat(resolve(root, "operations/push-support.mjs"))).isFile(), true, "The staff app must deploy its push capability and install guidance module.");
assert.equal((await stat(resolve(root, "operations/activity-label.mjs"))).isFile(), true, "The staff app must deploy its private activity-log renderer.");
assert.equal((await stat(resolve(root, "operations/push-target.mjs"))).isFile(), true, "Push notification links must resolve to the requested enquiry in the staff app.");
assert.equal((await stat(resolve(root, "operations/invoice-document.mjs"))).isFile(), true, "The mobile Operations app must be able to render safe printable invoices.");
assert.equal((await stat(resolve(root, "operations/payment-idempotency.mjs"))).isFile(), true, "Manual payment retries must retain their idempotency key across reloads.");
const publicHtml = await readFile(resolve(root, "index.html"), "utf8");
const publicConfigSource = await readFile(resolve(root, "public-config.js"), "utf8");
const publicConfigMatch = /^window\.FF_PUBLIC_CONFIG = Object\.freeze\((\{.*\})\);\s*$/.exec(publicConfigSource);
assert.ok(publicConfigMatch, "The generated public config must be a valid frozen JSON object.");
const publicConfig = JSON.parse(publicConfigMatch[1]);
const publicSupabaseRef = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(publicConfig.supabaseUrl || "")?.[1]?.toLowerCase();
assert.equal(publicSupabaseRef, "otqzhocismdjbvvsjnpe", "The public build must use the dedicated Form & Frame Supabase project.");
assert.ok(/<script src="\/public-config\.js"><\/script>/.test(publicHtml), "The public page must load the generated Supabase config before its enquiry handler.");
assert.ok(/\/functions\/v1\/submit-enquiry/.test(publicHtml), "The public enquiry flow must call the server-side persistence function.");
const localStorageKeys = [...publicHtml.matchAll(/localStorage\.setItem\(\s*["']([^"']+)["']/g)].map(match => match[1]);
assert.deepEqual(
  [...new Set(localStorageKeys)].sort(),
  ["ff_spec", "ff_view"],
  "The public page may persist only configurator preferences, never customer enquiry details."
);
for (const unverifiedClaim of ["VAT at 20%", "VAT @ 20%", " ex VAT", "+ VAT", "INDICATIVE COST ALLOCATION", "INDICATIVE<br>PRO FORMA"]) {
  assert.equal(publicHtml.includes(unverifiedClaim), false, `The public page must not state unverified tax/cost claim: ${unverifiedClaim}`);
}
assert.match(publicHtml, /not a quotation, invoice or booking/i, "The customer design summary must be clearly non-binding.");
assert.match(publicHtml, /any applicable tax treatment/i, "Tax treatment must remain for the written quotation to confirm.");
assert.match(publicHtml, /id="cWebsite"[^>]*name="company_website"/, "The public enquiry form must include its off-screen honeypot field.");
assert.match(publicHtml, /company_website:\s*\$\("cWebsite"\)\.value/, "The public enquiry payload must send the honeypot value for server-side rejection.");
const referenceCheck = publicHtml.indexOf('typeof result.reference !== "string"');
const successView = publicHtml.indexOf('form.style.display = "none"', referenceCheck);
assert.ok(referenceCheck >= 0 && successView > referenceCheck, "The public page must only show success after validating the saved enquiry reference.");
for (const privatePath of ["supabase", "planning", "anthony-roadmap.html"]) {
  assert.equal(rootEntries.has(privatePath), false, `${privatePath} must not enter the public build.`);
}

const operationsFiles = await readdir(resolve(root, "operations"));
assert.equal(operationsFiles.includes("config.example.js"), false, "The staff app config template must not enter the deployment.");
assert.equal(operationsFiles.some(file => file.endsWith(".test.mjs")), false, "Node tests must not enter the deployment.");
const operationsAppSource = await readFile(resolve(root, "operations/app.js"), "utf8");
for (const [, importedModule] of operationsAppSource.matchAll(/from\s+["']\.\/([^"']+\.mjs)["']/g)) {
  assert.ok(operationsFiles.includes(importedModule), `The staff app dependency ${importedModule} must be copied into the public build.`);
}
const operationsConfig = await readFile(resolve(root, "operations/config.js"), "utf8");
assert.match(operationsConfig, /^window\.FF_OPERATIONS_CONFIG = Object\.freeze\(/, "Operations receives generated browser-safe config.");
for (const forbiddenSecretName of ["SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY", "PUSH_DISPATCH_TOKEN", "RESEND_API_KEY"]) {
  assert.equal(operationsConfig.includes(forbiddenSecretName), false, `Server secret ${forbiddenSecretName} must not enter the staff app config.`);
}
const operationsHtml = await readFile(resolve(root, "operations/index.html"), "utf8");
assert.match(operationsHtml, /Send secure link/, "Operations requires staff sign-in.");

console.log(`Verified public build root: ${[...rootEntries].sort().join(", ")}`);
