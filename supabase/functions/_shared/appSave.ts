// _shared/appSave.ts
//
// (v2.8.0 항목 75) 관리 앱 저장 — 데이터 이관 입력 범위만 Notion에 쓴다(원본은 Notion, 앱은 입력 장치).
//
// - 쓸 수 있는 DB = WRITE_DBS(선생님 · 학생 · 클래스 · 시즌 · 시간표 · 등록 · 진도관리 · 라이브러리 · 기준 정보 · 일정 · 시험 · 시험정보 · 성적 · 루틴). 그 밖 DB는 읽기만.
// - 앱은 읽을 때와 같은 평평한 값(appCopy.flattenProps 모양)으로 보낸다. 서버가 그 DB의 Notion 칸 형식을 읽어 속성 값으로 바꾼다
//   (toNotionProps). 칸 이름이 없거나, 수식 · 롤업 · 버튼처럼 쓸 수 없는 칸이거나, 고르기 값이 Notion 선택지에 없으면 그 줄을 쓰지 않고
//   이유를 돌려준다(오타로 새 선택지가 생기지 않게).
// - 동작은 만들기(create) · 고치기(update)뿐이다. 지우기는 하지 않는다(지우기 대신 끝내기 — 등록 종료 등은 칸 값으로).
// - 고치기는 그 페이지가 복사본(app_rows)에서 같은 DB 줄인지 먼저 본다(다른 DB · 아무 페이지나 고치지 못하게). edited를 주면
//   그 사이 Notion에서 바뀌었는지(last_edited_time) 보고, 바뀌었으면 쓰지 않고 "충돌"로 돌려준다.
// - 한 번에 여러 줄: 앞 줄에서 만든 페이지를 뒤 줄 관계에 "tmp:이름"으로 쓸 수 있다(학생 → 등록 → 진도처럼 순서대로 보낸다).
// - 쓴 결과(Notion 응답)는 바로 app_rows에 반영한다. Notion 자동화(이름 자동화 등)가 뒤에 바꾸는 값은 다음 동기화가 맞춘다.

import { NOTION_API } from "./constants.ts"
import { createPage, fetchWithRetry, notionHeaders, updatePageProperties, getPage, mapWithConcurrency } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { appSources, pageRow, sourceProblem, SKIP_PROPS, type AppDb } from "./appCopy.ts"
import { enqueueSync, wakeSyncQueueWorker } from "./syncQueue.ts"
import { runInBackground } from "./backgroundTask.ts"
import { getCurrentAdminKey } from "./adminShared.ts"

export const WRITE_DBS = [
	"강사(학원) DB", "학생(학원) DB", "클래스(학원) DB", "시즌(학원) DB", "시간표(학원) DB", "등록(학원) DB", "진도관리(학원) DB",
	"라이브러리(학원) DB", "과목(학원) DB", "영역(학원) DB", "학교(학원) DB", "학년(학원) DB",
	// (2.8, 담당 261118) 일정 공개 화면: 앱이 쓰는 칸만(EVENT_PROPS). 잠긴 줄의 날짜는 서버도 거절.
	"일정(학원) DB",
	// (2.8, 담당 261119 연결 준비) 시험 화면 입력: 시험 · 시험정보 · 성적(노션에서 줄을 직접 고치는 것과 같음 — 보내기 없음).
	// 재무(수강료 · 결제 · 청구서 · 청구 결제)는 아직 읽기만 — [결제] 버튼 단계를 서버 동작으로 옮긴 뒤(N-18·19).
	"시험(학원) DB", "시험정보(학원) DB", "성적(학원) DB",
	// (2.8, 담당 261119) 앱 클래스 창 [루틴] 탭: 앱이 쓰는 칸만(ROUTINE_PROPS). 지우기는 열지 않음 — 쉬기로 끄거나 노션 [삭제].
	"루틴(학원) DB",
] as const
export type WriteDb = typeof WRITE_DBS[number]
export const isWriteDb = (v: unknown): v is WriteDb => typeof v === "string" && (WRITE_DBS as readonly string[]).includes(v)

