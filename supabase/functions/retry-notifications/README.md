# Retry notifications

This private Supabase Edge Function processes at most 10 due `new_enquiry` email or push events per request. It atomically claims each event through `claim_new_enquiry_notification`, sends only the saved enquiry reference and required internal notice, and records the result. Temporary provider failures keep an exponential retry time capped at 16 minutes. Expired claims allow recovery if a function process stops before recording its outcome.

The request must be `POST` with `Authorization: Bearer <NOTIFICATION_RETRY_TOKEN>`. Supabase's gateway JWT check is disabled for this function because Supabase Cron calls it; the handler enforces the separate private token using a constant-time comparison. The scheduled SQL retrieves that token from Vault and does not store its value in the cron command or repository.

The function also needs the project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Email retries use `RESEND_API_KEY`, `NOTIFICATION_EMAIL` and `NOTIFICATION_FROM`; push retries call `push-new-enquiry` with `PUSH_DISPATCH_TOKEN`. Add all secrets only through Supabase Function Secrets, and configure the matching retry token in Vault before scheduling. See [`supabase/ACTIVATION_RUNBOOK.md`](../../ACTIVATION_RUNBOOK.md).

Run the offline fictional-data tests with:

```sh
node --test supabase/functions/retry-notifications/handler.test.mjs supabase/notification-retry.test.mjs
```

These checks do not verify the deployed schema, cron permissions, mail provider, VAPID setup or phone delivery. The worker is prepared locally and is not active until its migration, Edge Function, secrets and scheduled job are configured in the approved Form & Frame project.
