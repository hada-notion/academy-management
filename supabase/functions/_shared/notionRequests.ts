// _shared/notionRequests.ts
//
// (261123 버튼 전환) 노션 버튼·자동화가 "웹훅 보내기" 대신 줄의 `요청` 칸(select)만 동작 ID로 바꾸면, 노션 API 웹훅 구독
// (notion-events) → 대기열 → 처리기(notionEventsApply.ts)가 그 줄을 다시 읽고 이 파일이 일을 넘긴다.
//   1. `요청` = 아는 동작 ID(webhookRoutes.ts) → `요청` = "🔄 처리 중", `요청 결과` = 접수 시각 (한 번 쓰기)
//   2. 그 동작의 기존 함수로 넘긴다 — 길잡이(notion-router)와 같은 주소·같은 본문 모양({ data: 페이지 })·지금 서버 키
//   3. 다시 읽어 `요청`이 아직 "처리 중"이면 "✅ 완료"/"⚠️ 실패", `요청 결과` = 동작 이름·걸린 초·실패 이유.
//      그 사이 새 요청(다른 동작 ID)이 들어왔으면 `요청`은 건드리지 않고 `요청 결과`만 쓴다(새 요청은 대기열이 이어서 처리).
// 규칙
// - 자동화가 보내던 `웹훅 정보` 수식: 요청 ID가 그 줄 `웹훅 정보`에 들어 있으면 `웹훅 정보`의 ID를 모두 넘긴다(예전 자동화가
//   보내던 것과 같게 — 같은 줄에 대기 상태가 둘이면 둘 다). 아니면 요청 ID 하나만.
// - 메아리: 서버가 쓴 "처리 중·완료·실패"는 동작 ID가 아니라서 다시 읽어도 아무 일도 하지 않는다.
// - 옛 경로(notion-router, 버튼·자동화의 웹훅 보내기)는 그대로 둔다. `웹훅 버튼` 칸은 보지 않는다(옛 버튼과 겹치지 않게).
// - 끄기: 함수 설정 NOTION_EVENTS_REQUESTS=off (사본 반영은 그대로).
// - 넘기기 실패(네트워크·5xx): 길잡이와 같은 "다시 넘기기"(sync_queue notion-router-retry, 최대 3번)에 넣고 ⚠️ 실패에 그 사실을 적는다.

import { NOTION_API } from "./constants.ts"
import { fetchWithRetry, notionHeaders } from "./notionClient.ts"
import { routeById, targetUrl, type WebhookRoute } from "./webhookRoutes.ts"

export const REQUEST_PROP = "요청"
export const RESULT_PROP = "요청 결과"
export const STATE_RUNNING = "🔄 처리 중"
export const STATE_DONE = "✅ 완료"
export const STATE_FAILED = "⚠️ 실패"
export const STATES = [STATE_RUNNING, STATE_DONE, STATE_FAILED]
const INFO_PROP = "웹훅 정보"
const FORWARD_TIMEOUT_MS = 25000

type Page = Record<string, any>

export const requestsEnabled = () => (globalThis as any).Deno?.env?.get?.("NOTION_EVENTS_REQUESTS") !== "off"

// 속성 값 하나를 글자로(select · formula.string · rich_text).
function propText(p: any): string {
	if (!p || typeof p !== "object") return ""
	if (p.select && typeof p.select.name === "string") return p.select.name
	if (p.formula && typeof p.formula.string === "string") return p.formula.string
	if (Array.isArray(p.rich_text)) return p.rich_text.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("")
	return ""
}

export const hasRequestProp = (page: Page | null) => !!page?.properties && typeof page.properties[REQUEST_PROP] === "object"

// 이 줄의 요청: 아는 동작 ID면 { id, ids(넘길 것 전부) }, 아니면 null(비었음 · 처리 중 · 완료 · 실패 · 모르는 값).
export function requestOf(page: Page | null): { id: string; ids: string[] } | null {
	const id = propText(page?.properties?.[REQUEST_PROP]).trim()
	if (!id || !routeById(id)) return null
	const info = propText(page?.properties?.[INFO_PROP]).split(",").map((s) => s.trim()).filter((s) => s && routeById(s))
	const ids = info.includes(id) ? [...new Set(info)] : [id]
	return { id, ids }
}

