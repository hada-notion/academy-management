// _shared/appSave.ts
//
// (v2.8.0 항목 75) 관리 앱 저장 — 데이터 이관 입력 범위만 Notion에 쓴다(원본은 Notion, 앱은 입력 장치).
//
// - 쓸 수 있는 DB = WRITE_DBS(선생님 · 학생 · 클래스 · 시즌 · 시간표 · 등록 · 진도관리 · 라이브러리 · 기준 정보 · 일정 · 시험 · 시험정보 · 성적 · 루틴). 그 밖 DB는 읽기만.
// - 앱은 읽을 때와 같은 평평한 값(appCopy.flattenProps 모양)으로 보낸다. 서버가 그 DB의 Notion 칸 형식을 읽어 속성 값으로 바꾼다
//   (toNotionProps). 칸 이름이 없거나, 수식 · 롤업 · 버튼처럼 쓸 수 없는 칸이거나, 고르기 값이 Notion 선택지에 없으면 그 줄을 쓰지 않고
//   이유를 돌려준다(오타로 새 선택지가 생기지 않게).
// - 동작은 만들기(create) · 고치기(update) · 지우기(delete, 항목 104)다. 지우기는 DELETE_BLOCKERS의 DB만, 연결된 기록이 있으면 거절, 노션 휴지통(복구 가능) + 복사본 줄 즉시 삭제.
// - 고치기는 그 페이지가 복사본(app_rows)에서 같은 DB 줄인지 먼저 본다(다른 DB · 아무 페이지나 고치지 못하게). edited를 주면
//   그 사이 Notion에서 바뀌었는지(last_edited_time) 보고, 바뀌었으면 쓰지 않고 "충돌"로 돌려준다.
// - 한 번에 여러 줄: 앞 줄에서 만든 페이지를 뒤 줄 관계에 "tmp:이름"으로 쓸 수 있다(학생 → 등록 → 진도처럼 순서대로 보낸다).
// - 쓴 결과(Notion 응답)는 바로 app_rows에 반영한다. Notion 자동화(이름 자동화 등)가 뒤에 바꾸는 값은 다음 동기화가 맞춘다.

import { NOTION_API } from "./constants.ts"
import { archivePage, createPage, fetchWithRetry, notionHeaders, updatePageProperties, getPage, mapWithConcurrency } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { appSources, pageRow, sourceProblem, SKIP_PROPS, type AppDb } from "./appCopy.ts"
import { enqueueSync, wakeSyncQueueWorker } from "./syncQueue.ts"
import { textbookSources } from "./textbookSearch.ts"
import { syncBookCopy } from "./libraryCopy.ts"
import { runInBackground } from "./backgroundTask.ts"
import { getCurrentAdminKey } from "./adminShared.ts"
import { routeById } from "./webhookRoutes.ts"
import { REQUEST_PROP } from "./notionRequests.ts"

export const WRITE_DBS = [
	"강사(학원) DB", "학생(학원) DB", "클래스(학원) DB", "시즌(학원) DB", "시간표(학원) DB", "등록(학원) DB", "진도관리(학원) DB",
	"라이브러리(학원) DB", "과목(학원) DB", "영역(학원) DB", "학교(학원) DB", "학년(학원) DB",
	// (2.8, 담당 261118) 일정 공개 화면: 앱이 쓰는 칸만(EVENT_PROPS). 잠긴 줄의 날짜는 서버도 거절.
	"일정(학원) DB",
	// (2.8, 담당 261119 연결 준비) 시험 화면 입력: 시험 · 시험정보 · 성적(노션에서 줄을 직접 고치는 것과 같음 — 보내기 없음).
	"시험(학원) DB", "시험정보(학원) DB", "성적(학원) DB",
	// (2.8, 담당 261119) 앱 클래스 창 [루틴] 탭: 앱이 쓰는 칸만(ROUTINE_PROPS). 지우기는 열지 않음 — 쉬기로 끄거나 노션 [삭제].
	"루틴(학원) DB",
	// (2.8, 재무 서버 261123) 재무 입력: 노션에서 사람이 고치는 칸만(FINANCE_PROPS).
	// (2바퀴, 노션 재무 2안) 결제 · 청구 결제 DB도 연다 — [결제](수강료 · 청구 항목 줄에서 전액 한 줄)는 서버 동작(app-api "record-payment",
	// _shared/appPayment.ts)이 만들고, 일부 · 초과는 그 줄을 고치기(update)로, 지출 · "청구서 결제 합계" 같은 결제 내역 줄은 결제 DB 만들기로
	// (PAYMENT_RULES — 구분 · 결제 수단 필수, 법정 서류 현금출납부가 결제 수단 = 현금 · 구분 = 지출로 읽음). 청구 결제 줄은 만들기 없음(교재배부 연결은 [결제]만).
	"수강료(학원) DB", "기타경비(학원) DB", "청구서(학원) DB", "청구 항목(학원) DB", "결제(학원) DB", "청구 결제(학원) DB",
] as const
export type WriteDb = typeof WRITE_DBS[number]
export const isWriteDb = (v: unknown): v is WriteDb => typeof v === "string" && (WRITE_DBS as readonly string[]).includes(v)

