// All network calls are mocked. No live Notion/Solapi/Supabase calls or secret values are used.
for (const [key, value] of Object.entries({ NOTION_TOKEN: "test-only", ADMIN_SECRET: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_REGISTRATION_ID: "registrations", DATA_SOURCE_SCHEDULE_EVENT_ID: "events", DATA_SOURCE_TUITION_ID: "tuitions", REPORT_PATH: "/r.html" })) Deno.env.set(key, value)
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const m = await import("./monthlyNotice.ts")
const { monthlyDeps: deps } = m

const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })), has_more: false })
const title = (s: string) => ({ type: "title", title: [{ plain_text: s }] })
const rt = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s }] : [] })
const date = (start: string | null, end: string | null = null) => ({ type: "date", date: start ? { start, end } : null })
const textOfRt = (p: any) => (p?.rich_text ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("")
const fx = (s: string) => ({ type: "formula", formula: { type: "string", string: s } })
const roll = (s: string) => ({ type: "rollup", rollup: { type: "array", array: [{ type: "rich_text", rich_text: [{ plain_text: s }] }] } })
const reg = (id: string, o: { student: string; name: string; cls: string; clsName: string; since?: string; until?: string }) => ({ id, properties: {
	"학생정보": rel(o.student), "클래스": rel(o.cls), "등록일": date(o.since ?? "2026-03-02"), "종료일": date(o.until ?? null),
	"학생이름(등록)": { type: "rollup", rollup: { array: [{ type: "title", title: [{ plain_text: o.name }] }] } }, "클래스명(등록)": roll(o.clsName),
} })

type Calls = { enq: any[]; created: any[]; updates: any[]; sends: any[]; logs: any[]; marks: string[] }
function mock(pages: Record<string, any>, q: (ds: string, filter: any) => any[] = () => [], o: { sendThrows?: Error } = {}): Calls {
	const c: Calls = { enq: [], created: [], updates: [], sends: [], logs: [], marks: [] }
	const memo = new Map<string, string>()
	let n = 0
	Object.assign(deps, {
		getPage: async (id: string) => { if (!(id in pages)) throw new Error(`unexpected page ${id}`); return pages[id] },
		createPage: async (ds: string, props: any) => {
			const id = `new${++n}`; c.created.push({ ds, props })
			// 노션이 돌려주는 모양처럼 글에 plain_text를 붙인다.
			const read = Object.fromEntries(Object.entries<any>(props).map(([k, v]) => [k, v?.title ? { type: "title", title: v.title.map((t: any) => ({ ...t, plain_text: t.text.content })) } : v]))
			pages[id] = { id, properties: read }; return pages[id]
		},
		queryAllPages: async (ds: string, filter: any) => q(ds, filter),
		// 쓴 값을 페이지에 반영한다(다른 발송함에서 다시 읽을 때 보낸 일시·체크가 보이게).
		update: async (id: string, props: any) => {
			c.updates.push({ id, props })
			if (!pages[id]) return
			for (const [k, v] of Object.entries<any>(props)) pages[id].properties[k] = v?.rich_text ? { type: "rich_text", rich_text: v.rich_text.map((t: any) => ({ plain_text: t.text.content })) } : v
		},
		fullRelationIds: async (page: any, name: string) => (page.properties?.[name]?.relation ?? []).map((r: any) => r.id),
		enqueue: async (target: string, payload: any) => { c.enq.push({ target, payload }) },
		batchDataSourceId: async () => "batches",
		letterDataSourceId: async () => "letters",
		config: async () => ({ pfId: "pf", templateId: "tpl", senderNumber: "", notice: "계좌번호\n하다은행", recipientTarget: ["우선 연락 대상"] }),
		tuitionConfigRow: async () => "cfg-row",
		send: async (code: string, regId: string, phone: string, vars: any) => { if (o.sendThrows) throw o.sendThrows; c.sends.push({ code, regId, phone, vars }) },
		log: async (a: any) => { c.logs.push({ cat: a.category, status: a.status, reg: a.registrationId, tuition: a.tuitionId }) },
		botUser: async () => null,
		token: async () => "tok",
		today: () => "2026-11-28",
		markRunning: async (id: string) => { c.marks.push(`running:${id}`) },
		markDone: async (id: string) => { c.marks.push(`done:${id}`) },
		markError: async (id: string, _spec: any, msg: string) => { c.marks.push(`error:${id}:${msg}`) },
		memo: {
			get: async (mo: string, k: string, key = "") => memo.get(`${mo}/${k}/${key}`) ?? null,
			put: async (mo: string, k: string, key: string, id: string, replace = false) => { const kk = `${mo}/${k}/${key}`; if (replace || !memo.has(kk)) memo.set(kk, id) },
			count: async (mo: string, k: string) => [...memo.keys()].filter((x) => x.startsWith(`${mo}/${k}/`)).length,
		},
	})
	return c
}

Deno.test("v2.8.0 월 수강료: 달 범위·이름", () => {
	eq(m.monthRange("2026-12"), { start: "2026-12-01", end: "2026-12-31" })
	eq(m.monthRange("2027-02"), { start: "2027-02-01", end: "2027-02-28" })
	eq(m.tuitionTitle("2026-12", "이도윤"), "26.12 이도윤 수강료")
	// 클래스 '안내 기간': 비면 다음 달, 있으면 시작일의 달, 두 달에 걸치면 고칠 곳을 알림
	eq(m.monthFromClass({ properties: {} }, new Date("2026-11-27T03:00:00Z")), "2026-12")
	eq(m.monthFromClass({ properties: { "안내 기간": date("2026-11-01", "2026-11-30") } }), "2026-11")
	let msg = ""
	try { m.monthFromClass({ properties: { "안내 기간": date("2026-11-20", "2026-12-05") } }) } catch (e) { msg = (e as Error).message }
	eq(msg.includes("한 달 안"), true)
})

Deno.test("v2.8.0 [월 수강료 생성]: 월간 수업 총량이 없으면 ⚠️, 반 수강료 발송함을 찾거나 만들어 클래스에 잇고 그 달 다니는 등록마다 큐", async () => {
	const c0 = mock({ cls: { id: "cls", properties: { "월간 수업 총량": { type: "number", number: null } } } })
	await m.processMonthlyCreateClassItem({ classId: "cls", month: "2026-12" })
	eq(c0.marks[1].includes("월간 수업 총량"), true)
	const regs = [
		reg("r1", { student: "s1", name: "이도윤", cls: "cls", clsName: "중1 A 수학" }),
		reg("r2", { student: "s2", name: "박서준", cls: "cls", clsName: "중1 A 수학", until: "2026-11-20" }), // 11월에 끝남
		reg("r3", { student: "s3", name: "김하윤", cls: "cls", clsName: "중1 A 수학", since: "2026-12-15" }),
	]
	const cls = { id: "cls", properties: { "클래스명": title("중1 A 수학"), "월간 수업 총량": { type: "number", number: 8 } } }
	let boxes: any[] = []
	const c = mock({ cls }, (ds, filter) => ds === "registrations" ? regs : ds === "batches" ? (JSON.stringify(filter).includes("수강료") ? boxes : []) : [])
	await m.processMonthlyCreateClassItem({ classId: "cls", month: "2026-12" })
	eq(c.created.map((x) => [x.ds, x.props["이름"].title[0].text.content, x.props["구분"].select.name, x.props["기간"].date, x.props["클래스"].relation]), [["batches", "중1 A 수학 수강료 26.12", "수강료", { start: "2026-12-01", end: "2026-12-31" }, [{ id: "cls" }]]])
	// (항목 69) 클래스 '수강료 생성 대상'에는 적지 않는다.
	eq(c.updates, [])
	eq(c.enq.map((e) => [e.target, e.payload.regId, e.payload.amount, e.payload.mailboxId, e.payload.last ?? false]), [["monthly-create-reg", "r1", 8, "new1", false], ["monthly-create-reg", "r3", 8, "new1", true]])
	// 다시 누르면 같은 달 수강료 발송함을 쓴다(다른 달 발송함은 무시).
	boxes = [{ id: "box-nov", properties: { "기간": date("2026-11-01", "2026-11-30") } }, { id: "box-dec", properties: { "기간": date("2026-12-01", "2026-12-31") } }]
	const cls2 = { id: "cls", properties: { ...cls.properties } }
	const c2 = mock({ cls: cls2 }, (ds, filter) => ds === "registrations" ? regs : ds === "batches" ? (JSON.stringify(filter).includes("수강료") ? boxes : []) : [])
	await m.processMonthlyCreateClassItem({ classId: "cls", month: "2026-12" })
	eq([c2.created.length, c2.updates.length, c2.enq[0].payload.mailboxId], [0, 0, "box-dec"])
	// 대상 달은 클래스 '수강료 기간'(비면 다음 달, 두 달에 걸치면 고칠 곳)
	eq(m.tuitionMonthFromClass({ properties: { "수강료 기간": date("2026-11-01", "2026-11-30"), "안내 기간": date("2027-01-01", "2027-01-31") } }), "2026-11")
	eq(m.tuitionMonthFromClass({ properties: {} }, new Date("2026-11-27T03:00:00Z")), "2026-12")
	let msg = ""
	try { m.tuitionMonthFromClass({ properties: { "수강료 기간": date("2026-11-20", "2026-12-05") } }) } catch (e) { msg = (e as Error).message }
	eq(msg.includes("'수강료 기간'은 한 달 안"), true)
})

Deno.test("v2.8.0 [월 수강료 생성] 등록 1건: 수강료를 만들어 반 발송함에 잇고, 같은 학생의 그 달 다른 반 수강료와 '같은 달 수강료'로 서로 잇는다(세 반)", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const rB = reg("rB", { student: "s1", name: "테스트학생", cls: "cB", clsName: "영어반" })
	const rC = reg("rC", { student: "s1", name: "테스트학생", cls: "cC", clsName: "국어반" })
	const pages: Record<string, any> = { rA, rB, rC, cA: { id: "cA", properties: { "마지막 오류": rt("") } }, cB: { id: "cB", properties: { "마지막 오류": rt("") } }, cC: { id: "cC", properties: { "마지막 오류": rt("") } } }
	const tByReg: Record<string, any[]> = { rA: [], rB: [], rC: [] }
	const q = (ds: string, filter: any) => {
		if (ds === "registrations") return [rA, rB, rC]
		if (ds === "tuitions") return tByReg[filter?.relation?.contains] ?? []
		return []
	}
	const tuitionPage = (id: string, regId: string, month = "2026-12") => ({ id, properties: { "청구기간": date(`${month}-01`, `${month}-28`), "등록": rel(regId), "알림톡 발송함": rel(), "같은 달 수강료": rel() } })
	// 1) 수학반: 혼자라 수강료만 만들고 잇지 않음
	const c1 = mock(pages, q)
	await m.processMonthlyCreateRegItem({ classId: "cA", month: "2026-12", regId: "rA", amount: 8, mailboxId: "box-A", last: true })
	const tA = c1.created[0]
	eq(tA.ds, "tuitions")
	eq([tA.props["청구명"].title[0].text.content, tA.props["실제 수업량"].number, tA.props["알림톡 발송함"].relation, tA.props["알림톡 설정"].relation, tA.props["일괄전송 선택"].checkbox, "가정통신문" in tA.props], ["26.12 테스트학생 수강료", 8, [{ id: "box-A" }], [{ id: "cfg-row" }], false, false])
	eq([c1.updates.filter((u) => u.props["같은 달 수강료"]).length, c1.marks], [0, ["done:cA"]])
	tByReg.rA = [tuitionPage("tA", "rA")]
	// 2) 영어반: 새 수강료(new1)와 수학반 수강료(tA)를 서로 잇는다
	const c2 = mock(pages, q)
	await m.processMonthlyCreateRegItem({ classId: "cB", month: "2026-12", regId: "rB", amount: 8, mailboxId: "box-B" })
	const sib2 = new Map(c2.updates.filter((u) => u.props["같은 달 수강료"]).map((u) => [u.id, u.props["같은 달 수강료"].relation.map((r: any) => r.id)]))
	eq([sib2.size, sib2.get("new1"), sib2.get("tA")], [2, ["tA"], ["new1"]])
	tByReg.rA = [{ ...tuitionPage("tA", "rA"), properties: { ...tuitionPage("tA", "rA").properties, "같은 달 수강료": rel("tB") } }]
	tByReg.rB = [{ ...tuitionPage("tB", "rB"), properties: { ...tuitionPage("tB", "rB").properties, "같은 달 수강료": rel("tA") } }]
	// 3) 국어반: 세 장이 서로 모두를 가진다(다른 달 수강료는 빼고)
	tByReg.rC = []
	tByReg.rA.push(tuitionPage("tA-nov", "rA", "2026-11"))
	const c3 = mock(pages, q)
	await m.processMonthlyCreateRegItem({ classId: "cC", month: "2026-12", regId: "rC", amount: 8, mailboxId: "box-C" })
	const sib3 = new Map(c3.updates.filter((u) => u.props["같은 달 수강료"]).map((u) => [u.id, u.props["같은 달 수강료"].relation.map((r: any) => r.id).sort()]))
	eq([sib3.get("new1"), sib3.get("tA"), sib3.get("tB"), sib3.has("tA-nov")], [["tA", "tB"], ["new1", "tB"], ["new1", "tA"], false])
	// 4) 다시 눌러도 늘지 않음: 국어반 수강료가 이미 있고 셋이 이미 서로 이어져 있으면 아무것도 쓰지 않음(빈 발송함만 연결)
	tByReg.rA = [{ ...tuitionPage("tA", "rA"), properties: { ...tuitionPage("tA", "rA").properties, "같은 달 수강료": rel("tB", "tC"), "알림톡 발송함": rel("box-A") } }]
	tByReg.rB = [{ ...tuitionPage("tB", "rB"), properties: { ...tuitionPage("tB", "rB").properties, "같은 달 수강료": rel("tA", "tC"), "알림톡 발송함": rel("box-B") } }]
	tByReg.rC = [{ ...tuitionPage("tC", "rC"), properties: { ...tuitionPage("tC", "rC").properties, "같은 달 수강료": rel("tA", "tB") } }]
	const c4 = mock(pages, q)
	await m.processMonthlyCreateRegItem({ classId: "cC", month: "2026-12", regId: "rC", amount: 8, mailboxId: "box-C" })
	eq([c4.created.length, c4.updates], [0, [{ id: "tC", props: { "알림톡 발송함": { relation: [{ id: "box-C" }] } } }]])
})