// 한국 시각 "11/23 10:05:07"
export function kst(ms: number): string {
	const d = new Date(ms + 9 * 3600_000)
	const p = (n: number) => String(n).padStart(2, "0")
	return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

const names = (ids: string[]) => ids.map((id) => routeById(id)?.name.replace(/^\[웹훅\]\s*/, "") ?? id).join(" · ")
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

export type ForwardResult = { id: string; status: number; error?: string; retry?: boolean; note?: string }

export interface RequestDeps {
	patch(pageId: string, props: Record<string, unknown>): Promise<void>
	readPage(pageId: string): Promise<Page | null>
	forward(route: WebhookRoute, body: string): Promise<{ status: number; text?: string; error?: string }>
	enqueueRetry(id: string, pageId: string, body: string, firstError: string): Promise<void>
	now(): number
	log(msg: string): void
}

const selectProp = (name: string) => ({ select: { name } })
const textProp = (s: string) => ({ rich_text: [{ type: "text", text: { content: clip(s, 1900) } }] })

const isForwardFailure = (status: number) => status === 0 || status >= 500

// 응답 본문에서 사람이 읽을 이유 한 줄(error · message · reason).
function reasonOf(text: string | undefined): string {
	if (!text) return ""
	try {
		const j = JSON.parse(text)
		const r = j?.error ?? j?.message ?? j?.reason ?? (Array.isArray(j?.results) ? j.results.map((x: any) => x?.error).filter(Boolean).join(", ") : "")
		return typeof r === "string" ? r : JSON.stringify(r)
	} catch {
		return text.replace(/\s+/g, " ").trim()
	}
}

// 함수가 성공하면서 남긴 안내(note, 사람 말 한 줄) — 예: 링크 재발급인데 리포트가 아직 없음.
function noteOf(text: string | undefined): string {
	if (!text) return ""
	try { const j = JSON.parse(text); return typeof j?.note === "string" ? clip(j.note.trim(), 160) : "" } catch { return "" }
}

// ---------- 실패 이유 → 학원 사람이 읽을 말 (261123) ----------
// 순서대로 처음 맞는 것. 원문은 함수 로그에 남기고, 칸에는 "무엇이 · 어떻게"만.
const KNOWN: [RegExp, string][] = [
	[/report_cache.*없|캐시를 생성/, "학부모 리포트가 아직 만들어지지 않았어요. 반의 [학생 페이지 동기화]를 먼저 누른 뒤 다시 눌러 주세요"],
	[/인증 실패|x-admin-key|unauthorized|forbidden/i, "서버 연결 키가 맞지 않아요. 관리 앱 관리자 설정 → 연결에서 서버 상태를 확인해 주세요"],
	[/rate.?limit|429|too many/i, "노션이 잠시 요청을 막았어요(한도). 1~2분 뒤 다시 눌러 주세요"],
	[/이미 (처리|진행|실행) 중|잠겨|lock/i, "같은 일이 이미 처리 중이에요. 1~2분 뒤 결과를 보고, 그대로면 다시 눌러 주세요"],
	[/timed? ?out|timeout|aborted|시간 초과/i, "서버가 25초 안에 답하지 않았어요. 몇 분 뒤 이 줄의 상태 칸을 보고, 그대로면 다시 눌러 주세요"],
	[/could not find|object_not_found|찾을 수 없|없는 페이지|404/i, "연결된 노션 줄을 찾지 못했어요. 지웠거나 연동에 공유되지 않은 줄인지 확인해 주세요"],
	[/validation|body failed|올바르지 않|형식/i, "줄에 들어간 값 형식이 맞지 않아요. 비었거나 잘못 고른 칸이 없는지 확인해 주세요"],
]
// 사람이 읽을 수 없는 조각(내부 id · 함수 · 표 이름 · 영문 코드)을 걷어낸다.
export function cleanReason(raw: string): string {
	return raw
		.replace(/\([^()가-힣]*\)/g, "") // 한글 없는 괄호 덩어리(page …, lock …, HTTP 400)
		.replace(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi, "")
		.replace(/\b[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+(?:=\S*)?/gi, "")
		.replace(/\b(?:HTTP|status|error|Error)\s*:?\s*\d*/g, "")
		.replace(/[()\[\]{}"']/g, " ")
		.replace(/\s+([.,:;])/g, "$1").replace(/\s+/g, " ").replace(/^[\s.,:;·-]+|[\s,:;·-]+$/g, "").trim()
}
const hasHangul = (s: string) => /[가-힣]/.test(s)
export function readableReason(status: number, raw: string, retried: boolean): string {
	for (const [re, say] of KNOWN) if (re.test(raw)) return retried ? `${say} (서버가 몇 분 안에 자동으로 한 번 더 넘겨요)` : say
	if (status === 0 || status >= 500) {
		// 함수가 한글 이유를 줬으면 앞에(무엇이), 뒤에 서버가 하는 일 · 할 일(어떻게)
		const c = status === 0 ? "" : cleanReason(raw)
		const why = hasHangul(c) ? `${clip(c, 120)} — ` : ""
		return retried
			? `${why}서버가 ${why ? "" : "잠깐 처리하지 못해 "}자동으로 다시 넘기고 있어요(최대 3번). 10분 뒤에도 실패면 다시 누르고, 계속되면 관리자에게 알려 주세요`
			: `${why}${why ? "" : "서버가 잠깐 처리하지 못했어요. "}1~2분 뒤 다시 눌러 주세요`
	}
	if (status === 404) return "서버에 이 기능이 아직 없어요(업데이트가 필요해요). 관리자에게 알려 주세요"
	const c = cleanReason(raw)
	if (hasHangul(c)) return clip(c, 160)
	return `서버가 요청을 받지 않았어요(${status}). 관리자에게 알려 주세요`
}

// 줄의 `상태`가 ⚠️ 오류이고 그 오류가 이번 요청 동안 생겼으면 `마지막 오류`를 읽을 말로(없으면 기본 안내). 아니면 "".
// "이번 요청 동안" = 접수 전 줄과 상태 · 마지막 오류가 다르거나, 함수가 쓰는 `처리 시작 시각`이 접수 뒤(분 단위).
// 같은 줄에 다른 동작이 남긴 옛 ⚠️ 오류(예: 보고서 생성 실패 뒤 [학생 페이지 동기화])를 이번 요청 실패로 보지 않게.
export const STATUS_PROP = "상태", LAST_ERROR_PROP = "마지막 오류", STARTED_PROP = "처리 시작 시각"
const dateStart = (p: any): number => { const v = p?.date?.start; return typeof v === "string" ? Date.parse(v) : NaN }
export function rowErrorOf(now: Page | null, before: Page | null = null, t0 = 0): string {
	if (!/^⚠️/.test(propText(now?.properties?.[STATUS_PROP]).trim())) return ""
	const raw = propText(now?.properties?.[LAST_ERROR_PROP]).trim()
	if (before) {
		const changed = propText(before.properties?.[STATUS_PROP]).trim() !== propText(now?.properties?.[STATUS_PROP]).trim() ||
			propText(before.properties?.[LAST_ERROR_PROP]).trim() !== raw
		const started = dateStart(now?.properties?.[STARTED_PROP]) >= Math.floor(t0 / 60000) * 60000
		if (!changed && !started) return ""
	}
	const c = cleanReason(raw)
	return hasHangul(c) ? clip(c, 160) : "줄의 [마지막 오류]를 보고 고친 뒤 다시 눌러 주세요"
}

export type RequestOutcome = { state: typeof STATE_DONE | typeof STATE_FAILED; ids: string[]; results: ForwardResult[]; ms: number; overwritten: boolean }

// 줄 하나의 요청 처리. page = 방금 다시 읽은 페이지(노션 API 모양 그대로).
export async function handleRequest(page: Page, req: { id: string; ids: string[] }, deps: RequestDeps): Promise<RequestOutcome> {
	const t0 = deps.now()
	const label = names(req.ids)
	// 노션 자동화 웹훅과 같은 모양: { source, data: 페이지 }. 요청 칸은 접수 전 값(동작 ID) 그대로 둔다.
	const body = JSON.stringify({ source: { type: "notion-events", request: req.id }, data: page })
	await deps.patch(page.id, { [REQUEST_PROP]: selectProp(STATE_RUNNING), [RESULT_PROP]: textProp(`${STATE_RUNNING} · ${label} · ${kst(t0)} 접수`) })
	// (261123 출시 전 2번) 여기부터는 무엇이 실패해도 요청 칸을 "처리 중"에 두지 않는다 — 처리 중은 요청이 아니라서(requestOf)
	// 대기열이 다시 돌아도 건너뛰고, 사람은 실제로 돌았는지 알 수 없다. 넘기기 예외는 status 0(넘기지 못함)으로 본다.
	const results: ForwardResult[] = await Promise.all(req.ids.map(async (id) => {
		const route = routeById(id)!
		const r = await deps.forward(route, body).catch((err) => ({ status: 0, error: (err as Error)?.message ?? String(err) } as { status: number; text?: string; error?: string }))
		const out: ForwardResult = { id, status: r.status }
		if (isForwardFailure(r.status)) {
			out.error = r.error ?? (reasonOf(r.text) || `HTTP ${r.status}`)
			try { await deps.enqueueRetry(id, page.id, body, out.error); out.retry = true } catch (err) { deps.log(`[notionRequests] 다시 넘기기 넣기 실패 ${id}: ${(err as Error).message}`) }
		} else if (r.status >= 400) {
			out.error = reasonOf(r.text) || `HTTP ${r.status}`
		} else {
			const n = noteOf(r.text)
			if (n) out.note = n
		}
		return out
	}))
	// 다시 읽어: 그 사이 새 요청이 들어왔나 · 바로 답한 함수(200)가 줄을 ⚠️ 오류로 끝냈나.
	// 다시 읽기가 실패하면(노션 오류·시간 초과) 새 요청은 없다고 보고 마무리한다 — 처리 중에 남기는 것보다 낫다.
	let now: Page | null = null, readFailed = false
	try { now = await deps.readPage(page.id) } catch (err) { readFailed = true; deps.log(`[notionRequests] ${page.id.slice(-6)} 다시 읽기 실패(마무리는 함): ${(err as Error).message}`) }
	const failed = results.filter((r) => r.error)
	// (261123 원본 실측) 함수는 예시 데이터가 모자라면 실패로 답하지 않고 줄의 `상태` = ⚠️ 오류 · `마지막 오류`에 이유를 쓴다
	// (예: 시험 기간 연결 "학교와 시험을 먼저 고르세요."). 요청 칸이 ✅ 완료면 사람이 놓치므로, 바로 처리하는 함수(200 — 큐에
	// 넣고 202로 답하는 함수는 아직 결과 전)가 끝낸 줄이 ⚠️ 오류면 요청도 ⚠️ 실패 + 그 이유로.
	const rowError = !failed.length && results.every((r) => r.status === 200) ? rowErrorOf(now, page, t0) : ""
	const state = failed.length || rowError ? STATE_FAILED : STATE_DONE
	const ms = deps.now() - t0
	const sec = (ms / 1000).toFixed(1)
	// (261123) 학원 사람이 읽을 말: 무엇이 안 됐고 어떻게 하면 되는지. 내부 id · 함수 이름 · 영문 오류 원문은 서버 기록(log)에만.
	for (const r of failed) deps.log(`[notionRequests] ${page.id.slice(-6)} ${r.id} 실패 원문 ${r.status}: ${clip(r.error ?? "", 400)}`)
	const why = rowError
		? `${label} — ${rowError}`
		: failed.map((r) => `${names([r.id])} — ${readableReason(r.status, r.error ?? "", !!r.retry)}`).join(" / ")
	const notes = results.map((r) => r.note).filter(Boolean)
	const resultText = state === STATE_DONE
		? `${STATE_DONE} · ${label} · ${sec}초 · ${kst(deps.now())}${notes.length ? ` · ${notes.join(" / ")}` : ""}`
		: `${STATE_FAILED} · ${why} · ${kst(deps.now())}`
	// 그 사이 새 요청이 들어왔으면 요청 칸은 그대로 두고 결과만.
	const cur = propText(now?.properties?.[REQUEST_PROP]).trim()
	const overwritten = !readFailed && cur !== STATE_RUNNING
	try {
		await deps.patch(page.id, overwritten ? { [RESULT_PROP]: textProp(resultText) } : { [REQUEST_PROP]: selectProp(state), [RESULT_PROP]: textProp(resultText) })
	} catch (err) {
		// 마지막 쓰기가 실패하면 한 번 더(긴 글이 문제일 수 있어 짧게). 그래도 안 되면 감시(sweepStaleRequests)가 15분 뒤 ⚠️ 실패로.
		deps.log(`[notionRequests] ${page.id.slice(-6)} 마지막 쓰기 실패, 다시 씀: ${(err as Error).message}`)
		const short = `${state} · ${label} · ${kst(deps.now())}`
		await deps.patch(page.id, overwritten ? { [RESULT_PROP]: textProp(short) } : { [REQUEST_PROP]: selectProp(state), [RESULT_PROP]: textProp(short) })
	}
	deps.log(`[notionRequests] ${page.id.slice(-6)} ${req.ids.join(",")} → ${state} ${sec}s${rowError ? " (줄 ⚠️ 오류)" : ""}${overwritten ? " (새 요청 있음)" : ""}`)
	return { state, ids: req.ids, results, ms, overwritten }
}

// ---------- 자동 재시도 결과를 요청 칸에 (261123 출시 전 3번) ----------
// 넘기기가 실패하면 요청 칸은 "⚠️ 실패 … 자동으로 다시 넘기고 있어요"다. 다시 넘기기(webhookRouter processRouterRetryItem)가
// 끝나면 그 결과로 바꾼다: 성공 = ✅ 완료 + "(자동 재시도)", 함수가 4xx로 거절 = ⚠️ 실패 + 그 이유(더는 다시 넘기지 않으니).
// 요청 칸이 지금 ⚠️ 실패일 때만 쓴다 — 그사이 사람이 다시 눌렀으면(새 요청·처리 중·완료) 건드리지 않는다.
// 이 쓰기가 실패해도 throw하지 않는다(던지면 큐가 같은 동작을 한 번 더 넘긴다).
export function isNotionEventsBody(body: string | undefined): boolean {
	try { return JSON.parse(body ?? "")?.source?.type === "notion-events" } catch { return false }
}
export async function finishRetriedRequest(pageId: string, id: string, r: { status: number; text?: string }, deps: Pick<RequestDeps, "readPage" | "patch" | "now" | "log">): Promise<"done" | "failed" | "skip"> {
	try {
		const page = await deps.readPage(pageId)
		if (propText(page?.properties?.[REQUEST_PROP]).trim() !== STATE_FAILED) return "skip"
		const ok = r.status < 400
		const text = ok
			? `${STATE_DONE}(자동 재시도) · ${names([id])} · ${kst(deps.now())}${noteOf(r.text) ? ` · ${noteOf(r.text)}` : ""}`
			: `${STATE_FAILED} · ${names([id])} — ${readableReason(r.status, reasonOf(r.text) || `HTTP ${r.status}`, false)} · ${kst(deps.now())}`
		await deps.patch(pageId, ok ? { [REQUEST_PROP]: selectProp(STATE_DONE), [RESULT_PROP]: textProp(text) } : { [RESULT_PROP]: textProp(text) })
		deps.log(`[notionRequests] ${pageId.slice(-6)} ${id} 자동 재시도 → ${ok ? STATE_DONE : STATE_FAILED}`)
		return ok ? "done" : "failed"
	} catch (err) {
		deps.log(`[notionRequests] ${pageId.slice(-6)} 자동 재시도 결과 쓰기 실패: ${(err as Error).message}`)
		return "skip"
	}
}

// ---------- 오래된 "처리 중" 회수 (261123 출시 전 2번) ----------
// 함수가 통째로 죽으면(실행 시간 한도 등) 위 마무리도 못 한다. 감시(status-watchdog, 5분마다)가 요청 칸이 있는 DB
// (처리기가 기억한 notion_request_sources)에서 `요청` = 처리 중이고 staleMinutes분 넘게 아무도 고치지 않은 줄을 ⚠️ 실패로 바꾼다.
// 기준은 줄의 마지막 수정 시각(처리 중을 쓴 때 · 그 뒤 함수가 쓴 때) — 아직 일하는 함수가 줄을 고치면 그만큼 늦게 본다.
export interface SweepDeps {
	sources(): Promise<string[]>
	query(ds: string, filter: Record<string, unknown>): Promise<{ id: string }[]>
	patch(pageId: string, props: Record<string, unknown>): Promise<void>
	now(): number
	log(msg: string): void
}
export const STALE_REQUEST_TEXT = "처리 중에 서버가 끝을 알리지 못했어요(15분 넘음). 실제로 됐는지 이 줄의 상태 칸을 보고, 안 됐으면 다시 눌러 주세요"
export async function sweepStaleRequests(deps: SweepDeps, staleMinutes = 15): Promise<{ recovered: number; ids: string[]; sources: number }> {
	const ids: string[] = []
	const sources = await deps.sources()
	const before = new Date(deps.now() - staleMinutes * 60_000).toISOString()
	const filter = { and: [{ property: REQUEST_PROP, select: { equals: STATE_RUNNING } }, { timestamp: "last_edited_time", last_edited_time: { before } }] }
	for (const ds of sources) {
		let rows: { id: string }[] = []
		try { rows = await deps.query(ds, filter) } catch (err) { deps.log(`[notionRequests] 감시: ${ds.slice(-6)} 찾기 실패 ${(err as Error).message}`); continue }
		for (const r of rows) {
			try {
				await deps.patch(r.id, { [REQUEST_PROP]: selectProp(STATE_FAILED), [RESULT_PROP]: textProp(`${STATE_FAILED} · ${STALE_REQUEST_TEXT} · ${kst(deps.now())}`) })
				ids.push(r.id)
			} catch (err) { deps.log(`[notionRequests] 감시: ${r.id.slice(-6)} 쓰기 실패 ${(err as Error).message}`) }
		}
	}
	if (ids.length) deps.log(`[notionRequests] 감시: 오래된 처리 중 ${ids.length}줄 → ${STATE_FAILED}`)
	return { recovered: ids.length, ids, sources: sources.length }
}

// ---------- 실제 바깥 일 ----------
async function liveForward(route: WebhookRoute, body: string) {
	const { getCurrentAdminKey } = await import("./adminShared.ts")
	const base = (globalThis as any).Deno.env.get("SB_URL") ?? ""
	if (!base) return { status: 0, error: "SB_URL이 설정되지 않았습니다." }
	try {
		const res = await fetch(targetUrl(base, route), {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-admin-key": await getCurrentAdminKey() },
			body,
			signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
		})
		return { status: res.status, text: (await res.text()).slice(0, 2000) }
	} catch (err) {
		return { status: 0, error: (err as Error).message }
	}
}

export const liveRequestDeps: RequestDeps = {
	async patch(pageId, props) {
		const res = await fetchWithRetry(`${NOTION_API}/pages/${pageId}`, { method: "PATCH", headers: notionHeaders(), body: JSON.stringify({ properties: props }) })
		if (!res.ok) throw new Error(`요청 칸 쓰기 실패: ${res.status} ${(await res.text()).slice(0, 200)}`)
	},
	async readPage(pageId) {
		const res = await fetchWithRetry(`${NOTION_API}/pages/${pageId}`, { headers: notionHeaders() })
		if (res.status === 404) return null
		if (!res.ok) throw new Error(`노션 줄 읽기 실패: ${res.status}`)
		return await res.json()
	},
	forward: liveForward,
	async enqueueRetry(id, pageId, body, firstError) {
		const { enqueueSync, wakeSyncQueueWorker } = await import("./syncQueue.ts")
		await enqueueSync("notion-router-retry", { id, pageId, body, firstError })
		wakeSyncQueueWorker()
	},
	now: () => Date.now(),
	log: (m) => console.log(m),
}

export const liveSweepDeps: SweepDeps = {
	async sources() {
		const { fetchSupabaseWithRetry } = await import("./reportCacheShared.ts")
		const env = (globalThis as any).Deno.env
		const url = String(env.get("SB_URL") ?? "").replace(/\/$/, ""), key = env.get("SB_SERVICE_ROLE_KEY") ?? ""
		if (!url) return []
		const res = await fetchSupabaseWithRetry(`${url}/rest/v1/notion_request_sources?has_request=eq.true&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
		if (!res.ok) throw new Error(`요청 칸 DB 목록 읽기 실패: ${res.status}`)
		return ((await res.json()) as { id: string }[]).map((r) => r.id)
	},
	async query(ds, filter) {
		const { queryAllPages } = await import("./notionClient.ts")
		return await queryAllPages(ds, filter) as { id: string }[]
	},
	patch: liveRequestDeps.patch,
	now: () => Date.now(),
	log: (m) => console.log(m),
}
