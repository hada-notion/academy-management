import { assert, assertEquals } from "jsr:@std/assert@1"
import { handleRequest, kst, requestOf, hasRequestProp, REQUEST_PROP, RESULT_PROP, STATE_DONE, STATE_FAILED, STATE_RUNNING, type RequestDeps } from "./notionRequests.ts"
import { applyOne, buildTargets, type Deps, type QueueItem, type Target } from "./notionEventsApply.ts"
import { WEBHOOK_ROUTES } from "./webhookRoutes.ts"

// 시험 값만(실제 노션 id 아님)
const sel = (name: string) => ({ type: "select", select: name ? { name } : null })
const formula = (s: string) => ({ type: "formula", formula: { type: "string", string: s } })
const rpage = (id: string, props: Record<string, unknown>, ds = "ds-session-0001") => ({ id, object: "page", parent: { type: "data_source_id", data_source_id: ds }, properties: props })
const text = (p: any) => p?.rich_text?.[0]?.text?.content ?? ""

type FakeReq = RequestDeps & { pages: Map<string, any>; patches: { id: string; props: any }[]; forwards: { fn: string; body: any }[]; retries: string[]; t: number }
function fakeReq(status = 202, respText = '{"ok":true}'): FakeReq {
	const f: any = { pages: new Map(), patches: [], forwards: [], retries: [], t: Date.UTC(2026, 10, 23, 1, 5, 7) }
	Object.assign(f, {
		async patch(id: string, props: any) {
			f.patches.push({ id, props })
			const p = f.pages.get(id)
			if (p) for (const [k, v] of Object.entries(props)) p.properties[k] = v
		},
		async readPage(id: string) { return f.pages.get(id) ? structuredClone(f.pages.get(id)) : null },
		async forward(route: any, body: string) { f.t += 1200; f.forwards.push({ fn: route.fn + route.path, body: JSON.parse(body) }); return typeof status === "number" ? { status, text: respText } : status },
		async enqueueRetry(id: string) { f.retries.push(id) },
		now: () => f.t,
		log: () => {},
	})
	return f
}

Deno.test("요청 칸: 아는 동작 ID만 요청으로 본다", () => {
	assertEquals(requestOf(rpage("p", { [REQUEST_PROP]: sel("session-record") })), { id: "session-record", ids: ["session-record"] })
	for (const v of ["", STATE_RUNNING, STATE_DONE, STATE_FAILED, "모르는-동작"]) assertEquals(requestOf(rpage("p", { [REQUEST_PROP]: sel(v) })), null, v)
	assertEquals(requestOf(rpage("p", {})), null)
	assert(hasRequestProp(rpage("p", { [REQUEST_PROP]: sel("") })))
	assert(!hasRequestProp(rpage("p", { 이름: {} })))
})

Deno.test("요청 ID가 웹훅 정보에 있으면 웹훅 정보 전부(예전 자동화와 같게), 없으면 그 하나", () => {
	const both = formula("attendance-report-queue,attendance-lesson-notice-queue")
	assertEquals(requestOf(rpage("p", { [REQUEST_PROP]: sel("attendance-report-queue"), "웹훅 정보": both }))!.ids, ["attendance-report-queue", "attendance-lesson-notice-queue"])
	// 수업 날짜 이동은 웹훅 정보가 아니라 웹훅 수업일시를 보냈다 → 그 하나만
	assertEquals(requestOf(rpage("p", { [REQUEST_PROP]: sel("session-date-move"), "웹훅 정보": formula("session-attendance-queue") }))!.ids, ["session-date-move"])
	// 대기가 이미 풀렸으면(웹훅 정보 비어 있음) 요청 ID 하나
	assertEquals(requestOf(rpage("p", { [REQUEST_PROP]: sel("report-send"), "웹훅 정보": formula("") }))!.ids, ["report-send"])
})

Deno.test("모든 동작 ID가 select 옵션 이름으로 쓸 수 있다(쉼표 없음, 100자 안)", () => {
	for (const r of WEBHOOK_ROUTES) assert(!r.id.includes(",") && r.id.length < 100, r.id)
})

