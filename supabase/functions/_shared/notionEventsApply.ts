// _shared/notionEventsApply.ts
//
// (261123 동기화 단계 2) 노션 웹훅 이벤트로 앱 사본을 줄 단위로 맞춘다.
//   notion-events(받기) → notion_event_enqueue(대기열, 마이그레이션 20261123020000) → drainEvents(이 파일, 처리기 하나만)
//   → 그 줄만 노션에서 다시 읽어 app_rows 또는 cr_* 를 고치거나 지움.
// 규칙
//   - 이벤트에는 값이 없고 칸 id만 온다. 그래서 언제나 그 줄을 다시 읽어 "노션 지금 값"으로 맞춘다(순서가 뒤섞여도 결과가 같다).
//     휴지통 · 보관 · 없음(404)이면 모든 사본에서 지우고, 되살리면(undeleted) 다시 읽어 넣는다.
//   - 사본에 없는 DB의 이벤트는 노션을 읽지 않고 "사본 없음"으로 끝낸다(기록은 notion_webhook_events에 남아 있다).
//   - 메아리: 작성자가 이 학원 연동뿐이고 그 줄 사본이 이벤트 시각 뒤에 이미 고쳐졌으면(앱 저장이 바로 반영한 경우) 노션을 읽지 않는다.
//     그 밖의 연동 쓰기(다른 함수가 노션만 고친 경우)는 다시 읽어 맞춘다. 다시 읽은 값이 사본과 같으면 쓰지 않는다("same").
//   - 노션 한도: 이 처리기는 한 번에 하나(임대)이고, 부른 횟수 × 400ms(초당 2.5회)보다 빨리 다음 줄로 가지 않는다.
//   - 이벤트로 다른 일(알림톡 · 보고서 · 수업 생성)은 하지 않는다. 사본만 맞춘다.

import { NOTION_API } from "./constants.ts"
import { fetchWithRetry, notionHeaders, normalizeProps, notionCalls } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { appSources, pageRow, upsertRows, deleteIds, type AppDb } from "./appCopy.ts"
import { COPY_TABLES, DS, toRows, upsertCopyRows, deleteCopyRows, type CopyTable } from "./classRoomCopy.ts"

type Page = Record<string, any>

// 다시 읽어 맞추는 이벤트. page.content_updated(본문만)는 사본에 본문이 없어 넘긴다.
export const REREAD_EVENTS = new Set(["page.created", "page.properties_updated", "page.deleted", "page.undeleted", "page.moved"])
export const MS_PER_NOTION_CALL = 400
export const MAX_ATTEMPTS = 6

export type Target = { kind: "app"; db: AppDb } | { kind: "cr"; table: CopyTable }
export type QueueItem = { page_id: string; data_source_id: string | null; event_type: string; event_time: string; own_bot: boolean; seq: number; attempts: number; events?: number }

const norm = (id: string | null | undefined) => (id ?? "").replace(/-/g, "").toLowerCase()

// 작성자가 모두 이 학원 연동(bot)인가. 작성자가 없거나 사람·다른 연동이 섞이면 false.
export function ownBotOnly(authors: unknown, botId: string | null): boolean {
	if (!botId || !Array.isArray(authors) || !authors.length) return false
	return authors.every((a: any) => a?.type === "bot" && norm(a?.id) === norm(botId))
}

// 이벤트 본문의 데이터 소스 id(API 2025-09-03 이후 parent.data_source_id).
export function eventDataSource(data: unknown): string | null {
	const parent = (data as any)?.parent
	if (!parent || typeof parent !== "object") return null
	if (typeof parent.data_source_id === "string" && parent.data_source_id) return parent.data_source_id
	if (parent.type === "data_source" && typeof parent.id === "string") return parent.id
	return null
}
// 다시 읽은 페이지의 데이터 소스 id.
export const pageDataSource = (p: Page | null): string | null => p?.parent?.data_source_id ?? null

export type TargetMap = Map<string, Target>
export function buildTargets(crSources: Record<CopyTable, string>, appMap: Map<AppDb, string[]>): TargetMap {
	const out: TargetMap = new Map()
	for (const [db, ids] of appMap) for (const id of ids) if (id) out.set(norm(id), { kind: "app", db })
	for (const t of COPY_TABLES) if (crSources[t]) out.set(norm(crSources[t]), { kind: "cr", table: t })
	return out
}
export const targetOf = (map: TargetMap, ds: string | null): Target | null => (ds ? map.get(norm(ds)) ?? null : null)

