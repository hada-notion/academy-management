-- (261123 버튼 전환) 노션 버튼·자동화가 줄의 `요청` 칸만 바꾸면 웹훅 구독(notion-events)이 알려 주고, 처리기가 그 줄을 다시 읽어
-- 기존 함수로 넘긴다(_shared/notionRequests.ts). 사본이 없는 DB의 이벤트는 원래 노션을 읽지 않으므로, 어느 데이터 소스에
-- `요청` 칸이 있는지 처음 한 번 읽어 보고 여기에 1시간 기억한다(요청 칸 없는 DB 이벤트는 계속 읽지 않음).
-- 지워도 되는 기억(없으면 처리기가 다시 알아봄). 접근: RLS 켜고 정책 없음(서비스 역할만).
create table if not exists public.notion_request_sources (
  id text primary key,            -- 데이터 소스 id(하이픈 없이 소문자)
  has_request boolean not null,
  checked_at timestamptz not null default clock_timestamp()
);
alter table public.notion_request_sources enable row level security;
