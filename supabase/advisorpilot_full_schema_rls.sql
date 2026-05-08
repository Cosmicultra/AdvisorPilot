-- AdvisorPilot full schema + RLS baseline.
-- Run this in the Supabase SQL editor before deploying the hardened app routes.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_advisorpilot_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.advisorpilot_clients (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text not null,
  client jsonb not null default '{}'::jsonb,
  holdings jsonb not null default '[]'::jsonb,
  meeting_notes text not null default '',
  demo_mode boolean not null default false,
  analysis jsonb,
  total_value numeric not null default 0,
  status text not null default 'Analyzed',
  last_contacted_at timestamptz,
  source text not null default 'advisor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  roth_worksheet jsonb
);

alter table public.advisorpilot_clients
  add column if not exists roth_worksheet jsonb,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists owner_email text,
  add column if not exists client jsonb not null default '{}'::jsonb,
  add column if not exists holdings jsonb not null default '[]'::jsonb,
  add column if not exists meeting_notes text not null default '',
  add column if not exists demo_mode boolean not null default false,
  add column if not exists analysis jsonb,
  add column if not exists total_value numeric not null default 0,
  add column if not exists status text not null default 'Analyzed',
  add column if not exists last_contacted_at timestamptz,
  add column if not exists source text not null default 'advisor',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists advisorpilot_clients_owner_email_idx
  on public.advisorpilot_clients (lower(owner_email));

create index if not exists advisorpilot_clients_owner_user_id_idx
  on public.advisorpilot_clients (owner_user_id);

create index if not exists advisorpilot_clients_updated_at_idx
  on public.advisorpilot_clients (updated_at desc);

drop trigger if exists set_advisorpilot_clients_updated_at on public.advisorpilot_clients;
create trigger set_advisorpilot_clients_updated_at
before update on public.advisorpilot_clients
for each row execute function public.set_advisorpilot_updated_at();

