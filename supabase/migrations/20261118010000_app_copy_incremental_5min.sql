-- 관리 앱 읽기 복사본(app_rows): 노션에서 사람이 직접 고친 값이 앱에 오는 간격을 10분 → 5분으로(2.8, 261118 담당 결정).
-- 노션 직접 편집은 웹훅 없이 이 정기 동기화로만 온다(DB마다 last_edited_time ≥ 커서 − 2분). 최대 늦음 약 10~12분 → 약 5~7분.
-- 부르는 본문·주소·키는 20261117010000_app_copy.sql 그대로(class_room_copy_call). 다시 적용해도 겹치지 않는다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'app-copy-incremental') then
    perform cron.unschedule('app-copy-incremental');
  end if;
end $$;

select cron.schedule('app-copy-incremental', '*/5 * * * *', $cron$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $cron$);
