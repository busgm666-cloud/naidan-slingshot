-- 奶蛋弹弓无尽模式排行榜
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次（要先执行过 workshop.sql，昵称过滤复用 workshop_text_blocked）。
-- 匿名玩家只能看成绩、交成绩；不能修改或删除。服务端会核对每一项得分来源，而不只看客户端报上来的总分。

create table if not exists public.slingshot_scores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  score integer not null,
  level integer not null,
  pigs integer not null default 0,
  blocks integer not null default 0,
  bosses integer not null default 0,
  bonus integer not null default 0,
  run_seconds integer not null default 1,
  created_at timestamptz not null default now(),
  status text not null default 'published',
  constraint slingshot_scores_name_len check (char_length(name) between 1 and 12),
  constraint slingshot_scores_level check (level between 1 and 100000),
  constraint slingshot_scores_pigs check (pigs between 0 and 200000),
  constraint slingshot_scores_blocks check (blocks between 0 and 500000),
  constraint slingshot_scores_bosses check (bosses between 0 and 20000),
  constraint slingshot_scores_bonus check (bonus between 0 and 500000000 and bonus % 10000 = 0),
  constraint slingshot_scores_seconds check (run_seconds between 1 and 604800),
  -- 得分必须能逐项拆开：普通奶蛙 5000、物块 500、boss 30000、剩余奶蛋奖励 10000 的整数倍
  constraint slingshot_scores_formula check (
    score::bigint = pigs::bigint * 5000 + blocks::bigint * 500 + bosses::bigint * 30000 + bonus::bigint
  ),
  -- 关数与数量上限给得很宽，只拦明显不可能批量灌进来的数据
  constraint slingshot_scores_level_rate check (level::bigint <= run_seconds::bigint * 3 + 2),
  constraint slingshot_scores_pig_rate check (pigs::bigint <= level::bigint * 100),
  constraint slingshot_scores_block_rate check (blocks::bigint <= level::bigint * 300),
  -- boss 每 10 关出现一次；没打到那一关就不可能拿到前面的 boss 分
  constraint slingshot_scores_boss_rate check (bosses::bigint <= level::bigint / 10),
  constraint slingshot_scores_bonus_rate check (bonus::bigint <= level::bigint * 200000),
  constraint slingshot_scores_total_rate check (score::bigint <= level::bigint * 1000000 + 500000),
  constraint slingshot_scores_status check (status in ('published', 'hidden'))
);

create index if not exists slingshot_scores_score_idx on public.slingshot_scores (score desc);
create index if not exists slingshot_scores_created_at_idx on public.slingshot_scores (created_at desc);
create unique index if not exists slingshot_scores_name_uidx
  on public.slingshot_scores (lower(name));

alter table public.slingshot_scores enable row level security;

drop policy if exists "slingshot scores public read" on public.slingshot_scores;
create policy "slingshot scores public read"
  on public.slingshot_scores
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "slingshot scores anonymous insert" on public.slingshot_scores;
create policy "slingshot scores anonymous insert"
  on public.slingshot_scores
  for insert
  to anon, authenticated
  with check (status = 'published');

revoke all on table public.slingshot_scores from anon, authenticated;
grant select, insert on table public.slingshot_scores to anon, authenticated;

create or replace function public.slingshot_scores_moderate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.slingshot_scores%rowtype;
begin
  if public.workshop_text_blocked(new.name) then
    raise exception '昵称包含违禁词或广告联系方式' using errcode = '23514';
  end if;
  if new.score::bigint <> new.pigs::bigint * 5000 + new.blocks::bigint * 500
       + new.bosses::bigint * 30000 + new.bonus::bigint then
    raise exception '分数构成异常，已拒绝提交' using errcode = '23514';
  end if;
  if new.level::bigint > new.run_seconds::bigint * 3 + 2 then
    raise exception '关卡进度速度异常，已拒绝提交' using errcode = '23514';
  end if;
  if new.bosses::bigint > new.level::bigint / 10 then
    raise exception 'boss 数量异常，已拒绝提交' using errcode = '23514';
  end if;
  -- 同名成绩串行处理，只保留最高分，避免重复插入灌表
  perform pg_advisory_xact_lock(hashtext(lower(new.name))::bigint);
  select * into existing
    from public.slingshot_scores
    where lower(name) = lower(new.name)
    for update;
  if found then
    if new.score > existing.score then
      update public.slingshot_scores
        set score = new.score,
            level = new.level,
            pigs = new.pigs,
            blocks = new.blocks,
            bosses = new.bosses,
            bonus = new.bonus,
            run_seconds = new.run_seconds,
            created_at = now()
        where id = existing.id;
    end if;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists slingshot_scores_moderate_trigger on public.slingshot_scores;
create trigger slingshot_scores_moderate_trigger
  before insert on public.slingshot_scores
  for each row execute function public.slingshot_scores_moderate();
