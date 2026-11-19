// _shared/appCopy.ts
//
// (v2.8.0 항목 74) 관리 앱 읽기용 Notion 복사본. 관리 앱의 메뉴 9×3 화면이 Notion을 직접 읽지 않고 Supabase app_rows를 읽는다.
//
// - 표 하나(app_rows)에 DB마다 페이지를 한 줄씩 둔다. 칸은 Notion 속성 이름 그대로, 값만 평평하게(flattenProps):
//   제목·글 → 글자, 고르기·상태 → 이름, 여러 개 고르기 → 이름 목록, 관계 → 페이지 id 목록, 날짜 → {start, end},
//   숫자 → 숫자, 체크 → 참·거짓, 수식·롤업 → 그 값, 사람 → id 목록. 화면 모양으로 바꾸는 일은 앱 자료 층 한 곳에서 한다.
//   Notion 칸 이름이 바뀌어도 표(마이그레이션)는 그대로다.
// - DB는 제목으로 찾는다(exampleClear.dataSources와 같은 Notion 검색). 학원마다 id가 달라도 되고, 저장소에 Notion id를 적지 않는다.
// - 수업·출석·학습기록·학습활동은 이미 있는 cr_* 복사본, 라이브러리 단원은 lib_*를 쓴다(여기서 다시 복사하지 않는다).
// - Notion은 읽기만 한다. 쓰기(저장)는 다음 단계에서 Notion에 먼저 쓰고 이 표에 반영한다.
//
// 맞추는 법(classRoomCopy와 같은 틀)
//   - reconcile(DB 하나): DB 전체를 읽어 upsert하고, 이 DB 줄 중 Notion에 없는 것은 지운다. 커서가 없으면 남긴다.
//   - incremental(모든 DB): DB마다 last_edited_time ≥ (커서 − 2분)인 페이지만 upsert. 커서 = sync_cursors("app:" + DB 이름).
//   관계 칸은 Notion 페이지 응답이 25개까지만 주므로(has_more) 많은 쪽은 반대편(예: 등록의 클래스)으로 이어 본다.

import { NOTION_API } from "./constants.ts"
import { fetchWithRetry, notionHeaders, queryAllPages } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { runInBackground } from "./backgroundTask.ts"

type Page = Record<string, any>
type Row = { db: string; id: string; props: Record<string, unknown>; notion_created_at: string | null; notion_edited_at: string; url: string; icon: string }

// 앱 메뉴 9×3가 읽는 DB(Notion 제목). 순서 = 처음 채우기 순서(기준 정보 → 사람 → 수강 → 청구·보고).
export const APP_DBS = [
  "메뉴(학원) DB",
  "학교(학원) DB", "학년(학원) DB", "영역(학원) DB", "과목(학원) DB", "라이브러리(학원) DB",
  "강사(학원) DB", "근무(학원) DB",
  "학생(학원) DB", "클래스(학원) DB", "시즌(학원) DB", "시간표(학원) DB", "등록(학원) DB", "진도관리(학원) DB",
  "루틴(학원) DB", // (2.8, 앱 클래스 창 [루틴] 탭 — 담당 261119)
  "일정(학원) DB", "시험(학원) DB", "시험정보(학원) DB", "성적(학원) DB",
  "보고서(학원) DB", "알림톡 발송함(학원) DB", "가정통신문(학원) DB",
  "수강료(학원) DB", "결제(학원) DB", "청구서(학원) DB", "청구 항목(학원) DB", "청구 결제(학원) DB", "기타경비(학원) DB",
  "자료(학원) DB", "알림톡 설정(학원) DB",
] as const
export type AppDb = typeof APP_DBS[number]
export const isAppDb = (v: unknown): v is AppDb => typeof v === "string" && (APP_DBS as readonly string[]).includes(v)
// 옛 이름으로 남아 있는 학원(v2.8.0 항목 55 · 71 전): 같은 DB로 본다.
const OLD_NAMES: Record<string, AppDb> = {
  "진도교재(학원) DB": "진도관리(학원) DB",
  "교재비(학원) DB": "청구서(학원) DB", "청구(학원) DB": "청구서(학원) DB",
  "교재배부(학원) DB": "청구 항목(학원) DB",
  "교재결제(학원) DB": "청구 결제(학원) DB",
}

