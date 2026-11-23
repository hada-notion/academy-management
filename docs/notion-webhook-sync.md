# 노션 웹훅으로 앱 사본 맞추기 (원본 먼저)

> 노션에서 줄을 만들거나 고치거나 지우면, 노션 웹훅을 받아 **그 줄만** 노션에서 다시 읽어 관리 앱 서버 사본(`app_rows`·`cr_*`)을 맞춘다.
> 지금은 원본에서만 켜져 있다(웹훅 구독은 원본 연동에만 있음). 구독이 없는 학원에는 이 코드가 들어가도 아무 일도 하지 않고 폴링도 그대로다.
> 받기 · 서명 검증 · 구독 등록 순서는 [notion-webhook-test.md](notion-webhook-test.md).

## 흐름
1. 노션 → `notion-events` 함수(서명 검증) → `notion_webhook_events`에 기록(그대로).
2. 서명이 맞는 `page.*` 이벤트면 `notion_event_enqueue` → 대기열 `notion_event_queue`(줄 하나 = 페이지 하나).
   - 같은 이벤트 id는 한 번만(`notion_event_ids`, 노션은 같은 이벤트를 최대 8번 다시 보냄).
   - 같은 줄 이벤트는 합치고 2초 기다렸다가 한 번만 읽는다.
3. 응답한 뒤 뒤에서 처리기(`_shared/notionEventsApply.ts` `drainEvents`)가 돈다. 처리기는 **한 번에 하나**(`notion_event_worker` 임대).
   - 그 줄을 노션에서 다시 읽는다(이벤트에는 값이 없음). 휴지통 · 보관 · 404면 모든 사본에서 지우고, 아니면 그 DB의 사본에 넣는다. 되살림도 다시 읽어 넣는다.
   - 순서가 뒤섞여 와도 언제나 "노션 지금 값"으로 맞춘다. 처리 중 같은 줄에 새 이벤트가 오면(`seq`) 다시 처리한다.
   - 사본에 없는 DB의 이벤트, 본문만 바뀐 이벤트(`page.content_updated`)는 노션을 읽지 않는다.
   - 어느 데이터 소스가 어느 사본인지(DB 이름 찾기, 노션 수십 번)는 표 `notion_event_targets`에 1시간 기억한다. 모르는 데이터 소스가 오면 10분 지난 목록일 때만 다시 찾는다.
   - 메아리: 작성자가 이 학원 연동뿐이고 그 줄 사본이 이벤트 뒤에 이미 고쳐졌으면(앱 저장이 바로 반영) 읽지 않는다(`echo`). 다시 읽은 값이 사본과 같으면 쓰지 않는다(`same`).
   - 노션 한도: 부른 횟수 × 400ms보다 빨리 다음 줄로 가지 않는다(초당 2.5회 이하).
   - 실패하면 `retry`(30초 · 1분 · 2분 · 4분 · 8분 · 10분), 6번이면 `failed` — 15분 폴링 · 밤 대조가 맞춘다.
4. 예약 `notion-events-drain`(1분마다): 할 일이 있을 때만 `sync-class-room-copy {"mode":"events"}`(재시도 · 웹훅 때 못 한 몫).
5. 안전망: 사본 증분 폴링 `app-copy-incremental` · `class-room-copy-incremental` 5분 → **15분**(구독이 확인된 곳만, `notion_webhook_tokens`에 줄이 있을 때). 밤 대조는 그대로.
6. 정리 `notion-events-prune`(매일 한국 02:40): 이벤트 id 3일, 끝난 대기열 7일, 수신 기록 30일.

## 확인 (SQL Editor)
```sql
-- 최근 처리: 노션 이벤트 시각 → 처리 끝 시각(초)
select page_id, event_type, status, result, events, attempts, notion_calls,
       round(extract(epoch from (done_at - event_time))::numeric, 1) as to_copy_s, error
from public.notion_event_queue order by coalesce(done_at, due_at) desc limit 30;
-- 밀린 일
select status, count(*) from public.notion_event_queue group by status;
```
함수 로그: `[notionEvents] 처리 n줄 · {...} · Notion n번 · n ms · 초당 n번`.

## 끄기 · 되돌리기
- 반영만 끄기(기록은 계속): 함수 설정 `NOTION_EVENTS_APPLY=off` + `select cron.unschedule('notion-events-drain');`
- 폴링을 5분으로 되돌리기:
  ```sql
  select cron.schedule('app-copy-incremental', '*/5 * * * *', $c$ select public.class_room_copy_call('{"mode":"app","step":"incremental"}'::jsonb); $c$);
  select cron.schedule('class-room-copy-incremental', '*/5 * * * *', $c$ select public.class_room_copy_incremental_step(); $c$);
  ```
- 구독 끄기: 노션 연동 설정 > Webhooks에서 Pause 또는 Delete.

## 구독 새로 만들어 확인 토큰 바꾸기 (대표가 노션 · Supabase 화면에서)
시험 때 확인 토큰 값이 대화에 한 번 보였다. 실사용 전에 바꾼다. 값은 어디에도 적지 않는다.
1. 노션 연동 설정 → 원본 내부 연동 → Webhooks → **+ Create a subscription**. URL은 지금 구독과 같은 `…/functions/v1/notion-events`, API version `2025-09-03`.
   이벤트: `page.created` · `page.properties_updated` · `page.deleted` · `page.undeleted` · `page.moved`(데이터 소스 이벤트는 고르지 않아도 됨 — 오지 않거나 쓰지 않음).
2. 확인 토큰이 함수로 온다. SQL Editor에서 `select id, token from public.notion_webhook_tokens order by id desc limit 1;` → 값 복사 → 노션 **Verify** → Active.
3. 새 구독으로 오는지 본다: 원본 시험 줄 하나를 고친 뒤
   `select id, received_at, token_id, event_type from public.notion_webhook_events where kind='event' order by id desc limit 3;` — `token_id`가 2번의 id면 된다.
4. 노션에서 **옛 구독을 Delete**.
5. 옛 토큰 줄 지우기(지우기라 담당 · 대표 확인 뒤): `delete from public.notion_webhook_tokens where id <> <새 id>;`
   함수는 토큰을 5개까지만 받는다. 줄이 5개가 되면 새 구독 확인이 막힌다.
