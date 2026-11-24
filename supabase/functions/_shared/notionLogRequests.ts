// _shared/notionLogRequests.ts
//
// (261125 시험, 버튼 하나) 버튼이 자기 줄 `요청` 칸을 바꾸는 대신 "자동화 로그(학원) DB"에 요청 줄을 새로 만든다.
// 까닭: 노션 웹훅 구독은 page.properties_updated를 같은 페이지 1분 안 앞선 변경과 묶어 약 60초 뒤 보내지만
// (사람이 누른 것 21%), page.created는 묶지 않고 몇 초 안에 보낸다.
//
// 요청 줄(버튼이 만듦)
//   - `발송 구분` = "버튼 요청"
//   - `메모` = 동작 ID(요청 칸 선택지와 같은 이름, 예 session-record)
//   - 대상 줄 연결 = 버튼의 "이 페이지"(동작 표의 DB 이름과 같은 관계 칸, 없으면 값이 있는 첫 관계 칸)
//   - `발송자` = 누른 사람
// 처리(notion-events → 대기열 → notionEventsApply.applyOne): 자동화 로그 data source의 page.created면 그 줄을 읽고
//   대상 줄을 다시 읽어 요청 칸 길과 똑같이 handleRequest(대상 `요청`·`요청 결과`도 지금과 같게) → 요청 줄 `발송 상태`·`발송일시`·`실패 사유`.
// 요청 칸 길(다른 버튼·자동화)은 그대로다.
// 성공한 요청 줄은 바로 휴지통에(영구 삭제 아님 — 노션 휴지통에서 되살림). 실패한 줄은 남겨 발송 상태·실패 사유를 본다.
//   끄기: 함수 설정 NOTION_LOG_REQUEST_TRASH=off. 버튼 요청이 아닌 줄(알림톡 기록 등)은 읽기만 하고 건드리지 않는다.
//   서버가 휴지통에 넣어 생기는 page.deleted는 처리기(applyOne)가 자동화 로그 data source라 읽지 않고 넘긴다(skip:no-copy).

import { hasRequestProp, handleRequest, requestFromId, STATE_DONE, type RequestDeps } from "./notionRequests.ts"
import { routeById } from "./webhookRoutes.ts"

export const LOG_CATEGORY_PROP = "발송 구분"
export const LOG_REQUEST_CATEGORY = "버튼 요청"
export const LOG_ACTION_PROP = "메모"
export const LOG_STATUS_PROP = "발송 상태"
export const LOG_TIME_PROP = "발송일시"
export const LOG_REASON_PROP = "실패 사유"

type Page = Record<string, any>

const plain = (p: any): string => {
	if (!p || typeof p !== "object") return ""
	if (p.select && typeof p.select.name === "string") return p.select.name
	if (Array.isArray(p.rich_text)) return p.rich_text.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("")
	if (Array.isArray(p.title)) return p.title.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("")
	return ""
}

// 요청 줄이면 { id(동작), targetId(대상 줄) }, 아니면 null. 대상 줄이 없으면 targetId = "".
export function logRequestOf(page: Page | null): { id: string; targetId: string } | null {
	const props = page?.properties
	if (!props || plain(props[LOG_CATEGORY_PROP]).trim() !== LOG_REQUEST_CATEGORY) return null
	const id = plain(props[LOG_ACTION_PROP]).trim()
	const route = routeById(id)
	const want = route ? route.db.replace(/\(학원\)$/, "") : ""
	const rels = Object.entries(props).filter(([, v]: [string, any]) => v?.type === "relation" || Array.isArray(v?.relation))
	const first = (v: any) => (Array.isArray(v?.relation) && v.relation[0]?.id) || ""
	const named = rels.find(([k]) => k === want)
	const targetId = (named && first(named[1])) || rels.map(([, v]) => first(v)).find(Boolean) || ""
	return { id, targetId }
}

const textProp = (s: string) => ({ rich_text: [{ type: "text", text: { content: s.slice(0, 1900) } }] })

