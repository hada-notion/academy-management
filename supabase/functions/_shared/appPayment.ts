// _shared/appPayment.ts
//
// (v2.8.0, 재무 서버 261123) 관리 앱 결제 기록 — app-api { action: "record-payment" }.
// 노션 수강료 [결제] 버튼이 하는 일과 같은 결과를 서버가 만든다(실제 결제 · 발송은 없음, 노션에 기록만):
//   버튼 = "결제(학원) DB에 페이지 추가": 결제(제목) = 수강료 제목 + " 결제", 수강료 = 이 수강료, 결제일 = 오늘, 구분 = 매출,
//          결제 금액 = 청구금액 + 기타경비 금액, 템플릿 "결제"(💵 아이콘, 본문 없음).
//   앱은 여기에 받은 금액(부분 결제) · 결제일 · 결제 수단 · 메모(비고)를 더해 보낼 수 있다. 금액을 비우면 버튼과 같은 금액.
// - 결제 상태(🟢 완료 · 🔴 미납 · 🟠 과오납)는 서버가 계산하지 않는다 — 수강료 `결제 관리` 수식이 롤업 `결제금액`(관련 결제의 결제 금액 합)과
//   `청구금액` + `기타경비 금액`을 비교한다. 서버는 만든 뒤 수강료를 다시 읽어 그 값을 돌려준다(관련 결제에 새 줄이 보일 때까지 짧게 다시 읽음).
// - 같은 요청 두 번: 앱이 확인 창마다 요청 id(requestId)를 만들어 보낸다. 표 app_payment_requests에 먼저 자리를 잡고(기본 키) 노션에 쓴다.
//   이미 끝난 id면 노션에 다시 쓰지 않고 그때 만든 결제 줄을 돌려준다. 처리 중인 id면 409.
// - 지출(kind "지출"): 손익의 지출 한 줄(수강료 없이 이름 · 금액). 우선순위 낮은 입력이라 같은 길에 종류 값만 더했다.
// - 결제 DB는 앱 save로 열지 않는다(appSave.WRITE_DBS에 없음) — 결제 줄은 이 동작으로만.

import { createPage, getPage } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { appSources, pageRow, sourceProblem, type AppDb } from "./appCopy.ts"
import { dataSourceSchema, toNotionProps, SaveError } from "./appSave.ts"

export const TUITION_DB: AppDb = "수강료(학원) DB"
export const PAYMENT_DB: AppDb = "결제(학원) DB"
export const PAYMENT_ICON = "💵"
export const MAX_AMOUNT = 100_000_000

export type PaymentInput = {
	requestId: string
	kind: "매출" | "지출"
	tuitionId?: string
	name?: string
	amount?: number
	date: string
	method?: string
	memo?: string
}

const isId = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{32,36}$/i.test(s)
const norm = (s: unknown) => String(s ?? "").replace(/-/g, "").toLowerCase()
export function kstToday(now = Date.now()): string {
	return new Date(now + 9 * 3600_000).toISOString().slice(0, 10)
}

// 입력 검사(노션 · 표를 부르기 전). 틀리면 SaveError 400.
export function checkPaymentInput(body: any, now = Date.now()): PaymentInput {
	const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : ""
	if (!/^[\w-]{8,64}$/.test(requestId)) throw new SaveError(400, "requestId(8~64자 영문 · 숫자 · - · _)가 필요해요. 확인 창마다 새로 만들어 보내요.")
	const kind = body?.kind === undefined || body?.kind === null || body?.kind === "" ? "매출" : body.kind
	if (kind !== "매출" && kind !== "지출") throw new SaveError(400, 'kind는 "매출" 또는 "지출"이에요.')
	let amount: number | undefined
	if (body?.amount !== undefined && body?.amount !== null && body?.amount !== "") {
		amount = Number(body.amount)
		if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new SaveError(400, `금액은 1원 이상 ${MAX_AMOUNT.toLocaleString("ko-KR")}원 이하 정수예요.`)
	}
	const date = body?.date === undefined || body?.date === null || body?.date === "" ? kstToday(now) : String(body.date)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new SaveError(400, "결제일 형식(YYYY-MM-DD)이 올바르지 않아요.")
	const method = body?.method === undefined || body?.method === null ? undefined : String(body.method).trim() || undefined
	const memo = body?.memo === undefined || body?.memo === null ? undefined : String(body.memo).slice(0, 500) || undefined
	if (kind === "매출") {
		if (!isId(body?.tuitionId)) throw new SaveError(400, "결제를 기록할 수강료 줄 id(tuitionId)가 필요해요.")
		return { requestId, kind, tuitionId: String(body.tuitionId), amount, date, method, memo }
	}
	const name = typeof body?.name === "string" ? body.name.trim().slice(0, 200) : ""
	if (!name) throw new SaveError(400, "지출 이름(name)이 필요해요.")
	if (amount === undefined) throw new SaveError(400, "지출 금액(amount)이 필요해요.")
	return { requestId, kind, name, amount, date, method, memo }
}

