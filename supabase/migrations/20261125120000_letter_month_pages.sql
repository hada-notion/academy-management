-- letter_month_pages: 가정통신문 "그 달 발송함 하나 → 학생당 한 장"(v2.8.0 항목 148)의 페이지 기억.
--
-- 클래스 [가정통신문 생성]을 반마다 누르면 같은 달 발송함·같은 학생 가정통신문을 다시 찾아 쌓는다. 노션 조회는
-- 방금 만든 페이지를 몇 초 늦게 잡아(두 반을 이어 누르면) 발송함·학생 장이 둘 생길 수 있어, 만든 페이지 id를
-- (달, 종류, 열쇠)로 여기 먼저 적고 다음 반은 여기서 찾는다. 고유 열쇠라 같은 것을 두 번 적지 못한다.
--   kind = 'box'     key = ''           → 그 달 가정통신문 발송함
--   kind = 'student' key = 학생 page id → 그 학생의 그 달 가정통신문
--   kind = 'late'    key = 학생 page id → 이미 보낸 장에 반이 더해진 학생(발송함 "보낸 뒤 더해진 학생 n명")
-- 노션 페이지를 지우면 서버가 다음에 읽을 때 살아 있지 않은 것을 보고 이 줄을 무시하고 새로 적는다.

create table if not exists public.letter_month_pages (
  month text not null,
  kind text not null,
  key text not null default '',
  page_id text not null,
  created_at timestamptz not null default now(),
  primary key (month, kind, key)
);

alter table public.letter_month_pages enable row level security;
revoke all on public.letter_month_pages from anon, authenticated;
