// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_LEARNING_RECORD_ID: "records" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const { attendanceRecordDeps, createLearningRecordForAttendance, NO_INDIVIDUAL_BOOKS } = await import("./attendanceLearningRecord.ts")

const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })) })
const sel = (name: string) => ({ type: "select", select: { name } })
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] })
const book = (id: string, mode: string, status: string, lib?: string) => ({ id, properties: { 진도교재: title(id), 진도방식: sel(mode), 진행상태: sel(status), ...(lib ? { 라이브러리: rel(lib) } : {}) } })

function fake(pages: Record<string, any>, existing: Set<string> = new Set()) {
	const created: any[] = []
	const saved = { ...attendanceRecordDeps }
	Object.assign(attendanceRecordDeps, {
		getPage: async (id: string) => pages[id] ?? { id, properties: {} },
		createPage: async (_ds: string, props: any) => { created.push(props); existing.add(`${props["출석"].relation[0].id}|${props["진도교재"].relation[0].id}`); return { id: `rec${created.length}` } },
		countRecords: async (a: string, b: string) => (existing.has(`${a}|${b}`) ? 1 : 0),
	})
	return { created, restore: () => Object.assign(attendanceRecordDeps, saved) }
}

const att = (id: string, reg: string) => ({ id, properties: { 등록: rel(reg), 수업: rel("S1"), 수업일시: { type: "date", date: { start: "2026-11-26" } } } })
const world = () => ({
	A1: att("A1", "R1"), A2: att("A2", "R2"),
	R1: { id: "R1", properties: { 진도교재: rel("B1", "B2", "BG", "BX") } },
	R2: { id: "R2", properties: { 진도교재: rel("B3") } },
	B1: book("B1", "개별 진도", "진행 중"), B2: book("B2", "개별 진도", "진행 중"),
	BG: book("BG", "그룹 진도", "진행 중"), BX: book("BX", "개별 진도", "완료"),
	B3: book("B3", "개별 진도", "진행 중"),
})

Deno.test("출석 학습기록: 개별 교재 2권 → 2개(그룹·완료 교재·다른 학생 교재는 안 만듦), 다시 → 0개", async () => {
	const { created, restore } = fake(world())
	try {
		const r = await createLearningRecordForAttendance("A1")
		eq(r.created.length, 2)
		eq(created.map((p) => p["진도교재"].relation[0].id), ["B1", "B2"])
		eq(created[0]["출석"].relation, [{ id: "A1" }])
		eq(created[0]["등록"].relation, [{ id: "R1" }])
		eq(created[0]["수업"].relation, [{ id: "S1" }])
		const again = await createLearningRecordForAttendance("A1")
		eq(again.created.length, 0)
		eq(again.skipped.length, 2)
		eq(created.length, 2)
	} finally { restore() }
})

Deno.test("출석 학습기록: 그룹 교재만 있으면 0개 + 안내", async () => {
	const w = world(); w.R1 = { id: "R1", properties: { 진도교재: rel("BG") } }
	const { created, restore } = fake(w)
	try {
		const r = await createLearningRecordForAttendance("A1")
		eq(r.ok, false); eq(r.message, NO_INDIVIDUAL_BOOKS); eq(created.length, 0)
	} finally { restore() }
})

Deno.test("출석 학습기록: 같은 수업 다른 학생(A2)은 자기 출석 것만, A1을 눌러도 안 만들어짐", async () => {
	const { created, restore } = fake(world())
	try {
		await createLearningRecordForAttendance("A1")
		eq(created.some((p) => p["출석"].relation[0].id === "A2" || p["진도교재"].relation[0].id === "B3"), false)
	} finally { restore() }
})