// 실패 뒤 다시 할 때까지(초): 30, 60, 120, 240, 480, 600
export const retryDelaySec = (attempts: number) => Math.min(600, 30 * 2 ** Math.max(0, attempts))

// 사본 줄이 다시 읽은 값과 같은가(동기화 시각만 빼고 본다. 시각 글자는 같은 순간이면 같다고 본다 — DB가 "+00:00"으로 돌려줌).
const stable = (v: unknown): string => {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`
	return JSON.stringify(v ?? null)
}
export function sameRow(existing: Record<string, unknown> | null, next: Record<string, unknown>): boolean {
	if (!existing) return false
	for (const [k, v] of Object.entries(next)) {
		if (k === "synced_at") continue
		const a = existing[k]
		if (typeof a === "string" && typeof v === "string" && /T\d\d:/.test(a) && /T\d\d:/.test(v) && Date.parse(a) === Date.parse(v)) continue
		if (stable(a) !== stable(v)) return false
	}
	return true
}

// ---------- 바깥 일(시험에서 가짜로 바꿈) ----------
export interface Deps {
	rpc(name: string, args: Record<string, unknown>): Promise<any>
	targets(): Promise<TargetMap>
	readPage(id: string): Promise<Page | null> // 404 = null
	copyRow(target: Target, id: string): Promise<Record<string, unknown> | null>
	rowsOf(target: Target, page: Page): Promise<Record<string, unknown>[]>
	upsert(target: Target, rows: Record<string, unknown>[]): Promise<void>
	removeEverywhere(id: string): Promise<void>
	calls(): number
	now(): number
	sleep(ms: number): Promise<void>
	log(msg: string): void
}

export type ApplyResult = { result: string; target?: string }

// 줄 하나. 결과 글자는 대기열 result 칸에 남는다.
export async function applyOne(item: QueueItem, deps: Deps): Promise<ApplyResult> {
	const map = await deps.targets()
	const evTarget = targetOf(map, item.data_source_id)
	if (!REREAD_EVENTS.has(item.event_type)) return { result: "skip:event" }
	if (!evTarget && item.event_type !== "page.moved") return { result: "skip:no-copy" }
	if (evTarget && item.own_bot) {
		const row = await deps.copyRow(evTarget, item.page_id)
		if (item.event_type === "page.deleted" && !row) return { result: "echo", target: label(evTarget) } // 앱이 지우면서 사본도 이미 뺌
		const synced = row?.synced_at ? Date.parse(String(row.synced_at)) : NaN
		if (Number.isFinite(synced) && synced >= Date.parse(item.event_time)) return { result: "echo", target: label(evTarget) }
	}
	const page = await deps.readPage(item.page_id)
	if (!page || page.in_trash || page.archived) {
		await deps.removeEverywhere(item.page_id)
		return { result: "deleted", target: evTarget ? label(evTarget) : undefined }
	}
	const target = targetOf(map, pageDataSource(page)) ?? null
	if (!target) {
		await deps.removeEverywhere(item.page_id) // 사본 DB 밖으로 옮겨짐
		return { result: "moved-out" }
	}
	if (item.event_type === "page.moved" && (!evTarget || label(evTarget) !== label(target))) await deps.removeEverywhere(item.page_id)
	const rows = await deps.rowsOf(target, page)
	if (rows.length === 1 && sameRow(await deps.copyRow(target, item.page_id), rows[0])) return { result: "same", target: label(target) }
	await deps.upsert(target, rows)
	return { result: "upserted", target: label(target) }
}
const label = (t: Target) => (t.kind === "app" ? `app_rows:${t.db}` : t.table)

export type DrainResult = { lease: boolean; processed: number; results: Record<string, number>; notionCalls: number; ms: number; perSec: number }

// 대기열 비우기. 다른 처리기가 돌고 있으면 바로 끝난다(그쪽이 이어서 처리). budgetMs 안에서 할 일이 없을 때까지.
export async function drainEvents(deps: Deps, owner: string, budgetMs = 40_000): Promise<DrainResult> {
	const t0 = deps.now(), c0 = deps.calls()
	const results: Record<string, number> = {}
	let processed = 0, lease = false, nextAt = t0
	outer: for (let round = 0; round < 3; round++) {
		while (deps.now() - t0 < budgetMs) {
			const claim = await deps.rpc("notion_event_claim", { p_owner: owner, p_limit: 10, p_lease_sec: 60 })
			if (!claim?.lease) { if (!lease) break outer; break }
			lease = true
			const items: QueueItem[] = claim.items ?? []
			if (!items.length) break
			for (const item of items) {
				if (deps.now() - t0 >= budgetMs) break
				const wait = nextAt - deps.now()
				if (wait > 0) await deps.sleep(wait)
				const s = deps.now(), before = deps.calls()
				let ok = true, out: ApplyResult = { result: "error" }, error: string | null = null
				try { out = await applyOne(item, deps) } catch (err) { ok = false; error = (err as Error)?.message ?? String(err) }
				const used = deps.calls() - before
				nextAt = s + used * MS_PER_NOTION_CALL
				const status = await deps.rpc("notion_event_finish", {
					p_page_id: item.page_id, p_seq: item.seq, p_ok: ok, p_result: out.target ? `${out.result} ${out.target}` : out.result,
					p_error: error, p_retry_sec: retryDelaySec(item.attempts), p_notion_calls: used,
				})
				const key = ok ? out.result : `error→${status}`
				results[key] = (results[key] ?? 0) + 1
				processed++
				if (!ok) deps.log(`[notionEvents] ${item.page_id.slice(-6)} 실패(${status}): ${error}`)
			}
		}
		await deps.rpc("notion_event_release", { p_owner: owner })
		// 놓아주는 사이에 들어온 일이 있으면 한 번 더(다른 처리기가 임대에 실패하고 끝났을 수 있다).
		if (deps.now() - t0 >= budgetMs || !(Number(await deps.rpc("notion_event_due_count", {})) > 0)) break
	}
	const ms = deps.now() - t0, used = deps.calls() - c0
	const out = { lease, processed, results, notionCalls: used, ms, perSec: used > 1 && ms > 0 ? Math.round(((used - 1) / (ms / 1000)) * 100) / 100 : 0 } // 부른 사이 간격 기준(첫 번째는 시작점)
	if (lease && processed) deps.log(`[notionEvents] 처리 ${processed}줄 · ${JSON.stringify(results)} · Notion ${used}번 · ${ms}ms · 초당 ${out.perSec}번`)
	return out
}

// ---------- 실제 바깥 일 ----------
const SB_URL = () => (Deno.env.get("SB_URL") ?? "").replace(/\/$/, "")
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
const sbHeaders = (extra: Record<string, string> = {}) => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra })

export async function sbRpc(name: string, args: Record<string, unknown>): Promise<any> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/rpc/${name}`, { method: "POST", headers: sbHeaders(), body: JSON.stringify(args) })
	if (!res.ok) throw new Error(`${name} 실패: ${res.status} ${(await res.text()).slice(0, 200)}`)
	const text = await res.text()
	return text ? JSON.parse(text) : null
}

