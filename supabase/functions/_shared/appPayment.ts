// _shared/appPayment.ts
//
// (v2.8.0, 재무 서버 261123) 관리 앱 [결제] — app-api { action: "record-payment" }.
// 노션 [결제] 버튼 두 개와 같은 결과를 서버가 만든다(실제 결제 · 발송은 없음, 노션에 기록만). 버튼 원문(노션 버튼 설정):
//   수강료 [결제]    = 결제(학원) DB에 페이지 추가: 결제(제목) = 수강료 제목 + " 결제", 수강료 = 이 수강료, 결제일 = 오늘, 구분 = 매출,
//                      결제 금액 = 청구금액 + 기타경비 금액, 템플릿 "결제"(💵 아이콘, 본문 없음).
//   청구 항목 [결제] = 청구 결제(학원) DB에 페이지 추가: 결제 금액 = 교재비 금액, 교재배부 = 이 청구 항목, 결제일 = 오늘(제목 · 아이콘 없음).
// (2바퀴, 노션 재무 2안 261123) [결제]는 노션처럼 **전액 한 번**이다. 앱은 금액을 보내지 않는다(보내면 거절 — 1바퀴의 "받은 금액 입력"은
//   노션에 없는 흐름이라 뺐다). 일부 · 초과는 만들어진 결제 줄을 고친다(app-api save, 결제(학원) DB 결제 금액 · 결제 수단 · 결제일 · 비고 /
//   청구 결제(학원) DB 결제 금액 · 결제 방법 · 결제일 — appSave.FINANCE_PROPS). 결제 수단(방법) · 결제일 · 비고는 함께 보내도 된다
//   (버튼을 누른 뒤 그 줄에서 고르는 것과 같은 결과 — 노션 버튼은 결제 수단을 비워 둔다).
// - 결제 상태(🟢 완료 · 🔴 미납 · 🟠 과오납)는 서버가 계산하지 않는다 — 수강료 `결제 관리` · 청구 항목 `결제 상태` 수식이 한다.
//   서버는 만든 뒤 그 줄을 다시 읽어 값을 돌려준다(관계 칸에 새 결제 줄이 보일 때까지 짧게 다시 읽음).
// - 같은 요청 두 번: 앱이 확인 창마다 요청 id(requestId)를 만들어 보낸다. 표 app_payment_requests에 먼저 자리를 잡고(기본 키) 노션에 쓴다.
//   이미 끝난 id면 노션에 다시 쓰지 않고 그때 만든 결제 줄을 돌려준다. 처리 중인 id면 409. (표의 tuition_id 칸 = 대상 줄 id —
//   수강료 또는 청구 항목, kind 칸이 어느 쪽인지 "매출"(수강료) · "청구 결제"(청구 항목).)
// - 지출 · "청구서 결제 합계" 같은 결제 내역 줄은 이 동작이 아니라 save(결제(학원) DB 만들기, 구분 · 결제 수단 필수)로 넣는다.

import { createPage, getPage } from "./notionClient.ts"
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { appSources, pageRow, sourceProblem, type AppDb } from "./appCopy.ts"
import { dataSourceSchema, toNotionProps, SaveError } from "./appSave.ts"

export const TUITION_DB: AppDb = "수강료(학원) DB"
export const PAYMENT_DB: AppDb = "결제(학원) DB"
export const ITEM_DB: AppDb = "청구 항목(학원) DB"
export const ITEM_PAYMENT_DB: AppDb = "청구 결제(학원) DB"
export const PAYMENT_ICON = "💵"

// 대상별 차이(어느 DB 줄의 [결제]인가).
type Target = {
	kind: "매출" | "청구 결제"; db: AppDb; payDb: AppDb; link: string; back: string; method: string; icon: boolean
	amount: (p: Record<string, any>) => number | undefined
	title: (p: Record<string, any>) => string | null
	summary: (page: Record<string, any>) => Record<string, unknown>
}
const fnum = (v: any): number | undefined => { const n = v?.formula?.number ?? v?.rollup?.number ?? v?.number; return typeof n === "number" ? n : undefined }
const fval = (v: any) => v?.formula ? (v.formula.string ?? v.formula.number ?? null) : v?.rollup ? (v.rollup.number ?? null) : null
const relIds = (v: any): string[] => (v?.relation ?? []).map((r: any) => r.id)
export const TARGETS: Record<"tuition" | "item", Target> = {
	tuition: {
		kind: "매출", db: TUITION_DB, payDb: PAYMENT_DB, link: "수강료", back: "관련 결제", method: "결제 수단", icon: true,
		amount: (p) => { const bill = fnum(p["청구금액"]); return bill === undefined ? undefined : bill + (fnum(p["기타경비 금액"]) ?? 0) },
		title: (p) => `${(p["청구명"]?.title ?? []).map((t: any) => t?.plain_text ?? "").join("")} 결제`,
		summary: (page) => { const p = page?.properties ?? {}; return { id: page.id, "결제 관리": fval(p["결제 관리"]), "결제금액": fval(p["결제금액"]), "청구금액": fval(p["청구금액"]), "기타경비 금액": fval(p["기타경비 금액"]), "관련 결제": relIds(p["관련 결제"]) } },
	},
	item: {
		kind: "청구 결제", db: ITEM_DB, payDb: ITEM_PAYMENT_DB, link: "교재배부", back: "교재결제", method: "결제 방법", icon: false,
		amount: (p) => fnum(p["교재비 금액"]),
		title: () => null,
		summary: (page) => { const p = page?.properties ?? {}; return { id: page.id, "결제 상태": fval(p["결제 상태"]), "결제금액": fval(p["결제금액"]), "교재비 금액": fval(p["교재비 금액"]), "교재결제": relIds(p["교재결제"]) } },
	},
}
const targetOfKind = (kind: string): Target | null => Object.values(TARGETS).find((t) => t.kind === kind) ?? null

