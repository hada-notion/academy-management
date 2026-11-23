-- (261123 동기화 단계 2) 노션 웹훅 → 앱 사본 반영 대기열.
--
-- 함수 notion-events가 서명이 맞는 page.* 이벤트를 받으면 notion_event_enqueue로 "그 줄(page_id)"을 대기열에 넣는다.
--   - 같은 이벤트 id는 한 번만(notion_event_ids). 노션은 같은 이벤트를 최대 8번 다시 보낼 수 있다.
--   - 같은 줄의 이벤트는 한 줄로 합친다(seq가 오르고 다시 pending). 처리 중에 새 이벤트가 오면 seq가 달라져
--     처리 결과가 덮어쓰지 못하고 다시 처리된다 — 순서가 뒤섞여 와도 마지막에는 노션 지금 값을 다시 읽는다.
-- 처리기(_shared/notionEventsApply.ts)는 한 번에 하나만 돈다(notion_event_worker 임대). 그 줄만 노션에서 다시 읽어
-- 사본(app_rows · cr_*)을 고치거나 지우고 notion_event_finish로 결과를 적는다. 실패하면 retry(30초·1분·2분…), 6번이면 failed
-- (15분 폴링 · 밤 대조가 맞춘다).
-- 예약 notion-events-drain(1분마다): 할 일이 있을 때만 sync-class-room-copy {"mode":"events"}를 부른다(웹훅 때 바로 처리하지
-- 못한 것 · 재시도 몫). 사본 증분 폴링은 5분 → 15분(안전망, 웹훅 구독이 확인된 곳만). 밤 대조는 그대로.
-- 되돌리기(폴링 5분으로): select cron.schedule('app-copy-incremental', '*/5 * * * *', $c$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $c$);
--                         select cron.schedule('class-room-copy-incremental', '*/5 * * * *', $c$ select public.class_room_copy_incremental_step(); $c$);
-- 반영을 멈추기: select cron.unschedule('notion-events-drain'); 그리고 함수 설정 NOTION_EVENTS_APPLY=off(기록만 하던 때로).
-- 접근: RLS 켜고 정책 없음(서비스 역할만). 함수들은 anon · authenticated가 부르지 못한다.

create table if not exists public.notion_event_ids (
  event_id text primary key,
  received_at timestamptz not null default clock_timestamp()
);
alter table public.notion_event_ids enable row level security;

create table if not exists public.notion_event_queue (
  page_id text primary key,
  data_source_id text,
  event_type text not null,
  event_id text,
  event_time timestamptz not null,
  first_received_at timestamptz not null default clock_timestamp(),
  due_at timestamptz not null default clock_timestamp(),
  own_bot boolean not null default false,
  seq bigint not null default 1,
  events int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'retry', 'done', 'failed')),
  attempts int not null default 0,
  result text,
  error text,
  done_at timestamptz,
  notion_calls int
);
create index if not exists notion_event_queue_due_idx on public.notion_event_queue (status, due_at);
alter table public.notion_event_queue enable row level security;

create table if not exists public.notion_event_worker (
  id int primary key check (id = 1),
  owner text,
  lease_until timestamptz not null default '-infinity'
);
insert into public.notion_event_worker (id) values (1) on conflict (id) do nothing;
alter table public.notion_event_worker enable row level security;

-- 이벤트 하나 넣기. 'duplicate'(같은 이벤트 id를 이미 받음) 또는 'queued'.
-- p_own_bot = 작성자가 모두 이 학원 연동(서버가 쓴 결과, 메아리 후보). 같은 줄에 사람 이벤트가 섞이면 false.
create or replace function public.notion_event_enqueue(p_event_id text, p_page_id text, p_data_source_id text, p_event_type text,
  p_event_time timestamptz, p_own_bot boolean, p_delay_ms int default 2000) returns text
language plpgsql security definer set search_path = public as $fn$
declare due timestamptz := clock_timestamp() + make_interval(secs => greatest(coalesce(p_delay_ms, 0), 0) / 1000.0);
begin
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

-- 처리기 임대 + 할 일 가져오기. 다른 처리기가 임대 중이면 {"lease": false}. 임대는 부를 때마다 p_lease_sec만큼 늘어난다.
create or replace function public.notion_event_claim(p_owner text, p_limit int default 10, p_lease_sec int default 60) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare items jsonb;
begin
  update public.notion_event_worker set owner = p_owner, lease_until = clock_timestamp() + make_interval(secs => p_lease_sec)
   where id = 1 and (lease_until < clock_timestamp() or owner = p_owner);
  if not found then return jsonb_build_object('lease', false, 'items', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.due_at, t.event_time), '[]'::jsonb) into items from (
    select page_id, data_source_id, event_type, event_time, own_bot, seq, attempts, events, due_at
      from public.notion_event_queue
     where status in ('pending', 'retry') and due_at <= clock_timestamp()
     order by due_at, event_time limit greatest(p_limit, 1)) t;
  return jsonb_build_object('lease', true, 'items', items);
