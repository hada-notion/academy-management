-- (261123 실패 알리기·구독 꺼짐 감지) 노션 웹훅 구독이 끊긴 것을 서버가 알아채고, 그동안 사본 폴링을 15분 → 5분으로 되돌린다.
--
-- 알아채는 법(1안 — 폴링 대조): 15분 사본 폴링(app-copy-incremental)이 노션에서 바뀐 줄을 읽을 때, 앱 사본과 값이 다르고
-- 고친 지 2분이 넘었는데 그 줄의 웹훅 이벤트를 하나도 받지 않은 줄을 "놓친 줄"로 센다(sync-class-room-copy →
-- notion_subscription_poll_report). 구독이 살아 있으면 웹훅이 몇 초 안에 사본을 먼저 맞춰 두므로 값이 같다.
--   - 본문만 고친 줄 · 사본에 없는 칸만 고친 줄은 값이 같아서 세지 않는다(구독 이벤트가 원래 안 오는 고침).
--   - 놓친 줄이 2개 이상 쌓이고 그 사이 받은 이벤트가 하나도 없으면 "끊김"(down) → 폴링 5분.
--   - 서명이 맞는 이벤트가 하나라도 오면(트리거) 쌓인 수를 비우고, 끊김이었으면 "정상"(ok) → 폴링 15분.
--   - 아무도 노션을 고치지 않는 밤·주말은 놓친 줄도 없어 경고가 뜨지 않는다(헛경보 없음).
-- 끊긴 동안 버튼·자동화 요청: 폴링이 찾은 놓친 줄의 `요청`이 동작 ID면 대기열에 넣어 처리기가 넘긴다(5분 안).
-- 꺼짐 흉내(시험용, 실제 구독은 그대로): notion_subscription_simulate(분) — 그 시간 동안 받은 이벤트를 "거절(꺼짐 흉내)"로 적고
--   대기열에 넣지 않는다. 노션에는 200을 돌려줘 노션 쪽 실패 횟수는 늘지 않는다. notion_subscription_simulate(0)으로 바로 끝.
-- 기록: notion_subscription_log(끊김 · 되돌아옴 · 폴링 바꿈 · 흉내 시작/끝).
-- 폴링을 바꾸는 곳은 구독이 확인된 서버(notion_webhook_tokens에 줄이 있음)뿐이다. 구독 없는 학원은 5분 그대로.
-- 되돌리기: drop trigger notion_webhook_events_watch on public.notion_webhook_events;
--          drop trigger notion_webhook_events_simulate on public.notion_webhook_events;
--          select public.notion_subscription_poll_set(15);  -- 폴링 15분 고정(20261123020000 상태)
--          (함수 sync-class-room-copy는 표 · 함수가 없으면 감지를 건너뛴다)
-- 접근: RLS 켜고 정책 없음(서비스 역할만). 함수는 anon · authenticated가 부르지 못한다.

