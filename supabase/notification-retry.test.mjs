import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("./migrations/20261006100000_retryable_enquiry_notifications.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("./migrations/20261007100000_harden_definer_search_paths.sql", import.meta.url), "utf8");
const workflowPush = await readFile(new URL("./migrations/20261008120000_workflow_push_notifications.sql", import.meta.url), "utf8");
const schedule = await readFile(new URL("./schedule_notification_retries.sql", import.meta.url), "utf8");
const enquiryHandler = await readFile(new URL("./functions/submit-enquiry/handler.mjs", import.meta.url), "utf8");
const pushHandler = await readFile(new URL("./functions/push-new-enquiry/handler.mjs", import.meta.url), "utf8");

test("a single new-enquiry event exists for each request and delivery channel", () => {
  assert.match(migration, /create unique index if not exists notification_events_new_enquiry_channel_idx[\s\S]*?on public\.notification_events \(request_id, channel\)[\s\S]*?where request_id is not null and event_type = 'new_enquiry'/i);
  assert.match(migration, /add column if not exists claim_until timestamptz/i);
});

test("notification claims are transactionally serialized and expire for a retry", () => {
  assert.match(migration, /for update/i);
  assert.match(migration, /claim_until = now\(\) \+ interval '1 minute'/i);
  assert.match(migration, /notification_claim_until > now\(\)/i);
  assert.match(migration, /attempt_count = attempt_count \+ 1/i);
});

test("only the server role can claim an enquiry notification", () => {
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.claim_new_enquiry_notification\(uuid, text, jsonb, boolean\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_new_enquiry_notification\(uuid, text, jsonb, boolean\) to service_role/i);
});

test("duplicate enquiry submissions reuse saved notification events instead of skipping retries", () => {
  assert.match(enquiryHandler, /savedEnquiry = prior/);
  assert.match(enquiryHandler, /claimNotification\(admin, savedEnquiry\.id, "email"/);
  assert.match(enquiryHandler, /claimNotification\(admin, savedEnquiry\.id, "push"/);
  assert.match(enquiryHandler, /admin\.rpc\("claim_new_enquiry_notification"/);
  assert.match(enquiryHandler, /notification:notificationStatus, push:pushStatus/);
});

test("push sender does not create a second event for the same new enquiry", () => {
  assert.doesNotMatch(pushHandler, /from\("notification_events"\)/);
});

test("the scheduled retry job is pinned to Form & Frame and reads its credential from Vault", () => {
  assert.match(schedule, /otqzhocismdjbvvsjnpe\.supabase\.co\/functions\/v1\/retry-notifications/);
  assert.match(schedule, /form_frame_notification_retry_token/);
  assert.match(schedule, /vault\.decrypted_secrets/);
  assert.match(schedule, /cron\.schedule\([\s\S]*?'\* \* \* \* \*'/);
  assert.match(schedule, /pg_cron/);
  assert.match(schedule, /pg_net/);
  assert.doesNotMatch(schedule, /Bearer\s+[A-Za-z0-9_-]{24,}/i);
});

test("all application SECURITY DEFINER functions receive an empty search path", () => {
  const functions = [
    "is_staff", "validate_accepted_work_order_quote", "protect_accepted_quote",
    "protect_paid_invoice_balance", "prevent_calendar_overlap", "prevent_invoice_overpayment",
    "log_workflow_record_update", "log_workflow_record_created", "log_availability_block_deleted",
    "claim_new_enquiry_notification", "claim_notification_event", "queue_workflow_push_notification"
  ];
  for (const name of functions.slice(0, -2)) assert.match(hardening, new RegExp(`alter function public\\.${name}\\([^)]*\\) set search_path = ''`, "i"), `${name} must pin its privileged function search path`);
  for (const name of functions.slice(-2)) assert.match(workflowPush, new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`, "i"), `${name} must define an empty privileged search path`);
});

test("workflow notification claims use a row lock and server-only access", () => {
  assert.match(workflowPush, /from public\.notification_events[\s\S]*?where id = p_event_id[\s\S]*?for update/i);
  assert.match(workflowPush, /revoke all on function public\.claim_notification_event\(uuid\) from public, anon, authenticated/i);
  assert.match(workflowPush, /grant execute on function public\.claim_notification_event\(uuid\) to service_role/i);
});
