# OpenCode task: enquiry and notification security review

Status: prepared locally. Do not send this task or its source files to OpenCode until Mark explicitly authorizes sharing the four exact files listed below.

Codex completed an independent local review on 5 October 2026. It confirmed that the enquiry delivery event uses a unique request/channel key and a row-locked, service-role-only claim; push dispatch requires its private bearer token; retry workers reclaim only due events; and every routine named in the search-path hardening migration is defined by an earlier local migration. The review found one additional reporting defect: when all saved device endpoints had expired, the push sender could return `sent` with zero deliveries. The handler now returns `no_subscriptions`, removes those endpoints, and has a passing regression test. OpenCode has not received this task or the four source files; its independent review remains pending the explicit file-sharing authorization above.

Perform a read-only security and correctness review of the Form & Frame enquiry persistence and new-enquiry notification path. Do not edit files, create commits, contact external services, or send customer/test data. Report only concrete findings with file and line references, severity, and a practical fix.

Review these exact files:

- `supabase/functions/submit-enquiry/handler.mjs`
- `supabase/functions/push-new-enquiry/handler.mjs`
- `supabase/migrations/20261006100000_retryable_enquiry_notifications.sql`
- `supabase/migrations/20261007100000_harden_definer_search_paths.sql`

Focus on idempotency across repeated and concurrent submissions, private function authorization, whether partial push delivery remains retryable, whether the SQL claim function is serialized safely, and whether every function altered by the search-path migration exists in the expected earlier schema migrations.

Codex's offline review has already found and addressed three issues: the privileged SQL functions now use an empty search path; partial push delivery remains failed and retryable; and a batch where every saved endpoint has expired now returns `no_subscriptions` instead of falsely reporting `sent` with zero delivered devices. The local tests cover these checks; confirm any remaining concerns independently.
