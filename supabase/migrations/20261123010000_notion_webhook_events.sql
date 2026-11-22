-- (261123 동기화 설계 단계 0, 원본 시험) 노션 API 웹훅 수신 기록 — 함수 notion-events가 받은 요청을 한 줄씩 적기만 한다.
-- 다른 표·예약 작업은 건드리지 않는다. 표를 더하기만 하고, 다시 적용해도 같다.
-- 접근: RLS를 켜고 정책을 두지 않아 anon·authenticated는 막히고, 함수(서비스 역할)와 SQL 편집기만 읽고 쓴다(app_rows와 같다).
-- 확인 토큰은 notion_webhook_tokens에만 둔다(서명 검증 열쇠). 값은 채팅·문서·Git·로그에 쓰지 않는다.
-- 시험이 끝나 지울 때: drop table public.notion_webhook_events; drop table public.notion_webhook_tokens;(대표 확인 뒤)

create table if not exists public.notion_webhook_tokens (
  id bigserial primary key,
  token text not null,
  received_at timestamptz not null default clock_timestamp()
);
alter table public.notion_webhook_tokens enable row level security;

create table if not exists public.notion_webhook_events (
  id bigserial primary key,
  received_at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('verification', 'event', 'rejected')),
  reason text,
  token_id bigint,
  event_id text,
  event_type text,
  event_time timestamptz,
  entity_type text,
  entity_id text,
  parent_id text,
  attempt int,
  api_version text,
  authors jsonb,
  payload jsonb,
  body_bytes int
);
create index if not exists notion_webhook_events_received_idx on public.notion_webhook_events (received_at);
create index if not exists notion_webhook_events_entity_idx on public.notion_webhook_events (entity_id, received_at);
alter table public.notion_webhook_events enable row level security;
