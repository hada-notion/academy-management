// All network calls are mocked. No live Notion/Supabase writes or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_TEXTBOOK_CART_ID: "carts", DATA_SOURCE_TEXTBOOK_DISTRIBUTION_ID: "distributions", DATA_SOURCE_REGISTRATION_ID: "registrations" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const { cartPlanDeps, cartPlanFromText, processCartPlanQueueItem } = await import("./cartPlan.ts")

const REG = "3ecba040586b8044be66db21a8c2c7e9", L1 = "3fc8121f51254cd5a32ee6b8ccf8ca1e", L2 = "7ad0b5a15c67453cbb8ccfd195636733"
const dashed = (id: string) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
const plan = (items: unknown[]) => JSON.stringify({ v: 1, r: REG, items })

function fake(billed: string[]) {
	const calls = { reads: 0, created: [] as any[], updates: [] as any[], errors: [] as string[], legacy: 0 }
	const saved = { ...cartPlanDeps }
	Object.assign(cartPlanDeps, {
		getPage: async () => { calls.reads++; return { properties: {} } },
		createPage: async (_db: string, props: any) => { calls.created.push(props); return { id: "x" } },
		queryAllPages: async () => billed.map((l) => ({ properties: { 라이브러리: { relation: [{ id: dashed(l) }] } } })),
		update: async (_id: string, props: any) => { calls.updates.push(props) },
		libraryProp: async () => "라이브러리",
		markError: async (_id: string, m: string) => { calls.errors.push(m) },
		legacy: async () => { calls.legacy++ },
		today: () => "2026-10-17",
	})
	return { calls, restore: () => Object.assign(cartPlanDeps, saved) }
}

Deno.test("v2.6.26 담기 계획: 수식 값을 읽고, 형식이 틀리면 오류, JSON이 아니면 null", () => {
	eq(cartPlanFromText(plan([{ l: L1, t: "쎈 공통수학2" }])), { reg: REG, items: [{ lib: L1, title: "쎈 공통수학2" }] })
	eq(cartPlanFromText(plan([])), { reg: REG, items: [] })
	eq(cartPlanFromText(""), null)
	eq(cartPlanFromText("{\"v\":1,\"r\":\"" + REG), null)
	let threw = false
	try { cartPlanFromText(plan([{ l: "bad" }])) } catch { threw = true }
	eq(threw, true)
})

Deno.test("v2.6.26 큐: 이미 배부된 교재는 건너뛰고 나머지만 만든 뒤 교재비 쓰기 1번", async () => {
	const { calls, restore } = fake([L1])
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: L1, t: "쎈 공통수학2" }, { l: L2, t: "라이트쎈 공통수학2" }]) })
		eq(calls.reads, 0)
		eq(calls.created.length, 1)
		eq(calls.created[0]["이름"].title[0].text.content, "라이트쎈 공통수학2")
		eq(calls.created[0]["라이브러리"].relation[0].id, L2)
		eq(calls.created[0]["등록"].relation[0].id, REG)
		eq(calls.created[0]["교재비"].relation[0].id, "cart-1")
		eq(calls.updates.length, 1)
		eq(calls.updates[0]["진도교재 담기 상태"].select.name, "✅ 완료")
	} finally { restore() }
})

Deno.test("v2.6.26 큐: 담을 교재가 없으면 조회 없이 완료, 수식이 없으면 예전 방식", async () => {
	let t = fake([])
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([]) })
		eq(t.calls.created.length, 0)
		eq(t.calls.updates.length, 1)
	} finally { t.restore() }
	t = fake([])
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: null })
		eq(t.calls.reads, 1)
		eq(t.calls.legacy, 1)
		eq(t.calls.updates[0]["진도교재 담기 상태"].select.name, "✅ 완료")
	} finally { t.restore() }
})

Deno.test("v2.6.26 큐: 계획 형식 오류는 만들지 않고 ⚠️ 오류(재시도 없음)", async () => {
	const { calls, restore } = fake([])
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: "bad" }]) })
		eq(calls.created.length, 0)
		eq(calls.errors.length, 1)
	} finally { restore() }
})