export type PaymentInput = { requestId: string; target: "tuition" | "item"; targetId: string; date: string; method?: string; memo?: string }

const isId = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{32,36}$/i.test(s)
const norm = (s: unknown) => String(s ?? "").replace(/-/g, "").toLowerCase()
const given = (v: unknown) => v !== undefined && v !== null && v !== ""
export function kstToday(now = Date.now()): string {
	return new Date(now + 9 * 3600_000).toISOString().slice(0, 10)
}

// 입력 검사(노션 · 표를 부르기 전). 틀리면 SaveError 400.
export function checkPaymentInput(body: any, now = Date.now()): PaymentInput {
	const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : ""
	if (!/^[\w-]{8,64}$/.test(requestId)) throw new SaveError(400, "requestId(8~64자 영문 · 숫자 · - · _)가 필요해요. 확인 창마다 새로 만들어 보내요.")
	if (given(body?.kind) && body.kind !== "매출") throw new SaveError(400, "지출 · 결제 내역 줄은 save로 결제(학원) DB에 넣어요(구분 · 결제 수단 필수). [결제]는 수강료 · 청구 항목 줄에서만.")
	if (given(body?.amount)) throw new SaveError(400, "[결제]는 노션 버튼처럼 전액 한 줄이에요 — 금액은 보내지 않아요. 일부 · 초과는 만들어진 결제 줄의 결제 금액을 고쳐요(save).")
	const hasTu = given(body?.tuitionId), hasItem = given(body?.itemId)
	if (hasTu === hasItem) throw new SaveError(400, "결제할 줄 하나가 필요해요: 수강료 줄 id(tuitionId) 또는 청구 항목 줄 id(itemId).")
	const target = hasTu ? "tuition" : "item"
	const targetId = hasTu ? body.tuitionId : body.itemId
	if (!isId(targetId)) throw new SaveError(400, `${hasTu ? "tuitionId" : "itemId"}가 페이지 id가 아니에요.`)
	const date = given(body?.date) ? String(body.date) : kstToday(now)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new SaveError(400, "결제일 형식(YYYY-MM-DD)이 올바르지 않아요.")
	const method = given(body?.method) ? String(body.method).trim() || undefined : undefined
	const memo = given(body?.memo) ? String(body.memo).slice(0, 500) || undefined : undefined
	if (memo && target === "item") throw new SaveError(400, "청구 결제(학원) DB에는 비고 칸이 없어요.")
	return { requestId, target, targetId: String(targetId), date, method, memo }
}

// 노션 [결제] 버튼과 같은 결제 줄 속성(평평한 값). 결제 수단(방법) · 비고는 앱이 줄 때만.
export function paymentProps(input: PaymentInput, page: Record<string, any> | null): Record<string, unknown> {
	const t = TARGETS[input.target], p = page?.properties ?? {}
	const amount = t.amount(p)
	if (amount === undefined) throw new SaveError(400, `이 ${t.db.replace(/\(학원\) DB$/, "")} 줄의 결제할 금액을 읽지 못했어요(노션에서 금액 칸을 확인해 주세요).`)
	const out: Record<string, unknown> = {}
	const title = t.title(p)
	if (title !== null) out["결제"] = title
	out["결제 금액"] = amount
	out["결제일"] = input.date
	if (t.kind === "매출") out["구분"] = "매출"
	out[t.link] = [input.targetId]
	if (input.method) out[t.method] = input.method
	if (input.memo) out["비고"] = input.memo
	return out
}