// DB별로 앱이 쓸 수 있는 칸을 좁힌 곳(없으면 그 DB의 쓸 수 있는 칸 전부). 그 밖 칸은 그 줄을 쓰지 않고 이유를 돌려준다.
export const EVENT_DB = "일정(학원) DB"
// (2.8 2단계) 세부 구분·기록(내부용)을 받고, 구분은 받지 않는다(수식이 될 칸 — 앱은 읽기만, 앱서버 261118).
// (2.8, 대표 261118) `잠금` 칸은 버림 — 받지 않고, 잠금 줄 날짜 거절도 없앴다(관리 앱이 학사 일정을 스스로 잠가 보여 줌).
export const EVENT_PROPS = ["이름", "날짜", "세부 구분", "기록(내부용)", "숨김", "학부모 공개", "클래스", "학생", "학교", "학년"] as const
export const ROUTINE_DB = "루틴(학원) DB"
// 루틴 체크 관계는 받지 않는다(체크는 수업 [루틴 체크 생성]이 만든다).
export const ROUTINE_PROPS = ["이름", "클래스", "순서", "설명", "쉬기"] as const
const ONLY_PROPS: Partial<Record<WriteDb, ReadonlySet<string>>> = { [EVENT_DB]: new Set(EVENT_PROPS), [ROUTINE_DB]: new Set(ROUTINE_PROPS) }
export function checkAllowedProps(db: WriteDb, props: Record<string, unknown>): void {
	const only = ONLY_PROPS[db]
	if (!only) return
	const bad = Object.keys(props ?? {}).filter((k) => !only.has(k))
	if (bad.length) throw new SaveError(400, `앱에서 ${db}에 쓰지 않는 칸: ${bad.join(", ")}`)
}
// 앱이 고친 일정의 학부모 리포트 맞추기: sync-report-cache를 force로 부른다(건너뛰기 없이, 응답을 기다리지 않음).
export const saveDeps = {
	refreshReport: (pageId: string): void => {
		runInBackground(async () => {
			try {
				const res = await fetch(`${Deno.env.get("SB_URL") ?? ""}/functions/v1/sync-report-cache`, {
					method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": await getCurrentAdminKey() },
					body: JSON.stringify({ pageId, force: true }), signal: AbortSignal.timeout(60000),
				})
				if (!res.ok) console.warn("[appSave] 일정 리포트 맞추기 실패:", pageId, res.status)
			} catch (err) { console.warn("[appSave] 일정 리포트 맞추기 실패:", pageId, (err as Error).message) }
		})
	},
}
// 리포트에 보이는 데 영향을 주는 일정 칸(기록(내부용)만 바꾼 것은 아님).
export function eventAffectsReport(db: WriteDb, props: Record<string, unknown>): boolean {
	return db === EVENT_DB && Object.keys(props ?? {}).some((k) => k !== "기록(내부용)")
}
export const MAX_CHANGES = 60

export class SaveError extends Error { constructor(public status: number, message: string) { super(message) } }

type PropDef = { type: string; options?: string[] }
export type Schema = Record<string, PropDef>
const WRITABLE = new Set(["title", "rich_text", "number", "select", "status", "multi_select", "date", "checkbox", "relation", "url", "email", "phone_number"])

