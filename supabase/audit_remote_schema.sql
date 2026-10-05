-- READ ONLY. First verify the dashboard project reference is
-- otqzhocismdjbvvsjnpe, then run this in that project's SQL Editor before
-- reconciling migration history or applying local migrations. This inspects
-- schema metadata only; it does not select customer rows or modify the database.

-- 1. Inspect the database name and whether a tracked migration ledger exists.
select current_database() as database_name,
       to_regclass('supabase_migrations.schema_migrations') as migration_ledger;

-- 2. Compare the deployed public table/column definitions with local SQL.
select c.relname as table_name,
       a.attnum as column_position,
       a.attname as column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
       not a.attnotnull as is_nullable,
       pg_get_expr(d.adbin, d.adrelid) as default_expression,
       a.attgenerated as generated_kind
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attnum;

-- 3. Inspect check, foreign-key, unique, exclusion and primary-key definitions.
select n.nspname as schema_name,
       c.relname as table_name,
       con.conname as constraint_name,
       con.contype as constraint_type,
       pg_get_constraintdef(con.oid, true) as definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class c on c.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, con.conname;

-- 4. Inspect indexes, including partial-index predicates.
select schemaname as schema_name,
       tablename as table_name,
       indexname as index_name,
       indexdef as definition
from pg_catalog.pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- 5. Confirm row-level security flags and staff policies.
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

select schemaname as schema_name,
       tablename as table_name,
       policyname as policy_name,
       permissive,
       roles,
       cmd as command,
       qual as using_expression,
       with_check
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 6. Compare deployed trigger definitions with the local migrations.
select n.nspname as schema_name,
       c.relname as table_name,
       t.tgname as trigger_name,
       pg_get_triggerdef(t.oid, true) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
order by c.relname, t.tgname;

-- 7. List installed extensions and versions relevant to migration safety.
select extname as extension_name, extversion as version
from pg_catalog.pg_extension
order by extname;

-- 8. Read-only gate for the local business workflow migration. Any failed
-- prerequisite must be resolved before applying SQL; a missing migration
-- ledger means the baseline must be reconciled before using `supabase db push`.
with checks(check_name, passed, detail) as (
  values
    ('migration ledger exists', to_regclass('supabase_migrations.schema_migrations') is not null,
      coalesce(to_regclass('supabase_migrations.schema_migrations')::text, 'missing; reconcile the manually-created baseline first')),
    ('profiles table exists', to_regclass('public.profiles') is not null,
      coalesce(to_regclass('public.profiles')::text, 'missing')),
    ('consultation_requests table exists', to_regclass('public.consultation_requests') is not null,
      coalesce(to_regclass('public.consultation_requests')::text, 'missing')),
    ('availability_blocks table exists', to_regclass('public.availability_blocks') is not null,
      coalesce(to_regclass('public.availability_blocks')::text, 'missing')),
    ('request_status type exists', to_regtype('public.request_status') is not null,
      coalesce(to_regtype('public.request_status')::text, 'missing')),
    ('availability_kind type exists', to_regtype('public.availability_kind') is not null,
      coalesce(to_regtype('public.availability_kind')::text, 'missing')),
    ('is_staff function exists', to_regprocedure('public.is_staff()') is not null,
      coalesce(to_regprocedure('public.is_staff()')::text, 'missing')),
    ('touch_updated_at trigger function exists', to_regprocedure('public.touch_updated_at()') is not null,
      coalesce(to_regprocedure('public.touch_updated_at()')::text, 'missing')),
    ('public enquiry cleanup function exists', to_regprocedure('public.cleanup_public_enquiry_rate_limits()') is not null,
      coalesce(to_regprocedure('public.cleanup_public_enquiry_rate_limits()')::text, 'missing')),
    ('quotes table is available', to_regclass('public.quotes') is null,
      coalesce(to_regclass('public.quotes')::text, 'not present')),
    ('work_orders table is available', to_regclass('public.work_orders') is null,
      coalesce(to_regclass('public.work_orders')::text, 'not present')),
    ('appointments table is available', to_regclass('public.appointments') is null,
      coalesce(to_regclass('public.appointments')::text, 'not present')),
    ('follow_up_tasks table is available', to_regclass('public.follow_up_tasks') is null,
      coalesce(to_regclass('public.follow_up_tasks')::text, 'not present')),
    ('invoices table is available', to_regclass('public.invoices') is null,
      coalesce(to_regclass('public.invoices')::text, 'not present')),
    ('invoice_payments table is available', to_regclass('public.invoice_payments') is null,
      coalesce(to_regclass('public.invoice_payments')::text, 'not present')),
    ('workflow_activity table is available', to_regclass('public.workflow_activity') is null,
      coalesce(to_regclass('public.workflow_activity')::text, 'not present')),
    ('push_subscriptions table is available', to_regclass('public.push_subscriptions') is null,
      coalesce(to_regclass('public.push_subscriptions')::text, 'not present')),
    ('business_settings table is available', to_regclass('public.business_settings') is null,
      coalesce(to_regclass('public.business_settings')::text, 'not present')),
    ('enquiry_rate_limits table is available', to_regclass('public.enquiry_rate_limits') is null,
      coalesce(to_regclass('public.enquiry_rate_limits')::text, 'not present')),
    ('enquiry_rate_limit_keys table is available', to_regclass('public.enquiry_rate_limit_keys') is null,
      coalesce(to_regclass('public.enquiry_rate_limit_keys')::text, 'not present')),
    ('invoice_balances view is available', to_regclass('public.invoice_balances') is null,
      coalesce(to_regclass('public.invoice_balances')::text, 'not present')),
    ('work_order_financial_summary view is available', to_regclass('public.work_order_financial_summary') is null,
      coalesce(to_regclass('public.work_order_financial_summary')::text, 'not present')),
    ('quote_status type is available', to_regtype('public.quote_status') is null,
      coalesce(to_regtype('public.quote_status')::text, 'not present')),
    ('work_order_status type is available', to_regtype('public.work_order_status') is null,
      coalesce(to_regtype('public.work_order_status')::text, 'not present')),
    ('appointment_kind type is available', to_regtype('public.appointment_kind') is null,
      coalesce(to_regtype('public.appointment_kind')::text, 'not present')),
    ('appointment_status type is available', to_regtype('public.appointment_status') is null,
      coalesce(to_regtype('public.appointment_status')::text, 'not present')),
    ('invoice_status type is available', to_regtype('public.invoice_status') is null,
      coalesce(to_regtype('public.invoice_status')::text, 'not present'))
)
select check_name, passed, detail
from checks
order by passed asc, check_name;

