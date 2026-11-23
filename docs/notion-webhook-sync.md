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
   - 사본에 없는 DB의 이벤트는 노션을 읽지 않는다. 본문만 바뀐 이벤트(`page.content_updated`)는 구독하지 않는다.
   - 어느 데이터 소스가 어느 사본인지(DB 이름 찾기, 노션 수십 번)는 표 `notion_event_targets`에 1시간 기억한다. 모르는 데이터 소스가 오면 10분 지난 목록일 때만 다시 찾는다.
   - 메아리: 작성자가 이 학원 연동뿐이고 그 줄 사본이 이벤트 뒤에 이미 고쳐졌으면(앱 저장이 바로 반영) 읽지 않는다(`echo`). 다시 읽은 값이 사본과 같으면 쓰지 않는다(`same`).
   - 노션 한도: 부른 횟수 × 400ms보다 빨리 다음 줄로 가지 않는다(초당 2.5회 이하).
   - 실패하면 `retry`(30초 · 1분 · 2분 · 4분 · 8분 · 10분), 6번이면 `failed` — 15분 폴링 · 밤 대조가 맞춘다.
4. 예약 `notion-events-drain`(1분마다): 할 일이 있을 때만 `sync-class-room-copy {"mode":"events"}`(재시도 · 웹훅 때 못 한 몫).
5. 안전망: 사본 증분 폴링 `app-copy-incremental` · `class-room-copy-incremental` 5분 → **15분**(구독이 확인된 곳만, `notion_webhook_tokens`에 줄이 있을 때). 밤 대조는 그대로.
6. 정리 `notion-events-prune`(매일 한국 02:40): 이벤트 id 3일, 끝난 대기열 7일, 수신 기록 30일.

## 구독 끊김 알아채기 (`20261123060000_notion_subscription_watch.sql`, `_shared/notionSubscriptionWatch.ts`)
노션은 실패가 쌓인 구독을 스스로 끄고, 확인 토큰이 바뀌면 서명이 맞지 않는다. 그동안 사본이 늦지 않게 서버가 알아채서 폴링을 5분으로 되돌린다.
1. **대조**: 15분 폴링(`app-copy-incremental`)이 노션에서 바뀐 줄을 사본에 넣기 **전에** 사본 값과 견준다. 구독이 살아 있으면 웹훅이 몇 초 안에 사본을 먼저 맞춰 두므로 같다.
   값이 다르고 고친 지 2분 넘은 줄만 `notion_subscription_poll_report`로 보내고, 서버가 그 줄 이벤트를 받은 적이 없으면 "놓친 줄"로 센다.
   - 본문만 고친 줄 · 사본에 없는 칸만 고친 줄은 값이 같아 세지 않는다(구독이 원래 알리지 않는 고침).
   - 아무도 노션을 고치지 않는 밤 · 주말엔 놓친 줄도 없어 경고가 뜨지 않는다.
2. **끊김**: 놓친 줄이 **2개 이상** 쌓이고 그 사이 받은 이벤트가 없으면 `notion_subscription_health.state = 'down'` → 폴링 두 예약(`app-copy-incremental` · `class-room-copy-incremental`) **5분**.
   - 놓친 줄의 `요청`이 동작 ID면 대기열에 넣는다 — 끊긴 동안에도 버튼 · 자동화가 폴링 주기(5분) 안에 처리된다.
3. **되돌아옴**: 서명이 맞는 이벤트가 하나라도 오면(트리거 `notion_webhook_events_watch`) 쌓인 수를 비우고, 끊김이었으면 `ok` → 폴링 **15분**.
4. **보이는 곳**: 관리 앱 관리자 설정 "노션 연동 구독" 상태 **끊김**(이유 · 언제부터 · 폴링 주기 · 마지막 대조), 관리 앱 홈 입력 점검 "노션 연동 구독 끊김"(누르면 안내 창). 홈은 자동 갱신(`app-api changes`)이 받을 때마다 같이 받는다.
5. **기록**: `notion_subscription_log`(down · ok · poll · simulate). 구독이 없는 학원(`notion_webhook_tokens`가 빔)은 끊김으로 보지 않고 폴링도 바꾸지 않는다.

