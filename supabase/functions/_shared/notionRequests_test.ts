import { assert, assertEquals } from "jsr:@std/assert@1"
import { handleRequest, kst, requestOf, hasRequestProp, sweepStaleRequests, REQUEST_PROP, RESULT_PROP, STATE_DONE, STATE_FAILED, STATE_RUNNING, type RequestDeps } from "./notionRequests.ts"
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
	assert(text(f.patches[1].props[RESULT_PROP]).includes("자동으로 다시 넘기"))
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

// (261123 출시 전 2번) 처리 중을 쓴 뒤 다시 읽기·마지막 쓰기가 실패해도 처리 중에 멈추지 않는다.
Deno.test("출시 전 2번: 다시 읽기가 실패해도 요청 칸을 결과로 마무리한다", async () => {
	const f = fakeReq()
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("session-record") }))
	f.readPage = async () => { throw new Error("노션 줄 읽기 실패: 502") }
	const out = await handleRequest(f.pages.get("p"), { id: "session-record", ids: ["session-record"] }, f)
	assertEquals(out.state, STATE_DONE)
	assertEquals(f.pages.get("p").properties[REQUEST_PROP].select.name, STATE_DONE, "처리 중에 남지 않음")
})

Deno.test("출시 전 2번: 마지막 쓰기가 한 번 실패하면 요청 칸만 다시 써서 처리 중을 끝낸다", async () => {
	const f = fakeReq()
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("session-record") }))
	const orig = f.patch
	let n = 0
	f.patch = async (id, props) => { n++; if (n === 2) throw new Error("요청 칸 쓰기 실패: 504"); return await orig(id, props) }
	const out = await handleRequest(f.pages.get("p"), { id: "session-record", ids: ["session-record"] }, f)
	assertEquals(out.state, STATE_DONE)
	assertEquals(f.pages.get("p").properties[REQUEST_PROP].select.name, STATE_DONE)
})

Deno.test("출시 전 2번: 넘기는 길이 예외를 던져도 처리 중에 멈추지 않고 실패로 끝난다", async () => {
	const f = fakeReq()
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("session-record") }))
	f.forward = async () => { throw new Error("connection reset") }
	const out = await handleRequest(f.pages.get("p"), { id: "session-record", ids: ["session-record"] }, f)
	assertEquals(out.state, STATE_FAILED)
	assertEquals(f.pages.get("p").properties[REQUEST_PROP].select.name, STATE_FAILED)
})

Deno.test("출시 전 2번 감시: 요청 칸 DB에서 15분 넘게 처리 중인 줄만 ⚠️ 실패로", async () => {
	const now = Date.UTC(2026, 10, 23, 5, 0, 0)
	const queries: { ds: string; filter: any }[] = [], patched: { id: string; props: any }[] = []
	const out = await sweepStaleRequests({
		sources: async () => ["dsa", "dsb"],
		query: async (ds, filter) => { queries.push({ ds, filter }); return ds === "dsa" ? [{ id: "old1" }] : [] },
		patch: async (id, props) => { patched.push({ id, props }) },
		now: () => now,
		log: () => {},
	}, 15)
	assertEquals(out, { recovered: 1, ids: ["old1"], sources: 2 })
	assertEquals(queries.length, 2)
	const f = queries[0].filter.and
	assertEquals(f[0], { property: REQUEST_PROP, select: { equals: STATE_RUNNING } })
	assertEquals(f[1], { timestamp: "last_edited_time", last_edited_time: { before: new Date(now - 15 * 60000).toISOString() } })
	assertEquals(patched[0].props[REQUEST_PROP].select.name, STATE_FAILED)
	assert(text(patched[0].props[RESULT_PROP]).includes("다시 눌러"), text(patched[0].props[RESULT_PROP]))
})