Deno.test("v2.8.0 월간 일정 안내: 반 이름은 이름순, 두 반 이상 학생에게 일부 반에만 걸린 일정은 반 이름을 붙임(10/28 사용자)", async () => {
	const names = new Map([["ca", "중1 A"], ["cb", "중1 B"]])
	const ev1 = { properties: { "클래스": rel("cb") } }
	eq(m.withClassPrefix("11/14(토) 보충 수업", ev1, names), "11/14(토) 중1 B 보충 수업")
	eq(m.withClassPrefix("12/24(목)~12/26(토) 겨울 휴원", { properties: { "클래스": rel("cb") } }, names), "12/24(목)~12/26(토) 중1 B 겨울 휴원")
	// 두 반 모두·반 없음(학생·학원 전체)·한 반만 다니는 학생은 그대로
	eq(m.withClassPrefix("11/14(토) 보충", { properties: { "클래스": rel("ca", "cb") } }, names), "11/14(토) 보충")
	eq(m.withClassPrefix("11/14(토) 설명회", { properties: { "클래스": rel() } }, names), "11/14(토) 설명회")
	eq(m.withClassPrefix("11/14(토) 보충", ev1, new Map([["cb", "중1 B"]])), "11/14(토) 보충")
	// (10/28) 일정 이름에 반 이름이 이미 있으면 다시 붙이지 않는다
	eq(m.withClassPrefix("11/14(토) 중1 B 보충 수업", ev1, names), "11/14(토) 중1 B 보충 수업")
	// (v2.8.0 통일안) #{클래스목록}: 반 하나면 두 칸 띄워 옆에, 둘 이상이면 줄을 바꿔 · 목록
})

