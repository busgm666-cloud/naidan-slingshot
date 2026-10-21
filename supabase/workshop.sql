-- 奶蛋弹弓社区投稿表
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次。
-- 匿名玩家只能读取已发布关卡、插入新关卡；不能修改或删除已有内容。

create table if not exists public.workshop_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  author text not null default '匿名玩家',
  created_at timestamptz not null default now(),
  status text not null default 'published',
  constraint workshop_code_len check (char_length(code) between 40 and 5000),
  constraint workshop_name_len check (char_length(name) between 1 and 30),
  constraint workshop_author_len check (char_length(author) between 1 and 30),
  constraint workshop_status check (status in ('published', 'hidden'))
);

create index if not exists workshop_levels_created_at_idx
  on public.workshop_levels (created_at desc);

alter table public.workshop_levels enable row level security;

drop policy if exists "workshop public read" on public.workshop_levels;
create policy "workshop public read"
  on public.workshop_levels
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "workshop anonymous insert" on public.workshop_levels;
create policy "workshop anonymous insert"
  on public.workshop_levels
  for insert
  to anon, authenticated
  with check (
    status = 'published'
    and char_length(code) between 40 and 5000
    and char_length(name) between 1 and 30
    and char_length(author) between 1 and 30
  );

revoke all on table public.workshop_levels from anon, authenticated;
grant select, insert on table public.workshop_levels to anon, authenticated;

-- 每周五 24:00 锁定的点赞前 6 名。先写入的客户端决定本周快照，之后只读。
create table if not exists public.workshop_weekly (
  week_key text primary key,
  level_ids text[] not null,
  created_at timestamptz not null default now(),
  constraint workshop_weekly_size check (array_length(level_ids, 1) between 1 and 6)
);

alter table public.workshop_weekly enable row level security;

drop policy if exists "workshop weekly read" on public.workshop_weekly;
create policy "workshop weekly read"
  on public.workshop_weekly
  for select
  to anon, authenticated
  using (true);

drop policy if exists "workshop weekly insert" on public.workshop_weekly;
create policy "workshop weekly insert"
  on public.workshop_weekly
  for insert
  to anon, authenticated
  with check (array_length(level_ids, 1) between 1 and 6);

revoke all on table public.workshop_weekly from anon, authenticated;
grant select, insert on table public.workshop_weekly to anon, authenticated;

-- 关卡名 / 玩家署名的服务端兜底过滤。
-- 网页端先提示，这里负责拦住绕过网页直接调用 REST API 的请求。
create or replace function public.workshop_text_blocked(input text)
returns boolean
language plpgsql
immutable
as $$
declare
  raw text := lower(coalesce(input, ''));
  compact text;
begin
  compact := regexp_replace(raw, '[\s\-_.·•*~|/\\]+', '', 'g');
  compact := translate(compact, '013457@$', 'oieastas');

  if compact ~ '(傻逼|煞笔|沙比|操你妈|草你妈|你妈死了|死全家|婊子|贱人|杂种|狗东西|去死吧|支那|黑鬼|尼哥|爸爸|父亲|妈妈|母亲|爹地|妈咪|爷爷|奶奶|外公|外婆|姥爷|姥姥|哥哥|姐姐|弟弟|妹妹|儿子|女儿|叔叔|阿姨|舅舅|舅妈|姑姑|姑父|姨妈|姨父|表哥|表姐|表弟|表妹|堂哥|堂姐|堂弟|堂妹|岳父|岳母|公公|婆婆|女婿|儿媳|亲戚|强奸|轮奸|迷奸|恋童|儿童色情|幼女|裸聊|约炮|嫖娼|卖淫|色情|成人视频|黄片|制毒|贩毒|冰毒|海洛因|炸弹制作|造枪|卖枪|枪支交易|恐怖袭击|杀人教程|买凶|博彩|网赌|赌博网站|代开发票|刷单|兼职日结|贷款秒批|办证|代孕|卖肾|器官买卖|洗钱|加微信|加qq|扫码返利)' then
    return true;
  end if;
  if raw ~ '(https?://|www\.)' or raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    return true;
  end if;
  if raw ~ '(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)' then
    return true;
  end if;
  if raw ~ '(微信|weixin|vx|v信|qq|扣扣)[[:space:]]*[:：]?[[:space:]]*[a-z0-9_-]{5,}' then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.workshop_levels_moderate()
returns trigger
language plpgsql
as $$
begin
  if public.workshop_text_blocked(new.name) then
    raise exception '关卡名包含违禁词或广告联系方式' using errcode = '23514';
  end if;
  if public.workshop_text_blocked(new.author) then
    raise exception '用户名包含违禁词或广告联系方式' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workshop_levels_moderate_trigger on public.workshop_levels;
create trigger workshop_levels_moderate_trigger
  before insert or update on public.workshop_levels
  for each row execute function public.workshop_levels_moderate();