create table if not exists public.advisorpilot_advisor_profiles (
  owner_email text primary key,
  owner_user_id uuid references auth.users(id) on delete set null,
  email_signature text not null default '',
  logo_url text,
  advisor_name text,
  advisor_title text,
  advisor_license text,
  calendar_link text,
  office_address text,
  office_phone text,
  cell_phone text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advisorpilot_advisor_profiles
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists email_signature text not null default '',
  add column if not exists logo_url text,
  add column if not exists advisor_name text,
  add column if not exists advisor_title text,
  add column if not exists advisor_license text,
  add column if not exists calendar_link text,
  add column if not exists office_address text,
  add column if not exists office_phone text,
  add column if not exists cell_phone text,
  add column if not exists website text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists advisorpilot_profiles_owner_user_id_idx
  on public.advisorpilot_advisor_profiles (owner_user_id);

drop trigger if exists set_advisorpilot_advisor_profiles_updated_at on public.advisorpilot_advisor_profiles;
create trigger set_advisorpilot_advisor_profiles_updated_at
before update on public.advisorpilot_advisor_profiles
for each row execute function public.set_advisorpilot_updated_at();

create table if not exists public.advisorpilot_upload_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  advisor_user_id uuid references auth.users(id) on delete set null,
  advisor_owner_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  upload_count int not null default 0,
  max_upload_count int not null default 25,
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.advisorpilot_upload_tokens
  add column if not exists advisor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists max_upload_count int not null default 25,
  add column if not exists last_used_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists intake_snapshot jsonb;

create index if not exists advisorpilot_upload_tokens_advisor_email_idx
  on public.advisorpilot_upload_tokens (lower(advisor_owner_email));

create index if not exists advisorpilot_upload_tokens_advisor_user_idx
  on public.advisorpilot_upload_tokens (advisor_user_id);

create index if not exists advisorpilot_upload_tokens_expires_idx
  on public.advisorpilot_upload_tokens (expires_at);

drop trigger if exists set_advisorpilot_upload_tokens_updated_at on public.advisorpilot_upload_tokens;
create trigger set_advisorpilot_upload_tokens_updated_at
before update on public.advisorpilot_upload_tokens
for each row execute function public.set_advisorpilot_updated_at();

create table if not exists public.advisorpilot_documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text not null,
  client_id uuid references public.advisorpilot_clients(id) on delete set null,
  storage_bucket text not null default 'advisorpilot-statements',
  storage_path text not null,
  original_file_name text,
  mime_type text,
  file_size_bytes bigint,
  sha256 text,
  source text not null default 'advisor_upload',
  status text not null default 'uploaded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists advisorpilot_documents_owner_email_idx
  on public.advisorpilot_documents (lower(owner_email));

create index if not exists advisorpilot_documents_owner_user_id_idx
  on public.advisorpilot_documents (owner_user_id);

create index if not exists advisorpilot_documents_client_id_idx
  on public.advisorpilot_documents (client_id);

drop trigger if exists set_advisorpilot_documents_updated_at on public.advisorpilot_documents;
create trigger set_advisorpilot_documents_updated_at
before update on public.advisorpilot_documents
for each row execute function public.set_advisorpilot_updated_at();

create table if not exists public.advisorpilot_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_email text not null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists advisorpilot_audit_events_owner_email_idx
  on public.advisorpilot_audit_events (lower(owner_email));

create index if not exists advisorpilot_audit_events_owner_user_id_idx
  on public.advisorpilot_audit_events (owner_user_id);

create index if not exists advisorpilot_audit_events_created_at_idx
  on public.advisorpilot_audit_events (created_at desc);

alter table public.advisorpilot_clients enable row level security;
alter table public.advisorpilot_advisor_profiles enable row level security;
alter table public.advisorpilot_upload_tokens enable row level security;
alter table public.advisorpilot_documents enable row level security;
alter table public.advisorpilot_audit_events enable row level security;

drop policy if exists "advisorpilot_clients_select_own" on public.advisorpilot_clients;
drop policy if exists "advisorpilot_clients_insert_own" on public.advisorpilot_clients;
drop policy if exists "advisorpilot_clients_update_own" on public.advisorpilot_clients;
drop policy if exists "advisorpilot_clients_delete_own" on public.advisorpilot_clients;

create policy "advisorpilot_clients_select_own" on public.advisorpilot_clients
for select to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_clients_insert_own" on public.advisorpilot_clients
for insert to authenticated
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_clients_update_own" on public.advisorpilot_clients
for update to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_clients_delete_own" on public.advisorpilot_clients
for delete to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "advisorpilot_profiles_select_own" on public.advisorpilot_advisor_profiles;
drop policy if exists "advisorpilot_profiles_insert_own" on public.advisorpilot_advisor_profiles;
drop policy if exists "advisorpilot_profiles_update_own" on public.advisorpilot_advisor_profiles;
drop policy if exists "advisorpilot_profiles_delete_own" on public.advisorpilot_advisor_profiles;

create policy "advisorpilot_profiles_select_own" on public.advisorpilot_advisor_profiles
for select to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_profiles_insert_own" on public.advisorpilot_advisor_profiles
for insert to authenticated
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_profiles_update_own" on public.advisorpilot_advisor_profiles
for update to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_profiles_delete_own" on public.advisorpilot_advisor_profiles
for delete to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "advisorpilot_upload_tokens_select_own" on public.advisorpilot_upload_tokens;
drop policy if exists "advisorpilot_upload_tokens_insert_own" on public.advisorpilot_upload_tokens;
drop policy if exists "advisorpilot_upload_tokens_update_own" on public.advisorpilot_upload_tokens;
drop policy if exists "advisorpilot_upload_tokens_delete_own" on public.advisorpilot_upload_tokens;

create policy "advisorpilot_upload_tokens_select_own" on public.advisorpilot_upload_tokens
for select to authenticated
using (advisor_user_id = auth.uid() or lower(advisor_owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_upload_tokens_insert_own" on public.advisorpilot_upload_tokens
for insert to authenticated
with check (advisor_user_id = auth.uid() or lower(advisor_owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_upload_tokens_update_own" on public.advisorpilot_upload_tokens
for update to authenticated
using (advisor_user_id = auth.uid() or lower(advisor_owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (advisor_user_id = auth.uid() or lower(advisor_owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_upload_tokens_delete_own" on public.advisorpilot_upload_tokens
for delete to authenticated
using (advisor_user_id = auth.uid() or lower(advisor_owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "advisorpilot_documents_select_own" on public.advisorpilot_documents;
drop policy if exists "advisorpilot_documents_insert_own" on public.advisorpilot_documents;
drop policy if exists "advisorpilot_documents_update_own" on public.advisorpilot_documents;
drop policy if exists "advisorpilot_documents_delete_own" on public.advisorpilot_documents;

create policy "advisorpilot_documents_select_own" on public.advisorpilot_documents
for select to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_documents_insert_own" on public.advisorpilot_documents
for insert to authenticated
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_documents_update_own" on public.advisorpilot_documents
for update to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_documents_delete_own" on public.advisorpilot_documents
for delete to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "advisorpilot_audit_events_select_own" on public.advisorpilot_audit_events;
drop policy if exists "advisorpilot_audit_events_insert_own" on public.advisorpilot_audit_events;

create policy "advisorpilot_audit_events_select_own" on public.advisorpilot_audit_events
for select to authenticated
using (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "advisorpilot_audit_events_insert_own" on public.advisorpilot_audit_events
for insert to authenticated
with check (owner_user_id = auth.uid() or lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

insert into storage.buckets (id, name, public)
values ('advisorpilot-statements', 'advisorpilot-statements', false)
on conflict (id) do update set public = false;

drop policy if exists "advisorpilot_storage_select_own" on storage.objects;
drop policy if exists "advisorpilot_storage_insert_own" on storage.objects;
drop policy if exists "advisorpilot_storage_update_own" on storage.objects;
drop policy if exists "advisorpilot_storage_delete_own" on storage.objects;

create policy "advisorpilot_storage_select_own" on storage.objects
for select to authenticated
using (bucket_id = 'advisorpilot-statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "advisorpilot_storage_insert_own" on storage.objects
for insert to authenticated
with check (bucket_id = 'advisorpilot-statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "advisorpilot_storage_update_own" on storage.objects
for update to authenticated
using (bucket_id = 'advisorpilot-statements' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'advisorpilot-statements' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "advisorpilot_storage_delete_own" on storage.objects
for delete to authenticated
using (bucket_id = 'advisorpilot-statements' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