Deno.test("출시 전 2번 감시: 한 DB가 실패해도 나머지는 계속", async () => {
	const patched: string[] = []
	const out = await sweepStaleRequests({
		sources: async () => ["bad", "ok"],
		query: async (ds) => { if (ds === "bad") throw new Error("400 요청 칸 없음"); return [{ id: "x" }] },
		patch: async (id) => { patched.push(id) },
		now: () => Date.UTC(2026, 10, 23),
		log: () => {},
	})
	assertEquals(patched, ["x"])
	assertEquals(out.recovered, 1)
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

// ---------- (261123) 실패 이유를 읽을 말로 · 성공 안내 · 구독 끊김 대조 ----------
import { cleanReason, readableReason } from "./notionRequests.ts"
import { stableJson, watchItems, watchPoll, MissingWatch, type WatchItem } from "./notionSubscriptionWatch.ts"
import { healthFrom, subscriptionState } from "./notionSubscriptionStatus.ts"

const RAW_CACHE = "report_cache에 registration_id=00000000-0000-4000-8000-000000000001 행이 없어 링크 상태를 갱신하지 못했습니다. sync-report-cache로 먼저 캐시를 생성한 뒤 다시 시도하세요."
const unreadable = (s: string) => /[0-9a-f]{8}-[0-9a-f]{4}|report_cache|sync-|registration_id|HTTP|Error/.test(s)

Deno.test("읽을 말: 이유 원문 3종 이상 — 내부 id · 함수 · 표 이름 · 영문 오류가 남지 않는다", () => {
	const cases: [number, string, boolean][] = [
		[500, RAW_CACHE, true],
		[401, '인증 실패', false],
		[0, "The signal has been aborted", true],
		[503, "", true],
		[400, "보고서 구분이 비어 있습니다 (page 00000000000040008000000000000001)", false],
		[400, "body failed validation: body.properties.이름.title should be defined", false],
		[422, "Something went wrong", false],
		[404, "Not Found", false],
		[409, "이미 처리 중입니다 (lock generate_classes)", false],
	]
	for (const [st, raw, retry] of cases) {
		const say = readableReason(st, raw, retry)
		assert(!unreadable(say), `${raw} → ${say}`)
		assert(/[가-힣]/.test(say), say)
	}
	assert(readableReason(500, RAW_CACHE, true).includes("[학생 페이지 동기화]"))
	assert(readableReason(503, "", true).includes("자동으로 다시 넘기"))
	assertEquals(readableReason(500, "대시보드 날짜가 비어 있습니다 (page 00000000000040008000000000000001)", true),
		"대시보드 날짜가 비어 있습니다 — 서버가 자동으로 다시 넘기고 있어요(최대 3번). 10분 뒤에도 실패면 다시 누르고, 계속되면 관리자에게 알려 주세요")
	assertEquals(readableReason(500, "TypeError: Cannot read properties of undefined", false), "서버가 잠깐 처리하지 못했어요. 1~2분 뒤 다시 눌러 주세요")
	assertEquals(readableReason(400, "보고서 구분이 비어 있습니다 (page 00000000000040008000000000000001)", false), "보고서 구분이 비어 있습니다")
	assert(readableReason(422, "Something went wrong", false).includes("관리자에게"))
	assertEquals(cleanReason("연락처가 없습니다: student_phone (HTTP 400)"), "연락처가 없습니다")
})

Deno.test("실패 칸: 동작 이름 — 읽을 말, 원문은 서버 기록에만", async () => {
	const f = fakeReq(400, '{"error":"수업일시가 비어 있습니다. registration_id=00000000-0000-4000-8000-000000000001"}')
	const logs: string[] = []; f.log = (m) => logs.push(m)
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("class-report-create") }))
	await handleRequest(f.pages.get("p"), { id: "class-report-create", ids: ["class-report-create"] }, f)
	const t = text(f.patches[1].props[RESULT_PROP])
	assert(t.startsWith(`${STATE_FAILED} · 보고서 생성 — 수업일시가 비어 있습니다`), t)
	assert(!unreadable(t), t)
	assert(logs.some((l) => l.includes("registration_id=")), "원문은 기록에")
})

