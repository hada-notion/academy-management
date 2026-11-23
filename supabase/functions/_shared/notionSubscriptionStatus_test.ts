// 관리자 설정 "노션 연동 구독" 칸 시험(261123): 상태 고르기 · 줄 수 읽기.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { parseCount, subscriptionState, type SubscriptionFacts } from "./notionSubscriptionStatus.ts"

const base: SubscriptionFacts = { tables: true, tokenAt: null, lastEventAt: null, lastEventType: null, events24h: 0, rejectedAt: null, pending: 0, failed: 0, health: null }

Deno.test("구독 상태: 표 없음 → none, 아무것도 없음 → off, 토큰만 → waiting, 이벤트 → on", () => {
	assertEquals(subscriptionState({ ...base, tables: false }), "none")
	assertEquals(subscriptionState(base), "off")
	assertEquals(subscriptionState({ ...base, tokenAt: "2026-11-23T01:00:00Z" }), "waiting")
	assertEquals(subscriptionState({ ...base, tokenAt: "2026-11-23T01:00:00Z", lastEventAt: "2026-11-23T02:00:00Z" }), "on")
	// 토큰 기록을 지웠어도 이벤트를 받고 있으면 켜짐
	assertEquals(subscriptionState({ ...base, lastEventAt: "2026-11-23T02:00:00Z" }), "on")
	// 거절만 있으면(서명 불일치) 아직 켜짐이 아니다
	assertEquals(subscriptionState({ ...base, rejectedAt: "2026-11-23T02:00:00Z" }), "off")
})

Deno.test("줄 수: Content-Range 끝 숫자, 없으면 0", () => {
	assertEquals(parseCount("0-0/12"), 12)
	assertEquals(parseCount("*/0"), 0)
	assertEquals(parseCount(null), 0)
	assertEquals(parseCount("bad"), 0)
})