시험(실제 구독은 그대로 두고 서버 쪽 흉내):
```sql
select public.notion_subscription_simulate(30);  -- 30분 동안 받은 이벤트를 "거절(꺼짐 흉내)"로 적고 대기열에 넣지 않음(노션에는 200)
-- 노션에서 시험 줄 2개를 고치고 다음 15분 폴링을 기다리면 → 끊김 · 폴링 5분
select public.notion_subscription_simulate(0);   -- 흉내 끝 → 다음 노션 고침이 오면 되돌아옴 · 폴링 15분
select * from public.notion_subscription_log order by id desc limit 10;
select state, since, reason, missed, poll_min, last_report_at from public.notion_subscription_health;
```

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
- 끊김 감지만 끄기: `drop trigger notion_webhook_events_watch on public.notion_webhook_events; drop trigger notion_webhook_events_simulate on public.notion_webhook_events;` + `select public.notion_subscription_poll_set(15);`(폴링 15분 고정). 함수는 표 · 함수가 없으면 대조를 건너뛴다.

## 앱 자동 동기화 끄기(PR 519, 병합 보류)와 끊김 되돌림이 겹칠 때
- 겹치는 곳: 519는 `app-copy-incremental` 크론을 지운다. 그런데 `notion_subscription_poll_set`은 그 크론이 없어도(`cur`가 비어 있어도) 원하는 주기로 다시 만든다 — 구독이 끊김 ↔ 정상으로 바뀔 때마다 지운 크론이 되살아난다.
- 이기는 쪽: 519(꺼 둠)가 이긴다. 끊김 때 폴링을 5분으로 앞당기는 건 `app-copy-incremental`이 이미 있을 때만 의미가 있고, 없으면 앱은 웹훅 자동 갱신과 [동기화]로 따라간다.
- 고칠 곳: 519를 병합하는 날 같은 묶음에서 새 마이그레이션으로 `notion_subscription_poll_set`을 다시 정의해, `app-copy-incremental`용 `cron.schedule`을 `cur`가 있을 때만 부르게 한다(`class-room-copy-incremental`은 그대로). 519 코드와 20261123060000은 고치지 않는다.

## 구독 새로 만들어 확인 토큰 바꾸기 (대표가 노션 · Supabase 화면에서)
시험 때 확인 토큰 값이 대화에 한 번 보였다. 실사용 전에 바꾼다. 값은 어디에도 적지 않는다.
1. 노션 연동 설정 → 원본 내부 연동 → Webhooks → **+ Create a subscription**. URL은 지금 구독과 같은 `…/functions/v1/notion-events`, API version `2026-03-11`.
   이벤트: `page.created` · `page.properties_updated` · `page.deleted` · `page.undeleted` · `page.moved`(이 5개만. `page.content_updated`·`data_source.*`는 고르지 않는다).
2. 확인 토큰이 함수로 온다. SQL Editor에서 `select id, token from public.notion_webhook_tokens order by id desc limit 1;` → 값 복사 → 노션 **Verify** → Active.
3. 새 구독으로 오는지 본다: 원본 시험 줄 하나를 고친 뒤
   `select id, received_at, token_id, event_type from public.notion_webhook_events where kind='event' order by id desc limit 3;` — `token_id`가 2번의 id면 된다.
4. 노션에서 **옛 구독을 Delete**.
5. 옛 토큰 줄 지우기(지우기라 담당 · 대표 확인 뒤): `delete from public.notion_webhook_tokens where id <> <새 id>;`
   함수는 토큰을 5개까지만 받는다. 줄이 5개가 되면 새 구독 확인이 막힌다.
