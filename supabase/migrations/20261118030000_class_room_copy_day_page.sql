-- (2.8 하루 수업 페이지, 앱서버 261118) 수업 관리 복사본에 하루 수업 페이지가 읽는 칸을 더한다.
-- class-room session·day 응답의 kind·summary·busy·error·blockId·notice·noticeStatus·noticePreview(수업)와
-- reportStatus(출석). 복사본을 읽는 학원(CLASS_ROOM_SOURCE=copy)도 Notion을 읽을 때와 같은 응답이 되게 한다.
-- 칸을 더하기만 한다(지우거나 바꾸지 않음). 다시 적용해도 같다. 빈 값은 다음 동기화(증분·대조)가 채운다.
alter table public.cr_sessions add column if not exists kind text not null default '';
alter table public.cr_sessions add column if not exists summary text not null default '';
alter table public.cr_sessions add column if not exists busy text not null default '';
alter table public.cr_sessions add column if not exists error_text text not null default '';
alter table public.cr_sessions add column if not exists block_id text;
alter table public.cr_sessions add column if not exists notice text not null default '';
alter table public.cr_sessions add column if not exists notice_status text not null default '';
alter table public.cr_sessions add column if not exists notice_preview text not null default '';
alter table public.cr_attendance add column if not exists report_status text not null default '';
