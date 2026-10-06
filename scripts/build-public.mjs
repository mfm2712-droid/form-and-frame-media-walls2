import { cp, mkdir, rm, writeFile } from "node:fs/promises";
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
await cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true });
const operationsOutput = resolve(output, "operations");
await mkdir(operationsOutput, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css", "today-view.mjs", "project-model.mjs", "mutation-result.mjs", "datetime-local.mjs", "pipeline.mjs", "workflow.mjs", "push-support.mjs", "activity-label.mjs", "assignment.mjs", "availability-list.mjs", "push-target.mjs", "invoice-document.mjs", "payment-idempotency.mjs", "staff-access.mjs", "calendar-records.mjs", "business-records.mjs", "service-worker.js", "manifest.webmanifest", "icon.svg"]) {
  await cp(resolve(root, "operations", file), resolve(operationsOutput, file));
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
