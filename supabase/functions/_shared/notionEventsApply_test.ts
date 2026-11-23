import { assert, assertEquals } from "jsr:@std/assert@1"
import { applyOne, buildTargets, drainEvents, targetsFromJson, targetsToJson, eventDataSource, ownBotOnly, retryDelaySec, sameRow, type Deps, type QueueItem, type Target } from "./notionEventsApply.ts"

// 시험 값만(실제 노션 id 아님)
const BOT = "bot-0000-1111"
const DS_STUDENT = "ds-student-0001", DS_SESSION = "ds-session-0001", DS_OTHER = "ds-other-0001"
const map = buildTargets({ cr_sessions: DS_SESSION, cr_attendance: "", cr_records: "", cr_activities: "" } as any, new Map([["학생(학원) DB", [DS_STUDENT]]]) as any)

type Fake = Deps & { notion: Map<string, any>; copy: Map<string, any>; reads: string[]; upserts: string[]; removed: string[]; queue: Map<string, any>; finished: any[]; t: number; n: number; sleeps: number[] }
function fake(): Fake {
	const f: any = {
		notion: new Map(), copy: new Map(), reads: [], upserts: [], removed: [], queue: new Map(), finished: [], t: 1_000_000, n: 0, sleeps: [],
	}
	let leaseOwner: string | null = null
	Object.assign(f, {
		async rpc(name: string, a: any) {
			if (name === "notion_event_claim") {
				if (leaseOwner && leaseOwner !== a.p_owner) return { lease: false, items: [] }
				leaseOwner = a.p_owner
				return { lease: true, items: [...f.queue.values()].filter((q: any) => q.status === "pending").slice(0, a.p_limit) }
			}
			if (name === "notion_event_finish") {
				const q = f.queue.get(a.p_page_id)
				f.finished.push(a)
				if (!q || q.seq !== a.p_seq) return "superseded"
				q.status = a.p_ok ? "done" : (q.attempts + 1 >= 6 ? "failed" : "retry")
				q.attempts += a.p_ok ? 0 : 1
				return q.status
			}
			if (name === "notion_event_release") { if (leaseOwner === a.p_owner) leaseOwner = null; return null }
			if (name === "notion_event_due_count") return [...f.queue.values()].filter((q: any) => q.status === "pending").length
			throw new Error("모르는 rpc " + name)
		},
		holdLease(o: string) { leaseOwner = o },
		targets: async () => map,
		async readPage(id: string) { f.n++; f.t += 150; f.reads.push(id); return f.notion.get(id) ?? null },
		async copyRow(_t: Target, id: string) { return f.copy.get(id) ?? null },
		async rowsOf(t: Target, p: any) { return [{ id: p.id, db: t.kind === "app" ? t.db : t.table, name: p.name, synced_at: "x" }] },
		async upsert(_t: Target, rows: any[]) { for (const r of rows) { f.copy.set(r.id, { ...r, synced_at: new Date(f.t).toISOString() }); f.upserts.push(r.id) } },
		async removeEverywhere(id: string) { f.copy.delete(id); f.removed.push(id) },
		calls: () => f.n, now: () => f.t, sleep: async (ms: number) => { f.sleeps.push(ms); f.t += ms }, log: () => {},
	})
	return f
}
const item = (page_id: string, event_type: string, extra: Partial<QueueItem> = {}): QueueItem => ({
	page_id, data_source_id: DS_STUDENT, event_type, event_time: new Date(1_000_000).toISOString(), own_bot: false, seq: 1, attempts: 0, ...extra,
})
const page = (id: string, name: string, ds = DS_STUDENT, extra: any = {}) => ({ id, name, parent: { type: "data_source_id", data_source_id: ds }, ...extra })

Deno.test("작성자가 모두 이 학원 연동일 때만 메아리 후보", () => {
	assert(ownBotOnly([{ id: BOT, type: "bot" }], BOT))
	assert(ownBotOnly([{ id: BOT.replace(/-/g, ""), type: "bot" }], BOT), "하이픈 없는 id도 같은 연동")
	assert(!ownBotOnly([{ id: BOT, type: "bot" }, { id: "u1", type: "person" }], BOT), "사람이 섞이면 아님")
	assert(!ownBotOnly([{ id: "other-bot", type: "bot" }], BOT), "다른 연동(자동화 · 다른 도구)은 아님")
	assert(!ownBotOnly([], BOT)); assert(!ownBotOnly([{ id: BOT, type: "bot" }], null))
})