const ev = (id: string, o: { name: string; cat?: string; start: string; end?: string; cls?: string[]; stu?: string[]; school?: string[]; grade?: string[] }) => ({ id, properties: {
	"이름": title(o.name), "구분": { type: "select", select: { name: o.cat ?? "📆 학원 일정" } }, "날짜": date(o.start, o.end ?? null),
	"학부모 공개": { type: "checkbox", checkbox: true }, "숨김": { type: "checkbox", checkbox: false },
	"클래스": rel(...(o.cls ?? [])), "학생": rel(...(o.stu ?? [])), "학교": rel(...(o.school ?? [])), "학년": rel(...(o.grade ?? [])),
} })
const relFilter = (filter: any) => {
	const f = filter?.relation ? filter : filter?.and?.find((x: any) => x.relation)
	return f ? `${f.property}:${f.relation.contains}` : ""
}

Deno.test("v2.8.0 항목 148 [월간 안내 생성]: 그 달 발송함 하나에 반이 쌓이고(클래스), 학생은 한 장에 반 등록이 더해짐, 학원 일정은 만들 때 한 번에", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const rB = reg("rB", { student: "s1", name: "테스트학생", cls: "cB", clsName: "영어반" })
	const rC = reg("rC", { student: "s2", name: "예시학생", cls: "cB", clsName: "영어반" })
	const academy = ev("e-all", { name: "학원 설명회", start: "2026-11-14" })
	const mySchool = ev("e-sch", { name: "중간고사", cat: "🏫 학사 일정", start: "2026-11-20", school: ["sch1"] })
	const otherSchool = ev("e-oth", { name: "다른 학교 시험", cat: "🏫 학사 일정", start: "2026-11-21", school: ["sch9"] })
	const pages: Record<string, any> = { rA, rB, rC, cA: { id: "cA", properties: { "마지막 오류": rt("") } }, cB: { id: "cB", properties: { "마지막 오류": rt("") } },
		s1: { id: "s1", properties: { "학교": rel("sch1"), "학년": rel() } }, s2: { id: "s2", properties: { "학교": rel(), "학년": rel() } } }
	// 노션 조회는 방금 만든 페이지를 못 잡는다(늦게 잡힘) — 기억 표로 찾아야 한다.
	const q = (ds: string, filter: any) => {
		if (ds === "registrations") { const c = filter?.relation?.contains; return c === "cA" ? [rA] : c === "cB" ? [rB, rC] : c === "s1" ? [rA, rB] : [rC] }
		if (ds === "events") return relFilter(filter) === "" ? [academy, mySchool, otherSchool] : []
		return []
	}
	const c = mock(pages, q)
	const run = async () => { for (let i = 0; i < c.enq.length; i++) if (c.enq[i].target === "letter-create-reg" && !c.enq[i].done) { c.enq[i].done = true; await m.processLetterCreateRegItem(c.enq[i].payload) } }
	// 1) 수학반: 달 발송함 "가정통신문 26.11"(클래스 = 수학반) + 테스트학생 한 장
	await m.processLetterCreateClassItem({ classId: "cA", month: "2026-11" })
	await run()
	eq(c.created.map((x) => x.ds), ["batches", "letters"])
	eq([c.created[0].props["이름"].title[0].text.content, c.created[0].props["구분"].select.name, c.created[0].props["클래스"].relation], ["가정통신문 26.11", "가정통신문", [{ id: "cA" }]])
	const made = c.created[1].props
	eq([made["이름"].title[0].text.content, made["등록"].relation, made["알림톡 발송함"].relation, made["학원 일정"].relation.map((r: any) => r.id).sort()],
		["26.11 테스트학생 가정통신문", [{ id: "rA" }], [{ id: "new1" }], ["e-all", "e-sch"]])
	eq(c.updates.filter((u) => u.id === "new2"), [])
	// 2) 영어반: 같은 발송함에 영어반이 더해지고, 테스트학생 장에 rB가 더해지고, 예시학생 장만 새로
	await m.processLetterCreateClassItem({ classId: "cB", month: "2026-11" })
	await run()
	eq(c.created.length, 3)
	eq(c.created[2].props["이름"].title[0].text.content, "26.11 예시학생 가정통신문")
	eq(pages.new1.properties["클래스"].relation.map((r: any) => r.id), ["cA", "cB"])
	eq(pages.new2.properties["등록"].relation.map((r: any) => r.id), ["rA", "rB"])
	// 3) 다시 눌러도 같다(쓰기 없음)
	const before = c.updates.length
	await m.processLetterCreateClassItem({ classId: "cB", month: "2026-11" })
	await run()
	eq([c.created.length, c.updates.length], [3, before])
	eq(c.marks.filter((x) => x.startsWith("done")), ["done:cA", "done:cB", "done:cB"])
	// 4) 이미 보낸 장에 반이 더해지면 다시 보내지 않고 발송함에 한 줄
	pages.new2.properties["등록"] = rel("rA")
	pages.new2.properties["안내문 전송 상태"] = { type: "select", select: { name: "✅ 완료" } }
	await m.processLetterCreateClassItem({ classId: "cB", month: "2026-11" })
	await run()
	eq(pages.new1.properties["요청 결과"].rich_text[0].plain_text.startsWith("보낸 뒤 더해진 학생 1명"), true)
	eq(c.sends, [])
})