// DB별로 앱이 쓸 수 있는 칸을 좁힌 곳(없으면 그 DB의 쓸 수 있는 칸 전부). 그 밖 칸은 그 줄을 쓰지 않고 이유를 돌려준다.
export const EVENT_DB = "일정(학원) DB"
// (2.8 2단계) 세부 구분·기록(내부용)을 받고, 구분은 받지 않는다(수식이 될 칸 — 앱은 읽기만, 앱서버 261118).
// (2.8, 대표 261118) `잠금` 칸은 버림 — 받지 않고, 잠금 줄 날짜 거절도 없앴다(관리 앱이 학사 일정을 스스로 잠가 보여 줌).
// (2.8, 홈 다시 만들기 261124) 홈 [할 일]: 진행상태(완료로 바꾸면 홈에서 빠짐) · 담당자(직원 관계)도 받는다. 리포트에는 영향 없음(할일은 늘 비공개).
export const EVENT_PROPS = ["이름", "날짜", "세부 구분", "기록(내부용)", "숨김", "학부모 공개", "클래스", "학생", "학교", "학년", "진행상태", "완료", "담당자", "달성여부", "우선순위"] as const
// (261124 대표 "노션에서 우선순위 · 달성여부가 바뀌면 앱도") 홈 할 일 [✔️] · [✖️] · 오른쪽 창 고르기 · 우선순위 보드 끌기가 쓰는 두 칸. 리포트에는 영향 없음(할일은 늘 비공개)
// (261124 대표 "1안") 노션 진행상태 칸 이름을 "완료"로 바꾸는 동안 두 이름을 다 받는다(앱은 노션에 있는 이름으로 보냄)
// 리포트에 보이는 데 영향이 없는 일정 칸(이것만 바꾸면 리포트 맞추기를 부르지 않음)
const EVENT_NO_REPORT = new Set(["기록(내부용)", "진행상태", "완료", "담당자", "달성여부", "우선순위"])
export const ROUTINE_DB = "루틴(학원) DB"
// 루틴 체크 관계는 받지 않는다(체크는 수업 [루틴 체크 생성]이 만든다).
export const ROUTINE_PROPS = ["이름", "클래스", "순서", "설명", "쉬기"] as const
// (재무 서버 261123) 재무 DB는 노션에서 사람이 고치는 칸만 받는다. 수식 · 롤업(청구금액 · 결제 관리 · 반별 생성 · 결제금액 등)은
// 칸 형식 검사(toNotionProps)도 거절하지만, 여기서 칸 이름으로 한 번 더 좁힌다. 수강료 · 청구 항목 줄은 서버 동작이 만든다(만들기 거절).
export const FINANCE_PROPS = {
	"수강료(학원) DB": ["청구금액 조정", "청구금액 조정 사유", "메모(내부용)", "실제 수업량"],
	"기타경비(학원) DB": ["이름", "기타경비 항목", "받는 방식", "신고 금액", "클래스"],
	// 청구서: 새 청구서(이름 · 등록) → [담기]는 `요청` = cart-progress-book. 안내문 전송(cart-notice)은 받지 않음(아래 요청 검사).
	"청구서(학원) DB": ["이름", "등록", "요청"],
	"청구 항목(학원) DB": ["교재비 수기입력", "배부일"],
	// 결제 줄: 만들기는 아래 칸 전부(수강료 연결은 받지 않음 — 수강료 결제는 [결제]로), 고치기는 PAYMENT_RULES.update만.
	"결제(학원) DB": ["결제", "결제 금액", "결제일", "구분", "결제 수단", "비고"],
	"청구 결제(학원) DB": ["결제 금액", "결제 방법", "결제일"],
} as const
// (2바퀴) 결제 줄 규칙: 고칠 수 있는 칸(그 밖은 만들 때만), 만들 때 꼭 채울 칸(빈 값 거절), 보내면 빈 값이 될 수 없는 칸.
export const PAYMENT_RULES: Record<string, { update: readonly string[]; required: readonly string[]; noEmpty: readonly string[] }> = {
	"결제(학원) DB": { update: ["결제 금액", "결제 수단", "결제일", "비고"], required: ["결제", "결제 금액", "결제일", "구분", "결제 수단"], noEmpty: ["결제", "결제 금액", "결제일", "구분", "결제 수단"] },
	"청구 결제(학원) DB": { update: ["결제 금액", "결제 방법", "결제일"], required: [], noEmpty: ["결제 금액", "결제일"] },
}
export const MAX_PAYMENT_AMOUNT = 100_000_000
// (2바퀴 원본 확인 261123) 결제 줄을 고치면 노션은 연결된 줄의 수식(수강료 `결제 관리` · 청구 항목 `결제 상태`)을 바로 바꾸지만,
// 그 줄 자체는 편집 시각이 바뀌지 않아 앱 사본의 증분 동기화가 놓친다(원본에서 결제 줄 250,000 → 50,000 뒤 사본이 🟠과오납으로 남음).
// 그래서 결제 · 청구 결제 줄을 쓰면 연결된 줄을 다시 읽어 사본에 바로 넣는다(실패해도 저장은 성공 — 다음 통째 대조가 맞춤).
export const PAYMENT_LINKS: Record<string, { prop: string; db: WriteDb }> = {
	"결제(학원) DB": { prop: "수강료", db: "수강료(학원) DB" },
	"청구 결제(학원) DB": { prop: "교재배부", db: "청구 항목(학원) DB" },
}
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length)
function checkPaymentRow(db: string, props: Record<string, unknown>, op: "create" | "update"): void {
	const rule = PAYMENT_RULES[db]
	if (!rule) return
	const keys = Object.keys(props ?? {})
	if (op === "update") {
		const bad = keys.filter((k) => !rule.update.includes(k))
		if (bad.length) throw new SaveError(400, `${db} 줄에서 고치지 않는 칸: ${bad.join(", ")} (고칠 수 있는 칸: ${rule.update.join(" · ")})`)
	} else {
		const miss = rule.required.filter((k) => blank(props[k]))
		if (miss.length) throw new SaveError(400, `${db} 줄을 만들 때 꼭 채울 칸: ${miss.join(", ")}`)
	}
	const empty = keys.filter((k) => rule.noEmpty.includes(k) && blank(props[k]))
	if (empty.length) throw new SaveError(400, `빈 값으로 둘 수 없는 칸: ${empty.join(", ")}`)
	if (keys.includes("결제 금액")) {
		const n = Number(props["결제 금액"])
		if (!Number.isInteger(n) || n <= 0 || n > MAX_PAYMENT_AMOUNT) throw new SaveError(400, `결제 금액은 1원 이상 ${MAX_PAYMENT_AMOUNT.toLocaleString("ko-KR")}원 이하 정수예요.`)
	}
}
const ONLY_PROPS: Partial<Record<WriteDb, ReadonlySet<string>>> = {
	[EVENT_DB]: new Set(EVENT_PROPS), [ROUTINE_DB]: new Set(ROUTINE_PROPS),
	...Object.fromEntries(Object.entries(FINANCE_PROPS).map(([db, p]) => [db, new Set<string>(p)])),
}
export const NO_CREATE_DBS: readonly string[] = ["수강료(학원) DB", "청구 항목(학원) DB", "청구 결제(학원) DB"]
export function checkAllowedProps(db: WriteDb, props: Record<string, unknown>, op: "create" | "update" = "update"): void {
	if (op === "create" && db === "청구 결제(학원) DB") throw new SaveError(400, "청구 결제 줄은 청구 항목 [결제](app-api record-payment, itemId)로 만들어요 — 교재배부 연결까지 함께.")
	if (op === "create" && NO_CREATE_DBS.includes(db)) throw new SaveError(400, `${db} 줄은 앱에서 만들지 않아요 — 클래스 [월 수강료 생성] · 청구서 [담기] 같은 동작으로 만들어요.`)
	checkRequestProp(db, props, op)
	const only = ONLY_PROPS[db]
	if (!only) return
	const bad = Object.keys(props ?? {}).filter((k) => !only.has(k))
	if (bad.length) throw new SaveError(400, `앱에서 ${db}에 쓰지 않는 칸: ${bad.join(", ")}`)
	checkPaymentRow(db, props, op)
}