const CURSOR_MARGIN_MS = 2 * 60 * 1000
const cursorKey = (db: AppDb) => `app:${db}`

// ---------- 속성 평평하게 ----------
const plain = (rt: any[] | undefined) => (rt ?? []).map((t) => t?.plain_text ?? "").join("")
function flatValue(p: any): unknown {
	if (!p || typeof p !== "object") return null
	switch (p.type) {
		case "title": return plain(p.title)
		case "rich_text": return plain(p.rich_text)
		case "number": return p.number ?? null
		case "select": return p.select?.name ?? ""
		case "status": return p.status?.name ?? ""
		case "multi_select": return (p.multi_select ?? []).map((o: any) => o?.name ?? "")
		case "relation": return (p.relation ?? []).map((r: any) => r?.id).filter(Boolean)
		case "date": return p.date ? { start: p.date.start ?? null, end: p.date.end ?? null } : null
		case "checkbox": return !!p.checkbox
		case "url": return p.url ?? ""
		case "email": return p.email ?? ""
		case "phone_number": return p.phone_number ?? ""
		case "people": return (p.people ?? []).map((u: any) => u?.id).filter(Boolean)
		case "files": return (p.files ?? []).map((f: any) => ({ name: f?.name ?? "", url: f?.external?.url ?? f?.file?.url ?? "" }))
		case "created_time": return p.created_time ?? null
		case "last_edited_time": return p.last_edited_time ?? null
		case "created_by": case "last_edited_by": return p[p.type]?.id ?? null
		case "unique_id": return p.unique_id ? `${p.unique_id.prefix ? p.unique_id.prefix + "-" : ""}${p.unique_id.number ?? ""}` : ""
		case "formula": {
			const f = p.formula ?? {}
			if (f.type === "string") return f.string ?? ""
			if (f.type === "number") return f.number ?? null
			if (f.type === "boolean") return !!f.boolean
			if (f.type === "date") return f.date ? { start: f.date.start ?? null, end: f.date.end ?? null } : null
			return null
		}
		case "rollup": {
			const r = p.rollup ?? {}
			if (r.type === "number") return r.number ?? null
			if (r.type === "date") return r.date ? { start: r.date.start ?? null, end: r.date.end ?? null } : null
			if (r.type === "array") return (r.array ?? []).map((x: any) => flatValue(x))
			return null
		}
		case "button": return null
		default: return null
	}
}
// 버튼은 값이 없어 뺀다. 관계가 25개를 넘으면(has_more) "<칸>#more": true를 남겨 앱이 반대편으로 잇게 한다.
// 앱 화면에 필요 없고 새면 안 되는 칸은 복사하지 않는다: 학부모 리포트 토큰, 웹훅 주소·동작 칸, 노션 계정.
export const SKIP_PROPS = new Set(["토큰", "웹훅 링크", "웹훅 정보", "웹훅ID", "웹훅 버튼", "노션 계정", "노션 아이디"])
export function flattenProps(props: Record<string, any> | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [name, p] of Object.entries(props ?? {})) {
		if (p?.type === "button" || SKIP_PROPS.has(name)) continue
		out[name] = flatValue(p)
		if (p?.type === "relation" && p.has_more) out[`${name}#more`] = true
	}
	return out
}
const iconText = (icon: any) => (icon?.type === "emoji" ? icon.emoji ?? "" : "")
export function pageRow(db: AppDb, p: Page): Row {
	return {
		db, id: p.id, props: flattenProps(p.properties),
		notion_created_at: p.created_time ?? null, notion_edited_at: p.last_edited_time ?? new Date(0).toISOString(),
		url: p.url ?? "", icon: iconText(p.icon),
	}
}