// ---------- 칸 형식 ----------
const schemaCache = new Map<string, { at: number; schema: Schema }>()
export async function dataSourceSchema(ds: string): Promise<Schema> {
	const hit = schemaCache.get(ds)
	if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.schema
	const res = await fetchWithRetry(`${NOTION_API}/data_sources/${ds}`, { headers: notionHeaders() })
	if (!res.ok) throw new Error(`Notion 칸 형식 읽기 실패: ${res.status} ${await res.text()}`)
	const data = await res.json()
	const schema: Schema = {}
	for (const [name, p] of Object.entries<any>(data.properties ?? {})) {
		const opts = p?.[p.type]?.options
		schema[name] = { type: p.type, ...(Array.isArray(opts) ? { options: opts.map((o: any) => o?.name ?? "") } : {}) }
	}
	schemaCache.set(ds, { at: Date.now(), schema })
	return schema
}
// 앱이 고르기 칸을 Notion 선택지에서만 고르게 하는 목록: 쓸 수 있는 DB마다 { 칸 이름: [선택지 이름…] }(고르기 · 상태 · 여러 개 고르기).
// 저장은 선택지에 없는 값을 거절하므로(새 선택지를 만들지 않음) 앱이 미리 이 목록으로 맞춘다. 못 찾은 · 모호한 DB는 빠진다.
// (v2.8.0 항목 101) 쓰기 DB 약 20개의 칸 형식을 하나씩 읽던 것을 한 번에 5개까지 병렬로(Notion 한도를 더 부르지 않게 5 이하).
// 캐시가 빈 첫 호출이 11초 걸리던 것(원본 261119 01:43Z)을 줄인다. 결과는 WRITE_DBS 순서 그대로.
export const OPTIONS_CONCURRENCY = 5
export async function writeOptions(): Promise<Record<string, Record<string, string[]>>> {
	const sources = await appSources()
	const targets = WRITE_DBS.flatMap((db) => { const ds = (sources.get(db as AppDb) ?? [])[0]; return ds ? [{ db, ds }] : [] })
	const schemas = await mapWithConcurrency(targets, OPTIONS_CONCURRENCY, (t) => dataSourceSchema(t.ds))
	const out: Record<string, Record<string, string[]>> = {}
	targets.forEach((t, i) => {
		const props: Record<string, string[]> = {}
		for (const [name, def] of Object.entries(schemas[i])) if (def.options && !SKIP_PROPS.has(name)) props[name] = def.options
		out[t.db] = props
	})
	return out
}

// ---------- 평평한 값 → Notion 속성 ----------
const rt = (v: unknown) => {
	const s = v == null ? "" : String(v)
	return s ? [{ type: "text", text: { content: s.slice(0, 2000) } }] : []
}
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(s)
const isId = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{32,36}$/i.test(s)

// resolve: "tmp:…" → 앞에서 만든 페이지 id. 잘못된 값은 throw(그 줄만 실패).
export function toNotionProps(props: Record<string, unknown>, schema: Schema, resolve: (v: string) => string = (v) => v): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [name, value] of Object.entries(props ?? {})) {
		const def = schema[name]
		if (!def) throw new SaveError(400, `없는 칸: ${name}`)
		if (SKIP_PROPS.has(name)) throw new SaveError(400, `앱에서 쓰지 않는 칸: ${name}`)
		if (!WRITABLE.has(def.type)) throw new SaveError(400, `쓸 수 없는 칸(${def.type}): ${name}`)
		switch (def.type) {
			case "title": out[name] = { title: rt(value) }; break
			case "rich_text": out[name] = { rich_text: rt(value) }; break
			case "number": {
				if (value === null || value === "") { out[name] = { number: null }; break }
				const n = Number(value)
				if (!Number.isFinite(n)) throw new SaveError(400, `숫자가 아님: ${name}`)
				out[name] = { number: n }; break
			}
			case "select": case "status": {
				const s = value == null ? "" : String(value)
				if (s && def.options && !def.options.includes(s)) throw new SaveError(400, `선택지에 없음: ${name} = ${s}`)
				out[name] = { [def.type]: s ? { name: s } : null }; break
			}
			case "multi_select": {
				const arr = Array.isArray(value) ? value.map(String).filter(Boolean) : []
				const bad = arr.filter((s) => def.options && !def.options.includes(s))
				if (bad.length) throw new SaveError(400, `선택지에 없음: ${name} = ${bad.join(", ")}`)
				out[name] = { multi_select: arr.map((s) => ({ name: s })) }; break
			}
			case "date": {
				if (value == null || value === "") { out[name] = { date: null }; break }
				const d = typeof value === "string" ? { start: value, end: null } : value as { start?: unknown; end?: unknown }
				if (!isDay(d.start) || (d.end != null && d.end !== "" && !isDay(d.end))) throw new SaveError(400, `날짜 형식(YYYY-MM-DD): ${name}`)
				out[name] = { date: { start: d.start, end: d.end || null } }; break
			}
			case "checkbox": out[name] = { checkbox: value === true }; break
			case "relation": {
				const ids = (Array.isArray(value) ? value : value ? [value] : []).map((v) => resolve(String(v)))
				if (ids.some((v) => !isId(v))) throw new SaveError(400, `관계 값이 페이지 id가 아님: ${name}`)
				out[name] = { relation: [...new Set(ids)].map((id) => ({ id })) }; break
			}
			case "url": out[name] = { url: value ? String(value) : null }; break
			case "email": out[name] = { email: value ? String(value) : null }; break
			case "phone_number": out[name] = { phone_number: value ? String(value) : null }; break
		}
	}
	return out
}

