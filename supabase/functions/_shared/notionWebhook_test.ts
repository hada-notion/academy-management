import { assert, assertEquals } from "jsr:@std/assert@1"
import { hmacSha256Hex, matchSignature, redact, safeEqual, summarizeEvent, verificationToken } from "./notionWebhook.ts"

// 노션 문서 예시와 같은 꼴의 시험 값(실제 토큰 아님)
const TOKEN = "secret_test-only-0123456789abcdef"
const OTHER = "secret_test-only-other-token-xyz"
const BODY = '{"id":"evt-1","timestamp":"2026-11-23T01:02:03.456Z","type":"page.properties_updated","entity":{"id":"page-1","type":"page"},"data":{"parent":{"id":"ds-1","type":"database"},"updated_properties":["XGe%40"]},"authors":[{"id":"u-1","type":"person"}],"attempt_number":1,"api_version":"2025-09-03"}'

Deno.test("HMAC-SHA256 hex는 알려진 값과 같다(RFC 4231 시험 2)", async () => {
	assertEquals(await hmacSha256Hex("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
})

Deno.test("서명이 맞는 토큰의 id를 돌려주고, 틀리거나 없으면 null", async () => {
	const sig = "sha256=" + await hmacSha256Hex(TOKEN, BODY)
	const tokens = [{ id: 2, token: OTHER }, { id: 1, token: TOKEN }]
	assertEquals(await matchSignature(BODY, sig, tokens), 1)
	assertEquals(await matchSignature(BODY, sig.toUpperCase().replace("SHA256=", "sha256="), tokens), 1)
	assertEquals(await matchSignature(BODY + " ", sig, tokens), null, "본문이 한 글자라도 다르면 거름")
	assertEquals(await matchSignature(BODY, sig, [{ id: 2, token: OTHER }]), null, "다른 토큰이면 거름")
	assertEquals(await matchSignature(BODY, null, tokens), null)
	assertEquals(await matchSignature(BODY, "sha256=abc", tokens), null)
	assertEquals(await matchSignature(BODY, sig, []), null, "토큰이 없으면 모두 거름")
})

Deno.test("다시 직렬화한 본문이 아니라 받은 글자 그대로 검증한다", async () => {
	const spaced = BODY.replace('"type":"page.properties_updated"', '"type": "page.properties_updated"')
	const sig = "sha256=" + await hmacSha256Hex(TOKEN, spaced)
	assertEquals(await matchSignature(spaced, sig, [{ id: 1, token: TOKEN }]), 1)
	assertEquals(await matchSignature(JSON.stringify(JSON.parse(spaced)), sig, [{ id: 1, token: TOKEN }]), null)
})

Deno.test("safeEqual", () => {
	assert(safeEqual("abc", "abc"))
	assert(!safeEqual("abc", "abd"))
	assert(!safeEqual("abc", "abcd"))
})

Deno.test("확인 요청만 토큰으로 본다", () => {
	assertEquals(verificationToken({ verification_token: TOKEN }), TOKEN)
	assertEquals(verificationToken({ verification_token: TOKEN, type: "page.created" }), null)
	assertEquals(verificationToken({ verification_token: "x" }), null)
	assertEquals(verificationToken(JSON.parse(BODY)), null)
	assertEquals(verificationToken([TOKEN]), null)
})

Deno.test("이벤트 요약 칸", () => {
	const s = summarizeEvent(JSON.parse(BODY))
	assertEquals(s.event_id, "evt-1")
	assertEquals(s.event_type, "page.properties_updated")
	assertEquals(s.event_time, "2026-11-23T01:02:03.456Z")
	assertEquals([s.entity_type, s.entity_id, s.parent_id, s.attempt, s.api_version], ["page", "page-1", "ds-1", 1, "2025-09-03"])
	assertEquals(summarizeEvent({ timestamp: "아님" }).event_time, null)
	assertEquals(summarizeEvent(null).event_type, null)
})

Deno.test("기록 본문에서 토큰·서명 칸 값은 지운다", () => {
	assertEquals(redact({ a: 1, verification_token: TOKEN, x: [{ secret: "s", b: 2 }] }), { a: 1, verification_token: "(지움)", x: [{ secret: "(지움)", b: 2 }] })
})