Deno.test("이벤트 본문에서 데이터 소스 id", () => {
	assertEquals(eventDataSource({ parent: { id: "db-1", type: "database", data_source_id: "ds-1" } }), "ds-1")
	assertEquals(eventDataSource({ parent: { id: "ds-2", type: "data_source" } }), "ds-2")
	assertEquals(eventDataSource({ parent: { id: "p-1", type: "page" } }), null)
	assertEquals(eventDataSource(null), null)
})

Deno.test("다시 시도 간격은 30초부터 두 배, 10분까지", () => {
	assertEquals([0, 1, 2, 3, 4, 5, 9].map(retryDelaySec), [30, 60, 120, 240, 480, 600, 600])
})

Deno.test("같은 값 비교: 동기화 시각은 빼고, 같은 순간의 시각 글자는 같다고 본다", () => {
	assert(sameRow({ id: "a", v: [1, { b: 2, a: 1 }], at: "2026-11-23T01:00:00+00:00", synced_at: "old" }, { id: "a", v: [1, { a: 1, b: 2 }], at: "2026-11-23T01:00:00.000Z", synced_at: "new" }))
	assert(!sameRow({ id: "a", arrived_at: "2026-11-23T01:00:00+00:00" }, { id: "a", arrived_at: "2026-11-23T01:05:00.000Z" }), "등원 시각만 바뀌어도 다름")
	assert(!sameRow(null, { id: "a" }))
})

Deno.test("만들기 · 고침 → 다시 읽어 넣기, 같은 값이면 쓰지 않음", async () => {
	const f = fake()
	f.notion.set("p1", page("p1", "예시 학생"))
	assertEquals((await applyOne(item("p1", "page.created"), f)).result, "upserted")
	assertEquals(f.copy.get("p1").name, "예시 학생")
	assertEquals((await applyOne(item("p1", "page.properties_updated"), f)).result, "same")
	assertEquals(f.upserts.length, 1)
	f.notion.set("p1", page("p1", "예시 학생2"))
	assertEquals((await applyOne(item("p1", "page.properties_updated"), f)).result, "upserted")
	assertEquals(f.copy.get("p1").name, "예시 학생2")
})

Deno.test("지움(휴지통 · 404) → 사본에서 지움, 되살림 → 다시 넣기", async () => {
	const f = fake()
	f.notion.set("p1", page("p1", "예시"))
	await applyOne(item("p1", "page.created"), f)
	f.notion.set("p1", page("p1", "예시", DS_STUDENT, { in_trash: true }))
	assertEquals((await applyOne(item("p1", "page.deleted"), f)).result, "deleted")
	assert(!f.copy.has("p1"))
	f.notion.set("p1", page("p1", "예시"))
	assertEquals((await applyOne(item("p1", "page.undeleted"), f)).result, "upserted")
	assert(f.copy.has("p1"))
	f.notion.delete("p1")
	assertEquals((await applyOne(item("p1", "page.deleted"), f)).result, "deleted", "영구 삭제(404)도 지움")
})

Deno.test("순서가 뒤바뀌어도 사본 = 노션 지금 값(늦게 온 지움 이벤트가 되살린 줄을 지우지 않음)", async () => {
	const f = fake()
	f.notion.set("p1", page("p1", "되살린 값")) // 노션 지금: 살아 있음
	await applyOne(item("p1", "page.undeleted"), f)
	assertEquals((await applyOne(item("p1", "page.deleted"), f)).result, "same", "앞서 일어난 지움 이벤트가 나중에 와도 다시 읽으면 살아 있음")
	assert(f.copy.has("p1"))
})

Deno.test("사본에 없는 DB · 본문만 바뀜은 노션을 읽지 않음", async () => {
	const f = fake()
	assertEquals((await applyOne(item("x", "page.properties_updated", { data_source_id: DS_OTHER }), f)).result, "skip:no-copy")
	assertEquals((await applyOne(item("x", "page.content_updated"), f)).result, "skip:event")
	assertEquals(f.reads.length, 0)
})