Deno.test("v2.8.0 항목 148 보내기: 학생 한 장(두 반)의 #{전달사항}은 그 달 발송함 공통 안내 메모만, 클래스 칸은 읽지도 비우지도 않음(대표 261125)", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const rB = reg("rB", { student: "s1", name: "테스트학생", cls: "cB", clsName: "영어반" })
	const sel = (s: string) => ({ type: "select", select: s ? { name: s } : null })
	const letter = { id: "l1", properties: { "기간": date("2026-11-01", "2026-11-30"), "등록": rel("rA", "rB"), "학원 일정": rel(), "알림톡 발송함": rel("box"), "같은 달 가정통신문": rel(), "안내문 전송 상태": sel("⚪ 대기") } }
	const pages: Record<string, any> = { rA, rB, l1: letter, s1: { id: "s1", properties: { "학교": rel(), "학년": rel() } },
		cA: { id: "cA", properties: { "가정통신문 전달사항": rt("반 글") } }, box: { id: "box", properties: { "가정통신문 안내 메모": rt("겨울방학 특강 신청을 받습니다.") } } }
	const q = (ds: string, filter: any) => (ds === "registrations" ? [rA, rB] : [])
	const c = mock(pages, q)
	const built = await m.buildLetterNotice(letter)
	eq(built.variables["#{전달사항}"], "겨울방학 특강 신청을 받습니다.")
	eq(built.afterSent, undefined)
	eq(textOfRt(pages.cA.properties["가정통신문 전달사항"]), "반 글")
	eq(c.sends, [])
})