Deno.test("처리: 처리 중 → 기존 함수로 넘김(길잡이와 같은 본문 모양) → 완료", async () => {
	const f = fakeReq()
	f.pages.set("p1", rpage("p1", { [REQUEST_PROP]: sel("session-record"), 이름: {} }))
	const out = await handleRequest(f.pages.get("p1"), { id: "session-record", ids: ["session-record"] }, f)
	assertEquals(out.state, STATE_DONE)
	assertEquals(f.patches[0].props[REQUEST_PROP].select.name, STATE_RUNNING)
	assert(text(f.patches[0].props[RESULT_PROP]).includes("학습기록 생성"))
	assertEquals(f.forwards.length, 1)
	assertEquals(f.forwards[0].fn, "create-learning-record")
	assertEquals(f.forwards[0].body.data.id, "p1")
	assertEquals(f.forwards[0].body.data.properties[REQUEST_PROP].select.name, "session-record", "넘기는 본문은 접수 전 페이지")
	assertEquals(f.patches[1].props[REQUEST_PROP].select.name, STATE_DONE)
	assert(text(f.patches[1].props[RESULT_PROP]).startsWith(`${STATE_DONE} · 학습기록 생성 · 1.2초`), text(f.patches[1].props[RESULT_PROP]))
	assertEquals(f.pages.get("p1").properties[REQUEST_PROP].select.name, STATE_DONE)
})

Deno.test("경로가 있는 동작은 그 경로로(쿼리 포함)", async () => {
	const f = fakeReq()
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("reg-link-disable") }))
	await handleRequest(f.pages.get("p"), { id: "reg-link-disable", ids: ["reg-link-disable"] }, f)
	assertEquals(f.forwards[0].fn, "toggle-report-link?action=disable")
})

Deno.test("함수가 4xx로 답하면 실패 + 이유, 다시 넘기지 않음", async () => {
	const f = fakeReq(400, '{"error":"보고서 구분이 비어 있습니다"}')
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("class-report-create") }))
	const out = await handleRequest(f.pages.get("p"), { id: "class-report-create", ids: ["class-report-create"] }, f)
	assertEquals(out.state, STATE_FAILED)
	assertEquals(f.retries, [])
	assertEquals(f.patches[1].props[REQUEST_PROP].select.name, STATE_FAILED)
	assert(text(f.patches[1].props[RESULT_PROP]).includes("보고서 구분이 비어 있습니다"))
})

Deno.test("넘기기 실패(5xx·네트워크)는 다시 넘기기 대기열에 넣고 그 사실을 적는다", async () => {
	const f = fakeReq(503, "")
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("menu-bulk-classes") }))
	const out = await handleRequest(f.pages.get("p"), { id: "menu-bulk-classes", ids: ["menu-bulk-classes"] }, f)
	assertEquals(out.state, STATE_FAILED)
	assertEquals(f.retries, ["menu-bulk-classes"])
	assert(text(f.patches[1].props[RESULT_PROP]).includes("자동으로 다시 넘김"))
})

Deno.test("처리하는 사이 새 요청이 들어오면 요청 칸은 그대로(결과만 씀)", async () => {
	const f = fakeReq()
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("attendance-report-queue") }))
	const orig = f.forward
	f.forward = async (r, b) => { f.pages.get("p").properties[REQUEST_PROP] = sel("attendance-delete"); return await orig(r, b) }
	const out = await handleRequest(f.pages.get("p"), { id: "attendance-report-queue", ids: ["attendance-report-queue"] }, f)
	assert(out.overwritten)
	assertEquals(f.patches[1].props[REQUEST_PROP], undefined)
	assertEquals(f.pages.get("p").properties[REQUEST_PROP].select.name, "attendance-delete")
})

Deno.test("한국 시각", () => {
	assertEquals(kst(Date.UTC(2026, 10, 23, 1, 5, 7)), "11/23 10:05:07")
	assertEquals(kst(Date.UTC(2026, 10, 23, 15, 0, 0)), "11/24 00:00:00")
})

