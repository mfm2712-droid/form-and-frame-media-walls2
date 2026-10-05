-- Owner-managed legal seller details and payment text used for printable
-- invoices. No defaults fabricate company, tax or bank details.

create table public.business_settings (
  singleton boolean primary key default true check (singleton),
  legal_name text not null check (char_length(btrim(legal_name)) between 2 and 160),
  billing_address text not null check (char_length(btrim(billing_address)) between 5 and 1200),
  contact_email text not null check (contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_phone text not null default '' check (char_length(contact_phone) <= 60),
  company_number text not null default '' check (char_length(company_number) <= 80),
  vat_number text not null default '' check (char_length(vat_number) <= 80),
  payment_instructions text not null default '' check (char_length(payment_instructions) <= 2000),
  invoice_footer text not null default '' check (char_length(invoice_footer) <= 1200),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.business_settings enable row level security;

create policy "staff read business settings" on public.business_settings
for select using (public.is_staff());

create policy "owners create business settings" on public.business_settings
for insert with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'owner'
));

create policy "owners update business settings" on public.business_settings
for update using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'owner'
)) with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'owner'
));

comment on table public.business_settings is 'Owner-only legal seller and invoice payment text; intentionally starts empty until the business confirms its own details.';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'The supabase_realtime publication is required for shared invoice setup.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'business_settings'
  ) then
    alter publication supabase_realtime add table public.business_settings;
  end if;
end;
$$;
