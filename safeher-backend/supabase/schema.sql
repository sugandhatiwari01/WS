create table if not exists public.app_documents (
  id uuid primary key,
  collection text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_documents_collection_idx on public.app_documents (collection);
create index if not exists app_documents_data_idx on public.app_documents using gin (data);

insert into storage.buckets (id, name, public)
values ('emergency-audio', 'emergency-audio', false)
on conflict (id) do nothing;