Deno.test("성공 안내(note)는 완료 뒤에 붙는다 — 리포트 없는 등록의 링크 재발급", async () => {
	const f = fakeReq(200, '{"ok":true,"note":"학부모 리포트가 아직 없어 노션에 새 링크만 적었어요","cache":"none"}')
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("reg-link-regenerate") }))
	const out = await handleRequest(f.pages.get("p"), { id: "reg-link-regenerate", ids: ["reg-link-regenerate"] }, f)
	assertEquals(out.state, STATE_DONE)
	assert(text(f.patches[1].props[RESULT_PROP]).endsWith("· 학부모 리포트가 아직 없어 노션에 새 링크만 적었어요"))
})

Deno.test("대조: 키 순서가 달라도 같은 값", () => {
	assertEquals(stableJson({ b: 1, a: [{ y: 2, x: null }] }), stableJson({ a: [{ x: null, y: 2 }], b: 1 }))
})

Deno.test("대조: 사본과 값이 다르고 2분 지난 줄만 — 같은 값(웹훅이 먼저 맞춤 · 본문만 고침)과 방금 고친 줄은 빼고", () => {
	const now = Date.parse("2026-11-23T03:20:00Z")
	const row = (id: string, v: string, at: string) => ({ id, props: { 이름: v }, notion_edited_at: at })
	const rows = [row("a", "새 값", "2026-11-23T03:10:00Z"), row("b", "같음", "2026-11-23T03:10:00Z"), row("c", "새 값", "2026-11-23T03:19:00Z"), row("d", "새 줄", "2026-11-23T03:12:00Z")]
	const pages = [rpage("a", { [REQUEST_PROP]: sel("reg-report-sync") }, "ds-1"), rpage("b", {}), rpage("c", {}), rpage("d", {}, "ds-2")]
	const items = watchItems(rows, pages, [{ id: "a", props: { 이름: "옛 값" } }, { id: "b", props: { 이름: "같음" } }, { id: "c", props: { 이름: "옛 값" } }], now)
	assertEquals(items, [
		{ page_id: "a", edited_at: "2026-11-23T03:10:00.000Z", ds: "ds-1", request: true },
		{ page_id: "d", edited_at: "2026-11-23T03:12:00.000Z", ds: "ds-2", request: false },
	])
})

Deno.test("대조: 서버 함수가 없으면 건너뜀, 사본을 못 읽은 DB는 빼고 보냄", async () => {
	const now = Date.parse("2026-11-23T03:20:00Z")
	const sent: WatchItem[][] = []
	const deps = { existing: async () => [], now: () => now, report: async (items: WatchItem[]) => { sent.push(items); return { state: "ok", missed: 0, total: 0, queued: 0 } } }
	const r1 = [{ id: "a", props: { x: 1 }, notion_edited_at: "2026-11-23T03:00:00Z" }]
	await watchPoll([{ rows: r1, pages: [], existing: [] }, { rows: r1, pages: [], existing: null }], deps)
	assertEquals(sent[0].length, 1)
	const skipped = await watchPoll([], { ...deps, report: async () => { throw new MissingWatch() } })
	assertEquals(skipped, { skipped: "표 없음" })
})

Deno.test("구독 상태: 끊김 감지가 down이면 이벤트가 있었어도 down", () => {
	const base = { tables: true, tokenAt: "t", lastEventAt: "e", lastEventType: null, events24h: 1, rejectedAt: null, pending: 0, failed: 0 }
	const h = healthFrom({ state: "down", since: "2026-11-23T03:00:00Z", reason: "놓침", missed: "2", poll_min: 5, simulate_until: "2026-11-23T04:00:00Z" }, Date.parse("2026-11-23T03:30:00Z"))!
	assertEquals(h.missed, 2); assertEquals(h.pollMin, 5); assert(h.simulating)
	assertEquals(subscriptionState({ ...base, health: h }), "down")
	assertEquals(subscriptionState({ ...base, health: { ...h, state: "ok" } }), "on")
	assertEquals(subscriptionState({ ...base, health: null }), "on")
	assertEquals(healthFrom(undefined), null)
})