Deno.test("메아리: 이 학원 연동이 쓰고 사본이 이미 그 뒤에 고쳐졌으면 노션을 읽지 않음", async () => {
	const f = fake()
	f.copy.set("p1", { id: "p1", name: "앱 저장 값", synced_at: new Date(1_000_500).toISOString() })
	f.notion.set("p1", page("p1", "앱 저장 값"))
	assertEquals((await applyOne(item("p1", "page.properties_updated", { own_bot: true }), f)).result, "echo")
	assertEquals(f.reads.length, 0)
	// 사본이 이벤트보다 오래됐으면(다른 함수가 노션만 고침) 다시 읽는다
	f.copy.set("p1", { id: "p1", name: "옛 값", synced_at: new Date(999_000).toISOString() })
	assertEquals((await applyOne(item("p1", "page.properties_updated", { own_bot: true }), f)).result, "upserted")
	// 사람이 쓴 이벤트는 사본이 새것이어도 다시 읽는다
	f.copy.set("p1", { id: "p1", name: "앱 저장 값", synced_at: new Date(2_000_000).toISOString() })
	f.reads.length = 0
	await applyOne(item("p1", "page.properties_updated", { own_bot: false }), f)
	assertEquals(f.reads.length, 1)
	// 앱이 지우면서 사본도 뺀 줄의 지움 메아리
	f.copy.delete("p1")
	assertEquals((await applyOne(item("p1", "page.deleted", { own_bot: true }), f)).result, "echo")
})

Deno.test("옮김: 사본 DB 밖으로 가면 지우고, 다른 사본 DB로 가면 옛 표에서 빼고 새 표에 넣음", async () => {
	const f = fake()
	f.notion.set("p1", page("p1", "예시", DS_OTHER))
	assertEquals((await applyOne(item("p1", "page.moved"), f)).result, "moved-out")
	f.notion.set("p2", page("p2", "예시", DS_SESSION))
	const r = await applyOne(item("p2", "page.moved"), f)
	assertEquals(r, { result: "upserted", target: "cr_sessions" })
	assert(f.removed.includes("p2"))
})

Deno.test("처리기: 노션 부른 횟수 × 400ms보다 빨리 다음 줄로 가지 않음(초당 2.5회 이하)", async () => {
	const f = fake()
	for (let i = 0; i < 8; i++) { f.notion.set(`p${i}`, page(`p${i}`, `예시${i}`)); f.queue.set(`p${i}`, { ...item(`p${i}`, "page.created"), status: "pending" }) }
	const out = await drainEvents(f, "w1")
	assertEquals(out.processed, 8)
	assertEquals(out.notionCalls, 8)
	assert(out.ms >= 7 * 400, `8번 부르는 데 ${out.ms}ms`)
	assert(out.perSec <= 2.5 + 1e-9, `초당 ${out.perSec}번`)
	assertEquals([...f.queue.values()].every((q: any) => q.status === "done"), true)
})

Deno.test("처리기: 다른 처리기가 임대 중이면 바로 끝남(동시에 둘이 노션을 읽지 않음)", async () => {
	const f = fake() as any
	f.queue.set("p1", { ...item("p1", "page.created"), status: "pending" })
	f.holdLease("other")
	const out = await drainEvents(f, "w2")
	assertEquals(out.lease, false); assertEquals(out.processed, 0); assertEquals(f.reads.length, 0)
})

Deno.test("처리기: 실패는 retry로 남고 다음 간격이 붙음", async () => {
	const f = fake()
	f.queue.set("p1", { ...item("p1", "page.created"), status: "pending" })
	f.readPage = async () => { throw new Error("노션 줄 읽기 실패: 502") }
	const out = await drainEvents(f, "w3")
	assertEquals(out.results, { "error→retry": 1 })
	assertEquals(f.finished[0].p_ok, false); assertEquals(f.finished[0].p_retry_sec, 30)
	assertEquals(f.queue.get("p1").status, "retry")
})

Deno.test("찾은 목록은 JSON으로 저장했다가 그대로 되살린다", () => {
	const back = targetsFromJson(JSON.parse(JSON.stringify(targetsToJson(map))))
	assertEquals([...back.entries()], [...map.entries()])
	assertEquals(targetsFromJson(null).size, 0)
})

Deno.test("모르는 데이터 소스면 목록이 오래됐을 때만 다시 찾아 본다", async () => {
	const f = fake()
	const NEW_DS = "ds-new-0001"
	f.notion.set("p1", page("p1", "새 DB 줄", NEW_DS))
	let asked = 0
	f.targetsFresh = async () => { asked++; return null }
	assertEquals((await applyOne(item("p1", "page.created", { data_source_id: NEW_DS }), f)).result, "skip:no-copy")
	assertEquals(asked, 1)
	const grown = new Map(map); grown.set(NEW_DS.replace(/-/g, ""), { kind: "app", db: "과목(학원) DB" as any })
	f.targetsFresh = async () => { asked++; return grown }
	assertEquals((await applyOne(item("p1", "page.created", { data_source_id: NEW_DS }), f)).result, "upserted")
	assertEquals((await applyOne(item("p1", "page.content_updated", { data_source_id: NEW_DS }), f)).result, "skip:event")
	assertEquals(asked, 2, "본문만 바뀐 이벤트는 목록도 보지 않음")
})
