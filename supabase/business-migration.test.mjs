import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { allowedNextStatuses } from "../operations/workflow.mjs";

const sql = await readFile(new URL("./migrations/20261005130000_business_management_backend.sql", import.meta.url), "utf8");
const operationsApp = await readFile(new URL("../operations/app.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}()`);
  assert.notEqual(start, -1, `Expected migration function ${name} to exist.`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `Expected migration function ${name} to terminate.`);
  return sql.slice(start, end);
}

test("every workflow update trigger maps to an allowed activity entity type", () => {
  const body = functionBody("log_workflow_record_update");
  const updateTriggers = [...sql.matchAll(/create trigger [a-z_]+ after update on public\.([a-z_]+)[\s\S]*?execute function public\.log_workflow_record_update\(\);/gi)]
    .map(match => match[1]);
  const mappings = new Map([...body.matchAll(/when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/gi)]
    .map(match => [match[1], match[2]]));
  const entityConstraint = /entity_type text not null check \(entity_type in \(([^)]+)\)\)/i.exec(sql)?.[1] || "";
  const allowedEntities = new Set([...entityConstraint.matchAll(/'([a-z_]+)'/gi)].map(match => match[1]));

  assert.ok(updateTriggers.length > 0, "The migration should audit workflow updates.");
  for (const table of updateTriggers) {
    assert.ok(mappings.has(table), `${table} updates need an activity entity mapping.`);
    assert.ok(allowedEntities.has(mappings.get(table)), `${table} maps to an entity type rejected by workflow_activity.`);
  }
});

test("issued quote terms and sent invoice totals are locked at the database boundary", () => {
  const quoteGuard = functionBody("protect_accepted_quote");
  assert.match(quoteGuard, /new\.accepted_at is distinct from old\.accepted_at/);
  assert.match(quoteGuard, /old\.status <> 'draft'[\s\S]*?new\.subtotal_pence is distinct from old\.subtotal_pence/);
  assert.match(quoteGuard, /new\.sent_at is distinct from old\.sent_at/);
  assert.match(functionBody("protect_paid_invoice_balance"), /old\.status = 'draft' and new\.status = 'sent'[\s\S]*?new\.subtotal_pence is distinct from old\.subtotal_pence/);
});