// ---------- DB 찾기(제목) ----------
export function pickSources(found: Map<string, string[]>): Map<AppDb, string[]> {
	const out = new Map<AppDb, string[]>()
	// 지금 이름이 먼저. 옛 이름은 지금 이름의 DB가 없을 때만 쓴다(이름을 바꾸는 중에 둘 다 보여도 섞지 않음).
	for (const [name, ids] of found) if (isAppDb(name)) out.set(name, [...ids])
	for (const [name, ids] of found) {
		const db = OLD_NAMES[name]
		if (db && !found.has(db)) out.set(db, [...(out.get(db) ?? []), ...ids])
	}
	return out
}
// (v2.8.0 항목 100) Notion이 한도(429)로 오래 기다리라고 하면 앱 요청을 몇 십 초 붙잡지 않고 "잠시 뒤 다시"로 돌려준다.
// DB 찾기(`status`·`list` 데우기·저장 앞 찾기)에만 쓴다 — 저장 본 경로와 다른 큐 작업의 429 처리는 그대로.
export const NOTION_BUSY_WAIT_MS = 15_000
export const NOTION_BUSY_RETRY_SEC = 10
export class NotionBusyError extends Error {
	constructor(public retryAfterSec = NOTION_BUSY_RETRY_SEC) { super("Notion이 바빠 잠시 뒤 다시 시도해야 합니다.") }
}
const findFetch = async (url: string, init: RequestInit): Promise<Response> => {
	const res = await fetchWithRetry(url, init, 5, { maxWaitMs: NOTION_BUSY_WAIT_MS })
	if (res.status === 429) throw new NotionBusyError()
	return res
}
async function searchSources(): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>()
	let cursor: string | undefined
	do {
		const body: Record<string, unknown> = { filter: { property: "object", value: "data_source" }, page_size: 100 }
		if (cursor) body.start_cursor = cursor
		const res = await findFetch(`${NOTION_API}/search`, { method: "POST", headers: notionHeaders(), body: JSON.stringify(body) })
		if (!res.ok) throw new Error(`Notion 검색 실패: ${res.status} ${await res.text()}`)
		const data = await res.json()
		for (const r of data.results ?? []) {
			if (r.in_trash || r.archived) continue
			const name = (r.title ?? []).map((t: { plain_text?: string }) => t.plain_text ?? "").join("").trim()
			if (name) out.set(name, [...(out.get(name) ?? []), r.id])
		}
		cursor = data.has_more ? data.next_cursor : undefined
	} while (cursor)
	return out
}
// ---------- 같은 이름 DB가 여럿 보일 때(한 워크스페이스에 학원 · 관이 여럿, 옛 버전 사본) ----------
// 조용히 고르지 않는다. 이 학원 것 하나로 좁혀지지 않으면 그 DB는 읽지도 쓰지도 않고 오류를 낸다(다른 관을 읽고 쓰는 일을 막음).
// 좁히는 순서: ① 이 학원 Secrets(DATA_SOURCE_*_ID)에 적힌 id와 같은 것 ② 기준 DB(등록, DATA_SOURCE_REGISTRATION_ID)와
// 같은 최상위 페이지 아래에 있는 것(부모를 위로 따라가 겹치는 페이지가 있는지) ③ 그래도 하나가 아니면 "모호함".
export type SourcePick = { map: Map<AppDb, string[]>; problems: Map<AppDb, string> }
export type AncestorsOf = (dataSourceId: string) => Promise<Set<string>>
const norm = (id: string) => id.replace(/-/g, "").toLowerCase()
export async function resolveSources(found: Map<AppDb, string[]>, envIds: string[], anchorId: string | null, ancestorsOf: AncestorsOf): Promise<SourcePick> {
	const map = new Map<AppDb, string[]>(), problems = new Map<AppDb, string>()
	const env = new Set(envIds.map(norm))
	let anchor: Set<string> | null = null
	for (const [db, ids] of found) {
		const uniq = [...new Set(ids)]
		if (uniq.length <= 1) { map.set(db, uniq); continue }
		const byEnv = uniq.filter((id) => env.has(norm(id)))
		if (byEnv.length === 1) { map.set(db, byEnv); continue }
		let left = uniq
		if (anchorId) {
			anchor ??= await ancestorsOf(anchorId)
			const keep: string[] = []
			for (const id of uniq) { const a = await ancestorsOf(id); if ([...a].some((x) => anchor!.has(x))) keep.push(id) }
			left = keep
		}
		if (left.length === 1) map.set(db, left)
		else problems.set(db, `같은 이름 DB가 ${uniq.length}개 보이고 이 학원 것 하나로 좁혀지지 않습니다(${left.length}개 남음). 통합(Integration)이 이 학원 페이지만 보게 하거나 중복 DB를 정리하세요.`)
	}
	return { map, problems }
}
// 부모를 위로 따라가며 만난 페이지 · DB id(자기 자신 제외). 워크스페이스에 닿거나 12단계에서 멈춘다.
async function notionAncestors(dataSourceId: string): Promise<Set<string>> {
	const out = new Set<string>()
	let kind = "data_sources", id = dataSourceId
	for (let i = 0; i < 12; i++) {
		const res = await findFetch(`${NOTION_API}/${kind}/${id}`, { headers: notionHeaders() })
		if (!res.ok) break
		const parent = (await res.json())?.parent
		if (!parent) break
		if (parent.type === "database_id") { kind = "databases"; id = parent.database_id }
		else if (parent.type === "page_id") { kind = "pages"; id = parent.page_id }
		else if (parent.type === "block_id") { kind = "blocks"; id = parent.block_id }
		else if (parent.type === "data_source_id") { kind = "data_sources"; id = parent.data_source_id }
		else break
		out.add(norm(id))
	}
	return out
}
const envDataSourceIds = () => Object.entries(Deno.env.toObject()).filter(([k, v]) => k.startsWith("DATA_SOURCE_") && v).map(([, v]) => v)

