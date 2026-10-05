-- Run as the Supabase database owner/admin after pg_cron is enabled and the
-- enquiry rate-limit migration is applied. pg_cron runs jobs with the creator's
-- database privileges: https://github.com/citusdata/pg_cron#managing-and-creating-jobs
-- The one-minute job enforces physical expiry even when no enquiries arrive.
-- It stores no secret and can safely be run again if its existing definition
-- still matches.

do $$
declare
  v_existing_schedule text;
  v_existing_command text;
  v_existing_active boolean;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise exception 'Enable pg_cron for this project first.';
  end if;
  if to_regprocedure('public.cleanup_public_enquiry_rate_limits()') is null then
    raise exception 'Apply the public enquiry rate-limit migration first.';
  end if;

  select schedule, command, active
    into v_existing_schedule, v_existing_command, v_existing_active
  from cron.job
  where jobname = 'form-frame-enquiry-rate-limit-cleanup';

  if found then
    if v_existing_schedule <> '* * * * *'
      or v_existing_command <> 'select public.cleanup_public_enquiry_rate_limits();'
      or not v_existing_active then
      raise exception 'A conflicting enquiry cleanup job already exists; review cron.job manually.';
    end if;
    return;
  end if;

  perform cron.schedule(
    'form-frame-enquiry-rate-limit-cleanup',
    '* * * * *',
    'select public.cleanup_public_enquiry_rate_limits();'
  );
end;
$$;
