# Submit enquiry function

The HTTP handler is separated from the Supabase Edge Runtime adapter so its request, persistence and notification behavior can be checked offline.

Run the fictional-data tests from the repository root:

```sh
node --test supabase/functions/submit-enquiry/handler.test.mjs
```

The test suite injects a fake database client, deterministic identifiers and fake notification senders. It makes no network requests and does not need project credentials. It covers CORS, malformed and oversized requests, field validation, honeypot rejection, HMACed edge-IP rate limits, missing server configuration, normalization, idempotency and unique-index races, and notification success/failure/tracking outcomes.

For production, configure `ENQUIRY_RATE_LIMIT_SECRET` as a Supabase Function Secret with at least 32 random characters and apply `20261009150000_public_enquiry_rate_limits.sql` after reconciling the existing migration history. New enquiries are limited to ten per edge address per hour. The database stores only a keyed HMAC fingerprint and random idempotency-key reservation; schedule `schedule_enquiry_rate_limit_cleanup.sql` to remove both after 24 hours even during periods without traffic. Sequential and concurrent retries of the same idempotency key consume only one slot, including while the first insert is still in flight. The endpoint fails closed when the limiter is unavailable; keep a valid `cf-connecting-ip` header supplied by the Supabase edge gateway.

These tests do not verify deployed Supabase policies, Edge Runtime behavior, Resend configuration or delivery to a real mailbox. Run separate tests against a dedicated test project only after its owner and data flow are confirmed.