test("every SECURITY DEFINER workflow trigger uses an empty search path", () => {
  const privilegedFunctions = [
    "validate_accepted_work_order_quote", "protect_accepted_quote", "protect_paid_invoice_balance",
    "prevent_calendar_overlap", "prevent_invoice_overpayment", "log_workflow_record_update",
    "log_workflow_record_created", "log_availability_block_deleted"
  ];
  for (const name of privilegedFunctions) {
    const definition = new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?security definer set search_path = ''`, "i");
    assert.match(sql, definition, `${name} must not resolve privileged names through public.`);
  }
});

test("database status guards exactly match the mobile workflow and protect direct API updates", () => {
  const guard = functionBody("enforce_workflow_status_transition");
  const guardedTables = ["quotes", "work_orders", "appointments", "invoices"];
  const uiTypes = { quotes:"quote", work_orders:"work_order", appointments:"appointment", invoices:"invoice" };
  const uiStates = {
    quote:["draft", "sent", "accepted", "rejected", "expired", "superseded"],
    work_order:["accepted", "ready_to_build", "in_progress", "quality_check", "ready_for_install", "installation_scheduled", "installed", "completed", "cancelled"],
    appointment:["scheduled", "confirmed", "cancelled", "completed"],
    invoice:["draft", "sent", "void"]
  };
  const databaseTransitions = new Set([...guard.matchAll(/'([a-z_]+>[a-z_]+)'/g)].map(match => match[1]));
  const appTransitions = new Set();
  for (const [type, states] of Object.entries(uiStates)) {
    for (const state of states) {
      for (const next of allowedNextStatuses(type, state).slice(1)) appTransitions.add(`${state}>${next}`);
    }
  }

  assert.deepEqual(databaseTransitions, appTransitions);
  for (const [table, initial] of Object.entries({ quotes:"draft", work_orders:"accepted", appointments:"scheduled", invoices:"draft" })) {
    assert.match(guard, new RegExp(`when '${table}' then '${initial}'`));
  }
  for (const table of guardedTables) {
    assert.match(sql, new RegExp(`create trigger ${table}_validate_status before insert or update of status on public\\.${table}`, "i"));
  }
  assert.match(guard, /invalid status transition/i);
});

test("meaningful workflow changes queue private teammate push alerts without financial or customer values", async () => {
  const pushSql = await readFile(new URL("./migrations/20261008120000_workflow_push_notifications.sql", import.meta.url), "utf8");
  for (const table of ["quotes", "work_orders", "appointments", "invoices", "invoice_payments"]) {
    assert.match(pushSql, new RegExp(`create trigger [a-z_]+ after [^;]* on public\\.${table}\\b`, "i"), `${table} should queue workflow notifications.`);
  }
  assert.match(pushSql, /insert into public\.notification_events \(request_id, channel, event_type, payload, delivery_status, next_attempt_at\)/i);
  assert.match(pushSql, /'workflow_update'/);
  assert.match(pushSql, /'exclude_user_id', auth\.uid\(\)/);
  assert.match(pushSql, /'view', target_view/);
  assert.doesNotMatch(pushSql, /customer_name|postcode|total_pence|amount_pence|bill_to_address/i);
  assert.match(pushSql, /create or replace function public\.claim_notification_event\(p_event_id uuid\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(pushSql, /grant execute on function public\.claim_notification_event\(uuid\) to service_role/i);
});

test("staff policies cannot hard-delete enquiries or financial workflow records", () => {
  const protectedTables = ["consultation_requests", "quotes", "work_orders", "appointments", "follow_up_tasks", "invoices", "invoice_payments"];
  const deletingPolicies = [...sql.matchAll(/create policy[^;]+?on public\.([a-z_]+)\s+for\s+(all|delete)\b/gi)]
    .map(match => ({ table:match[1], command:match[2].toLowerCase() }))
    .filter(policy => protectedTables.includes(policy.table));

  assert.deepEqual(deletingPolicies, []);
  assert.match(sql, /drop policy if exists "staff manage requests" on public\.consultation_requests/i);
});

test("the workflow migration enables Realtime for every live Operations data source", () => {
  const liveTables = ["consultation_requests", "availability_blocks", "profiles", "quotes", "work_orders", "appointments", "follow_up_tasks", "invoices", "invoice_payments", "workflow_activity"];
  const publicationBlock = /foreach realtime_table in array array\[([\s\S]*?)\] loop([\s\S]*?)end loop;/i.exec(sql);
  assert.ok(publicationBlock, "The migration should safely add live Operations tables to Supabase Realtime.");
  for (const table of liveTables) {
    assert.match(publicationBlock[1], new RegExp(`[\\'\\"]${table}[\\'\\"]`), `${table} must publish changes.`);
    assert.match(operationsApp, new RegExp(`realtimeTables\\s*=\\s*\\[[^\\]]*[\\'\\"]${table}[\\'\\"]`), `${table} must have a client subscription.`);
  }
  assert.match(publicationBlock[2], /pg_publication_tables/i, "Existing publication membership should be checked before altering it.");
  assert.match(operationsApp, /liveChannel\.on\("postgres_changes", \{ event:"\*", schema:"public", table \}, scheduleLiveRefresh\)/);
  assert.match(operationsApp, /clearTimeout\(liveRefreshTimer\)/, "Burst updates should be grouped into one app refresh.");
});

test("invoice setup starts empty, protects edits to owners and publishes changes to the team", async () => {
  const settings = await readFile(new URL("./migrations/20261009100000_invoice_business_settings.sql", import.meta.url), "utf8");
  const invoiceDocument = await readFile(new URL("../operations/invoice-document.mjs", import.meta.url), "utf8");
  assert.match(settings, /create table public\.business_settings/);
  assert.match(settings, /legal_name text not null/);
  assert.match(settings, /billing_address text not null/);
  assert.match(settings, /contact_email text not null/);
  assert.match(settings, /create policy "staff read business settings"[\s\S]*?for select using \(public\.is_staff\(\)\)/i);
  assert.match(settings, /create policy "owners update business settings"[\s\S]*?p\.role = 'owner'/i);
  assert.match(settings, /alter publication supabase_realtime add table public\.business_settings/i);
  assert.doesNotMatch(settings, /insert into public\.business_settings/i, "Unknown legal and tax data must never be seeded.");
  assert.match(invoiceDocument, /DRAFT · NOT SENT/);
  assert.match(invoiceDocument, /replace\(\/\[&<>"'\]/, "Customer and seller text must be escaped for printable HTML.");
});

test("public enquiry rate limiting stores only short-lived HMAC fingerprints and is server-only", async () => {
  const limiter = await readFile(new URL("./migrations/20261009150000_public_enquiry_rate_limits.sql", import.meta.url), "utf8");
  const cleanupSchedule = await readFile(new URL("./schedule_enquiry_rate_limit_cleanup.sql", import.meta.url), "utf8");
  const retentionAudit = await readFile(new URL("./audit_public_enquiry_retention.sql", import.meta.url), "utf8");
  const handler = await readFile(new URL("./functions/submit-enquiry/handler.mjs", import.meta.url), "utf8");
  assert.match(limiter, /create table public\.enquiry_rate_limits[\s\S]*?fingerprint text primary key/);
  assert.match(limiter, /create table public\.enquiry_rate_limit_keys[\s\S]*?idempotency_key uuid primary key[\s\S]*?created_at timestamptz/i);
  assert.match(limiter, /alter table public\.enquiry_rate_limit_keys enable row level security[\s\S]*?revoke all on table public\.enquiry_rate_limits, public\.enquiry_rate_limit_keys from public, anon, authenticated/i);
  assert.match(limiter, /insert into public\.enquiry_rate_limit_keys[\s\S]*?on conflict \(idempotency_key\) do nothing[\s\S]*?if not found then[\s\S]*?return query select true, 0/i);
  assert.match(limiter, /if v_hits > p_limit then[\s\S]*?delete from public\.enquiry_rate_limit_keys/i);
  assert.match(limiter, /updated_at < v_now - interval '24 hours'[\s\S]*?order by updated_at[\s\S]*?limit 100[\s\S]*?for update skip locked/i);
  assert.match(limiter, /on conflict \(fingerprint\) do update[\s\S]*?hit_count = case[\s\S]*?else limits\.hit_count \+ 1/i);
  assert.match(limiter, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(limiter, /revoke all on function public\.consume_public_enquiry_slot\(uuid, text, integer, integer\) from public, anon, authenticated/i);
  assert.match(limiter, /grant execute on function public\.consume_public_enquiry_slot\(uuid, text, integer, integer\) to service_role/i);
  assert.match(limiter, /create or replace function public\.cleanup_public_enquiry_rate_limits\(\)[\s\S]*?delete from public\.enquiry_rate_limits where updated_at < v_cutoff[\s\S]*?delete from public\.enquiry_rate_limit_keys where created_at < v_cutoff/i);
  assert.match(limiter, /create or replace function public\.cleanup_public_enquiry_rate_limits\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i);
  assert.match(limiter, /revoke all on function public\.cleanup_public_enquiry_rate_limits\(\) from public, anon, authenticated/i);
  assert.match(limiter, /grant execute on function public\.cleanup_public_enquiry_rate_limits\(\) to service_role/i);
  assert.match(cleanupSchedule, /cron\.schedule\([\s\S]*?'form-frame-enquiry-rate-limit-cleanup'[\s\S]*?'\* \* \* \* \*'[\s\S]*?select public\.cleanup_public_enquiry_rate_limits\(\);'/i);
  assert.match(cleanupSchedule, /conflicting enquiry cleanup job already exists/i);
  assert.match(retentionAudit, /matches_expected_cleanup/i);
  assert.match(retentionAudit, /from cron\.job_run_details[\s\S]*?order by start_time desc[\s\S]*?limit 10/i);
  assert.doesNotMatch(retentionAudit, /\b(insert\s+into|update\s+\w|delete\s+from|alter\s+|drop\s+|truncate\s+|cron\.schedule\s*\()/i);
  assert.match(handler, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(handler, /request\.headers\.get\("cf-connecting-ip"\)/);
  assert.match(handler, /p_idempotency_key:idempotencyKey,[\s\S]*?p_fingerprint:fingerprint,[\s\S]*?p_limit:10,[\s\S]*?p_window_seconds:3600/);
  assert.match(handler, /"Retry-After"/);
  assert.doesNotMatch(limiter, /client_ip|raw_ip|ip_address/i);
});