// ---------- Supabase(복사본) ----------
const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
const sbHeaders = (extra: Record<string, string> = {}) => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra })
async function copyDbOf(id: string): Promise<string | null> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?select=db&id=eq.${encodeURIComponent(id)}`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`app_rows 조회 실패: ${res.status}`)
	return (await res.json())[0]?.db ?? null
}
async function upsertCopy(db: WriteDb, page: Record<string, any>): Promise<Record<string, unknown>> {
	const row = { ...pageRow(db as AppDb, page), synced_at: new Date().toISOString() }
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?on_conflict=id`, {
		method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([row]),
	})
	if (!res.ok) throw new Error(`app_rows 반영 실패: ${res.status} ${await res.text()}`)
	return row
}

// ---------- 저장 ----------
export type Change = { op: "create" | "update"; db: string; id?: string; tmp?: string; edited?: string; props: Record<string, unknown> }
export type ChangeResult = { i: number; ok: boolean; id?: string; tmp?: string; row?: Record<string, unknown>; error?: string; conflict?: boolean }

export function checkChanges(changes: unknown): Change[] {
	if (!Array.isArray(changes) || !changes.length) throw new SaveError(400, "저장할 줄이 없습니다.")
	if (changes.length > MAX_CHANGES) throw new SaveError(400, `한 번에 ${MAX_CHANGES}줄까지 저장합니다.`)
	return changes.map((c: any, i) => {
		if (!c || (c.op !== "create" && c.op !== "update")) throw new SaveError(400, `${i + 1}번째: op는 create 또는 update`)
		if (!isWriteDb(c.db)) throw new SaveError(400, `${i + 1}번째: 앱에서 쓸 수 없는 DB(${c.db})`)
		if (c.op === "update" && !isId(c.id)) throw new SaveError(400, `${i + 1}번째: 고칠 페이지 id가 없습니다.`)
		if (c.op === "create" && c.tmp !== undefined && !/^tmp:[\w-]{1,40}$/.test(String(c.tmp))) throw new SaveError(400, `${i + 1}번째: tmp 형식`)
		if (!c.props || typeof c.props !== "object" || Array.isArray(c.props)) throw new SaveError(400, `${i + 1}번째: props가 없습니다.`)
		return c as Change
	})
}

