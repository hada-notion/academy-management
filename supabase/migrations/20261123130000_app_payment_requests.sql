-- (v2.8.0, 재무 서버 261123) 관리 앱 결제 기록(app-api "record-payment", _shared/appPayment.ts)의 요청 id.
-- 앱이 확인 창마다 요청 id를 만들어 보내고, 서버는 노션에 쓰기 전에 여기 자리를 잡는다(기본 키). 같은 id가 두 번 오면
-- 노션에 다시 쓰지 않고 그때 만든 결제 줄을 돌려준다(두 번 눌러도 결제 줄은 하나).
-- state: pending(쓰는 중) · done(payment_id 있음) · unknown(노션 응답을 못 받아 줄이 생겼는지 모름 — 앱은 결제 목록을 보고 새 id로).
-- 지워도 되는 기록(지우면 같은 id 중복 막기만 사라짐). 접근: RLS 켜고 정책 없음(서비스 역할만).
create table if not exists public.app_payment_requests (
  id text primary key,
  kind text not null,
  tuition_id text,
  amount bigint,
  state text not null default 'pending',
  payment_id text,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
alter table public.app_payment_requests enable row level security;
