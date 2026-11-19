-- 관리 앱 읽기 복사본(app_rows): 자동 incremental(5분)을 끈다(2.8, 대표 261119 "노션 → 앱은 [동기화] 버튼으로만").
-- 앱의 [동기화](app-api run sync-copy, 항목 105)가 배포되고 이 학원의 처음 채우기(app-copy-first-fill)가 끝난 뒤에만 적용한다 — 담당이 알릴 때까지 병합하지 않는다.
-- 처음 채우기 · 밤 대조(app-copy-reconcile) · 수업 쪽(class-room-copy-*) · 라이브러리 크론은 건드리지 않는다.
-- 되돌리기: 20261118010000_app_copy_incremental_5min.sql의 cron.schedule 줄을 다시 실행. 다시 적용해도 겹치지 않는다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'app-copy-incremental') then
    perform cron.unschedule('app-copy-incremental');
  end if;
end $$;
