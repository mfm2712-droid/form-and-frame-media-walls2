-- Pin SECURITY DEFINER routines to the implicit pg_catalog search path.
-- Every application relation and auth helper referenced by these functions is
-- schema-qualified; this prevents name shadowing through the exposed public schema.

alter function public.is_staff() set search_path = '';
alter function public.validate_accepted_work_order_quote() set search_path = '';
alter function public.protect_accepted_quote() set search_path = '';
alter function public.protect_paid_invoice_balance() set search_path = '';
alter function public.prevent_calendar_overlap() set search_path = '';
alter function public.prevent_invoice_overpayment() set search_path = '';
alter function public.log_workflow_record_update() set search_path = '';
alter function public.log_workflow_record_created() set search_path = '';
alter function public.log_availability_block_deleted() set search_path = '';
alter function public.claim_new_enquiry_notification(uuid, text, jsonb, boolean) set search_path = '';
