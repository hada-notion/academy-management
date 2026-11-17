-- v2.8.0 항목 74: 관리 앱 읽기용 Notion 복사본(app_rows) + 예약 동기화.
--
-- 관리 앱 메뉴 9×3 화면이 Notion을 직접 읽지 않고 이 표를 읽는다(함수 app-api). 표 하나에 DB마다 페이지를 한 줄씩 두고,
-- 칸은 Notion 속성 이름 그대로 props(jsonb)에 평평한 값으로 담는다(_shared/appCopy.ts). Notion 칸 이름이 바뀌어도 이 표는 그대로다.
-- 수업·출석·학습기록·학습활동은 cr_*, 라이브러리 단원은 lib_*를 그대로 쓴다.
-- 접근: RLS를 켜고 정책을 두지 않아 anon·authenticated는 막히고, 함수(서비스 역할)만 읽고 쓴다(cr_*와 같다).
-- Notion은 읽기만 한다. 앱이 저장하는 단계(다음 항목)가 와도 Notion에 먼저 쓰고 이 표는 그 결과를 받아 적는다.

create table if not exists public.app_rows (
  id text primary key,
  db text not null,
  props jsonb not null default '{}'::jsonb,
  url text not null default '',
  icon text not null default '',
  notion_created_at timestamptz,
  notion_edited_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index if not exists app_rows_db_idx on public.app_rows (db, id);
create index if not exists app_rows_db_synced_idx on public.app_rows (db, synced_at);
alter table public.app_rows enable row level security;

-- DB마다 줄 수(앱의 자료 상태 · Notion 건수 대조용).
create or replace function public.app_rows_counts() returns table(db text, n bigint)
language sql stable security definer set search_path = public as $fn$
  select db, count(*) from public.app_rows group by db;
$fn$;
revoke all on function public.app_rows_counts() from public, anon, authenticated;

-- 예약 실행: class-room-copy와 같은 틀(함수 sync-class-room-copy, Vault 관리자 키, 이 프로젝트 주소 — 학원 배포 때 학원 주소로).
--   1) app-copy-first-fill(3분마다): 커서가 없는 첫 DB를 reconcile(함수 mode=app, step=fill). 모두 끝나면 함수가 "done"을 돌려주고
--      다음 실행부터는 빈 부름이다(가볍다). 같은 DB를 두 번 불러도 같은 줄을 덮어쓸 뿐이다.
--   2) app-copy-incremental(10분마다): 커서가 있는 DB만 바뀐 것만.
--   3) app-copy-reconcile(매일 밤 한국 03:00~04:57 = UTC 18:00~19:57, 3분마다): 한 번에 DB 하나씩, 가장 오래전에 대조한 DB부터
--      전체 대조(지운 페이지 정리). 40번 부르므로 DB 29개가 하룻밤에 한 번씩 돈다(함수 한 번 실행 시간 안에 끝나게).
do $$
declare j text;
begin
  foreach j in array array['app-copy-first-fill','app-copy-incremental','app-copy-reconcile'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

select cron.schedule('app-copy-first-fill', '*/3 * * * *', $cron$ select public.class_room_copy_call('{"mode":"app","step":"fill"}'::jsonb); $cron$);
select cron.schedule('app-copy-incremental', '*/10 * * * *', $cron$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $cron$);
select cron.schedule('app-copy-reconcile', '*/3 18-19 * * *', $cron$ select public.class_room_copy_call('{"mode":"app","step":"reconcile-next"}'::jsonb); $cron$);
