-- Form & Frame Operations Hub
-- Run in the Supabase SQL editor after creating the project.

create extension if not exists pgcrypto;

create type public.request_status as enum ('new', 'reviewing', 'date_requested', 'confirmed', 'quoted', 'won', 'lost', 'archived');
create type public.availability_kind as enum ('available', 'blocked', 'booked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create table public.consultation_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  created_at timestamptz not null default now(),
  status public.request_status not null default 'new',
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  email text,
  phone text,
  postcode text not null,
  wall_width text,
  message text,
  project_spec jsonb not null default '{}'::jsonb,
  guide_low integer,
  guide_high integer,
  preferred_start timestamptz,
  preferred_end timestamptz,
  source text not null default 'website' check (source in ('website', 'assistant', 'email', 'manual')),
  staff_notes text,
  assigned_to uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.request_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.consultation_requests(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  bytes integer not null check (bytes > 0),
  created_at timestamptz not null default now()
);

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind public.availability_kind not null default 'blocked',
  title text not null,
  request_id uuid references public.consultation_requests(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.consultation_requests(id) on delete cascade,
  channel text not null check (channel in ('email', 'push', 'webhook')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index consultation_requests_status_created_idx on public.consultation_requests(status, created_at desc);
create index availability_blocks_time_idx on public.availability_blocks(starts_at, ends_at);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'staff'));
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger consultation_requests_touch before update on public.consultation_requests
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.consultation_requests enable row level security;
alter table public.request_uploads enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.notification_events enable row level security;

create policy "staff read profiles" on public.profiles for select using (public.is_staff());
create policy "staff manage requests" on public.consultation_requests for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage uploads" on public.request_uploads for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage availability" on public.availability_blocks for all using (public.is_staff()) with check (public.is_staff());
create policy "staff read notifications" on public.notification_events for select using (public.is_staff());

-- Private bucket for room photos and inspiration uploads.
insert into storage.buckets (id, name, public) values ('project-uploads', 'project-uploads', false)
on conflict (id) do nothing;
create policy "staff read project uploads" on storage.objects for select using (bucket_id = 'project-uploads' and public.is_staff());

