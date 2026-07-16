create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  legacy_login text unique,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, legacy_id)
);

create table public.property_members (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'edit', 'view')),
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

create table public.property_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  tariffs jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  custom_services jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.utility_records (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  month date not null check (extract(day from month) = 1),
  readings jsonb not null default '{}'::jsonb,
  costs jsonb not null default '{}'::jsonb,
  tariff_snapshot jsonb not null default '{}'::jsonb,
  total numeric(14, 2) not null default 0 check (total >= 0),
  payment_status text not null default 'charged' check (payment_status in ('charged', 'partial', 'paid')),
  paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0),
  note text not null default '',
  is_winter boolean not null default false,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, month),
  unique (property_id, legacy_id)
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  role text not null default 'view' check (role in ('view', 'edit')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Temporary bridge used during KV -> Supabase migration. It is never exposed to app roles.
create table public.legacy_accounts (
  login text primary key,
  pass_hash text,
  payload jsonb not null default '{}'::jsonb,
  migrated_user_id uuid references auth.users(id) on delete set null,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index utility_records_property_month_idx on public.utility_records (property_id, month desc);
create index property_members_user_idx on public.property_members (user_id, property_id);
create index share_links_property_idx on public.share_links (property_id) where revoked_at is null;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger properties_updated_at before update on public.properties for each row execute function public.set_updated_at();
create trigger property_settings_updated_at before update on public.property_settings for each row execute function public.set_updated_at();
create trigger utility_records_updated_at before update on public.utility_records for each row execute function public.set_updated_at();
create trigger legacy_accounts_updated_at before update on public.legacy_accounts for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.add_property_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.property_members (property_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (property_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger on_property_created
after insert on public.properties
for each row execute function public.add_property_owner();

create or replace function public.can_access_property(target_property_id uuid, allowed_roles text[] default array['owner','edit','view'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_members member
    where member.property_id = target_property_id
      and member.user_id = auth.uid()
      and member.role = any(allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_members enable row level security;
alter table public.property_settings enable row level security;
alter table public.utility_records enable row level security;
alter table public.share_links enable row level security;
alter table public.legacy_accounts enable row level security;

create policy profiles_select_self on public.profiles for select using (id = auth.uid());
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy properties_select_member on public.properties for select
using (owner_id = auth.uid() or public.can_access_property(id));
create policy properties_insert_owner on public.properties for insert
with check (owner_id = auth.uid());
create policy properties_update_editor on public.properties for update
using (public.can_access_property(id, array['owner','edit']))
with check (public.can_access_property(id, array['owner','edit']));
create policy properties_delete_owner on public.properties for delete
using (owner_id = auth.uid());

create policy members_select_related on public.property_members for select
using (user_id = auth.uid() or public.can_access_property(property_id, array['owner']));
create policy members_manage_owner on public.property_members for all
using (public.can_access_property(property_id, array['owner']))
with check (public.can_access_property(property_id, array['owner']));

create policy settings_select_member on public.property_settings for select
using (public.can_access_property(property_id));
create policy settings_insert_editor on public.property_settings for insert
with check (public.can_access_property(property_id, array['owner','edit']));
create policy settings_update_editor on public.property_settings for update
using (public.can_access_property(property_id, array['owner','edit']))
with check (public.can_access_property(property_id, array['owner','edit']));

create policy records_select_member on public.utility_records for select
using (public.can_access_property(property_id));
create policy records_insert_editor on public.utility_records for insert
with check (public.can_access_property(property_id, array['owner','edit']));
create policy records_update_editor on public.utility_records for update
using (public.can_access_property(property_id, array['owner','edit']))
with check (public.can_access_property(property_id, array['owner','edit']));
create policy records_delete_editor on public.utility_records for delete
using (public.can_access_property(property_id, array['owner','edit']));

create policy share_links_manage_owner on public.share_links for all
using (public.can_access_property(property_id, array['owner']))
with check (public.can_access_property(property_id, array['owner']));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.property_members to authenticated;
grant select, insert, update, delete on public.property_settings to authenticated;
grant select, insert, update, delete on public.utility_records to authenticated;
grant select, insert, update, delete on public.share_links to authenticated;

revoke all on public.legacy_accounts from anon, authenticated;
revoke execute on function public.can_access_property(uuid, text[]) from public, anon;
grant execute on function public.can_access_property(uuid, text[]) to authenticated;