let sourceCache: { at: number; pick: SourcePick } | null = null
async function sourcePick(): Promise<SourcePick> {
	if (sourceCache && Date.now() - sourceCache.at < 10 * 60 * 1000) return sourceCache.pick
	const pick = await resolveSources(pickSources(await searchSources()), envDataSourceIds(), Deno.env.get("DATA_SOURCE_REGISTRATION_ID") || null, notionAncestors)
	sourceCache = { at: Date.now(), pick }
	return pick
}
// DB마다 데이터 소스 하나(없으면 빈 목록). 모호한 DB는 여기에 없다 — sourceProblem으로 이유를 본다.
export async function appSources(): Promise<Map<AppDb, string[]>> { return (await sourcePick()).map }
export async function sourceProblem(db: AppDb): Promise<string | null> { return (await sourcePick()).problems.get(db) ?? null }

// ---------- Supabase ----------
const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
function sbHeaders(extra: Record<string, string> = {}) {
	if (!SB_URL() || !SB_KEY()) throw new Error("SB_URL / SB_SERVICE_ROLE_KEY Secrets가 설정되어 있지 않습니다.")
	return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra }
}
async function upsertRows(rows: Row[]): Promise<void> {
	const now = new Date().toISOString()
	for (let i = 0; i < rows.length; i += 300) {
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?on_conflict=id`, {
			method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
			body: JSON.stringify(rows.slice(i, i + 300).map((r) => ({ ...r, synced_at: now }))),
		})
		if (!res.ok) throw new Error(`app_rows upsert 실패: ${res.status} ${await res.text()}`)
	}
}
async function selectIds(db: AppDb): Promise<string[]> {
	const ids: string[] = []
	for (let offset = 0; ; offset += 1000) {
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?select=id&db=eq.${encodeURIComponent(db)}&order=id&limit=1000&offset=${offset}`, { headers: sbHeaders() })
		if (!res.ok) throw new Error(`app_rows id 조회 실패: ${res.status} ${await res.text()}`)
		const part: { id: string }[] = await res.json()
		ids.push(...part.map((r) => r.id))
		if (part.length < 1000) return ids
	}
}
async function deleteIds(ids: string[]): Promise<void> {
	for (let i = 0; i < ids.length; i += 100) {
		const list = ids.slice(i, i + 100).map((id) => `"${id}"`).join(",")
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?id=in.(${list})`, { method: "DELETE", headers: sbHeaders({ Prefer: "return=minimal" }) })
		if (!res.ok) throw new Error(`app_rows 삭제 실패: ${res.status} ${await res.text()}`)
	}
}
async function getCursor(db: AppDb): Promise<string | null> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?source=eq.${encodeURIComponent(cursorKey(db))}&select=last_synced_at`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`sync_cursors 조회 실패: ${res.status}`)
	return (await res.json())[0]?.last_synced_at ?? null
}
async function setCursor(db: AppDb, at: string): Promise<void> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?on_conflict=source`, {
		method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([{ source: cursorKey(db), last_synced_at: at }]),
	})
	if (!res.ok) throw new Error(`sync_cursors 저장 실패: ${res.status}`)
}

// ---------- 맞추기 ----------
export type AppSyncResult = { db: AppDb; found: boolean; read: number; upserted: number; deleted: number; problem?: string }

export async function reconcileApp(db: AppDb): Promise<AppSyncResult> {
	const problem = await sourceProblem(db)
	if (problem) {
		// 어느 학원 DB인지 모르면 복사본을 비우고(섞인 줄을 보여 주지 않음) 다음 DB로 넘어가게 커서만 남긴다.
		const stale = await selectIds(db)
		await deleteIds(stale)
		if (!(await getCursor(db))) await setCursor(db, new Date().toISOString())
		console.error(`[appCopy] ${db}: ${problem}`)
		return { db, found: false, read: 0, upserted: 0, deleted: stale.length, problem }
	}
	const sources = (await appSources()).get(db) ?? []
	if (!sources.length) return { db, found: false, read: 0, upserted: 0, deleted: 0 }
	const startedAt = new Date().toISOString()
	const pages: Page[] = []
	for (const ds of sources) pages.push(...await queryAllPages(ds))
	const rows = pages.map((p) => pageRow(db, p))
	await upsertRows(rows)
	const fresh = new Set(rows.map((r) => r.id))
	const stale = (await selectIds(db)).filter((id) => !fresh.has(id))
	await deleteIds(stale)
	if (!(await getCursor(db))) await setCursor(db, startedAt)
	return { db, found: true, read: pages.length, upserted: rows.length, deleted: stale.length }
}

// 처음 채우기가 끝난(커서가 있는) DB만. 지운 페이지는 밤 대조(reconcile)가 지운다.
export async function incrementalApp(db: AppDb): Promise<AppSyncResult | null> {
	const cursor = await getCursor(db)
	if (!cursor) return null
	const problem = await sourceProblem(db)
	if (problem) return { db, found: false, read: 0, upserted: 0, deleted: 0, problem }
	const sources = (await appSources()).get(db) ?? []
	const since = new Date(Date.parse(cursor) - CURSOR_MARGIN_MS).toISOString()
	const startedAt = new Date().toISOString()
	const pages: Page[] = []
	for (const ds of sources) pages.push(...await queryAllPages(ds, { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } }))
	const rows = pages.map((p) => pageRow(db, p))
	await upsertRows(rows)
	await setCursor(db, startedAt)
	return { db, found: sources.length > 0, read: pages.length, upserted: rows.length, deleted: 0 }
}

// 커서가 아직 없는 첫 DB(처음 채우기 순서). 모두 있으면 null.
export async function nextUnfilled(): Promise<AppDb | null> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?source=like.app:*&select=source`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`sync_cursors 조회 실패: ${res.status}`)
	const have = new Set(((await res.json()) as { source: string }[]).map((r) => r.source))
	return APP_DBS.find((db) => !have.has(cursorKey(db))) ?? null
}