// ---------- 처리기와 함께 ----------
const DS_REQ = "ds-menu-0001", DS_PLAIN = "ds-plain-0001", DS_COPY = "ds-session-0001"
const tmap = buildTargets({ cr_sessions: DS_COPY, cr_attendance: "", cr_records: "", cr_activities: "" } as any, new Map() as any)
function fakeApply(sources: Record<string, boolean | null>) {
	const f: any = { reads: [], handled: [], remembered: [], upserts: [], copy: new Map(), notion: new Map(), n: 0 }
	const deps: Deps = {
		rpc: async () => null,
		targets: async () => tmap,
		readPage: async (id) => { f.n++; f.reads.push(id); return f.notion.get(id) ?? null },
		copyRow: async (_t: Target, id) => f.copy.get(id) ?? null,
		rowsOf: async (_t: Target, p) => [{ id: p.id, v: JSON.stringify(p.properties) }],
		upsert: async (_t: Target, rows) => { for (const r of rows) { f.copy.set(r.id, { ...r, synced_at: new Date(2_000_000).toISOString() }); f.upserts.push(r.id) } },
		removeEverywhere: async () => {},
		calls: () => f.n, now: () => 1_000_000, sleep: async () => {}, log: () => {},
		request: {
			isSource: async (ds) => sources[ds] ?? null,
			remember: async (ds, has) => { f.remembered.push([ds, has]) },
			hasProp: hasRequestProp,
			handle: async (p) => { const r = requestOf(p); if (!r) return null; f.handled.push(r.id); return `${r.id} ${STATE_DONE}` },
		},
	}
	return { f, deps }
}
const qi = (page_id: string, ds: string, extra: Partial<QueueItem> = {}): QueueItem => ({ page_id, data_source_id: ds, event_type: "page.properties_updated", event_time: new Date(1_000_000).toISOString(), own_bot: false, seq: 1, attempts: 0, ...extra })

Deno.test("처리기: 요청 칸 없는 DB(사본도 없음)는 노션을 읽지 않는다", async () => {
	const { f, deps } = fakeApply({ [DS_PLAIN]: false })
	assertEquals((await applyOne(qi("x", DS_PLAIN), deps)).result, "skip:no-copy")
	assertEquals(f.reads, [])
})

Deno.test("처리기: 처음 보는 DB는 한 번 읽고 요청 칸이 있는지 기억", async () => {
	const { f, deps } = fakeApply({})
	f.notion.set("m1", rpage("m1", { [REQUEST_PROP]: sel("menu-bulk-classes") }, DS_REQ))
	assertEquals((await applyOne(qi("m1", DS_REQ), deps)).result, "request:menu-bulk-classes ✅ 완료 no-copy")
	assertEquals(f.remembered, [[DS_REQ, true]])
	f.notion.set("x1", rpage("x1", { 이름: {} }, DS_PLAIN))
	assertEquals((await applyOne(qi("x1", DS_PLAIN), deps)).result, "no-copy")
	assertEquals(f.remembered[1], [DS_PLAIN, false])
})

Deno.test("처리기: 서버가 쓴 처리 중·완료(메아리)는 다시 넘기지 않는다", async () => {
	const { f, deps } = fakeApply({ [DS_REQ]: true })
	for (const s of [STATE_RUNNING, STATE_DONE, STATE_FAILED]) {
		f.notion.set("m1", rpage("m1", { [REQUEST_PROP]: sel(s) }, DS_REQ))
		assertEquals((await applyOne(qi("m1", DS_REQ, { own_bot: true }), deps)).result, "no-copy")
	}
	assertEquals(f.handled, [])
})

Deno.test("처리기: 사본 DB의 요청은 넘기고 사본도 맞춘다, 연동 이벤트여도 사본 시각으로 건너뛰지 않는다", async () => {
	const { f, deps } = fakeApply({ [DS_COPY]: true })
	f.copy.set("s1", { id: "s1", synced_at: new Date(9_000_000).toISOString() }) // 사본이 이벤트보다 새것
	f.notion.set("s1", rpage("s1", { [REQUEST_PROP]: sel("session-record") }, DS_COPY))
	const out = await applyOne(qi("s1", DS_COPY, { own_bot: true }), deps)
	assertEquals(out.result, "request:session-record ✅ 완료 upserted")
	assertEquals(f.handled, ["session-record"])
})

Deno.test("처리기: 요청 칸이 없던 사본 DB는 예전처럼 메아리를 건너뜀", async () => {
	const { f, deps } = fakeApply({ [DS_COPY]: false })
	f.copy.set("s1", { id: "s1", synced_at: new Date(9_000_000).toISOString() })
	assertEquals((await applyOne(qi("s1", DS_COPY, { own_bot: true }), deps)).result, "echo")
	assertEquals(f.reads, [])
})

Deno.test("처리기: 휴지통 줄의 요청은 넘기지 않는다", async () => {
	const { f, deps } = fakeApply({ [DS_REQ]: true })
	f.notion.set("m1", { ...rpage("m1", { [REQUEST_PROP]: sel("menu-bulk-classes") }, DS_REQ), in_trash: true })
	await applyOne(qi("m1", DS_REQ), deps)
	assertEquals(f.handled, [])
})
