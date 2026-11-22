// Supabase Edge Function: notion-events (261123 동기화 설계 단계 0 — 원본 시험, 기록만)
//
// 노션 API 웹훅(연동 설정 > Webhooks 구독)이 보내는 요청을 받아 표 notion_webhook_events에 한 줄씩 적기만 한다.
// 사본 갱신·알림톡·보고서·수업 생성 등 다른 일은 하지 않는다. 노션을 읽거나 쓰지 않는다.
//
// 1) 확인 요청 {"verification_token": "..."}: 토큰을 notion_webhook_tokens에 넣고(최대 5개, 값은 응답·로그에 내지 않음)
//    기록 줄에는 "verification"만 남긴다. 대표가 SQL 편집기에서 토큰을 꺼내 노션 화면에 붙여 넣는다(docs/notion-webhook-test.md).
// 2) 이벤트: 헤더 X-Notion-Signature를 저장된 토큰으로 검증(HMAC-SHA256, 받은 본문 그대로). 맞으면 "event"로,
//    안 맞으면 "rejected"로 적고 401. 받은 시각(received_at)과 이벤트 시각(timestamp)의 차이가 지연이다.
// 함수 배포는 모두 --no-verify-jwt(노션은 Supabase 키 없이 부른다). 표는 RLS로 서비스 역할만 읽고 쓴다.

import { matchSignature, redact, summarizeEvent, verificationToken } from "../_shared/notionWebhook.ts"

const SB_URL = () => (Deno.env.get("SB_URL") ?? "").replace(/\/$/, "")
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
const MAX_BODY = 512 * 1024
const MAX_TOKENS = 5

function sb(path: string, init: RequestInit = {}, extra: Record<string, string> = {}) {
	return fetch(`${SB_URL()}/rest/v1/${path}`, {
		...init,
		headers: { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra },
	})
}

async function logRow(row: Record<string, unknown>) {
	const res = await sb("notion_webhook_events", { method: "POST", body: JSON.stringify(row) }, { Prefer: "return=minimal" })
	if (!res.ok) console.error("notion-events: 기록 실패", res.status, (await res.text()).slice(0, 200))
}

async function loadTokens(): Promise<{ id: number; token: string }[]> {
	const res = await sb("notion_webhook_tokens?select=id,token&order=id.desc&limit=" + MAX_TOKENS)
	if (!res.ok) throw new Error("토큰 표 읽기 실패 " + res.status)
	return await res.json()
}

const json = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

Deno.serve(async (req) => {
	if (req.method !== "POST") return json(405, { ok: false, error: "POST만 받습니다." })
	if (!SB_URL() || !SB_KEY()) return json(500, { ok: false, error: "서버 설정이 없습니다." })
	const raw = await req.text()
	const signature = req.headers.get("x-notion-signature")
	if (raw.length > MAX_BODY) {
		await logRow({ kind: "rejected", reason: "본문이 너무 큼", body_bytes: raw.length })
		return json(413, { ok: false })
	}
	let body: unknown
	try {
		body = JSON.parse(raw)
	} catch {
		await logRow({ kind: "rejected", reason: "JSON 아님", body_bytes: raw.length })
		return json(400, { ok: false })
	}

	const token = verificationToken(body)
	if (token) {
		const tokens = await loadTokens()
		if (tokens.length >= MAX_TOKENS) {
			await logRow({ kind: "rejected", reason: "확인 토큰이 이미 5개", body_bytes: raw.length })
			return json(409, { ok: false })
		}
		const res = await sb("notion_webhook_tokens", { method: "POST", body: JSON.stringify({ token }) }, { Prefer: "return=minimal" })
		if (!res.ok) return json(500, { ok: false })
		await logRow({ kind: "verification", reason: "확인 토큰 받음(값은 notion_webhook_tokens)", body_bytes: raw.length })
		return json(200, { ok: true })
	}

	const ev = summarizeEvent(body)
	const tokenId = await matchSignature(raw, signature, await loadTokens())
	await logRow({
		kind: tokenId === null ? "rejected" : "event",
		reason: tokenId === null ? (signature ? "서명 불일치" : "서명 없음") : null,
		token_id: tokenId,
		event_id: ev.event_id,
		event_type: ev.event_type,
		event_time: ev.event_time,
		entity_type: ev.entity_type,
		entity_id: ev.entity_id,
		parent_id: ev.parent_id,
		attempt: ev.attempt,
		api_version: ev.api_version,
		authors: ev.authors,
		payload: tokenId === null ? null : redact(body),
		body_bytes: raw.length,
	})
	return tokenId === null ? json(401, { ok: false }) : json(200, { ok: true })
})
