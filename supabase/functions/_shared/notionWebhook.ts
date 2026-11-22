// (261123 동기화 설계 단계 0, 원본 시험) 노션 API 웹훅을 받아 "기록만" 하기 위한 순수 함수.
// 문서: developers.notion.com/reference/webhooks
// - 구독을 만들면 노션이 한 번 {"verification_token": "..."}를 보낸다. 이 값을 노션 연동 설정 화면에 붙여 넣어야 구독이 켜진다.
// - 그 뒤 이벤트마다 헤더 X-Notion-Signature = "sha256=" + HMAC-SHA256(받은 본문 그대로, 확인 토큰) 16진수.
// 이 파일은 네트워크·DB를 건드리지 않는다(시험하기 쉽게). 토큰 값을 돌려주거나 출력하는 함수는 두지 않는다.

export type WebhookKind = "verification" | "event" | "rejected"

export interface EventSummary {
	event_id: string | null
	event_type: string | null
	event_time: string | null
	entity_type: string | null
	entity_id: string | null
	parent_id: string | null
	attempt: number | null
	api_version: string | null
	authors: unknown
	data: unknown
}

const enc = new TextEncoder()

export async function hmacSha256Hex(key: string, body: string): Promise<string> {
	const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
	const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(body)))
	return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")
}

// 길이가 달라도 바로 끝내지 않고 같은 만큼 비교한다(시간으로 값을 알아내지 못하게).
export function safeEqual(a: string, b: string): boolean {
	const x = enc.encode(a), y = enc.encode(b)
	let diff = x.length ^ y.length
	const n = Math.max(x.length, y.length)
	for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
	return diff === 0
}

// 받은 본문(바이트 그대로의 글자)과 서명 헤더를 저장된 토큰들과 맞춰 본다. 맞는 토큰의 id, 없으면 null.
export async function matchSignature(rawBody: string, header: string | null, tokens: { id: number; token: string }[]): Promise<number | null> {
	if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header.trim())) return null
	const got = header.trim().toLowerCase()
	let hit: number | null = null
	for (const t of tokens) {
		if (!t.token) continue
		const want = "sha256=" + await hmacSha256Hex(t.token, rawBody)
		if (safeEqual(want, got) && hit === null) hit = t.id
	}
	return hit
}

// 확인 요청: 본문이 verification_token 하나뿐인 객체(이벤트 칸 type이 없음).
export function verificationToken(body: unknown): string | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null
	const o = body as Record<string, unknown>
	if ("type" in o || "entity" in o) return null
	const t = o.verification_token
	return typeof t === "string" && t.length >= 8 && t.length <= 512 ? t : null
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

export function summarizeEvent(body: unknown): EventSummary {
	const o = (body && typeof body === "object" ? body : {}) as Record<string, any>
	const ent = (o.entity && typeof o.entity === "object" ? o.entity : {}) as Record<string, unknown>
	const data = o.data && typeof o.data === "object" ? o.data : null
	const parent = data && typeof (data as any).parent === "object" ? (data as any).parent : null
	const ts = str(o.timestamp)
	return {
		event_id: str(o.id),
		event_type: str(o.type),
		event_time: ts && !Number.isNaN(Date.parse(ts)) ? ts : null,
		entity_type: str(ent.type),
		entity_id: str(ent.id),
		parent_id: parent ? str(parent.id) : null,
		attempt: Number.isInteger(o.attempt_number) ? o.attempt_number : null,
		api_version: str(o.api_version),
		authors: Array.isArray(o.authors) ? o.authors : null,
		data,
	}
}

// 기록용 본문: 확인 토큰처럼 비밀일 수 있는 칸 이름은 값 대신 "(지움)"으로 바꾼다(이벤트 본문에는 원래 없음, 만약을 위해).
export function redact(body: unknown): unknown {
	if (Array.isArray(body)) return body.map(redact)
	if (!body || typeof body !== "object") return body
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
		out[k] = /token|secret|signature/i.test(k) ? "(지움)" : redact(v)
	}
	return out
}