Deno.test("v2.8.0 가정통신문 보내기 변수: 학원 일정을 다시 넣고 (일정안내) 수식 우선, 없으면 서버 계산(학생·두 반·연결 안 된 일정), 일정 0건이면 전달사항만, 둘 다 없으면 막음", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const rB = reg("rB", { student: "s1", name: "테스트학생", cls: "cB", clsName: "영어반" })
	const letter = { id: "lA", properties: { "기간": date("2026-11-01", "2026-11-30"), "등록": rel("rA"), "학원 일정": rel(), "알림톡 발송함": rel("bA"), "같은 달 가정통신문": rel("lB") } }
	const letterB = { id: "lB", properties: { "기간": date("2026-11-01", "2026-11-30"), "등록": rel("rB"), "학원 일정": rel(), "알림톡 발송함": rel("bB"), "같은 달 가정통신문": rel("lA") } }
	const academy = ev("e-all", { name: "학원 설명회", start: "2026-11-14" })
	const classB = ev("e-b", { name: "보충", start: "2026-11-07", cls: ["cB"] })
	const box = (id: string, memo: string) => ({ id, properties: { "가정통신문 전달사항": rt(memo) } })
	const pages: Record<string, any> = { rA, rB, lA: letter, lB: letterB, s1: { id: "s1", properties: { "학교": rel(), "학년": rel() } }, bA: box("bA", ""), bB: box("bB", "교재 지참") }
	let all = [academy, classB]
	const q = (ds: string, filter: any) => {
		if (ds === "registrations") return [rB, rA]
		if (ds === "events") {
			const r = relFilter(filter)
			if (r === "") return all.filter((e) => e.id === "e-all")
			if (r === "클래스:cB") return all.filter((e) => e.id === "e-b")
			return []
		}
		return []
	}
	const c = mock(pages, q)
	const built = await m.buildLetterNotice(letter)
	eq(c.updates.find((u) => u.id === "lA")?.props["학원 일정"].relation, [{ id: "e-all" }])
	eq([built.registrationId, built.variables["#{클래스}"], built.variables["#{안내월}"], built.variables["#{학원목록}"], built.variables["#{전달사항}"], built.variables["#{페이지ID}"].endsWith("?token=tok")],
		["rA", "수학반 · 영어반", "11월", "11.07(토)  영어반 보충\n  • 11.14(토)  학원 설명회", "교재 지참", true])
	// (11/2) 전달사항: 반 발송함 메모만, 반마다 "🏛 반" 줄 아래 "  • 문구"(반 이름순, 첫 줄이 공백으로 시작하지 않게). 학생 개인 메모는 넣지 않는다
	pages.bA = box("bA", "단원평가 범위는 3단원")
	eq(await m.letterNote(letter, [rB, rA]), "🏛 수학반\n  • 단원평가 범위는 3단원\n🏛 영어반\n  • 교재 지참")
	pages.bA = box("bA", "")
	pages.lA = letter
	// 그 달 일정 0건이어도 전달사항(영어반 발송함 메모 "교재 지참" 하나 → 머리 없이)이 있으면 보낸다: 일정 구역 없이 전달사항만
	all = []
	pages.lA = letter
	const noteOnly = await m.buildLetterNotice(letter)
	eq([noteOnly.variables["#{학원목록}"], noteOnly.variables["#{전달사항}"]], ["없음", "교재 지참"])
	// 일정도 전달사항도 없으면 막음
	pages.bB = box("bB", "")
	let msg = ""
	try { await m.buildLetterNotice(letter) } catch (e) { msg = (e as Error).message; eq(e instanceof m.LetterBlocked, true) }
	eq(msg.includes("일정과 전달사항이 없어 보내지 않았습니다"), true)
})

