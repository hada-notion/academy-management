# 노션 API 웹훅 시험 (원본 전용, 기록만)

> 원본(하다 학원관리 v2.0 · 원본 Supabase)에서만 쓰는 시험이다. **각 학원 운영에는 적용하지 않는다**(CHANGELOG·업데이트 지침에 넣지 않음).
> 목적: 노션 → 서버를 5분 폴링 대신 노션 웹훅 이벤트로 받을 수 있는지, 얼마나 빨리 오는지 잰다.
> (261123 단계 2) 받은 이벤트로 앱 사본을 맞추는 일은 [notion-webhook-sync.md](notion-webhook-sync.md). 함수는 이제 기록 + 대기열 넣기를 한다.

## 무엇이 들어 있나
| 부품 | 위치 | 하는 일 |
|-|-|-|
| 함수 `notion-events` | `supabase/functions/notion-events/index.ts` | 노션이 보낸 요청을 받아 표에 한 줄 적기만 한다. 노션·다른 표·알림톡에 쓰지 않는다 |
| 서명 검증 | `supabase/functions/_shared/notionWebhook.ts` | 헤더 `X-Notion-Signature` = `sha256=` + HMAC-SHA256(받은 본문 그대로, 확인 토큰). 안 맞으면 401, `rejected`로 기록 |
| 표 2개 | `supabase/migrations/20261123010000_notion_webhook_events.sql` | `notion_webhook_events`(받은 요청 기록), `notion_webhook_tokens`(확인 토큰). RLS 켬·정책 없음 = 서비스 역할·SQL 편집기만 |

## 구독 등록 순서 (대표가 노션·Supabase 화면에서)
값(토큰)은 채팅·문서에 쓰지 않는다. 화면에서 복사해 화면에 붙여 넣기만 한다.

1. 노션 연동 설정 열기: `https://www.notion.so/profile/integrations`(새 화면 이름은 connections, 노션 문서 기준 `https://app.notion.com/developers/connections`) → 원본 서버가 쓰는 **내부 연동**(원본 Supabase Secret `NOTION_TOKEN`의 연동) → **Webhooks** 탭 → **+ Create a subscription**.
2. Webhook URL: `https://<원본 Supabase 프로젝트 주소>.supabase.co/functions/v1/notion-events`
   (프로젝트 주소는 Supabase 대시보드 Project Settings > API의 Project URL과 같다.)
3. API version은 `2025-09-03`(data_source 이벤트가 이 판부터). 이벤트 고르기: `page.created` · `page.properties_updated` · `page.deleted` · `page.undeleted` · `data_source.content_updated`.
4. **Create subscription** → 노션이 함수로 확인 토큰을 한 번 보낸다(함수가 `notion_webhook_tokens`에 저장).
5. Supabase 대시보드 → 원본 프로젝트 → **SQL Editor**에서 아래를 실행해 결과 칸 값을 복사한다(값을 어디에도 붙여 두지 않는다):
   ```sql
   select token from public.notion_webhook_tokens order by id desc limit 1;
   ```
   결과가 비어 있으면: `select received_at, kind, reason from public.notion_webhook_events order by id desc limit 5;`로 요청이 왔는지 보고, 노션 화면의 **Resend token**을 누른다.
6. 노션 Webhooks 탭 → 왼쪽 아래 **⚠ Verify** → 복사한 값 붙여 넣기 → **Verify subscription**. 상태가 Active가 되면 끝.
7. 연동이 시험 페이지에 접근할 수 있어야 이벤트가 온다(연동이 연결된 페이지 아래에 시험 페이지를 둔다).

## 확인 (SQL Editor)
```sql
-- 최근 받은 것
select id, received_at, kind, reason, event_type, entity_type, entity_id, event_time, attempt,
       round(extract(epoch from (received_at - event_time))::numeric, 1) as delay_s
from public.notion_webhook_events order by id desc limit 30;

-- 종류별 지연(초): 가장 빠름 · 보통(중앙값) · 가장 느림
select event_type, count(*) n,
       round(min(extract(epoch from (received_at - event_time)))::numeric, 1) fastest,
       round((percentile_cont(0.5) within group (order by extract(epoch from (received_at - event_time))))::numeric, 1) median,
       round(max(extract(epoch from (received_at - event_time)))::numeric, 1) slowest
from public.notion_webhook_events where kind = 'event' group by event_type order by event_type;
```
`event_time`은 노션이 붙인 이벤트 시각이다. 묶여 오는 이벤트(`page.properties_updated` 두 번째부터, `page.deleted`, `data_source.*`)는 시험 절차에 적은 "노션에서 한 시각"과도 따로 비교한다.

## 끄는 법
- 잠시 끄기: 노션 Webhooks 탭에서 구독을 **Pause**(또는 이벤트 선택 해제). 함수는 그대로 두어도 요청이 없으면 아무 일도 하지 않는다.
- 완전히 끄기: 노션에서 구독 **Delete**. 서버 기록을 지울 때는 대표 확인 뒤 `drop table public.notion_webhook_events; drop table public.notion_webhook_tokens;`와 함수 폴더 삭제 PR.