// 성공한 요청 줄을 휴지통에 넣을까(기본 켬).
export const logTrashEnabled = () => Deno.env.get("NOTION_LOG_REQUEST_TRASH") !== "off"

// 요청 줄 하나 처리. readTarget = 사본 처리기와 같은 방식으로 읽기(넘기는 본문이 요청 칸 길과 같게).
// opts.trash가 있으면 성공한 요청 줄을 그것으로 휴지통에 넣는다(실패하면 성공 상태를 남기고 로그만).
export async function handleLogRequest(logPage: Page, readTarget: (id: string) => Promise<Page | null>, deps: RequestDeps, opts: { trash?: (pageId: string) => Promise<void> } = {}): Promise<string | null> {
	const r = logRequestOf(logPage)
	if (!r) return null
	const finish = async (ok: boolean, reason: string) => {
		const props: Record<string, unknown> = {
			[LOG_STATUS_PROP]: { select: { name: ok ? "성공" : "실패" } },
			[LOG_TIME_PROP]: { date: { start: new Date(deps.now()).toISOString() } },
		}
		if (reason) props[LOG_REASON_PROP] = textProp(reason)
		try { await deps.patch(logPage.id, props) } catch (err) { deps.log(`[logRequests] ${logPage.id.slice(-6)} 요청 줄 쓰기 실패: ${(err as Error).message}`) }
	}
	if (!routeById(r.id)) { await finish(false, `모르는 동작이에요(${r.id || "빈 칸"}). 버튼의 메모 값을 확인해 주세요`); return `log:unknown ${r.id}` }
	if (!r.targetId) { await finish(false, "대상 줄 연결이 비어 있어요. 버튼의 연결 칸이 '이 페이지'인지 확인해 주세요"); return "log:no-target" }
	const target = await readTarget(r.targetId)
	if (!target || target.in_trash || target.archived) { await finish(false, "대상 줄을 찾지 못했어요(지웠거나 연동에 공유되지 않음)"); return "log:target-gone" }
	if (!hasRequestProp(target)) { await finish(false, "대상 줄에 요청 칸이 없어요"); return "log:no-request-prop" }
	const req = requestFromId(target, r.id)!
	const out = await handleRequest(target, req, deps)
	const ok = out.state === STATE_DONE
	await finish(ok, ok ? "" : out.text)
	let trashed = ""
	if (ok && opts.trash) {
		try { await opts.trash(logPage.id); trashed = " trashed" } catch (err) { deps.log(`[logRequests] ${logPage.id.slice(-6)} 요청 줄 휴지통 넣기 실패(성공 상태로 남김): ${(err as Error).message}`) }
	}
	return `log:${out.ids.join(",")} ${out.state}${trashed}`
}

// 자동화 로그 DB의 data source id 찾기: NOTION_SEND_LOG_DB_ID(데이터베이스 id)로 /databases를 읽어 data_sources[0].
// 값이 이미 data source id면 그대로 맞는다. 함수 메모리에 1시간.
const norm = (id: string | null | undefined) => (id ?? "").replace(/-/g, "").toLowerCase()
let logSources: { at: number; ids: Set<string> } | null = null
export function resetLogSourceCache() { logSources = null }
export async function isLogSource(ds: string, env: { dbId: string; getDatabase(id: string): Promise<any> }): Promise<boolean> {
	if (!env.dbId || !ds) return false
	if (!logSources || Date.now() - logSources.at > 3600_000) {
		const ids = new Set([norm(env.dbId)])
		let at = Date.now()
		try {
			const db = await env.getDatabase(env.dbId)
			for (const s of db?.data_sources ?? []) if (s?.id) ids.add(norm(s.id))
		} catch (err) {
			console.error("[logRequests] 자동화 로그 DB 읽기 실패(1분 뒤 다시)", (err as Error).message)
			at = Date.now() - 3600_000 + 60_000
		}
		logSources = { at, ids }
	}
	return logSources.ids.has(norm(ds))
}
