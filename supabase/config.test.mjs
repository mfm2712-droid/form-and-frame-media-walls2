import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Supabase CLI is pinned to Form & Frame and keeps JWT verification on", async () => {
  const config = await readFile(new URL("./config.toml", import.meta.url), "utf8");
  assert.match(config, /^project_id = "otqzhocismdjbvvsjnpe"$/m);
  assert.match(config, /^\[functions\.submit-enquiry\]$/m);
  assert.match(config, /^verify_jwt = true$/m);
  assert.match(config, /^\[functions\.push-new-enquiry\]$/m);
  assert.match(config, /^verify_jwt = false$/m);
  assert.match(config, /^\[functions\.retry-notifications\]$/m);
  assert.match(config, /^verify_jwt = false$/m);
  const handler = await readFile(new URL("./functions/push-new-enquiry/handler.mjs", import.meta.url), "utf8");
  assert.match(handler, /PUSH_DISPATCH_TOKEN/);
  assert.match(handler, /sameSecret/);
  const retryHandler = await readFile(new URL("./functions/retry-notifications/handler.mjs", import.meta.url), "utf8");
  assert.match(retryHandler, /NOTIFICATION_RETRY_TOKEN/);
  assert.match(retryHandler, /sameSecret/);
});

test("the staff app and enquiry function pin the same Supabase SDK release", async () => {
  const [operations, edgeFunction] = await Promise.all([
    readFile(new URL("../operations/app.js", import.meta.url), "utf8"),
    readFile(new URL("./functions/submit-enquiry/index.ts", import.meta.url), "utf8")
  ]);
  for (const source of [operations, edgeFunction]) {
    assert.match(source, /@supabase\/supabase-js@2\.117\.2/);
  }
});

test("the remote schema audit reads Realtime ownership and membership without writes", async () => {
  const audit = await readFile(new URL("./audit_remote_schema.sql", import.meta.url), "utf8");
  assert.match(audit, /pg_catalog\.pg_publication\s+where pubname = 'supabase_realtime'/i);
  assert.match(audit, /pg_catalog\.pg_get_userbyid\(pubowner\)/i);
  assert.match(audit, /pg_catalog\.pg_publication_tables/i);
  assert.match(audit, /c\.relrowsecurity as rls_enabled/i);
  assert.doesNotMatch(audit, /^\s*(?:insert|update|delete|alter|create|drop|truncate)\b/im);
});
