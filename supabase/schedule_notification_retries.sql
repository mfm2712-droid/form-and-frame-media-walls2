-- Run only after BOTH pg_cron and pg_net have been enabled in the Supabase
-- project's Extensions page, retry-notifications is deployed, and the same
-- private NOTIFICATION_RETRY_TOKEN is saved in Edge Function Secrets and
-- Supabase Vault under the name form_frame_notification_retry_token.
-- This creates one named job and keeps the token out of the repository/SQL.

do $$
declare
  existing_job record;
  expected_command text := $job$
    select net.http_post(
      url := 'https://otqzhocismdjbvvsjnpe.supabase.co/functions/v1/retry-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'form_frame_notification_retry_token'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'Enable pg_cron for this project first.';
  end if;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    raise exception 'Enable pg_net for this project first.';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is not available in this project.';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'form_frame_notification_retry_token'
      and length(decrypted_secret) >= 32
  ) then
    raise exception 'Store a random 32+ character retry token in Supabase Vault first.';
  end if;
  if (select count(*) from vault.decrypted_secrets
      where name = 'form_frame_notification_retry_token') <> 1 then
    raise exception 'Exactly one Form & Frame retry token must exist in Vault.';
  end if;

  select schedule, command, active into existing_job
  from cron.job where jobname = 'form-frame-notification-retries';
  if found then
    if existing_job.schedule <> '* * * * *'
       or existing_job.command <> expected_command
       or not existing_job.active then
      raise exception 'Existing notification retry job differs; review it before changing it.';
    end if;
    -- Preserve the existing job ID and run history when already configured.
    return;
  end if;
  perform cron.schedule(
    'form-frame-notification-retries', '* * * * *', expected_command
  );
end;
$$;