// ---------- (261123 원본 실측) 바로 답한 함수가 줄을 ⚠️ 오류로 끝내면 요청도 실패 ----------
import { rowErrorOf } from "./notionRequests.ts"
const txt = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s, text: { content: s } }] : [] })
const dt = (iso: string | null) => ({ type: "date", date: iso ? { start: iso } : null })

Deno.test("줄 오류: 시험 기간 연결이 200으로 답하고 줄을 ⚠️ 오류로 끝내면 ⚠️ 실패 + 마지막 오류", async () => {
	const f = fakeReq(200, '{"pageId":"p","ok":false}')
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("exam-period-link"), 상태: sel(""), "마지막 오류": txt("") }))
	const orig = f.forward
	f.forward = async (r, b) => { Object.assign(f.pages.get("p").properties, { 상태: sel("⚠️ 오류"), "마지막 오류": txt("학교와 시험을 먼저 고르세요.") }); return await orig(r, b) }
	const out = await handleRequest(structuredClone(f.pages.get("p")), { id: "exam-period-link", ids: ["exam-period-link"] }, f)
	assertEquals(out.state, STATE_FAILED)
	assertEquals(f.pages.get("p").properties[REQUEST_PROP].select.name, STATE_FAILED)
	assert(text(f.patches[1].props[RESULT_PROP]).startsWith(`${STATE_FAILED} · 시험 기간 연결 — 학교와 시험을 먼저 고르세요.`), text(f.patches[1].props[RESULT_PROP]))
})

Deno.test("줄 오류: 큐에 넣고 202로 답한 함수는 아직 결과 전이라 완료(접수)", async () => {
	const f = fakeReq(202)
	f.pages.set("p", rpage("p", { [REQUEST_PROP]: sel("class-report-create"), 상태: sel("⚠️ 오류"), "마지막 오류": txt("옛 오류") }))
	const out = await handleRequest(structuredClone(f.pages.get("p")), { id: "class-report-create", ids: ["class-report-create"] }, f)
	assertEquals(out.state, STATE_DONE)
})

Deno.test("줄 오류: 이번 요청 전부터 있던 같은 ⚠️ 오류는 보지 않고, 처리 시작 시각이 접수 뒤면 봄", () => {
	const t0 = Date.parse("2026-11-23T03:38:20Z")
	const before = rpage("p", { 상태: sel("⚠️ 오류"), "마지막 오류": txt("보고서 구분이 비어 있습니다"), "처리 시작 시각": dt("2026-11-22T01:00:00Z") })
	assertEquals(rowErrorOf(structuredClone(before), before, t0), "", "옛 오류 그대로")
	const rerun = structuredClone(before); rerun.properties["처리 시작 시각"] = dt("2026-11-23T03:38:00.000Z")
	assertEquals(rowErrorOf(rerun, before, t0), "보고서 구분이 비어 있습니다", "같은 오류라도 이번에 다시 돎")
	const changed = structuredClone(before); changed.properties["마지막 오류"] = txt("시간표가 없습니다 (page 00000000000040008000000000000001)")
	assertEquals(rowErrorOf(changed, before, t0), "시간표가 없습니다")
	assertEquals(rowErrorOf(rpage("p", { 상태: sel("✅ 완료") }), null, t0), "")
	assertEquals(rowErrorOf(rpage("p", { 상태: sel("⚠️ 오류"), "마지막 오류": txt("Error: x_y") }), null, t0), "줄의 [마지막 오류]를 보고 고친 뒤 다시 눌러 주세요")
})
