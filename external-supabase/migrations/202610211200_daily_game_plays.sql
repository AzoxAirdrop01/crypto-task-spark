-- Record only: already applied to the production database. Do not re-run.
create table if not exists public.daily_game_plays (telegram_id bigint not null, game text not null, day date not null, started_at timestamptz not null default now(), primary key (telegram_id, game, day));
alter table public.daily_game_plays enable row level security;
revoke all on public.daily_game_plays from anon, authenticated;
create or replace function public.start_daily_play(p_telegram_id bigint, p_game text, p_day date) returns boolean language plpgsql security definer set search_path to 'public' as $$ declare v_n int; begin if p_telegram_id is null or p_day is null then raise exception 'invalid args'; end if; if p_game is null or p_game not in ('question','word') then raise exception 'invalid game'; end if; insert into public.daily_game_plays (telegram_id, game, day) values (p_telegram_id, p_game, p_day) on conflict (telegram_id, game, day) do nothing; get diagnostics v_n = row_count; return v_n > 0; end $$;
revoke all on function public.start_daily_play(bigint, text, date) from public, anon, authenticated;
grant execute on function public.start_daily_play(bigint, text, date) to service_role;
