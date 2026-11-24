import { assert, assertEquals } from "jsr:@std/assert@1"
import { handleLogRequest, isLogSource, logRequestOf, resetLogSourceCache, LOG_REQUEST_CATEGORY } from "./notionLogRequests.ts"
import { REQUEST_PROP, RESULT_PROP, STATE_DONE, STATE_FAILED, type RequestDeps } from "./notionRequests.ts"
import { applyOne, buildTargets, type Deps, type QueueItem } from "./notionEventsApply.ts"

// 시험 값만(실제 노션 id 아님)
const sel = (name: string) => ({ type: "select", select: name ? { name } : null })
const rt = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s, text: { content: s } }] : [] })
const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })) })
const page = (id: string, props: Record<string, unknown>, ds: string) => ({ id, object: "page", parent: { type: "data_source_id", data_source_id: ds }, properties: props })
const DS_LOG = "ds-log-0001", DS_SESSION = "ds-session-0001"
const logRow = (id: string, action: string, target: string, extra: Record<string, unknown> = {}) =>
	page(id, { 이름: { type: "title", title: [] }, "발송 구분": sel(LOG_REQUEST_CATEGORY), 메모: rt(action), 수업: target ? rel(target) : rel(), 등록: rel(), ...extra }, DS_LOG)

type Fake = RequestDeps & { pages: Map<string, any>; patches: { id: string; props: any }[]; forwards: { fn: string; body: any }[]; t: number }
function fake(status = 200, respText = '{"ok":true}'): Fake {
	const f: any = { pages: new Map(), patches: [], forwards: [], t: Date.UTC(2026, 10, 25, 1, 0, 0) }
	Object.assign(f, {
		async patch(id: string, props: any) { f.patches.push({ id, props }); const p = f.pages.get(id); if (p) Object.assign(p.properties, props) },
		async readPage(id: string) { return f.pages.get(id) ? structuredClone(f.pages.get(id)) : null },
		async forward(route: any, body: string) { f.t += 1500; f.forwards.push({ fn: route.fn + route.path, body: JSON.parse(body) }); return { status, text: respText } },
		async enqueueRetry() {},
		now: () => f.t,
		log: () => {},
	})
	return f
}

Deno.test("요청 줄: 발송 구분이 버튼 요청일 때만, 동작 표 DB 이름과 같은 관계 칸을 대상으로", () => {
	assertEquals(logRequestOf(logRow("l", "session-record", "s1")), { id: "session-record", targetId: "s1" })
	assertEquals(logRequestOf(page("l", { "발송 구분": sel("일일 보고서"), 메모: rt("session-record"), 수업: rel("s1") }, DS_LOG)), null)
	// 이름이 다른 관계 칸만 있으면 값이 있는 첫 관계
	assertEquals(logRequestOf(page("l", { "발송 구분": sel(LOG_REQUEST_CATEGORY), 메모: rt("session-record"), 등록: rel(), 기타: rel("s9") }, DS_LOG))!.targetId, "s9")
	assertEquals(logRequestOf(logRow("l", "session-record", ""))!.targetId, "")
})

Deno.test("요청 줄 처리: 요청 칸 길과 같은 함수·같은 본문(대상 줄), 대상 요청 결과와 요청 줄 발송 상태", async () => {
	const f = fake()
	f.pages.set("s1", page("s1", { [REQUEST_PROP]: sel(""), [RESULT_PROP]: rt(""), 이름: {} }, DS_SESSION))
	f.pages.set("l1", logRow("l1", "session-record", "s1"))
	const out = await handleLogRequest(f.pages.get("l1"), (id) => f.readPage(id), f)
	assertEquals(out, `log:session-record ${STATE_DONE}`)
	assertEquals(f.forwards.length, 1)
	assertEquals(f.forwards[0].fn, "create-learning-record")
	assertEquals(f.forwards[0].body.data.id, "s1", "넘기는 본문은 대상 줄")
	assertEquals(f.pages.get("s1").properties[REQUEST_PROP].select.name, STATE_DONE)
	assert(f.pages.get("s1").properties[RESULT_PROP].rich_text[0].text.content.startsWith(`${STATE_DONE} · 학습기록 생성 · 1.5초`))
	assertEquals(f.pages.get("l1").properties["발송 상태"].select.name, "성공")
	assert(f.pages.get("l1").properties["발송일시"].date.start)
	assertEquals(f.pages.get("l1").properties["실패 사유"], undefined)
})

Deno.test("요청 줄 처리: 함수 실패면 발송 상태 실패 + 이유", async () => {
	const f = fake(400, '{"error":"수업에 반이 비어 있습니다"}')
	f.pages.set("s1", page("s1", { [REQUEST_PROP]: sel("") }, DS_SESSION))
	f.pages.set("l1", logRow("l1", "session-record", "s1"))
	assertEquals(await handleLogRequest(f.pages.get("l1"), (id) => f.readPage(id), f), `log:session-record ${STATE_FAILED}`)
	assertEquals(f.pages.get("l1").properties["발송 상태"].select.name, "실패")
	assert(f.pages.get("l1").properties["실패 사유"].rich_text[0].text.content.includes("반이 비어"))
})