// ---------- `요청` 칸(앱 → 서버 동작) ----------
// (재무 서버 261123) 앱이 줄의 `요청` 칸에 동작 ID를 쓰면 노션 버튼을 누른 것과 같은 길(notion-events → notionRequests.ts)로 처리된다.
// 앱이 쓸 수 있는 값: 그 DB의 동작 ID(webhookRoutes.ts)만, 고치기(update)만. 학부모에게 나가는 안내문 전송 둘과 삭제 동작은 받지 않는다
// (발송은 노션에서 담당자가, 삭제는 앱에서 하지 않는 규칙 — DELETE_FORBIDDEN_MESSAGE). 처리 중 · 완료 · 실패는 서버만 쓴다.
export const APP_REQUEST_DENY: readonly string[] = ["tuition-notice", "cart-notice"]
export function checkRequestProp(db: string, props: Record<string, unknown>, op: "create" | "update"): void {
	if (!props || !Object.prototype.hasOwnProperty.call(props, REQUEST_PROP)) return
	const v = String(props[REQUEST_PROP] ?? "").trim()
	if (op !== "update") throw new SaveError(400, "요청은 이미 있는 줄에만 써요(만들기와 함께 쓰지 않음).")
	const route = routeById(v)
	if (!route || `${route.db} DB` !== db) throw new SaveError(400, `이 줄에서 할 수 없는 요청: ${v || "(빈 값)"}`)
	if (APP_REQUEST_DENY.includes(v)) throw new SaveError(400, "안내문 전송은 앱에서 하지 않아요 — 노션에서 담당자가 직접 눌러요.")
	if (v.endsWith("-delete")) throw new SaveError(400, DELETE_FORBIDDEN_MESSAGE)
}
// 앱이 고친 일정의 학부모 리포트 맞추기: sync-report-cache를 force로 부른다(건너뛰기 없이, 응답을 기다리지 않음).
export const LIBRARY_DB = "라이브러리(학원) DB"
export const saveDeps = {
	// 라이브러리 교재를 고쳤으면 라이브러리 복사본(lib_books)도 바로 맞춘다(library.html과 같은 복사본). 응답은 기다리지 않음.
	syncLibraryBook: (bookId: string): void => {
		runInBackground(async () => { await syncBookCopy(await textbookSources(), bookId) })
	},
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
// 리포트에 보이는 데 영향을 주는 일정 칸(기록(내부용) · 진행상태 · 담당자만 바꾼 것은 아님).
export function eventAffectsReport(db: WriteDb, props: Record<string, unknown>): boolean {
	return db === EVENT_DB && Object.keys(props ?? {}).some((k) => !EVENT_NO_REPORT.has(k))
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
// 노션 칸 이름을 바꾼 것: 옛 이름 → 새 이름(그 DB에 옛 이름이 없고 새 이름이 있을 때만). 261124 대표 "1안": 일정 진행상태 → 완료
const PROP_RENAMED: Record<string, string> = { "진행상태": "완료" }
const rt = (v: unknown) => {
	const s = v == null ? "" : String(v)
	return s ? [{ type: "text", text: { content: s.slice(0, 2000) } }] : []
}
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(s)
const isId = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{32,36}$/i.test(s)

// resolve: "tmp:…" → 앞에서 만든 페이지 id. 잘못된 값은 throw(그 줄만 실패).
export function toNotionProps(props: Record<string, unknown>, schema: Schema, resolve: (v: string) => string = (v) => v): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [name0, value] of Object.entries(props ?? {})) {
		// 노션에서 칸 이름을 바꾼 뒤 앱 사본에 옛 이름이 남아 있으면 새 이름으로(PROP_RENAMED)
		const name = !schema[name0] && PROP_RENAMED[name0] && schema[PROP_RENAMED[name0]] ? PROP_RENAMED[name0] : name0
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
				let s = value == null ? "" : String(value)
				// 선택지 이름 앞에 아이콘을 붙인 학원("✔️ 달성" · "‼️ 중요")도 앱은 글자만 보냄 → 앞 아이콘을 뗀 이름이 하나만 같으면 그 선택지로(261124)
				if (s && def.options && !def.options.includes(s)) { const bare = (x: string) => x.replace(/^[^0-9A-Za-z가-힣]+/, "").trim(); const hit = def.options.filter((o) => bare(o) === bare(s)); if (hit.length === 1) s = hit[0] }
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

// 결제 줄과 이어진 줄(수강료 · 청구 항목)을 다시 읽어 사본에 넣는다. 실패한 줄은 빼고 돌려준다(저장 결과는 그대로 성공).
async function refreshLinked(link: { prop: string; db: WriteDb }, page: Record<string, any>): Promise<Record<string, unknown>[]> {
	const ids: string[] = (page?.properties?.[link.prop]?.relation ?? []).map((r: any) => r.id).slice(0, 5)
	const rows: Record<string, unknown>[] = []
	for (const id of ids) {
		try { rows.push(await upsertCopy(link.db, await getPage(id))) } catch (err) { console.warn(`[appSave] ${link.db} 연결 줄 사본 맞추기 실패:`, id, String((err as Error).message).slice(0, 200)) }
	}
	return rows
}

// ---------- 저장 ----------
export type Change = { op: "create" | "update" | "delete"; db: string; id?: string; tmp?: string; edited?: string; props?: Record<string, unknown> }
export type ChangeResult = { i: number; ok: boolean; id?: string; tmp?: string; row?: Record<string, unknown> | null; linked?: Record<string, unknown>[]; error?: string; conflict?: boolean; deleted?: boolean; blocked?: Record<string, number>; warn?: string }
// (261123 출시 전 5번) 노션엔 썼고 앱 사본(Supabase)만 못 쓴 줄의 안내 — 앱이 그대로 보여 준다.
export const COPY_ONLY_FAILED = "노션엔 저장됨, 앱 사본만 못 맞춤 — 잠시 뒤 저절로 맞춰져요(다시 저장하지 않아도 돼요)"

// ---------- 지우기(op "delete") ----------
// 노션 페이지를 휴지통으로 보내고(복구 가능) 복사본(app_rows) 줄도 같은 요청에서 바로 뺀다. 앱 화면이 [삭제]를 내는 DB만 열고,
// 아래 "막는 관계"에 연결된 기록이 하나라도 있으면 지우지 않고 이유를 돌려준다(학생 · 등록 정보를 바로 지우지 않는 규칙 — 노션에서 정리).
export const DELETE_BLOCKERS: Record<string, string[]> = {
	"학생(학원) DB": ["등록", "성적", "응시 등록"],
	"등록(학원) DB": ["교재비", "루틴 체크", "보고서", "수업", "월별 수강료", "진도교재", "출석", "학습기록", "학습활동"],
	"클래스(학원) DB": ["등록", "수업", "학습기록", "시간표", "진도교재"],
	"강사(학원) DB": ["수업", "출석", "클래스", "근무일정"],
	"시간표(학원) DB": ["수업"],
	"시즌(학원) DB": ["시간표"],
	"과목(학원) DB": ["라이브러리", "시험정보", "영역", "학년"],
	"영역(학원) DB": ["클래스"],
	"진도관리(학원) DB": ["학습기록", "개별교재"],
}
// (대표 261119) 특별한 이유가 없으면 삭제하지 못하게 — 종료·보류로 처리하고, 단순 실수면 이름에 "실수"라고 적는다. 구조 줄인 시간표만 지울 수 있고 나머지는 금지(위 막는 관계 검사는 그대로).
export const DELETE_ALLOWED: readonly string[] = ["시간표(학원) DB"]
export const DELETE_FORBIDDEN_MESSAGE = "삭제하지 않아요 — 종료·보류로 처리해요"
export const isDeleteDb = (v: unknown): v is keyof typeof DELETE_BLOCKERS => typeof v === "string" && DELETE_ALLOWED.includes(v) && Object.prototype.hasOwnProperty.call(DELETE_BLOCKERS, v)
async function removeCopy(id: string): Promise<void> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: sbHeaders({ Prefer: "return=minimal" }) })
	if (!res.ok) throw new Error(`app_rows 지우기 실패: ${res.status} ${await res.text()}`)
}
async function deleteOne(i: number, c: Change): Promise<ChangeResult> {
	if (!isDeleteDb(c.db)) throw new SaveError(400, DELETE_FORBIDDEN_MESSAGE)
	const id = c.id!
	const page = await getPage(id)
	if (page.archived === true || page.in_trash === true) { await removeCopy(id); return { i, ok: true, id, deleted: true } } // 이미 지워졌으면 복사본만 맞춤
	if ((await copyDbOf(id)) !== c.db) throw new SaveError(400, "이 DB의 줄이 아닙니다.")
	if (c.edited && Date.parse(page.last_edited_time) > Date.parse(c.edited) + 1000) {
		return { i, ok: false, id, conflict: true, error: "그사이 Notion에서 바뀌었습니다. 다시 불러온 뒤 지우세요." }
	}
	const blocked: Record<string, number> = {}
	for (const name of DELETE_BLOCKERS[c.db]) { const n = (page.properties?.[name]?.relation ?? []).length; if (n) blocked[name] = n }
	if (Object.keys(blocked).length) {
		const list = Object.entries(blocked).map(([k, n]) => `${k} ${n}${n >= 25 ? "건 이상" : "건"}`).join(", ")
		return { i, ok: false, id, blocked, error: `연결된 기록이 있어 지우지 않았어요(${list}). 노션에서 먼저 정리하세요.` }
	}
	await archivePage(id)
	await removeCopy(id)
	return { i, ok: true, id, deleted: true }
}