// 노션 [결제] 버튼과 같은 결제 줄 속성(평평한 값). 결제 수단 · 비고는 앱이 줄 때만.
export function paymentProps(input: PaymentInput, tuition: Record<string, any> | null): Record<string, unknown> {
	const p = tuition?.properties ?? {}
	let title = input.name ?? ""
	let amount = input.amount
	if (input.kind === "매출") {
		title = `${(p["청구명"]?.title ?? []).map((t: any) => t?.plain_text ?? "").join("")} 결제`
		if (amount === undefined) {
			const bill = p["청구금액"]?.formula?.number, etc = p["기타경비 금액"]?.formula?.number
			if (typeof bill !== "number") throw new SaveError(400, "이 수강료의 청구금액을 읽지 못했어요. 금액을 직접 넣어 주세요.")
			amount = bill + (typeof etc === "number" ? etc : 0)
		}
	}
	const out: Record<string, unknown> = { "결제": title, "결제 금액": amount, "결제일": input.date, "구분": input.kind }
	if (input.kind === "매출") out["수강료"] = [input.tuitionId]
	if (input.method) out["결제 수단"] = input.method
	if (input.memo) out["비고"] = input.memo
	return out
}

// 다시 읽은 수강료에서 앱이 바로 그릴 값.
export function tuitionSummary(page: Record<string, any>) {
	const p = page?.properties ?? {}
	const f = (k: string) => { const v = p[k]; return v?.formula ? (v.formula.string ?? v.formula.number ?? null) : v?.rollup ? (v.rollup.number ?? null) : null }
	return { id: page.id, "결제 관리": f("결제 관리"), "결제금액": f("결제금액"), "청구금액": f("청구금액"), "기타경비 금액": f("기타경비 금액"), "관련 결제": (p["관련 결제"]?.relation ?? []).map((r: any) => r.id) }
}

// ---------- 요청 id 표 ----------
const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
const sbHeaders = (extra: Record<string, string> = {}) => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json", ...extra })
type ReqRow = { id: string; kind: string; tuition_id: string | null; payment_id: string | null; state: string; error: string | null }
const TABLE = "app_payment_requests"