Deno.test("요청 줄 처리: 모르는 동작 · 대상 없음 · 요청 칸 없는 대상은 넘기지 않고 실패", async () => {
	const f = fake()
	f.pages.set("s1", page("s1", { 이름: {} }, DS_SESSION))
	for (const [row, want] of [[logRow("a", "없는-동작", "s1"), "log:unknown 없는-동작"], [logRow("b", "session-record", ""), "log:no-target"], [logRow("c", "session-record", "zz"), "log:target-gone"], [logRow("d", "session-record", "s1"), "log:no-request-prop"]] as const) {
		f.pages.set(row.id, row)
		assertEquals(await handleLogRequest(row, (id) => f.readPage(id), f), want)
		assertEquals(f.pages.get(row.id).properties["발송 상태"].select.name, "실패")
	}
	assertEquals(f.forwards, [])
	// 버튼 요청이 아닌 줄은 아무것도 안 씀
	f.pages.set("e", page("e", { "발송 구분": sel("일일 보고서") }, DS_LOG))
	assertEquals(await handleLogRequest(f.pages.get("e"), (id) => f.readPage(id), f), null)
	assertEquals(f.patches.filter((p) => p.id === "e"), [])
})

Deno.test("자동화 로그 data source 찾기: DB id로 읽은 data_sources, 실패해도 DB id는 맞음", async () => {
	resetLogSourceCache()
	assert(await isLogSource("DS-LOG-0001", { dbId: "db-log", getDatabase: async () => ({ data_sources: [{ id: "ds-log-0001" }] }) }))
	assert(!(await isLogSource("ds-other", { dbId: "db-log", getDatabase: async () => ({}) })))
	resetLogSourceCache()
	assert(await isLogSource("db-log", { dbId: "db-log", getDatabase: async () => { throw new Error("x") } }))
	assert(!(await isLogSource("x", { dbId: "", getDatabase: async () => ({}) })))
	resetLogSourceCache()
})

// ---------- 처리기와 함께 ----------
const tmap = buildTargets({ cr_sessions: DS_SESSION, cr_attendance: "", cr_records: "", cr_activities: "" } as any, new Map() as any)
function fakeApply() {
	const f: any = { reads: [], handled: [], notion: new Map() }
	const deps: Deps = {
		rpc: async () => null,
		targets: async () => tmap,
		readPage: async (id) => { f.reads.push(id); return f.notion.get(id) ?? null },
		copyRow: async () => null,
		rowsOf: async (_t, p) => [{ id: p.id }],
		upsert: async () => {},
		removeEverywhere: async () => {},
		calls: () => 0, now: () => 1_000_000, sleep: async () => {}, log: () => {},
		request: { isSource: async () => false, remember: async () => {}, hasProp: () => false, handle: async () => null },
		logRequest: {
			isLogSource: async (ds) => ds === DS_LOG,
			handle: async (p, read) => { const r = logRequestOf(p); if (!r) return null; const t = await read(r.targetId); f.handled.push([r.id, t?.id]); return `log:${r.id} ${STATE_DONE}` },
		},
	}
	return { f, deps }
}
const qi = (page_id: string, ds: string, extra: Partial<QueueItem> = {}): QueueItem => ({ page_id, data_source_id: ds, event_type: "page.created", event_time: new Date(1_000_000).toISOString(), own_bot: false, seq: 1, attempts: 0, ...extra })

Deno.test("처리기: 자동화 로그의 새 요청 줄(page.created)은 대상 줄로 넘긴다", async () => {
	const { f, deps } = fakeApply()
	f.notion.set("l1", logRow("l1", "session-record", "s1"))
	f.notion.set("s1", page("s1", {}, DS_SESSION))
	assertEquals((await applyOne(qi("l1", DS_LOG), deps)).result, `log:session-record ${STATE_DONE}`)
	assertEquals(f.handled, [["session-record", "s1"]])
})

Deno.test("처리기: 자동화 로그의 다른 줄·연동이 만든 줄·칸 바뀜은 요청으로 보지 않는다", async () => {
	const { f, deps } = fakeApply()
	f.notion.set("l2", page("l2", { "발송 구분": sel("일일 보고서") }, DS_LOG))
	assertEquals((await applyOne(qi("l2", DS_LOG), deps)).result, "log:skip")
	f.reads.length = 0
	assertEquals((await applyOne(qi("l1", DS_LOG, { own_bot: true }), deps)).result, "skip:no-copy")
	assertEquals((await applyOne(qi("l1", DS_LOG, { event_type: "page.properties_updated" }), deps)).result, "skip:no-copy")
	assertEquals(f.reads, [], "서버가 쓴 전송 기록·요청 줄 결과 쓰기는 노션을 읽지 않음")
	assertEquals(f.handled, [])
})
