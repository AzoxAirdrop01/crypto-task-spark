-- Applied via Supabase migration "gaming_faces_referral_rewards" on 2026-10-22. Record only.
-- Gaming face: 1 = games page (referral pays the referrer 4000 only), 2 = referral page.
create table if not exists public.gaming_face (
  id int primary key default 1 check (id = 1),
  face smallint not null default 1 check (face in (1, 2)),
  updated_at timestamptz not null default now(),
  updated_by bigint
);
insert into public.gaming_face (id, face) values (1, 1) on conflict (id) do nothing;
alter table public.gaming_face enable row level security;
revoke all on public.gaming_face from anon, authenticated;
grant all on public.gaming_face to service_role;
-- get_gaming_face() / set_gaming_face(p_face int, p_admin bigint): security definer, service_role only.
create table if not exists public.referral_friend_picks (
  referrer_id bigint not null,
  friend_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (referrer_id, friend_id),
  check (referrer_id <> friend_id)
);
alter table public.referral_friend_picks enable row level security;
revoke all on public.referral_friend_picks from anon, authenticated;
grant all on public.referral_friend_picks to service_role;
-- record_friend_pick(p_referrer, p_friend) returns text: ok | self | no_referrer | already_registered | limit (max 1000 picks per referrer)
--   The 100-pick limit was raised to 1000 in Supabase by a separate applied migration "friend_pick_limit_1000"; record_friend_pick now allows up to 1000 saved friends per referrer.
alter table public.referrals
  add column if not exists contact_verified boolean not null default false,
  add column if not exists invitee_points integer not null default 0;
-- apply_referral_reward(p_referral_code, p_new_id): called by upsert_user for brand-new users only.
--   Face 1: referrer +4000, nobody else gets anything (a friend pick is ignored).
--   Face 2: referrer +5000; if the referrer picked this person: new user +3000 and 10 task units each
--           (user_tasks ids referral-contact-ref-<newId>[#n] for the referrer, referral-contact-new-<referrerId>[#n] for the new user).
--   One reward per referred user (referrals.referred_id is unique). Existing accounts never qualify.