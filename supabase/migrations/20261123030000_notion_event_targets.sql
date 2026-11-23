-- (261123 동기화 단계 2 보강) 웹훅 처리기가 찾은 "데이터 소스 id → 사본" 목록을 한 줄로 기억한다.
-- 처리기가 새로 뜰 때마다 DB 이름 찾기(노션 검색 + 부모 따라가기, 원본 실측 53번)를 다시 하지 않도록(_shared/notionEventsApply.ts).
-- 1시간이 지나면 다시 찾는다. 모르는 데이터 소스 이벤트가 오면 10분이 지난 목록일 때만 다시 찾는다.
-- 지워도 되는 기억(없으면 처리기가 다시 찾음). 접근: RLS 켜고 정책 없음(서비스 역할만).
create table if not exists public.notion_event_targets (
  id int primary key check (id = 1),
  map jsonb not null default '[]'::jsonb,
  built_at timestamptz not null default clock_timestamp()
);
alter table public.notion_event_targets enable row level security;