Deno.test("261125 옛 템플릿 #{클래스}: 반이 3개까지는 ' · '로 잇고, 넘으면 '첫 반 외 n개'(이름순 첫 반)", async () => {
	eq(m.letterClassText([]), "")
	eq(m.letterClassText(["수학반"]), "수학반")
	eq(m.letterClassText(["국어반", "수학반", "영어반"]), "국어반 · 수학반 · 영어반")
	eq(m.letterClassText(["국어 1학년", "국어 2학년", "수학 A", "영어 B"]), "국어 1학년 외 3개")
	const names = ["영어 B", "국어 1학년", "과학 C", "수학 A", "사회 D"]
	const regs = names.map((n, i) => reg(`r${i}`, { student: "s1", name: "예시학생", cls: `c${i}`, clsName: n }))
	const letter = { id: "lA", properties: { "기간": date("2026-12-01", "2026-12-31"), "등록": rel("r0"), "학원 일정": rel(), "알림톡 발송함": rel("bA"), "같은 달 가정통신문": rel() } }
	const pages: Record<string, any> = { lA: letter, s1: { id: "s1", properties: { "학교": rel(), "학년": rel() } }, bA: { id: "bA", properties: { "가정통신문 안내 메모": rt("교재 지참") } } }
	for (const r of regs) pages[r.id] = r
	mock(pages, (ds) => (ds === "registrations" ? regs : []))
	const built = await m.buildLetterNotice(letter)
	eq(built.variables["#{클래스}"], "과학 C 외 4개")
})