// 밤 대조 한 번: 가장 오래전에 전체 대조한 DB 하나(대조 시각 = sync_cursors "appfull:" + DB 이름).
export async function reconcileNext(): Promise<AppSyncResult> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?source=like.appfull:*&select=source,last_synced_at`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`sync_cursors 조회 실패: ${res.status}`)
	const at = new Map(((await res.json()) as { source: string; last_synced_at: string }[]).map((r) => [r.source, Date.parse(r.last_synced_at)]))
	const db = [...APP_DBS].sort((a, b) => (at.get(`appfull:${a}`) ?? 0) - (at.get(`appfull:${b}`) ?? 0))[0]
	const result = await reconcileApp(db)
	const mark = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?on_conflict=source`, {
		method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
		body: JSON.stringify([{ source: `appfull:${db}`, last_synced_at: new Date().toISOString() }]),
	})
	if (!mark.ok) throw new Error(`sync_cursors 저장 실패: ${mark.status}`)
	return result
}

// ---------- 읽기(app-api) ----------
// since가 있으면 그 뒤에 동기화된 줄만(앱이 화면을 열어 둔 채 바뀐 것만 다시 받을 때).
// (v2.8.0 항목 99) 앱 첫 로드가 곧 데우기: 목록 응답을 만든 뒤 뒤에서 Notion DB 찾기(sourcePick, 10분 캐시)를 채워 둔다.
// 저장 첫 호출이 DB 29개를 찾느라 6~7초 걸리던 것(원본 261119)을 줄인다. 응답은 기다리지 않고, 실패해도 저장·목록에 영향 없음.
export function warmSources(): void {
	if (sourceCache && Date.now() - sourceCache.at < 10 * 60 * 1000) return
	runInBackground(async () => { await sourcePick() })
}

