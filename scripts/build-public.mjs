import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolvePublicConfig } from "./public-config.mjs";

// Publish the public website and authenticated staff app shell. Operations
// records stay behind Supabase Auth + RLS; never include staff data or server
// credentials. Internal planning and backend source stay excluded.
const root = process.cwd();
const publicConfig = resolvePublicConfig(process.env);
const output = resolve(root, "dist/public");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, "index.html"), resolve(output, "index.html"));
await cp(resolve(root, "robots.txt"), resolve(output, "robots.txt"));
await cp(resolve(root, "sitemap.xml"), resolve(output, "sitemap.xml"));
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
const operationsOutput = resolve(output, "operations");
await mkdir(operationsOutput, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css", "today-view.mjs", "project-model.mjs", "mutation-result.mjs", "datetime-local.mjs", "pipeline.mjs", "workflow.mjs", "push-support.mjs", "activity-label.mjs", "assignment.mjs", "availability-list.mjs", "push-target.mjs", "invoice-document.mjs", "payment-idempotency.mjs", "quote-readiness.mjs", "enquiry-workspace.mjs", "enquiry-workspace-view.mjs", "staff-access.mjs", "calendar-records.mjs", "business-records.mjs", "service-worker.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-180.png", "notification-badge-ff.png", "notification-centre.mjs", "notification-view.mjs"]) {
  await cp(resolve(root, "operations", file), resolve(operationsOutput, file));
}
// Self-hosted third-party code (see operations/vendor/VENDOR.md); only the module ships.
await mkdir(resolve(operationsOutput, "vendor"), { recursive: true });
await cp(resolve(root, "operations/vendor/supabase-js-2.117.2.mjs"), resolve(operationsOutput, "vendor/supabase-js-2.117.2.mjs"));
// Every icon the manifest or the service worker names must ship. Deriving the
// list (instead of remembering it) prevents a notification icon from being
// left out of a deployment again.
const operationsManifest = JSON.parse(await readFile(resolve(root, "operations/manifest.webmanifest"), "utf8"));
const operationsWorker = await readFile(resolve(root, "operations/service-worker.js"), "utf8");
const referencedAssets = new Set([
  ...operationsManifest.icons.map(icon => icon.src),
  ...[...operationsWorker.matchAll(/const NOTIFICATION_(?:ICON|BADGE) = "([^"]+)"/g)].map(match => match[1])
].map(src => src.split("?")[0].replace(/^\.\//, "")));
for (const asset of referencedAssets) {
  if (asset.includes("/") || asset.includes("..")) throw new Error(`Unexpected icon path ${asset}`);
  await cp(resolve(root, "operations", asset), resolve(operationsOutput, asset));
}

await writeFile(resolve(output, "public-config.js"), `window.FF_PUBLIC_CONFIG = Object.freeze(${JSON.stringify({
  supabaseUrl: publicConfig.supabaseUrl,
  supabaseAnonKey: publicConfig.supabaseAnonKey
})});\n`);
await writeFile(resolve(operationsOutput, "config.js"), `window.FF_OPERATIONS_CONFIG = Object.freeze(${JSON.stringify({
  supabaseUrl: publicConfig.supabaseUrl,
  supabaseAnonKey: publicConfig.supabaseAnonKey,
  vapidPublicKey: publicConfig.vapidPublicKey
})});\n`);
console.log("Built the public website and authenticated staff app shell into dist/public. Server-side data and secrets were excluded.");
