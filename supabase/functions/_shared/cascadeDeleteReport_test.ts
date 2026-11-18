// (v2.8.0 항목 93) [삭제] 뒤 그 학생 리포트 다시 만들기. 모든 네트워크는 가짜, 비밀값 없음.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_ATTENDANCE_ID: "attendance", DATA_SOURCE_STUDY_ACTIVITY_ID: "activities", DATA_SOURCE_CLASS_SESSION_ID: "sessions", DATA_SOURCE_LEARNING_RECORD_ID: "records" })) Deno.env.set(key, value)
const assert = (v: unknown, m = "assertion failed") => { if (!v) throw new Error(m) }
const target = await import("./cascadeDeleteTarget.ts")

const rel = (...ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const page = (id: string, db: string, properties: any) => ({ id, parent: { data_source_id: db }, archived: false, properties })
const token = (s: string) => ({ rich_text: s ? [{ plain_text: s }] : [] })

function world() {
	return {
		// 보강 수업 · 그 보강 출석(기존 결석 있음) · 보강 출석에 붙은 학습기록 · 학습활동
		mk: page("mk", "sessions", { 이름: { title: [{ plain_text: "보강" }] }, "수업 구분": { select: { name: "보강" } }, 등록: rel("regA") }),
		mAtt: page("mAtt", "attendance", { 출석: { title: [] }, 수업: rel("mk"), 등록: rel("regA"), "기존 결석": rel("ab") }),
		rec: page("rec", "records", { 학습: { title: [] }, 출석: rel("mAtt"), 등록: rel("regA") }),
		act: page("act", "activities", { 학습활동: { title: [] }, 출석: rel("mAtt"), 등록: rel("regA") }),
		ab: page("ab", "attendance", { 출석: { title: [] }, 등록: rel("regA"), "보강 출석": rel("mAtt") }),
		regA: page("regA", "registrations", { 토큰: token("tok-a") }),
		regB: page("regB", "registrations", { 토큰: token("") }),
	} as Record<string, any>
}

async function withNotion(pages: Record<string, any>, run: () => Promise<void>) {
	const saved = globalThis.fetch
	globalThis.fetch = (async (input: any, init: any = {}) => {
		const url = String(input), body = init.body ? JSON.parse(init.body) : {}
		if (url.startsWith("https://mock.supabase/")) return new Response("[]")
		const db = url.match(/\/data_sources\/([^/]+)\/query/)?.[1]
		if (db) {
			const f = body.filter
			const match = (p: any, c: any): boolean => c.and ? c.and.every((x: any) => match(p, x)) : (p.properties[c.property]?.relation ?? []).some((r: any) => r.id === c.relation?.contains)
			return new Response(JSON.stringify({ results: Object.values(pages).filter((p: any) => p.parent.data_source_id === db && !p.archived && match(p, f)), has_more: false }))
		}
		const id = url.match(/\/pages\/([^/?]+)/)?.[1]!
		if (!pages[id]) return new Response(JSON.stringify({ message: "missing" }), { status: 404 })
		if (init.method === "PATCH") { if (body.archived) pages[id].archived = true; Object.assign(pages[id].properties, body.properties ?? {}) }
		return new Response(JSON.stringify(pages[id]))
	}) as typeof fetch
	const bg: Promise<unknown>[] = []
	;(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { bg.push(p.catch(() => {})) } }
	try { await run(); await Promise.all(bg) } finally { globalThis.fetch = saved; delete (globalThis as any).EdgeRuntime }
}

function spyDeps() {
	const calls: string[] = []
	const orig = { ...target.cascadeReportDeps }
	target.cascadeReportDeps.syncAttendance = async (id: string) => { calls.push("att:" + id); return 0 }
	target.cascadeReportDeps.syncReport = async (id: string) => { calls.push("report:" + id); return null }
	return { calls, restore: () => Object.assign(target.cascadeReportDeps, orig) }
}

Deno.test("보강 출석 [삭제] 큐: 지운 뒤 그 학생(토큰 있는 등록) 출석 사본과 리포트 캐시를 한 번 다시 만든다", async () => {
	const pages = world(), spy = spyDeps()
	try {
		await withNotion(pages, () => target.processCascadeDeleteQueueItem({ pageId: "mAtt" }))
		assert(pages.mAtt.archived && pages.rec.archived && pages.act.archived, "보강 출석·학습기록·학습활동 휴지통")
		assert(spy.calls.join() === "att:regA,report:regA", "한 학생 한 번, 출석 사본 먼저: " + spy.calls.join())
	} finally { spy.restore() }
})

Deno.test("보강 수업 [삭제] 큐: 하위 출석의 학생 리포트도 다시 만든다", async () => {
	const pages = world(), spy = spyDeps()
	try {
		await withNotion(pages, () => target.processCascadeDeleteQueueItem({ pageId: "mk" }))
		assert(pages.mk.archived && pages.mAtt.archived, "수업·출석 휴지통")
		assert(spy.calls.join() === "att:regA,report:regA", spy.calls.join())
	} finally { spy.restore() }
})

Deno.test("refreshReportsAfterDelete: 토큰 없는 등록·지워진 등록은 건너뛰고(새 링크 안 만듦), 실패해도 던지지 않음", async () => {
	const pages = world(), spy = spyDeps()
	pages.regGone = page("regGone", "registrations", { 토큰: token("tok-g") }); pages.regGone.archived = true
	try {
		await withNotion(pages, async () => {
			const log: string[] = []
			const n = await target.refreshReportsAfterDelete(["regB", "regGone", "regA", "regA"], log)
			assert(n === 1 && spy.calls.join() === "att:regA,report:regA", spy.calls.join())
			target.cascadeReportDeps.syncReport = async () => { throw new Error("boom") }
			const n2 = await target.refreshReportsAfterDelete(["regA"], log)
			assert(n2 === 0 && log.some((l) => l.includes("실패")), "failure is logged, not thrown")
		})
	} finally { spy.restore() }
})