export async function listApp(db: AppDb, since?: string | null): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = []
	const cond = since ? `&synced_at=gt.${encodeURIComponent(since)}` : ""
	for (let offset = 0; ; offset += 1000) {
		const res = await fetchSupabaseWithRetry(
			`${SB_URL()}/rest/v1/app_rows?select=id,props,notion_created_at,notion_edited_at,url,icon,synced_at&db=eq.${encodeURIComponent(db)}${cond}&order=id&limit=1000&offset=${offset}`,
			{ headers: sbHeaders() })
		if (!res.ok) throw new Error(`app_rows 읽기 실패: ${res.status} ${await res.text()}`)
		const part: Record<string, unknown>[] = await res.json()
		rows.push(...part)
		if (part.length < 1000) return rows
	}
}
// DB마다 줄 수 · 마지막 동기화(앱 첫 화면의 "자료 상태"와 건수 대조용).
export async function statusApp(): Promise<{ db: AppDb; rows: number; cursor: string | null; problem?: string }[]> {
	const pick = await sourcePick()
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/rpc/app_rows_counts`, { method: "POST", headers: sbHeaders(), body: "{}" })
	if (!res.ok) throw new Error(`app_rows 건수 조회 실패: ${res.status} ${await res.text()}`)
	const counts = new Map(((await res.json()) as { db: string; n: number }[]).map((r) => [r.db, Number(r.n)]))
	const cur = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/sync_cursors?source=like.app:*&select=source,last_synced_at`, { headers: sbHeaders() })
	const cursors = new Map(cur.ok ? ((await cur.json()) as { source: string; last_synced_at: string }[]).map((r) => [r.source, r.last_synced_at]) : [])
	return APP_DBS.map((db) => ({ db, rows: counts.get(db) ?? 0, cursor: cursors.get(cursorKey(db)) ?? null, ...(pick.problems.has(db) ? { problem: pick.problems.get(db) } : {}) }))
}