async function readRequest(id: string): Promise<ReqRow | null> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${TABLE}?select=*&id=eq.${encodeURIComponent(id)}`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`${TABLE} 조회 실패: ${res.status}`)
	return (await res.json())[0] ?? null
}
// 자리 잡기: 새로 잡았으면 true, 이미 있으면 false(기본 키 충돌은 무시하고 빈 배열이 온다).
async function reserveRequest(input: PaymentInput): Promise<boolean> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${TABLE}?on_conflict=id`, {
		method: "POST", headers: sbHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
		body: JSON.stringify([{ id: input.requestId, kind: input.kind, tuition_id: input.tuitionId ?? null, amount: input.amount ?? null, state: "pending" }]),
	})
	if (!res.ok) throw new Error(`${TABLE} 자리 잡기 실패: ${res.status} ${await res.text()}`)
	return ((await res.json()) as unknown[]).length === 1
}
async function finishRequest(id: string, patch: Partial<ReqRow>): Promise<void> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
		method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify({ ...patch, finished_at: new Date().toISOString() }),
	})
	if (!res.ok) console.error(`[appPayment] ${TABLE} 마무리 실패`, id, res.status)
}
async function dropRequest(id: string): Promise<void> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: sbHeaders({ Prefer: "return=minimal" }) })
	if (!res.ok) console.error(`[appPayment] ${TABLE} 자리 비우기 실패`, id, res.status)
}
async function upsertCopy(db: AppDb, page: Record<string, any>): Promise<Record<string, unknown> | null> {
	try {
		const row = { ...pageRow(db, page), synced_at: new Date().toISOString() }
		const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/app_rows?on_conflict=id`, {
			method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([row]),
		})
		if (!res.ok) throw new Error(`${res.status}`)
		return row
	} catch (err) {
		console.error(`[appPayment] ${db} 사본 반영 실패(웹훅 · 폴링이 맞춤):`, (err as Error).message)
		return null
	}
}

export const paymentDeps = {
	sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
	rereadTries: 4,
	rereadWaitMs: 700,
}

async function sourceOf(db: AppDb): Promise<string> {
	const problem = await sourceProblem(db)
	if (problem) throw new SaveError(409, `${db}: ${problem}`)
	const ds = ((await appSources()).get(db) ?? [])[0]
	if (!ds) throw new SaveError(404, `Notion에서 ${db}를 찾지 못했습니다.`)
	return ds
}

// 결제 줄 만든 뒤 수강료 다시 읽기: 관련 결제에 새 줄이 보일 때까지 짧게(수식 · 롤업이 새 값으로).
async function rereadTuition(tuitionId: string, paymentId: string): Promise<Record<string, any>> {
	let page: Record<string, any> = await getPage(tuitionId)
	for (let i = 1; i < paymentDeps.rereadTries; i++) {
		const ids = (page.properties?.["관련 결제"]?.relation ?? []).map((r: any) => norm(r.id))
		if (ids.includes(norm(paymentId))) break
		await paymentDeps.sleep(paymentDeps.rereadWaitMs)
		page = await getPage(tuitionId)
	}
	return page
}

export type PaymentResult = {
	ok: true; duplicate: boolean
	payment: { id: string; row: Record<string, unknown> | null }
	tuition: (ReturnType<typeof tuitionSummary> & { row: Record<string, unknown> | null }) | null
}

async function answer(paymentId: string, tuitionId: string | null, duplicate: boolean, paymentPage?: Record<string, any>): Promise<PaymentResult> {
	const payPage = paymentPage ?? await getPage(paymentId)
	const payRow = await upsertCopy(PAYMENT_DB, payPage)
	if (!tuitionId) return { ok: true, duplicate, payment: { id: paymentId, row: payRow }, tuition: null }
	const tPage = await rereadTuition(tuitionId, paymentId)
	const tRow = await upsertCopy(TUITION_DB, tPage)
	return { ok: true, duplicate, payment: { id: paymentId, row: payRow }, tuition: { ...tuitionSummary(tPage), row: tRow } }
}

export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
	// 1. 이미 받은 요청 id인가
	const before = await readRequest(input.requestId)
	if (before) return await repeated(before, input)
	// 2. 노션 쓰기 전 검사(실패하면 자리를 잡지 않으므로 같은 id로 다시 보내도 됨)
	const payDs = await sourceOf(PAYMENT_DB)
	let tuition: Record<string, any> | null = null
	if (input.kind === "매출") {
		const tuDs = await sourceOf(TUITION_DB)
		try { tuition = await getPage(input.tuitionId!) } catch { throw new SaveError(404, "수강료 줄을 찾지 못했어요(지웠거나 공유되지 않은 줄).") }
		if (tuition!.in_trash === true || tuition!.archived === true) throw new SaveError(400, "휴지통에 있는 수강료예요.")
		if (norm(tuition!.parent?.data_source_id) !== norm(tuDs)) throw new SaveError(400, "수강료(학원) DB의 줄이 아니에요.")
	}
	const props = toNotionProps(paymentProps(input, tuition), await dataSourceSchema(payDs))
	// 3. 자리 잡기(동시에 온 같은 id는 한쪽만)
	if (!(await reserveRequest(input))) {
		const now = await readRequest(input.requestId)
		if (now) return await repeated(now, input)
		throw new SaveError(409, "같은 요청을 처리 중이에요. 잠시 뒤 결제 목록을 확인해 주세요.")
	}
	// 4. 노션 결제 줄(버튼과 같은 아이콘)
	let page: Record<string, any>
	try {
		page = await createPage(payDs, props, { icon: { type: "emoji", emoji: PAYMENT_ICON } })
	} catch (err) {
		const msg = String((err as Error).message)
		// 노션이 4xx로 거절했으면 줄이 생기지 않았다 — 자리를 비워 같은 id로 다시 보낼 수 있게. 그 밖(네트워크 · 5xx)은 생겼는지 모르므로 남긴다.
		if (/failed: 4\d\d /.test(msg)) await dropRequest(input.requestId)
		else await finishRequest(input.requestId, { state: "unknown", error: msg.slice(0, 300) })
		console.error("[appPayment] 결제 줄 만들기 실패:", msg.slice(0, 300))
		throw new SaveError(502, "노션에 결제 줄을 만들지 못했어요. 결제 목록에 줄이 생겼는지 본 뒤, 없으면 다시 기록해 주세요.")
	}
	await finishRequest(input.requestId, { state: "done", payment_id: page.id })
	return await answer(page.id, input.tuitionId ?? null, false, page)
}

async function repeated(row: ReqRow, input: PaymentInput): Promise<PaymentResult> {
	if (row.kind !== input.kind || norm(row.tuition_id) !== norm(input.tuitionId)) throw new SaveError(409, "이 요청 id는 다른 결제에 이미 쓰였어요. 확인 창을 다시 열어 주세요.")
	if (row.state === "done" && row.payment_id) return await answer(row.payment_id, row.tuition_id, true)
	if (row.state === "unknown") throw new SaveError(409, "앞서 같은 요청이 끝을 알리지 못했어요. 결제 목록에 줄이 생겼는지 보고, 없으면 확인 창을 다시 열어 기록해 주세요.")
	throw new SaveError(409, "같은 요청을 처리 중이에요. 잠시 뒤 결제 목록을 확인해 주세요.")
}
