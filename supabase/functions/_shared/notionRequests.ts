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

export type ForwardResult = { id: string; status: number; error?: string; retry?: boolean }

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

export type RequestOutcome = { state: typeof STATE_DONE | typeof STATE_FAILED; ids: string[]; results: ForwardResult[]; ms: number; overwritten: boolean }

// 줄 하나의 요청 처리. page = 방금 다시 읽은 페이지(노션 API 모양 그대로).
export async function handleRequest(page: Page, req: { id: string; ids: string[] }, deps: RequestDeps): Promise<RequestOutcome> {
	const t0 = deps.now()
	const label = names(req.ids)
	// 노션 자동화 웹훅과 같은 모양: { source, data: 페이지 }. 요청 칸은 접수 전 값(동작 ID) 그대로 둔다.
	const body = JSON.stringify({ source: { type: "notion-events", request: req.id }, data: page })
	await deps.patch(page.id, { [REQUEST_PROP]: selectProp(STATE_RUNNING), [RESULT_PROP]: textProp(`${STATE_RUNNING} · ${label} · ${kst(t0)} 접수`) })
	const results: ForwardResult[] = await Promise.all(req.ids.map(async (id) => {
		const route = routeById(id)!
		const r = await deps.forward(route, body)
		const out: ForwardResult = { id, status: r.status }
		if (isForwardFailure(r.status)) {
			out.error = r.error ?? (reasonOf(r.text) || `HTTP ${r.status}`)
			try { await deps.enqueueRetry(id, page.id, body, out.error); out.retry = true } catch (err) { deps.log(`[notionRequests] 다시 넘기기 넣기 실패 ${id}: ${(err as Error).message}`) }
		} else if (r.status >= 400) {
			out.error = reasonOf(r.text) || `HTTP ${r.status}`
		}
		return out
	}))
	const failed = results.filter((r) => r.error)
	const state = failed.length ? STATE_FAILED : STATE_DONE
	const ms = deps.now() - t0
	const sec = (ms / 1000).toFixed(1)
	const why = failed.map((r) => `${names([r.id])}: ${r.error}${r.retry ? " (서버가 자동으로 다시 넘김, 결과는 자동화 로그)" : ""}`).join(" / ")
	const resultText = state === STATE_DONE ? `${STATE_DONE} · ${label} · ${sec}초 · ${kst(deps.now())}` : `${STATE_FAILED} · ${why} · ${kst(deps.now())}`
	// 그 사이 새 요청이 들어왔으면 요청 칸은 그대로 두고 결과만.
	const now = await deps.readPage(page.id)
	const cur = propText(now?.properties?.[REQUEST_PROP]).trim()
	const overwritten = cur !== STATE_RUNNING
	await deps.patch(page.id, overwritten ? { [RESULT_PROP]: textProp(resultText) } : { [REQUEST_PROP]: selectProp(state), [RESULT_PROP]: textProp(resultText) })
	deps.log(`[notionRequests] ${page.id.slice(-6)} ${req.ids.join(",")} → ${state} ${sec}s${overwritten ? " (새 요청 있음)" : ""}`)
	return { state, ids: req.ids, results, ms, overwritten }
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
