// 관리 앱 관리자 설정의 "노션 연동 구독" 칸(261123 관리자 설정 실제 연결). 노션 API 웹훅 구독이 이 서버로 오고 있는지를
// 서버 표에서 읽기만 한다: 확인 토큰을 받았나(notion_webhook_tokens) · 마지막으로 받은 이벤트(notion_webhook_events) ·
// 반영 대기열(notion_event_queue). 토큰 값은 읽지 않는다(받은 시각만). 표가 없는 서버(구독 표 마이그레이션 전)는 "none".
// 쓰는 곳: app-api { action: "admin-status" }.
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"

export type SubscriptionFacts = {
	tables: boolean // 구독 표가 이 서버에 있나
	tokenAt: string | null // 노션이 확인 토큰을 마지막으로 보낸 때(구독을 만든 때)
	lastEventAt: string | null // 마지막으로 받은 이벤트(서명이 맞은 것)
	lastEventType: string | null
	events24h: number // 최근 24시간 받은 이벤트 수
	rejectedAt: string | null // 서명이 안 맞아 거절한 마지막 요청
	pending: number // 반영 대기(처리 전·재시도)
	failed: number // 반영 실패(15분 폴링·밤 대조가 맞춤)
	health: Health | null // (261123) 끊김 감지 — notion_subscription_health. 표가 없으면 null
}
// 끊김 감지 한 줄(마이그레이션 20261123060000). state=down이면 폴링이 놓친 줄을 찾았고 그 뒤 이벤트가 오지 않음.
export type Health = { state: "ok" | "down"; since: string | null; reason: string | null; missed: number; pollMin: number | null; lastReportAt: string | null; simulating: boolean }
export type SubscriptionState = "none" | "off" | "waiting" | "on" | "down"
export type SubscriptionStatus = SubscriptionFacts & { state: SubscriptionState }

// 상태 하나로: 표가 없으면 none, 끊김 감지가 down이면 down, 토큰도 이벤트도 없으면 off(구독을 안 만듦), 토큰만 있고 이벤트가 아직이면 waiting
// (노션에서 Verify를 아직 안 눌렀거나, 누른 뒤 아직 아무도 고치지 않음), 이벤트를 한 번이라도 받았으면 on.
export function subscriptionState(f: SubscriptionFacts): SubscriptionState {
	if (!f.tables) return "none"
	if (f.health?.state === "down") return "down"
	if (f.lastEventAt) return "on"
	if (f.tokenAt) return "waiting"
	return "off"
}

const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
function sbHeaders(extra: Record<string, string> = {}) {
	if (!SB_URL() || !SB_KEY()) throw new Error("SB_URL / SB_SERVICE_ROLE_KEY Secrets가 설정되어 있지 않습니다.")
	return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, ...extra }
}
class MissingTable extends Error {}
async function rows(path: string): Promise<any[]> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${path}`, { headers: sbHeaders() })
	if (res.status === 404) throw new MissingTable(path)
	if (!res.ok) throw new Error(`구독 상태 읽기 실패 (${res.status})`)
	const out = await res.json()
	return Array.isArray(out) ? out : []
}
// 줄 수만(본문 없이): Prefer count=exact + Range 0-0 → Content-Range "0-0/12" 또는 "*/0".
async function count(path: string): Promise<number> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${path}`, { headers: sbHeaders({ Prefer: "count=exact", Range: "0-0" }) })
	if (res.status === 404) throw new MissingTable(path)
	if (!res.ok && res.status !== 206 && res.status !== 416) throw new Error(`구독 상태 읽기 실패 (${res.status})`)
	await res.body?.cancel()
	return parseCount(res.headers.get("content-range"))
}
export function parseCount(range: string | null): number {
	const m = /\/(\d+)$/.exec(String(range ?? ""))
	return m ? Number(m[1]) : 0
}

export async function subscriptionStatus(now = Date.now()): Promise<SubscriptionStatus> {
	const since = new Date(now - 24 * 3600 * 1000).toISOString()
	const empty: SubscriptionFacts = { tables: false, tokenAt: null, lastEventAt: null, lastEventType: null, events24h: 0, rejectedAt: null, pending: 0, failed: 0, health: null }
	try {
		const [token, last, rejected, events24h] = await Promise.all([
			rows("notion_webhook_tokens?select=received_at&order=id.desc&limit=1"),
			rows("notion_webhook_events?select=received_at,event_type&kind=eq.event&order=id.desc&limit=1"),
			rows(`notion_webhook_events?select=received_at&kind=eq.rejected&or=(reason.is.null,reason.not.like.${encodeURIComponent("꺼짐 흉내*")})&order=id.desc&limit=1`), // 꺼짐 흉내(시험)로 거절한 것은 빼고
			count(`notion_webhook_events?select=id&kind=eq.event&received_at=gte.${encodeURIComponent(since)}`),
		])
		const facts: SubscriptionFacts = {
			...empty, tables: true,
			tokenAt: token[0]?.received_at ?? null,
			lastEventAt: last[0]?.received_at ?? null,
			lastEventType: last[0]?.event_type ?? null,
			events24h,
			rejectedAt: rejected[0]?.received_at ?? null,
		}
		// 반영 대기열은 단계 2(20261123020000)부터 — 없으면 0으로 둔다(수신 기록만 있는 서버)
		try {
			const [pending, failed] = await Promise.all([
				count("notion_event_queue?select=page_id&status=in.(pending,retry)"),
				count("notion_event_queue?select=page_id&status=eq.failed"),
			])
			facts.pending = pending; facts.failed = failed
		} catch (e) { if (!(e instanceof MissingTable)) throw e }
		facts.health = await healthOf().catch(() => null)
		return { ...facts, state: subscriptionState(facts) }
	} catch (e) {
		if (e instanceof MissingTable) return { ...empty, state: "none" }
		throw e
	}
}

// 끊김 감지 한 줄만(관리 앱 홈이 자동 갱신 때마다 같이 받음 — app-api changes). 표가 없으면 null.
export function healthFrom(r: any, now = Date.now()): Health | null {
	if (!r) return null
	return {
		state: r.state === "down" ? "down" : "ok", since: r.since ?? null, reason: r.reason ?? null, missed: Number(r.missed ?? 0),
		pollMin: r.poll_min == null ? null : Number(r.poll_min), lastReportAt: r.last_report_at ?? null,
		simulating: !!r.simulate_until && Date.parse(r.simulate_until) > now,
	}
}
export async function healthOf(): Promise<Health | null> {
	try {
		const r = await rows("notion_subscription_health?select=state,since,reason,missed,poll_min,last_report_at,simulate_until&id=eq.1")
		return healthFrom(r[0])
	} catch (e) {
		if (e instanceof MissingTable) return null
		throw e
	}
}