Deno.test("v2.8.0 예체능: 프로그램은 가격(재료비)이 있을 때만 교재비에 담고, 교재는 가격과 상관없이 담는다", async () => {
	const { isBillableLibrary } = await import("./textbookDistributionTarget.ts")
	const lib = (kind: string | null, price: number | null) => ({ properties: { "구분": { type: "select", select: kind ? { name: kind } : null }, "가격": { type: "number", number: price } } })
	eq([lib(null, null), lib("교재", 0), lib("프로그램", null), lib("프로그램", 0), lib("프로그램", 20000), { properties: {} }].map(isBillableLibrary), [true, true, false, false, true, true])
})

// (v2.8.0 항목 71) 청구서 한 장 = 한 종류: 담기 계획 k로 교재 → 교재비 청구서, 프로그램 → 재료비 청구서
function fake2(opts: { cart: any; others: any[] }) {
	const calls = { created: [] as { db: string; props: any }[], updates: [] as any[] }
	const saved = { ...cartPlanDeps }
	Object.assign(cartPlanDeps, {
		getPage: async (id: string) => id === REG ? { properties: { 이름: { type: "title", title: [{ plain_text: "박서준 중2 영어" }] } } } : opts.cart,
		createPage: async (db: string, props: any) => { calls.created.push({ db, props }); return { id: db === "carts" ? "new-cart" : "d" } },
		queryAllPages: async (db: string) => db === "carts" ? opts.others : [],
		update: async (_id: string, props: any) => { calls.updates.push(props) },
		libraryProp: async () => "라이브러리",
		markError: async () => {},
		legacy: async () => {},
		today: () => "2026-11-16",
	})
	return { calls, restore: () => Object.assign(cartPlanDeps, saved) }
}
const kindCart = (id: string, kind: string, lines = 1) => ({ id, properties: { 구분: { formula: { string: kind } }, 교재배부: { relation: Array.from({ length: lines }, () => ({ id: "l" })) } } })

Deno.test("항목 71 담기: 빈 청구서에 교재·프로그램이 같이 오면 교재는 누른 장, 프로그램은 새 재료비 청구서", async () => {
	const { calls, restore } = fake2({ cart: kindCart("cart-1", "교재비", 0), others: [] })
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: L1, t: "예시 영문법 2", k: "교재" }, { l: L2, t: "영어 발표", k: "프로그램" }]) })
		const carts = calls.created.filter((c) => c.db === "carts"), dist = calls.created.filter((c) => c.db === "distributions")
		eq(carts.length, 1)
		eq(carts[0].props["이름"].title[0].text.content, "박서준 중2 영어 재료비 청구서")
		eq(dist.map((d) => [d.props["이름"].title[0].text.content, d.props["교재비"].relation[0].id]), [["예시 영문법 2", "cart-1"], ["영어 발표", "new-cart"]])
	} finally { restore() }
})

Deno.test("항목 71 담기: 교재비 청구서에서 눌렀는데 프로그램만 오면 같은 등록의 재료비 청구서에, k가 없으면 누른 장", async () => {
	let t = fake2({ cart: kindCart("cart-1", "교재비"), others: [kindCart("cart-2", "재료비")] })
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: L2, t: "영어 발표", k: "프로그램" }]) })
		eq(t.calls.created.filter((c) => c.db === "carts").length, 0)
		eq(t.calls.created[0].props["교재비"].relation[0].id, "cart-2")
	} finally { t.restore() }
	t = fake2({ cart: kindCart("cart-1", "교재비"), others: [] })
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: L2, t: "옛 수식" }]) })
		eq(t.calls.created.length, 1)
		eq(t.calls.created[0].props["교재비"].relation[0].id, "cart-1")
	} finally { t.restore() }
})

Deno.test("항목 80 담기: 새로 만드는 재료비 청구서에 표시용 알림톡 설정(재료비 안내 행)", async () => {
	const { calls, restore } = fake2({ cart: kindCart("cart-1", "교재비", 0), others: [] })
	const seen: string[] = []
	cartPlanDeps.configRow = async (k: string) => { seen.push(k); return k === "재료비" ? "cfg-mat" : null }
	try {
		await processCartPlanQueueItem({ cartId: "cart-1", plan: plan([{ l: L1, t: "예시 영문법 2", k: "교재" }, { l: L2, t: "영어 발표", k: "프로그램" }]) })
		const carts = calls.created.filter((c) => c.db === "carts")
		eq(carts.map((c) => c.props["알림톡 설정"]?.relation?.[0]?.id), ["cfg-mat"])
		eq(seen, ["재료비"])
	} finally { restore() }
})
