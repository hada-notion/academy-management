// _shared/notionSubscriptionWatch.ts — (261123) 노션 웹훅 구독 끊김 알아채기(폴링 대조).
//
// 15분 사본 폴링(sync-class-room-copy {mode:"app", step:"incremental"})이 노션에서 바뀐 줄을 사본에 넣기 전에, 사본에 있던 값과
// 견준다. 구독이 살아 있으면 웹훅이 몇 초 안에 사본을 먼저 맞춰 두므로 값이 같다. 값이 다르고 고친 지 2분이 넘은 줄만
// 서버 함수 notion_subscription_poll_report로 보내면, 그 줄의 이벤트를 받은 적이 있는지 보고 "놓친 줄"을 센다
// (2개 이상 쌓이고 그 사이 이벤트가 없으면 끊김 + 폴링 5분 — 마이그레이션 20261123060000).
// - 본문만 · 사본에 없는 칸만 고친 줄은 값이 같아 보내지 않는다(구독이 원래 알리지 않는 고침 → 헛경보 없음).
// - 놓친 줄의 `요청`이 동작 ID면 함께 알려 서버가 대기열에 넣는다(끊긴 동안에도 버튼이 폴링 주기 안에 처리됨).
// - 표 · 함수가 없는 서버(마이그레이션 전)는 조용히 건너뛴다. 실패해도 폴링 자체는 그대로 끝난다.
import { requestOf } from "./notionRequests.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"

type Page = Record<string, any>
export type ExistingRow = { id: string; props: Record<string, unknown> }
export type WatchItem = { page_id: string; edited_at: string; ds: string | null; request: boolean }

export const WATCH_MARGIN_MS = 2 * 60 * 1000 // 고친 지 이만큼 지난 줄만(웹훅이 늦게 와도 보통 1분 남짓)
export const MIN_MISSED = 2

// 키 순서와 무관하게 같은 값이면 같은 글(jsonb는 키 순서를 바꿔 저장한다).
export function stableJson(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
	if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`
	return JSON.stringify(v ?? null)
}

// 폴링이 읽은 줄 중 대조할 것: 사본에 이미 있고(새 줄은 첫 고침이 아직일 수 있어 제외하지 않음 — 사본에 없으면 "다름"),
// 값이 다르고, 고친 지 margin이 지난 줄.
export function watchItems(rows: { id: string; props: Record<string, unknown>; notion_edited_at: string }[], pages: Page[],
	existing: ExistingRow[], nowMs: number, marginMs = WATCH_MARGIN_MS): WatchItem[] {
	const had = new Map(existing.map((e) => [e.id, stableJson(e.props)]))
	const byId = new Map(pages.map((p) => [p.id, p]))
	const out: WatchItem[] = []
	for (const r of rows) {
		const edited = Date.parse(r.notion_edited_at)
		if (!Number.isFinite(edited) || nowMs - edited < marginMs) continue
		if (had.get(r.id) === stableJson(r.props)) continue
		const p = byId.get(r.id)
		out.push({ page_id: r.id, edited_at: new Date(edited).toISOString(), ds: p?.parent?.data_source_id ?? null, request: !!requestOf(p ?? null) })
	}
	return out
}

export type WatchReport = { state: "ok" | "down"; missed: number; total: number; queued: number } | { skipped: string }

export interface WatchDeps {
	existing(ids: string[]): Promise<ExistingRow[] | null> // null = 읽지 못함(대조 건너뜀)
	report(items: WatchItem[]): Promise<any> // 서버 함수가 없으면 throw MissingWatch
	now(): number
}
export class MissingWatch extends Error {}

// 폴링 한 번에 모은 줄 전부를 한 번에 대조. 대조할 줄이 없어도 "대조함"을 남기려고 빈 목록으로 부른다.
export async function watchPoll(batches: { rows: any[]; pages: Page[]; existing: ExistingRow[] | null }[], deps: WatchDeps): Promise<WatchReport> {
	const items: WatchItem[] = []
	for (const b of batches) if (b.existing) items.push(...watchItems(b.rows, b.pages, b.existing, deps.now()))
	try {
		return await deps.report(items)
	} catch (e) {
		if (e instanceof MissingWatch) return { skipped: "표 없음" }
		throw e
	}
}

// ---------- 실제 바깥 일 ----------
const SB_URL = () => (globalThis as any).Deno?.env?.get?.("SB_URL") ?? ""
const SB_KEY = () => (globalThis as any).Deno?.env?.get?.("SB_SERVICE_ROLE_KEY") ?? ""
const headers = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json" })

export const liveWatchDeps: WatchDeps = {
	async existing(ids) {
		const out: ExistingRow[] = []
		for (let i = 0; i < ids.length; i += 100) {
			const list = ids.slice(i, i + 100).map((id) => `"${id}"`).join(",")
			const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?select=id,props&id=in.(${list})`, { headers: headers() })
			if (!res.ok) { await res.body?.cancel(); return null }
			out.push(...await res.json())
		}
		return out
	},
	async report(items) {
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/rpc/notion_subscription_poll_report`, {
			method: "POST", headers: headers(), body: JSON.stringify({ p_items: items, p_min_missed: MIN_MISSED }),
		})
		if (res.status === 404) { await res.body?.cancel(); throw new MissingWatch() }
		if (!res.ok) throw new Error(`구독 대조 실패: ${res.status} ${(await res.text()).slice(0, 200)}`)
		return await res.json()
	},
	now: () => Date.now(),
}
