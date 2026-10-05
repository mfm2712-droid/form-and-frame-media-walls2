-- Read-only check for public-enquiry abuse-data retention.
-- Run after pg_cron is enabled and schedule_enquiry_rate_limit_cleanup.sql
-- has been applied in the dedicated Form & Frame Supabase project.

select jobid,
       jobname,
       username as job_owner,
       schedule,
       active,
       command,
       active
         and schedule = '* * * * *'
         and command = 'select public.cleanup_public_enquiry_rate_limits();'
         as matches_expected_cleanup
from cron.job
where jobname = 'form-frame-enquiry-rate-limit-cleanup';

select start_time,
       end_time,
       status,
       return_message
from cron.job_run_details
where jobid = (
  select jobid from cron.job
  where jobname = 'form-frame-enquiry-rate-limit-cleanup'
)
order by start_time desc
limit 10;

select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_can_read,
       has_table_privilege('authenticated', c.oid, 'select') as staff_can_read
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('enquiry_rate_limits', 'enquiry_rate_limit_keys')
order by c.relname;

select p.oid::regprocedure as function_name,
       coalesce(p.proconfig @> array['search_path=""'], false) as empty_search_path,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as staff_can_execute,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('consume_public_enquiry_slot', 'cleanup_public_enquiry_rate_limits')
order by p.proname;