let targetCache: { at: number; map: TargetMap } | null = null
async function liveTargets(): Promise<TargetMap> {
	if (targetCache && Date.now() - targetCache.at < 10 * 60 * 1000) return targetCache.map
	const map = buildTargets(DS, await appSources())
	targetCache = { at: Date.now(), map }
	return map
}

export const liveDeps: Deps = {
	rpc: sbRpc,
	targets: liveTargets,
	async readPage(id) {
		const res = await fetchWithRetry(`${NOTION_API}/pages/${id}`, { headers: notionHeaders() })
		if (res.status === 404) return null
		if (!res.ok) throw new Error(`노션 줄 읽기 실패: ${res.status} ${(await res.text()).slice(0, 200)}`)
		return normalizeProps(await res.json())
	},
	async copyRow(target, id) {
		const table = target.kind === "app" ? "app_rows" : target.table
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(id)}`, { headers: sbHeaders() })
		if (!res.ok) throw new Error(`${table} 조회 실패: ${res.status}`)
		return (await res.json())[0] ?? null
	},
	async rowsOf(target, page) {
		return target.kind === "app" ? [pageRow(target.db, page)] : await toRows(target.table, [page])
	},
	async upsert(target, rows) {
		if (target.kind === "app") await upsertRows(rows as any)
		else await upsertCopyRows(target.table, rows)
	},
	async removeEverywhere(id) {
		await deleteIds([id])
		for (const t of COPY_TABLES) await deleteCopyRows(t, [id])
	},
	calls: () => notionCalls.n,
	now: () => Date.now(),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	log: (m) => console.log(m),
}

export const applyEnabled = () => Deno.env.get("NOTION_EVENTS_APPLY") !== "off"