export function checkChanges(changes: unknown): Change[] {
	if (!Array.isArray(changes) || !changes.length) throw new SaveError(400, "저장할 줄이 없습니다.")
	if (changes.length > MAX_CHANGES) throw new SaveError(400, `한 번에 ${MAX_CHANGES}줄까지 저장합니다.`)
	return changes.map((c: any, i) => {
		if (!c || (c.op !== "create" && c.op !== "update" && c.op !== "delete")) throw new SaveError(400, `${i + 1}번째: op는 create · update · delete`)
		if (!isWriteDb(c.db)) throw new SaveError(400, `${i + 1}번째: 앱에서 쓸 수 없는 DB(${c.db})`)
		if (c.op === "delete") {
			if (!isId(c.id)) throw new SaveError(400, `${i + 1}번째: 지울 페이지 id가 없습니다.`)
			if (!isDeleteDb(c.db)) throw new SaveError(400, DELETE_FORBIDDEN_MESSAGE)
			return c as Change
		}
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
			if (c.op === "delete") { out.push(await timed("지우기", () => deleteOne(i, c))); console.log(`[appSave] ${c.db} delete ${Date.now() - t0}ms (${steps.join(" ")})`); continue }
			const cprops = c.props ?? {}
			checkAllowedProps(c.db as WriteDb, cprops, c.op)
			// 새 교재는 단원목록까지 만들어야 하므로 textbook-api(register-custom)로만 만든다 — 이 길로는 만들지 않는다.
			if (c.db === LIBRARY_DB && c.op === "create") throw new SaveError(400, "교재 추가는 라이브러리 등록(textbook-api register-custom)으로 하세요. 단원목록까지 함께 만들어요.")
			const props = toNotionProps(cprops, await timed("칸형식", () => dataSourceSchema(ds)), resolve)
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
			if (eventAffectsReport(c.db as WriteDb, cprops)) saveDeps.refreshReport(page.id)
			if (c.db === LIBRARY_DB) saveDeps.syncLibraryBook(page.id)
			// (261123 출시 전 5번) 노션에는 이미 썼다. 사본 쓰기만 실패하면 실패로 답하지 않는다 — 실패로 답하면 앱이 새 줄을
			// 작성 중으로 남기고, 다시 [저장]하면 노션에 같은 줄이 하나 더 생긴다. 새 id와 함께 성공 + 안내(warn)로 답한다.
			// 사본은 웹훅 · 폴링(5분)이 저절로 맞춘다.
			let row: Awaited<ReturnType<typeof upsertCopy>> | null = null, warn: string | undefined
			try { row = await timed("복사본반영", () => upsertCopy(c.db as WriteDb, page)) } catch (err) {
				warn = COPY_ONLY_FAILED
				console.error(`[appSave] ${c.db} ${c.op} 노션엔 저장, 사본 쓰기 실패: ${String((err as Error).message).slice(0, 200)}`)
			}
			const linked = PAYMENT_LINKS[c.db] ? await timed("연결줄", () => refreshLinked(PAYMENT_LINKS[c.db], page)) : undefined
			out.push({ i, ok: true, id: page.id, tmp: c.tmp, row, ...(linked?.length ? { linked } : {}), ...(warn ? { warn } : {}) })
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
