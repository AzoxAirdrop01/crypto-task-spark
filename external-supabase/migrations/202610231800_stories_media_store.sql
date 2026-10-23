alter table public.stories add column if not exists media_store text not null default 'supabase' check (media_store in ('supabase','r2'));
