// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_LEARNING_RECORD_ID: "records" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const { attendanceRecordDeps, createLearningRecordForAttendance, NO_INDIVIDUAL_BOOKS, NO_BOOKS_MARKED_TODAY_ATT } = await import("./attendanceLearningRecord.ts")

const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })) })
const sel = (name: string) => ({ type: "select", select: { name } })
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] })
// (261126) 원본 노션의 진행상태는 "상태(status)" 형식 — 실제 꼴로 시험한다.
const stat = (name: string) => ({ type: "status", status: { name } })
const chk = (on: boolean) => ({ type: "checkbox", checkbox: on })
const book = (id: string, mode: string, status: string, today = true) => ({ id, properties: { 진도교재: title(id), 진도방식: sel(mode), 진행상태: stat(status), "오늘 학습": chk(today) } })

// update는 페이지 값을 실제로 바꾼다(다시 누를 때 체크가 꺼져 있게).
function fake(pages: Record<string, any>) {
	const created: any[] = [], updates: any[] = []
	const saved = { ...attendanceRecordDeps }
	Object.assign(attendanceRecordDeps, {
		getPage: async (id: string) => pages[id] ?? { id, properties: {} },
		update: async (id: string, props: any) => { updates.push({ id, props }); if (pages[id]) pages[id] = { ...pages[id], properties: { ...pages[id].properties, "오늘 학습": chk(props["오늘 학습"].checkbox) } } },
		createPage: async (_ds: string, props: any) => { created.push(props); return { id: `rec${created.length}` } },
		countRecords: async () => 0,
	})
	return { created, updates, restore: () => Object.assign(attendanceRecordDeps, saved) }
}

const att = (id: string, reg: string) => ({ id, properties: { 등록: rel(reg), 수업: rel("S1"), 수업일시: { type: "date", date: { start: "2026-11-26" } } } })
const world = (): Record<string, any> => ({
	A1: att("A1", "R1"), A2: att("A2", "R2"),
	R1: { id: "R1", properties: { 진도교재: rel("B1", "B2", "BG", "BX") } },
	R2: { id: "R2", properties: { 진도교재: rel("B3") } },
	B1: book("B1", "개별 진도", "진행 중"), B2: book("B2", "개별 진도", "진행 중"),
	BG: book("BG", "그룹 진도", "진행 중"), BX: book("BX", "개별 진도", "완료"),
	B3: book("B3", "개별 진도", "진행 중"),
})

Deno.test("출석 학습기록: 오늘 학습 체크한 개별 교재 2권 → 2개, 체크 꺼짐, 다시(체크 없음) → 0개 + 안내", async () => {
	const w = world()
	const f = fake(w)
	try {
		const r = await createLearningRecordForAttendance("A1")
		eq(f.created.map((p) => p["진도교재"].relation[0].id), ["B1", "B2"])
		eq(f.created[0]["출석"].relation, [{ id: "A1" }])
		eq(f.created[0]["구분"], { select: { name: "학습" } })
		eq(f.updates.map((u) => u.id), ["B1", "B2"])
		eq(r.created.length, 2)
		const again = await createLearningRecordForAttendance("A1")
		eq(again.ok, false); eq(again.message, NO_BOOKS_MARKED_TODAY_ATT); eq(f.created.length, 2)
	} finally { f.restore() }
})

Deno.test("출석 학습기록: 다시 체크하면 같은 교재로 또 만든다(과제·평가용, 수업 버튼과 같음)", async () => {
	const w = world()
	const f = fake(w)
	try {
		await createLearningRecordForAttendance("A1")
		w.B1 = { ...w.B1, properties: { ...w.B1.properties, "오늘 학습": chk(true) } }
		const r = await createLearningRecordForAttendance("A1")
		eq(r.created.length, 1); eq(f.created.length, 3)
	} finally { f.restore() }
})

Deno.test("출석 학습기록: 체크한 교재만(B2), 그룹 교재만 있으면 안내", async () => {
	const w = world(); w.B1 = book("B1", "개별 진도", "진행 중", false)
	const f = fake(w)
	try {
		const r = await createLearningRecordForAttendance("A1")
		eq(r.created.length, 1); eq(f.created[0]["진도교재"].relation[0].id, "B2")
	} finally { f.restore() }
	const g = world(); g.R1 = { id: "R1", properties: { 진도교재: rel("BG") } }
	const f2 = fake(g)
	try {
		const r = await createLearningRecordForAttendance("A1")
		eq(r.ok, false); eq(r.message, NO_INDIVIDUAL_BOOKS); eq(f2.created.length, 0)
	} finally { f2.restore() }
})

Deno.test("출석 학습기록: 같은 수업 다른 학생(A2) 교재는 A1을 눌러도 안 만들어짐", async () => {
	const f = fake(world())
	try {
		await createLearningRecordForAttendance("A1")
		eq(f.created.some((p) => p["진도교재"].relation[0].id === "B3"), false)
	} finally { f.restore() }
})