-- 9. Read-only gate for the shared Operations Realtime subscriptions. The
-- migration adds only these public tables; it does not change publication
-- event settings or touch customer rows.
select pubname as publication_name,
       pg_catalog.pg_get_userbyid(pubowner) as publication_owner,
       pubinsert as publishes_inserts,
       pubupdate as publishes_updates,
       pubdelete as publishes_deletes,
       pubtruncate as publishes_truncates
from pg_catalog.pg_publication
where pubname = 'supabase_realtime';

select p.pubname as publication_name,
       pt.schemaname as schema_name,
       pt.tablename as table_name,
       pg_catalog.pg_get_userbyid(c.relowner) as table_owner,
       c.relrowsecurity as rls_enabled
from pg_catalog.pg_publication_tables pt
join pg_catalog.pg_publication p on p.pubname = pt.pubname
join pg_catalog.pg_namespace n on n.nspname = pt.schemaname
join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = pt.tablename
where pt.pubname = 'supabase_realtime'
  and pt.schemaname = 'public'
order by pt.tablename;

-- 10. Read-only preflight for retry-safe new-enquiry notifications. This must
-- return no rows before the migration adds its partial unique event index.
select request_id, channel, event_type, count(*) as duplicate_event_count
from public.notification_events
where request_id is not null
  and event_type = 'new_enquiry'
group by request_id, channel, event_type
having count(*) > 1
order by request_id, channel;

-- 11. Verify the fixed search path on every application SECURITY DEFINER
-- function. `search_path=""` ensures untrusted public objects cannot shadow
-- names used by privileged function code.
select p.proname as function_name,
       pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
       p.proconfig as function_settings,
       coalesce(p.proconfig @> array['search_path=""'], false) as empty_search_path
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.proname in (
    'is_staff', 'validate_accepted_work_order_quote', 'protect_accepted_quote',
    'protect_paid_invoice_balance', 'prevent_calendar_overlap',
    'prevent_invoice_overpayment', 'log_workflow_record_update',
    'log_workflow_record_created', 'log_availability_block_deleted',
    'claim_new_enquiry_notification', 'claim_notification_event',
    'queue_workflow_push_notification', 'consume_public_enquiry_slot',
    'cleanup_public_enquiry_rate_limits'
  )
order by p.proname;

-- 12. Confirm workflow push triggers are installed exactly on the intended
-- records. The trigger function stores a fixed title/body/section only; it
-- excludes customer names, contact details, addresses and invoice amounts.
select c.relname as table_name,
       t.tgname as trigger_name,
       pg_get_triggerdef(t.oid, true) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and t.tgname in ('quote_queue_push', 'work_order_queue_push', 'appointment_queue_push', 'invoice_queue_push', 'payment_queue_push')
order by c.relname, t.tgname;

-- 13. Confirm the anonymous abuse-prevention tables remain private, both
-- limiter functions are server-only, and scheduled cleanup is available.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'select') as staff_can_select
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('enquiry_rate_limits', 'enquiry_rate_limit_keys')
order by c.relname;

select p.oid::regprocedure as function_name,
       p.proconfig as function_settings,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as staff_can_execute,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('consume_public_enquiry_slot', 'cleanup_public_enquiry_rate_limits')
order by p.proname;
