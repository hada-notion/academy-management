// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_TEXTBOOK_CART_ID: "carts", DATA_SOURCE_TEXTBOOK_DISTRIBUTION_ID: "lines", DATA_SOURCE_REGISTRATION_ID: "regs" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const { classEtcDeps, processClassEtcChargeQueueItem, activeToday } = await import("./classEtcCharge.ts")

const title = (t: string) => ({ type: "title", title: [{ plain_text: t }] })
const sel = (n: string) => ({ select: { name: n } })
const rel = (...ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const date = (d: string) => ({ date: { start: d } })

function fake(pages: Record<string, any>, lines: any[] = [], carts: any[] = []) {
	const calls = { created: [] as { db: string; props: any }[], updates: [] as any[] }
	const saved = { ...classEtcDeps }
	let n = 0
	Object.assign(classEtcDeps, {
		getPage: async (id: string) => pages[id],
		queryAllPages: async (db: string) => db === "regs" ? pages.__regs : db === "lines" ? lines : carts,
		createPage: async (db: string, props: any) => { calls.created.push({ db, props }); return { id: `${db}-${++n}`, properties: props } },
		update: async (_id: string, props: any) => { calls.updates.push(props) },
		today: () => "2026-12-03",
	})
	return { calls, restore: () => Object.assign(classEtcDeps, saved) }
}

const pages = {
	cls: { id: "cls", properties: { 기타경비: rel("eonce", "emonth") } },
	"eonce": { id: "eonce", properties: { 이름: title("고등 모의고사비"), "기타경비 항목": sel("모의고사비"), "받는 방식": sel("한 번") } },
	"emonth": { id: "emonth", properties: { 이름: title("차량비(근거리)"), "기타경비 항목": sel("차량비"), "받는 방식": sel("매달") } },
	__regs: [
		{ id: "r1", properties: { 이름: title("홍재원 고1 수학"), 등록일: date("2026-09-01") } },
		{ id: "r2", properties: { 이름: title("노다인 고1 수학"), 등록일: date("2026-09-01"), 종료일: date("2026-11-30") } }, // 끝난 등록
	],
}

Deno.test("항목 72 기타경비 청구: 한 번인 것만, 오늘 다니는 등록마다 청구서 한 장 + 줄 한 줄", async () => {
	const { calls, restore } = fake(pages)
	try {
		await processClassEtcChargeQueueItem({ classId: "cls" })
		const carts = calls.created.filter((c) => c.db === "carts"), lines = calls.created.filter((c) => c.db === "lines")
		eq(carts.map((c) => c.props["이름"].title[0].text.content), ["26.12 홍재원 고1 수학 모의고사비 청구서"])
		eq(lines.length, 1)
		const l = lines[0].props
		eq([l["이름"].title[0].text.content, l["기타경비"].relation[0].id, l["종류"].select.name, l["기타경비 항목"].select.name, l["청구 월"].date.start, l["교재비"].relation[0].id], ["고등 모의고사비", "eonce", "기타경비", "모의고사비", "2026-12-01", "carts-1"])
	} finally { restore() }
})

Deno.test("항목 72 기타경비 청구: 같은 달 같은 기타경비 줄이 있으면 건너뜀, 한 번인 것이 없으면 마지막 오류만", async () => {
	let t = fake(pages, [{ id: "l1", properties: { "청구 월": date("2026-12-01"), 기타경비: rel("eonce") } }])
	try {
		await processClassEtcChargeQueueItem({ classId: "cls" })
		eq(t.calls.created.length, 0)
	} finally { t.restore() }
	t = fake({ ...pages, cls: { id: "cls", properties: { "기타경비(매달)": rel("emonth") } } })
	try {
		await processClassEtcChargeQueueItem({ classId: "cls" })
		eq(t.calls.created.length, 0)
		eq(t.calls.updates[0]["마지막 오류"].rich_text[0].text.content.includes("한 번"), true)
	} finally { t.restore() }
})

Deno.test("항목 72 오늘 다니는 등록", () => {
	eq(activeToday({ properties: { 등록일: date("2026-12-04") } }, "2026-12-03"), false)
	eq(activeToday({ properties: { 등록일: date("2026-12-01"), 종료일: date("2026-12-03") } }, "2026-12-03"), true)
})

Deno.test("항목 80 기타경비 청구: 새 청구서에 표시용 알림톡 설정(기타경비 안내 행), 행이 없으면 비움", async () => {
	const { calls, restore } = fake(pages)
	const seen: string[] = []
	classEtcDeps.configRow = async (k: string) => { seen.push(k); return "cfg-etc" }
	try {
		await processClassEtcChargeQueueItem({ classId: "cls" })
		const carts = calls.created.filter((c) => c.db === "carts")
		eq(carts.map((c) => c.props["알림톡 설정"]?.relation?.[0]?.id), ["cfg-etc"])
		eq(seen, ["기타경비"])
	} finally { restore() }
	const second = fake(pages)
	classEtcDeps.configRow = async () => null
	try {
		await processClassEtcChargeQueueItem({ classId: "cls" })
		eq(second.calls.created.filter((c) => c.db === "carts").map((c) => "알림톡 설정" in c.props), [false])
	} finally { second.restore() }
})

Deno.test("항목 80 청구서 종류 → 알림톡 설정 행(안내문 전송과 같은 고르기)", async () => {
	const { cartConfigCategory } = await import("./adminShared.ts")
	eq(["교재비", "재료비", "기타경비", ""].map(cartConfigCategory), ["교재비 안내", "재료비 안내", "기타경비 안내", "교재비 안내"])
})