end;
$fn$;

-- 처리 결과. 처리하는 사이 같은 줄에 새 이벤트가 왔으면(seq 다름) 아무것도 바꾸지 않고 'superseded'(다시 처리됨).
create or replace function public.notion_event_finish(p_page_id text, p_seq bigint, p_ok boolean, p_result text, p_error text default null,
  p_retry_sec int default 30, p_notion_calls int default null) returns text
language plpgsql security definer set search_path = public as $fn$
declare st text;
begin
  if p_ok then
    update public.notion_event_queue set status = 'done', result = p_result, error = null, done_at = clock_timestamp(), notion_calls = p_notion_calls
     where page_id = p_page_id and seq = p_seq returning status into st;
  else
    update public.notion_event_queue set attempts = attempts + 1,
      status = case when attempts + 1 >= 6 then 'failed' else 'retry' end,
      result = p_result, error = left(p_error, 500), notion_calls = p_notion_calls,
      due_at = clock_timestamp() + make_interval(secs => greatest(p_retry_sec, 1))
     where page_id = p_page_id and seq = p_seq returning status into st;
  end if;
  return coalesce(st, 'superseded');
end;
$fn$;

create or replace function public.notion_event_release(p_owner text) returns void
language sql security definer set search_path = public as $fn$
  update public.notion_event_worker set lease_until = '-infinity' where id = 1 and owner = p_owner;
$fn$;

-- 지금 처리할 일이 있나(예약 실행이 빈 부름을 하지 않게).
create or replace function public.notion_event_due_count() returns int
language sql stable security definer set search_path = public as $fn$
  select count(*)::int from public.notion_event_queue where status in ('pending', 'retry') and due_at <= clock_timestamp();
$fn$;

create or replace function public.notion_events_drain_step() returns text
language plpgsql security definer set search_path = public as $fn$
begin
  if public.notion_event_due_count() = 0 then return 'idle'; end if;
  perform public.class_room_copy_call('{"mode":"events"}'::jsonb);
  return 'called';
end;
$fn$;

-- 오래된 기록 정리(매일 밤): 이벤트 id 3일(노션 재전송은 약 24시간 안), 끝난 대기열 7일, 수신 기록 30일.
create or replace function public.notion_events_prune() returns void
language sql security definer set search_path = public as $fn$
  delete from public.notion_event_ids where received_at < clock_timestamp() - interval '3 days';
  delete from public.notion_event_queue where status = 'done' and done_at < clock_timestamp() - interval '7 days';
  delete from public.notion_webhook_events where received_at < clock_timestamp() - interval '30 days';
$fn$;

revoke all on function public.notion_event_enqueue(text, text, text, text, timestamptz, boolean, int) from public, anon, authenticated;
revoke all on function public.notion_event_claim(text, int, int) from public, anon, authenticated;
revoke all on function public.notion_event_finish(text, bigint, boolean, text, text, int, int) from public, anon, authenticated;
revoke all on function public.notion_event_release(text) from public, anon, authenticated;
revoke all on function public.notion_event_due_count() from public, anon, authenticated;
revoke all on function public.notion_events_drain_step() from public, anon, authenticated;
revoke all on function public.notion_events_prune() from public, anon, authenticated;

do $$
declare j text;
begin
  foreach j in array array['notion-events-drain', 'notion-events-prune'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

select cron.schedule('notion-events-drain', '* * * * *', $cron$ select public.notion_events_drain_step(); $cron$);
select cron.schedule('notion-events-prune', '40 17 * * *', $cron$ select public.notion_events_prune(); $cron$);
-- 안전망: 사본 증분 폴링 5분 → 15분(웹훅이 줄 단위로 먼저 맞춘다). 부르는 본문은 원래 마이그레이션 그대로.
-- 웹훅 구독이 확인된 곳(notion_webhook_tokens에 줄이 있음)에서만 늘린다. 구독이 없는 학원에 이 파일이 적용돼도 5분 그대로다.
do $$
begin
  if exists (select 1 from public.notion_webhook_tokens) then
    perform cron.schedule('app-copy-incremental', '*/15 * * * *', $cron$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $cron$);
    perform cron.schedule('class-room-copy-incremental', '*/15 * * * *', $cron$ select public.class_room_copy_incremental_step(); $cron$);
  end if;
end $$;