// (1바퀴 이름 그대로) 다시 읽은 수강료에서 앱이 바로 그릴 값.
export const tuitionSummary = (page: Record<string, any>) => TARGETS.tuition.summary(page)

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
async function reserveRequest(input: PaymentInput, amount: number): Promise<boolean> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${TABLE}?on_conflict=id`, {
		method: "POST", headers: sbHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
		body: JSON.stringify([{ id: input.requestId, kind: TARGETS[input.target].kind, tuition_id: input.targetId, amount, state: "pending" }]),
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

// 결제 줄 만든 뒤 대상 줄 다시 읽기: 관계 칸에 새 줄이 보일 때까지 짧게(수식 · 롤업이 새 값으로).
async function rereadTarget(t: Target, targetId: string, paymentId: string): Promise<Record<string, any>> {
	let page: Record<string, any> = await getPage(targetId)
	for (let i = 1; i < paymentDeps.rereadTries; i++) {
		if (relIds(page.properties?.[t.back]).map(norm).includes(norm(paymentId))) break
		await paymentDeps.sleep(paymentDeps.rereadWaitMs)
		page = await getPage(targetId)
	}
	return page
}

export type PaymentResult = {
	ok: true; duplicate: boolean
	payment: { id: string; db: AppDb; row: Record<string, unknown> | null }
	// 수강료 [결제]면 tuition(결제 관리 · 결제금액 · 관련 결제), 청구 항목 [결제]면 item(결제 상태 · 결제금액 · 교재결제). 다른 쪽은 null.
	tuition: (Record<string, unknown> & { row: Record<string, unknown> | null }) | null
	item: (Record<string, unknown> & { row: Record<string, unknown> | null }) | null
}

async function answer(t: Target, paymentId: string, targetId: string, duplicate: boolean, paymentPage?: Record<string, any>): Promise<PaymentResult> {
	const payPage = paymentPage ?? await getPage(paymentId)
	const payRow = await upsertCopy(t.payDb, payPage)
	const page = await rereadTarget(t, targetId, paymentId)
	const row = await upsertCopy(t.db, page)
	const summary = { ...t.summary(page), row }
	return { ok: true, duplicate, payment: { id: paymentId, db: t.payDb, row: payRow }, tuition: t.kind === "매출" ? summary : null, item: t.kind === "청구 결제" ? summary : null }
}

export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
	const t = TARGETS[input.target]
	// 1. 이미 받은 요청 id인가
	const before = await readRequest(input.requestId)
	if (before) return await repeated(before, input)
	// 2. 노션 쓰기 전 검사(실패하면 자리를 잡지 않으므로 같은 id로 다시 보내도 됨)
	const payDs = await sourceOf(t.payDb)
	const ds = await sourceOf(t.db)
	let page: Record<string, any>
	try { page = await getPage(input.targetId) } catch { throw new SaveError(404, "결제할 줄을 찾지 못했어요(지웠거나 공유되지 않은 줄).") }
	if (page.in_trash === true || page.archived === true) throw new SaveError(400, "휴지통에 있는 줄이에요.")
	if (norm(page.parent?.data_source_id) !== norm(ds)) throw new SaveError(400, `${t.db}의 줄이 아니에요.`)
	const flat = paymentProps(input, page)
	const props = toNotionProps(flat, await dataSourceSchema(payDs))
	// 3. 자리 잡기(동시에 온 같은 id는 한쪽만)
	if (!(await reserveRequest(input, flat["결제 금액"] as number))) {
		const now = await readRequest(input.requestId)
		if (now) return await repeated(now, input)
		throw new SaveError(409, "같은 요청을 처리 중이에요. 잠시 뒤 결제 목록을 확인해 주세요.")
	}
	// 4. 노션 결제 줄(수강료 [결제]는 버튼 템플릿과 같은 💵 아이콘, 청구 항목 [결제]는 아이콘 없음)
	let made: Record<string, any>
	try {
		made = await createPage(payDs, props, t.icon ? { icon: { type: "emoji", emoji: PAYMENT_ICON } } : undefined)
	} catch (err) {
		const msg = String((err as Error).message)
		// 노션이 4xx로 거절했으면 줄이 생기지 않았다 — 자리를 비워 같은 id로 다시 보낼 수 있게. 그 밖(네트워크 · 5xx)은 생겼는지 모르므로 남긴다.
		if (/failed: 4\d\d /.test(msg)) await dropRequest(input.requestId)
		else await finishRequest(input.requestId, { state: "unknown", error: msg.slice(0, 300) })
		console.error("[appPayment] 결제 줄 만들기 실패:", msg.slice(0, 300))
		throw new SaveError(502, "노션에 결제 줄을 만들지 못했어요. 결제 목록에 줄이 생겼는지 본 뒤, 없으면 다시 기록해 주세요.")
	}
	await finishRequest(input.requestId, { state: "done", payment_id: made.id })
	return await answer(t, made.id, input.targetId, false, made)
}

async function repeated(row: ReqRow, input: PaymentInput): Promise<PaymentResult> {
	const t = targetOfKind(row.kind)
	if (!t || t !== TARGETS[input.target] || norm(row.tuition_id) !== norm(input.targetId)) throw new SaveError(409, "이 요청 id는 다른 결제에 이미 쓰였어요. 확인 창을 다시 열어 주세요.")
	if (row.state === "done" && row.payment_id) return await answer(t, row.payment_id, row.tuition_id!, true)
	if (row.state === "unknown") throw new SaveError(409, "앞서 같은 요청이 끝을 알리지 못했어요. 결제 목록에 줄이 생겼는지 보고, 없으면 확인 창을 다시 열어 기록해 주세요.")
	throw new SaveError(409, "같은 요청을 처리 중이에요. 잠시 뒤 결제 목록을 확인해 주세요.")
}
