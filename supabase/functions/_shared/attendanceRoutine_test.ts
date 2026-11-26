// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const { attendanceRoutineDeps, createRoutineChecksForAttendance, NO_ROUTINES } = await import("./attendanceRoutine.ts")

const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })) })
const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] })
const cb = (v: boolean) => ({ type: "checkbox", checkbox: v })

function fake(pages: Record<string, any>, existing: Set<string> = new Set()) {
	const created: any[] = []
	const saved = { ...attendanceRoutineDeps }
	Object.assign(attendanceRoutineDeps, {
		getPage: async (id: string) => pages[id] ?? { id, properties: {} },
		fullRelationIds: async (page: any, prop: string) => (page.properties?.[prop]?.relation ?? []).map((r: any) => r.id),
		checkDs: async () => "checkds",
		createPage: async (_ds: string, props: any) => { created.push(props); existing.add(`${props["출석"].relation[0].id}|${props["루틴"].relation[0].id}`); return { id: `ck${created.length}` } },
		existingRoutineIds: async (_ds: string, a: string) => [...existing].filter((k) => k.startsWith(`${a}|`)).map((k) => k.split("|")[1]),
	})
	return { created, restore: () => Object.assign(attendanceRoutineDeps, saved) }
}

const att = (id: string, reg: string) => ({ id, properties: { 출석: title(`${id} 학생 26.11.26`), 등록: rel(reg), 수업: rel("S1"), 클래스: rel("C1") } })
const world = () => ({
	A1: att("A1", "R1"), A2: att("A2", "R2"),
	C1: { id: "C1", properties: { 루틴: rel("T1", "T2", "T3") } },
	T1: { id: "T1", properties: { 이름: title("단어 암기"), 쉬기: cb(false), 순서: { type: "number", number: 1 } } },
	T2: { id: "T2", properties: { 이름: title("일기"), 쉬기: cb(false), 순서: { type: "number", number: 2 } } },
	T3: { id: "T3", properties: { 이름: title("쉬는 루틴"), 쉬기: cb(true) } },
})

Deno.test("출석 루틴: 쉬기 아닌 루틴 2개 → 2개, 다시 → 0개(건너뜀)", async () => {
	const { created, restore } = fake(world())
	try {
		const r = await createRoutineChecksForAttendance("A1")
		eq(r.created.length, 2)
		eq(created.map((p) => p["루틴"].relation[0].id), ["T1", "T2"])
		eq(created[0]["출석"].relation, [{ id: "A1" }])
		eq(created[0]["등록"].relation, [{ id: "R1" }])
		eq(created[0]["수업"].relation, [{ id: "S1" }])
		const again = await createRoutineChecksForAttendance("A1")
		eq(again.created.length, 0); eq(again.skipped.length, 2); eq(created.length, 2)
	} finally { restore() }
})

Deno.test("출석 루틴: 루틴 항목이 없으면 0개 + 안내", async () => {
	const w = world(); w.C1 = { id: "C1", properties: { 루틴: rel("T3") } }
	const { created, restore } = fake(w)
	try {
		const r = await createRoutineChecksForAttendance("A1")
		eq(r.ok, false); eq(r.message, NO_ROUTINES); eq(created.length, 0)
	} finally { restore() }
})

Deno.test("출석 루틴: 같은 수업 다른 학생(A2)은 자기 출석 것만, A1을 눌러도 A2는 안 생김", async () => {
	const { created, restore } = fake(world())
	try {
		await createRoutineChecksForAttendance("A1")
		eq(created.every((p) => p["출석"].relation[0].id === "A1"), true)
		await createRoutineChecksForAttendance("A2")
		eq(created.filter((p) => p["출석"].relation[0].id === "A2").length, 2)
		eq(created.length, 4)
	} finally { restore() }
})