// 줄마다 따로 성공 · 실패(앞 줄이 실패해도 뒤 줄은 계속, 단 실패한 tmp를 가리키는 줄은 실패).
export async function saveChanges(changes: Change[]): Promise<ChangeResult[]> {
	const sources = await appSources()
	const made = new Map<string, string>()
	const resolve = (v: string) => {
		if (!v.startsWith("tmp:")) return v
		const id = made.get(v)
		if (!id) throw new SaveError(400, `앞에서 만들지 못한 줄을 가리킴: ${v}`)
		return id
	}
	const out: ChangeResult[] = []
	for (const [i, c] of changes.entries()) {
		// (v2.8.0 항목 97) 저장이 오래 걸릴 때 어느 단계인지 보려고 단계별 시간(ms)을 로그 한 줄로만 남긴다 — 동작은 그대로.
		const t0 = Date.now(), steps: string[] = []
		const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
			const s = Date.now()
			try { return await fn() } finally { steps.push(`${name}=${Date.now() - s}`) }
		}
		try {
			const problem = await timed("연결확인", () => sourceProblem(c.db as AppDb))
			if (problem) throw new SaveError(409, `${c.db}: ${problem}`)
			const ds = (sources.get(c.db as AppDb) ?? [])[0]
			if (!ds) throw new SaveError(404, `Notion에서 ${c.db}를 찾지 못했습니다.`)
			checkAllowedProps(c.db as WriteDb, c.props)
			const props = toNotionProps(c.props, await timed("칸형식", () => dataSourceSchema(ds)), resolve)
			let page: Record<string, any>
			if (c.op === "create") {
				page = await timed("노션쓰기", () => createPage(ds, props))
				if (c.tmp) made.set(c.tmp, page.id)
			} else {
				if ((await timed("복사본확인", () => copyDbOf(c.id!))) !== c.db) throw new SaveError(400, "이 DB의 줄이 아닙니다.")
				const now = c.edited ? await timed("충돌확인", () => getPage(c.id!)) : null
				if (c.edited && now) {
					if (Date.parse(now.last_edited_time) > Date.parse(c.edited) + 1000) {
						out.push({ i, ok: false, id: c.id, conflict: true, error: "그사이 Notion에서 바뀌었습니다. 다시 불러온 뒤 저장하세요.", row: await upsertCopy(c.db as WriteDb, now) })
						continue
					}
				}
				page = await timed("노션쓰기", () => updatePageProperties(c.id!, props))
			}
			// 앱(서버 봇)이 고친 일정은 리포트 반영 웹훅이 "서버가 고친 비공개 나이스 일정"으로 건너뛸 수 있으므로
			// (scheduleVisibility.noticeReportSyncNotNeeded) 여기서 직접 리포트를 맞춘다(학부모 공개를 끈 것도 빠지게).
			if (eventAffectsReport(c.db as WriteDb, c.props)) saveDeps.refreshReport(page.id)
			const row = await timed("복사본반영", () => upsertCopy(c.db as WriteDb, page))
			out.push({ i, ok: true, id: page.id, tmp: c.tmp, row })
			console.log(`[appSave] ${c.db} ${c.op} ${Date.now() - t0}ms (${steps.join(" ")})`)
		} catch (err) {
			out.push({ i, ok: false, id: c.id, tmp: c.tmp, error: err instanceof SaveError ? err.message : "Notion에 쓰지 못했습니다: " + String((err as Error).message).slice(0, 200) })
		}
	}
	return out
}

// ---------- 실행(run) ----------
// (항목 76) 입력을 마친 뒤 수업 만들기: 시간표마다 다음 수업 한 번을 기존 큐("generate-classes" — 시간표 [수업 추가]와 같은 처리)에 넣는다.
// 새 로직은 없다. 워커가 시간표 하나씩 처리하고 출석은 출석 조정 큐가 만든다. 이미 그날 수업이 있으면 기존 처리가 건너뛴다.
// ids를 주지 않으면 복사본의 시간표 전부. 복사본에 없는(= 시간표가 아닌) id는 받지 않는다.
export const MAX_RUN = 300
export async function runGenerateClasses(ids?: unknown): Promise<{ queued: number; skipped: number }> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?select=id&db=eq.${encodeURIComponent("시간표(학원) DB")}&limit=2000`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`시간표 조회 실패: ${res.status}`)
	const known = new Set(((await res.json()) as { id: string }[]).map((r) => r.id))
	let want: string[]
	if (ids === undefined || ids === null) want = [...known]
	else {
		if (!Array.isArray(ids) || ids.some((v) => !isId(v))) throw new SaveError(400, "timetableIds 형식이 올바르지 않습니다.")
		want = [...new Set(ids.map(String))]
	}
	const ok = want.filter((id) => known.has(id))
	if (!ok.length) throw new SaveError(400, "수업을 만들 시간표가 없습니다.")
	if (ok.length > MAX_RUN) throw new SaveError(400, `한 번에 시간표 ${MAX_RUN}개까지 실행합니다.`)
	for (const id of ok) await enqueueSync("generate-classes", { timetableId: id })
	wakeSyncQueueWorker()
	return { queued: ok.length, skipped: want.length - ok.length }
}