create table if not exists public.notion_subscription_health (
  id int primary key check (id = 1),
  state text not null default 'ok' check (state in ('ok', 'down')),
  since timestamptz,                -- 끊김으로 본 때
  reason text,                      -- 사람이 읽을 이유 한 줄
  missed int not null default 0,    -- 마지막 이벤트 뒤 쌓인 놓친 줄 수
  first_missed_at timestamptz,      -- 쌓인 놓친 줄 중 가장 이른 고친 시각
  last_missed_at timestamptz,
  last_report_at timestamptz,       -- 폴링이 마지막으로 대조한 때
  last_event_at timestamptz,        -- 마지막으로 받은 이벤트(서명 맞음)
  poll_min int,                     -- 지금 폴링 주기(분), 구독 없는 서버는 null
  simulate_until timestamptz,       -- 꺼짐 흉내 끝나는 때
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.notion_subscription_health (id) values (1) on conflict (id) do nothing;
alter table public.notion_subscription_health enable row level security;

create table if not exists public.notion_subscription_log (
  id bigserial primary key,
  at timestamptz not null default clock_timestamp(),
  event text not null,
  detail text
);
alter table public.notion_subscription_log enable row level security;

-- 폴링 주기 바꾸기(5 또는 15). 구독이 확인되지 않은 서버는 아무것도 하지 않는다. 부르는 본문은 원래 마이그레이션 그대로.
create or replace function public.notion_subscription_poll_set(p_min int) returns text
language plpgsql security definer set search_path = public, cron as $fn$
declare cur text; want text;
begin
  if p_min not in (5, 15) then raise exception '폴링은 5분 또는 15분만'; end if;
  if not exists (select 1 from public.notion_webhook_tokens) then return 'no-subscription'; end if;
  want := '*/' || p_min || ' * * * *';
  select schedule into cur from cron.job where jobname = 'app-copy-incremental';
  if cur is distinct from want then
    perform cron.schedule('app-copy-incremental', want, $cron$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $cron$);
    perform cron.schedule('class-room-copy-incremental', want, $cron$ select public.class_room_copy_incremental_step(); $cron$);
    insert into public.notion_subscription_log (event, detail) values ('poll', coalesce(cur, '없음') || ' → ' || want);
  end if;
  update public.notion_subscription_health set poll_min = p_min, updated_at = clock_timestamp() where id = 1;
  return want;
end;
$fn$;

-- 서명이 맞는 이벤트를 받으면: 쌓인 놓친 줄을 비우고, 끊김이었으면 되돌아옴 + 폴링 15분.
-- 꺼짐 흉내 중에는 이벤트가 "거절"로 바뀌어 들어오므로(아래 트리거) 여기 오지 않는다.
create or replace function public.notion_subscription_seen() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare was text;
begin
  if new.kind <> 'event' then return null; end if;
  select state into was from public.notion_subscription_health where id = 1 for update;
  update public.notion_subscription_health set last_event_at = new.received_at, missed = 0, first_missed_at = null,
    state = 'ok', since = null, reason = null, updated_at = clock_timestamp()
   where id = 1;
  if was = 'down' then
    insert into public.notion_subscription_log (event, detail) values ('ok', '이벤트를 다시 받음: ' || coalesce(new.event_type, '?'));
    perform public.notion_subscription_poll_set(15);
  end if;
  return null;
end;
$fn$;

-- 꺼짐 흉내: 흉내 시간 동안 받은 이벤트는 거절로 적는다(값 · 서명 검증 결과는 그대로, kind와 이유만).
create or replace function public.notion_subscription_simulate_mark() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.kind = 'event' and exists (select 1 from public.notion_subscription_health where id = 1 and simulate_until > clock_timestamp()) then
    new.kind := 'rejected';
    new.reason := '꺼짐 흉내(시험) — 받지 않은 것으로 침';
  end if;
  return new;
end;
$fn$;

drop trigger if exists notion_webhook_events_simulate on public.notion_webhook_events;
create trigger notion_webhook_events_simulate before insert on public.notion_webhook_events
  for each row execute function public.notion_subscription_simulate_mark();
drop trigger if exists notion_webhook_events_watch on public.notion_webhook_events;
create trigger notion_webhook_events_watch after insert on public.notion_webhook_events
  for each row when (new.kind = 'event') execute function public.notion_subscription_seen();

-- 대기열 넣기(20261123020000과 같고, 꺼짐 흉내 중 웹훅 이벤트는 넣지 않는다 — 'dropped').
-- 폴링이 넣는 요청(p_event_id = null)은 흉내 중에도 넣는다(끊긴 동안 버튼이 5분 안에 처리되는 길).
create or replace function public.notion_event_enqueue(p_event_id text, p_page_id text, p_data_source_id text, p_event_type text,
  p_event_time timestamptz, p_own_bot boolean, p_delay_ms int default 2000) returns text
language plpgsql security definer set search_path = public as $fn$
declare due timestamptz := clock_timestamp() + make_interval(secs => greatest(coalesce(p_delay_ms, 0), 0) / 1000.0);
begin
  if p_event_id is not null and exists (select 1 from public.notion_subscription_health where id = 1 and simulate_until > clock_timestamp()) then
    return 'dropped';
  end if;
  if p_event_id is not null then
    insert into public.notion_event_ids (event_id) values (p_event_id) on conflict (event_id) do nothing;
    if not found then return 'duplicate'; end if;
  end if;
  insert into public.notion_event_queue as q (page_id, data_source_id, event_type, event_id, event_time, due_at, own_bot)
  values (p_page_id, p_data_source_id, p_event_type, p_event_id, coalesce(p_event_time, clock_timestamp()), due, coalesce(p_own_bot, false))
  on conflict (page_id) do update set
    data_source_id = coalesce(excluded.data_source_id, q.data_source_id),
    event_type = case when excluded.event_time >= q.event_time then excluded.event_type else q.event_type end,
    event_id = case when excluded.event_time >= q.event_time then excluded.event_id else q.event_id end,
    event_time = greatest(q.event_time, excluded.event_time),
    own_bot = case when q.status in ('pending', 'retry') then q.own_bot and excluded.own_bot else excluded.own_bot end,
    events = case when q.status in ('pending', 'retry') then q.events + 1 else 1 end,
    first_received_at = case when q.status in ('pending', 'retry') then q.first_received_at else clock_timestamp() end,
    due_at = case when q.status = 'pending' then least(q.due_at, excluded.due_at) else excluded.due_at end,
    seq = q.seq + 1, status = 'pending', attempts = 0, result = null, error = null, done_at = null, notion_calls = null;
  return 'queued';
end;
$fn$;

-- 폴링 대조 결과 받기. p_items = [{ "page_id", "edited_at", "ds", "request": bool }] — 사본과 값이 다르고 고친 지 2분 넘은 줄.
-- 그중 이벤트를 받은 적 없는 줄(받은 시각 ≥ 고친 시각)이 놓친 줄. 놓친 줄이 쌓여 2개 이상이면 끊김 + 폴링 5분.
-- 놓친 줄의 요청은 대기열에 넣는다. 돌려주는 값: { state, missed, total, queued }.
create or replace function public.notion_subscription_poll_report(p_items jsonb, p_min_missed int default 2) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  it jsonb; pid text; edited timestamptz; n_missed int := 0; n_queued int := 0; oldest timestamptz; h record;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    pid := it->>'page_id'; edited := (it->>'edited_at')::timestamptz;
    if pid is null or edited is null then continue; end if;
    if exists (select 1 from public.notion_webhook_events e
                where e.kind = 'event' and e.received_at >= edited
                  and replace(lower(e.entity_id), '-', '') = replace(lower(pid), '-', '')) then
      continue;
    end if;
    n_missed := n_missed + 1;
    oldest := least(coalesce(oldest, edited), edited);
    if coalesce((it->>'request')::boolean, false) then
      perform public.notion_event_enqueue(null, pid, it->>'ds', 'page.properties_updated', clock_timestamp(), false, 0);
      n_queued := n_queued + 1;
    end if;
  end loop;
  update public.notion_subscription_health set
    missed = missed + n_missed,
    first_missed_at = case when n_missed > 0 then least(coalesce(first_missed_at, oldest), oldest) else first_missed_at end,
    last_missed_at = case when n_missed > 0 then clock_timestamp() else last_missed_at end,
    last_report_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = 1 returning * into h;
  if h.state = 'ok' and h.missed >= greatest(p_min_missed, 1) and exists (select 1 from public.notion_webhook_tokens) then
    update public.notion_subscription_health set state = 'down', since = clock_timestamp(),
      reason = '노션에서 고친 줄 ' || h.missed || '개를 웹훅으로 받지 못했어요(폴링이 찾음)' where id = 1 returning * into h;
    insert into public.notion_subscription_log (event, detail) values ('down', h.reason);
    perform public.notion_subscription_poll_set(5);
  end if;
  return jsonb_build_object('state', h.state, 'missed', n_missed, 'total', h.missed, 'queued', n_queued);
end;
$fn$;

-- 꺼짐 흉내 켜기(분) · 끄기(0). 원본 시험용 — 실제 구독은 건드리지 않는다.
create or replace function public.notion_subscription_simulate(p_minutes int) returns text
language plpgsql security definer set search_path = public as $fn$
begin
  if p_minutes is null or p_minutes < 0 or p_minutes > 120 then raise exception '0~120분'; end if;
  update public.notion_subscription_health set simulate_until = case when p_minutes = 0 then null else clock_timestamp() + make_interval(mins => p_minutes) end,
    updated_at = clock_timestamp() where id = 1;
  insert into public.notion_subscription_log (event, detail) values ('simulate', case when p_minutes = 0 then '흉내 끝' else '흉내 시작 ' || p_minutes || '분' end);
  return case when p_minutes = 0 then 'off' else 'on' end;
end;
$fn$;

-- 처음: 구독이 확인된 서버면 지금 폴링 주기를 기록(15분, 20261123020000이 바꿔 둠).
do $$
begin
  if exists (select 1 from public.notion_webhook_tokens) then
    update public.notion_subscription_health set poll_min = 15,
      last_event_at = (select max(received_at) from public.notion_webhook_events where kind = 'event') where id = 1;
  end if;
end $$;

revoke all on function public.notion_subscription_poll_set(int) from public, anon, authenticated;
revoke all on function public.notion_subscription_seen() from public, anon, authenticated;
revoke all on function public.notion_subscription_simulate_mark() from public, anon, authenticated;
revoke all on function public.notion_event_enqueue(text, text, text, text, timestamptz, boolean, int) from public, anon, authenticated;
revoke all on function public.notion_subscription_poll_report(jsonb, int) from public, anon, authenticated;
revoke all on function public.notion_subscription_simulate(int) from public, anon, authenticated;