Deno.test("261125 발송함 [일정 다시 가져오기]: 발송함 가정통신문마다 학원 일정을 다시 맞추고(다시 눌러도 같음), 세부 구분 빈 일정은 이름으로, 보내지 않음", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const rC = reg("rC", { student: "s2", name: "예시학생", cls: "cA", clsName: "수학반" })
	const box = { id: "box", properties: { "구분": { type: "select", select: { name: "가정통신문" } }, "기간": date("2026-12-01", "2026-12-31"), "클래스": rel("cA") } }
	const lA = { id: "lA", properties: { "이름": title("26.12 테스트학생 가정통신문"), "기간": date("2026-12-01", "2026-12-31"), "등록": rel("rA"), "알림톡 발송함": rel("box"), "학원 일정": rel("e-xmas") } }
	const lC = { id: "lC", properties: { "이름": title("26.12 예시학생 가정통신문"), "기간": date("2026-12-01", "2026-12-31"), "등록": rel("rC"), "알림톡 발송함": rel("box"), "학원 일정": rel("e-xmas") } }
	const xmas = ev("e-xmas", { name: "크리스마스 휴원", cat: "💤 휴원", start: "2026-12-25" })
	const late = ev("e-late", { name: "겨울 특강 설명회", start: "2026-12-12" })
	const sch1 = ev("e-sch1", { name: "기말고사", cat: "📝 시험", start: "2026-12-08", school: ["sch1"] })
	const sch2 = ev("e-sch2", { name: "다른 학교 방학식", cat: "🏫 학교 행사", start: "2026-12-20", school: ["sch2"] })
	// 세부 구분·구분이 비어 종류를 모르는 공개 일정: 학원 전체(이 발송함) · 다른 반(이 발송함 아님)
	const noKind = { ...ev("e-nokind", { name: "재량휴원일", start: "2026-12-03" }) }
	noKind.properties["구분"] = { type: "select", select: null } as any
	const otherCls = { ...ev("e-other", { name: "다른 반 보충", start: "2026-12-04", cls: ["cZ"] }) }
	otherCls.properties["구분"] = { type: "select", select: null } as any
	const nov = ev("e-nov", { name: "11월 일정", start: "2026-11-28" })
	const pages: Record<string, any> = { box, lA, lC, rA, rC, s1: { id: "s1", properties: { "학교": rel("sch1"), "학년": rel() } }, s2: { id: "s2", properties: { "학교": rel(), "학년": rel() } } }
	const q = (ds: string, filter: any) => {
		if (ds === "letters") return filter?.relation?.contains === "box" ? [pages.lA, pages.lC] : []
		if (ds === "events") return relFilter(filter) === "" ? [xmas, late, sch1, sch2, noKind, otherCls, nov] : []
		return []
	}
	const c = mock(pages, q)
	const r = await m.refetchMailboxEvents("box")
	const ids = (id: string) => c.updates.filter((u) => u.id === id && u.props["학원 일정"]).map((u) => u.props["학원 일정"].relation.map((x: any) => x.id).sort())
	eq(ids("lA"), [["e-late", "e-sch1", "e-xmas"]])
	eq(ids("lC"), [["e-late", "e-xmas"]])
	eq([r.letters, r.changed, r.events, r.skipped], [2, 2, 3, ["12/3(목) 재량휴원일"]])
	eq(m.refetchNote(r), "가정통신문 2장 · 넣은 일정 3개 · 고친 장 2 · 세부 구분 비어 빠짐: 12/3(목) 재량휴원일")
	// 학원 일정 말고는 쓰지 않음(발송 상태·전송 내역·보내기 없음)
	eq(c.updates.every((u) => Object.keys(u.props).join() === "학원 일정"), true)
	eq([c.sends.length, c.logs.length, c.enq.length], [0, 0, 0])
	// 다시 눌러도 같음: 쓰기 없음
	const c2 = mock(pages, q)
	const r2 = await m.refetchMailboxEvents("box")
	eq([c2.updates.length, r2.changed, r2.events], [0, 0, 3])
	eq(m.refetchNote(r2).startsWith("가정통신문 2장 · 넣은 일정 3개 · 바뀐 것 없음"), true)
})

