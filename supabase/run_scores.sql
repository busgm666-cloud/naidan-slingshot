-- 奶龙快跑排行榜
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次（要先执行过 workshop.sql，昵称过滤复用 workshop_text_blocked）。
-- 匿名玩家只能读成绩、交成绩；不能修改或删除。没有账号体系，所以只做"明显不可能的分数"兜底。

create table if not exists public.run_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  score integer not null,
  meters integer not null,
  coins integer not null default 0,
  stomps integer not null default 0,
  smashes integer not null default 0,
  run_seconds integer not null default 1,
  -- free = 自由跑；daily-20261018 = 那一天的每日赛道（同一天所有人同一条路）
  track text not null default 'free',
  created_at timestamptz not null default now(),
  status text not null default 'published',
  constraint run_scores_name_len check (char_length(name) between 1 and 12),
  constraint run_scores_meters check (meters between 0 and 200000),
  constraint run_scores_coins check (coins between 0 and 100000),
  constraint run_scores_stomps check (stomps between 0 and 50000),
  constraint run_scores_smashes check (smashes between 0 and 50000),
  constraint run_scores_seconds check (run_seconds between 1 and 7200),
  constraint run_scores_track check (track ~ '^(free|daily-[0-9]{8})$'),
  -- 得分 = 米数 + 奶滴×10 + 踩扁×100 + 撞碎×50；双倍积分时奶滴/踩扁最多再翻一倍
  constraint run_scores_score check (
    score >= meters + coins * 10 + stomps * 100 + smashes * 50
    and score <= meters + coins * 20 + stomps * 200 + smashes * 50
  ),
  -- 客户端最多约 90 米/秒（含所有加速叠加），再给开局 100 米余量
  constraint run_scores_speed check (meters <= run_seconds * 90 + 100),
  constraint run_scores_coin_rate check (coins <= meters * 5 + 500),
  constraint run_scores_status check (status in ('published', 'hidden'))
);

create index if not exists run_scores_score_idx on public.run_scores (score desc);
create index if not exists run_scores_created_at_idx on public.run_scores (created_at desc);
create index if not exists run_scores_track_idx on public.run_scores (track, score desc);
create unique index if not exists run_scores_track_name_uidx
  on public.run_scores (track, lower(name));

alter table public.run_scores enable row level security;

drop policy if exists "run scores public read" on public.run_scores;
create policy "run scores public read"
  on public.run_scores
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "run scores anonymous insert" on public.run_scores;
create policy "run scores anonymous insert"
  on public.run_scores
  for insert
  to anon, authenticated
  with check (status = 'published');

revoke all on table public.run_scores from anon, authenticated;
grant select, insert on table public.run_scores to anon, authenticated;

create or replace function public.run_scores_moderate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.run_scores%rowtype;
begin
  if public.workshop_text_blocked(new.name) then
    raise exception '昵称包含违禁词或广告联系方式' using errcode = '23514';
  end if;
  if new.meters > new.run_seconds * 90 + 100 then
    raise exception '成绩速度异常，已拒绝提交' using errcode = '23514';
  end if;
  if new.score < new.meters + new.coins * 10 + new.stomps * 100 + new.smashes * 50
     or new.score > new.meters + new.coins * 20 + new.stomps * 200 + new.smashes * 50 then
    raise exception '分数构成异常，已拒绝提交' using errcode = '23514';
  end if;
  -- 同一赛道、同一昵称串行处理，只保留最高分，避免重复插入灌表
  perform pg_advisory_xact_lock(hashtext(lower(new.name) || ':' || new.track)::bigint);
  select * into existing
    from public.run_scores
    where track = new.track and lower(name) = lower(new.name)
    for update;
  if found then
    if new.score > existing.score then
      update public.run_scores
        set score = new.score,
            meters = new.meters,
            coins = new.coins,
            stomps = new.stomps,
            smashes = new.smashes,
            run_seconds = new.run_seconds,
            created_at = now()
        where id = existing.id;
    end if;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists run_scores_moderate_trigger on public.run_scores;
create trigger run_scores_moderate_trigger
  before insert on public.run_scores
  for each row execute function public.run_scores_moderate();
