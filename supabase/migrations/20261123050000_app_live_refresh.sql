-- 관리 앱 열린 화면 자동 갱신(261123): 서버 사본(app_rows · cr_*)이 바뀌면 열린 앱에 "바뀜" 신호만 보낸다.
--
-- 신호 = Supabase Realtime 공개 채널 `hada-app`(realtime.send). 실리는 것은 DB 이름과 줄 수뿐이다(값 · 줄 id · 개인정보 없음).
-- 앱은 신호를 받으면 app-api `changes`(관리자 세션 필요)로 그 뒤 바뀐 줄과 지운 줄만 다시 읽는다. 노션은 부르지 않는다.
-- 신호가 실패해도 사본 쓰기는 막지 않는다(예외를 삼킴). realtime.send가 없는 곳(시험용 PGlite 등)에서는 신호만 건너뛴다.
-- 지운 줄은 app_row_gone에 남긴다(앱이 신호를 놓쳐도 `changes`로 따라잡게). 3일 지난 기록은 트리거가 정리한다.
-- 다시 적용해도 같은 결과다. 되돌리기는 맨 아래 주석.

create table if not exists public.app_row_gone (
  id text not null,
  db text not null,
  at timestamptz not null default now()
);
create index if not exists app_row_gone_at_idx on public.app_row_gone (at);
alter table public.app_row_gone enable row level security;
revoke all on public.app_row_gone from anon, authenticated;

-- 신호 보내기 한 곳. 실패는 삼킨다(사본 쓰기가 먼저).
create or replace function public.app_live_signal(payload jsonb, ev text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  begin
    execute 'select realtime.send($1, $2, $3, false)' using payload, ev, 'hada-app';
  exception when others then
    null;
  end;
end;
$fn$;
revoke all on function public.app_live_signal(jsonb, text) from public, anon, authenticated;

-- app_rows: 문장 하나에 신호 하나(DB별 줄 수). 값이 그대로인 다시 쓰기(5분 사본 · 밤 대조의 같은 값 upsert)는 세지 않는다.
create or replace function public.app_rows_live_ins() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare d jsonb; n int;
begin
  select coalesce(jsonb_agg(distinct db), '[]'::jsonb), count(*) into d, n from new_rows;
  if n > 0 then perform public.app_live_signal(jsonb_build_object('dbs', d, 'n', n), 'rows'); end if;
  return null;
end;
$fn$;

create or replace function public.app_rows_live_upd() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare d jsonb; n int;
begin
  select coalesce(jsonb_agg(distinct nw.db), '[]'::jsonb), count(*) into d, n
    from new_rows nw join old_rows o on o.id = nw.id
   where o.props is distinct from nw.props or o.notion_edited_at is distinct from nw.notion_edited_at
      or o.url is distinct from nw.url or o.icon is distinct from nw.icon or o.db is distinct from nw.db;
  if n > 0 then perform public.app_live_signal(jsonb_build_object('dbs', d, 'n', n), 'rows'); end if;
  return null;
end;
$fn$;

create or replace function public.app_rows_live_del() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare d jsonb; n int;
begin
  delete from public.app_row_gone where at < now() - interval '3 days';
  insert into public.app_row_gone (id, db) select id, db from old_rows;
  select coalesce(jsonb_agg(distinct db), '[]'::jsonb), count(*) into d, n from old_rows;
  if n > 0 then perform public.app_live_signal(jsonb_build_object('dbs', d, 'n', n), 'rows'); end if;
  return null;
end;
$fn$;

drop trigger if exists app_rows_live_ins on public.app_rows;
drop trigger if exists app_rows_live_upd on public.app_rows;
drop trigger if exists app_rows_live_del on public.app_rows;
create trigger app_rows_live_ins after insert on public.app_rows referencing new table as new_rows
  for each statement execute function public.app_rows_live_ins();
create trigger app_rows_live_upd after update on public.app_rows referencing old table as old_rows new table as new_rows
  for each statement execute function public.app_rows_live_upd();
create trigger app_rows_live_del after delete on public.app_rows referencing old table as old_rows
  for each statement execute function public.app_rows_live_del();

-- 수업 사본(cr_*): 표 이름만 알린다. 앱은 수업 화면이 열려 있을 때 그날 수업을 다시 받는다.
-- 5분 수업 사본이 같은 값을 다시 쓰는 것(synced_at만 바뀜)은 알리지 않는다.
create or replace function public.cr_live_signal() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if TG_OP = 'UPDATE' then
    select count(*) into n from new_rows nw join old_rows o on o.id = nw.id
     where (to_jsonb(o) - 'synced_at') is distinct from (to_jsonb(nw) - 'synced_at');
  elsif TG_OP = 'INSERT' then
    select count(*) into n from new_rows;
  else
    select count(*) into n from old_rows;
  end if;
  if n > 0 then perform public.app_live_signal(jsonb_build_object('cr', TG_TABLE_NAME, 'n', n), 'cr'); end if;
  return null;
end;
$fn$;

do $$
declare t text;
begin
  foreach t in array array['cr_sessions','cr_attendance','cr_records','cr_activities'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_live', t);
      execute format('drop trigger if exists %I on public.%I', t || '_live_ins', t);
      execute format('drop trigger if exists %I on public.%I', t || '_live_upd', t);
      execute format('drop trigger if exists %I on public.%I', t || '_live_del', t);
      execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.cr_live_signal()', t || '_live_ins', t);
      execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.cr_live_signal()', t || '_live_upd', t);
      execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.cr_live_signal()', t || '_live_del', t);
    end if;
  end loop;
end $$;

revoke all on function public.app_rows_live_ins() from public, anon, authenticated;
revoke all on function public.app_rows_live_upd() from public, anon, authenticated;
revoke all on function public.app_rows_live_del() from public, anon, authenticated;
revoke all on function public.cr_live_signal() from public, anon, authenticated;

-- 되돌리기(사본 쓰기와 무관, 앱은 60초 따라잡기로 계속 동작):
--   drop trigger app_rows_live_ins on public.app_rows; drop trigger app_rows_live_upd on public.app_rows; drop trigger app_rows_live_del on public.app_rows;
--   cr_* 4표마다: drop trigger <표>_live_ins / <표>_live_upd / <표>_live_del on public.<표>;