Deno.test("261125 발송함 [일정 다시 가져오기]: 가정통신문 발송함 아님 · 가정통신문 없음은 막고, 고르기 규칙은 생성·보내기와 같다", async () => {
	const box = (kind: string) => ({ id: "b", properties: { "구분": { type: "select", select: { name: kind } }, "기간": date("2026-12-01", "2026-12-31"), "클래스": rel("cA") } })
	for (const [kind, want] of [["수강료", "구분이 가정통신문인 발송함에서만"], ["가정통신문", "가정통신문이 없어요"]]) {
		mock({ b: box(kind) }, () => [])
		let msg = ""
		try { await m.refetchMailboxEvents("b") } catch (e) { msg = (e as Error).message; eq(e instanceof m.LetterBlocked, true) }
		eq(msg.includes(want), true)
	}
	// pickUnlinked: 학원 전체 + 학교·학년(채운 칸 모두 맞을 때), 다른 학교 · 학교 맞고 학년 다름 · 반 일정은 뺌, 다른 달 · 비공개 뺌
	const rows = [
		ev("a", { name: "전체", start: "2026-12-01" }),
		ev("b", { name: "우리 학교", start: "2026-12-02", school: ["S"] }),
		ev("c", { name: "우리 학교 다른 학년", start: "2026-12-03", school: ["S"], grade: ["G9"] }),
		ev("d", { name: "우리 학년", start: "2026-12-04", grade: ["G1"] }),
		ev("e", { name: "다른 학교", start: "2026-12-05", school: ["T"] }),
		ev("f", { name: "반", start: "2026-12-06", cls: ["c1"] }),
		ev("g", { name: "다른 달", start: "2027-01-02" }),
	]
	eq(m.pickUnlinked(rows, "S", "G1", "2026-12").map((e: any) => e.id), ["a", "b", "d"])
	eq(m.pickUnlinked(rows, undefined, undefined, "2026-12").map((e: any) => e.id), ["a"])
})

Deno.test("v2.8.0 항목 150 [월간 안내 생성] + 안내 구분 월별 학습계획: 반 × 달 발송함 하나(다시 눌러도 하나), 학생 장·큐 없음", async () => {
	const sel = (s: string) => ({ type: "select", select: s ? { name: s } : null })
	const pages: Record<string, any> = { cP: { id: "cP", properties: { "클래스명": title("중1 수학"), "안내 구분": sel("월별 학습계획"), "마지막 오류": rt("") } } }
	const boxes: any[] = []
	const q = (ds: string, filter: any) => {
		if (ds === "batches") return boxes.filter((b) => filter.and[0].relation.contains === "cP" && b.properties["구분"].select.name === filter.and[1].select.equals)
		throw new Error(`unexpected query ${ds}`)
	}
	const c = mock(pages, q)
	await m.processLetterCreateClassItem({ classId: "cP", month: "2026-12" })
	eq(c.created.length, 1)
	const made = c.created[0]
	eq([made.ds, made.props["이름"].title[0].text.content, made.props["구분"].select.name, made.props["클래스"].relation, made.props["기간"].date],
		["batches", "중1 수학 월별 학습계획 26.12", "월별 학습계획", [{ id: "cP" }], { start: "2026-12-01", end: "2026-12-31" }])
	boxes.push(pages.new1)
	await m.processLetterCreateClassItem({ classId: "cP", month: "2026-12" })
	eq([c.created.length, c.enq.length], [1, 0])
	eq(c.marks.filter((x) => x.startsWith("done")), ["done:cP", "done:cP"])
	// 안내 구분이 비거나 가정통신문이면 지금 그대로(등록 조회부터)
	pages.cP.properties["안내 구분"] = sel("")
	let asked = ""
	const c2 = mock(pages, (ds: string) => { asked = ds; return [] })
	await m.processLetterCreateClassItem({ classId: "cP", month: "2026-12" })
	eq([asked, c2.created.length, c2.marks[1].startsWith("error:cP")], ["registrations", 0, true])
})

Deno.test("v2.8.0 항목 150 월별 학습계획 발송함에 든 장은 보내지 않음(LetterBlocked)", async () => {
	const rA = reg("rA", { student: "s1", name: "테스트학생", cls: "cA", clsName: "수학반" })
	const letter = { id: "l1", properties: { "기간": date("2026-12-01", "2026-12-31"), "등록": rel("rA"), "학원 일정": rel(), "알림톡 발송함": rel("pbox"), "같은 달 가정통신문": rel() } }
	const pages: Record<string, any> = { rA, l1: letter, pbox: { id: "pbox", properties: { "구분": { type: "select", select: { name: "월별 학습계획" } } } } }
	const c = mock(pages, () => [rA])
	let msg = ""
	try { await m.buildLetterNotice(letter) } catch (e) { msg = (e as Error).message; eq(e instanceof m.LetterBlocked, true) }
	eq(msg.includes("월별 학습계획은 알림톡을 보내지 않습니다"), true)
	eq(c.sends, [])
})
