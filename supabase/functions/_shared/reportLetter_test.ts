// (v2.8.0 항목 148) 학부모 리포트 가정통신문: 학생당 한 장 — 달마다 한 줄, 본문은 다니는 반 전부의 일정·반별 전달사항.
import { buildLetterList, buildLetterView, buildPlanList, buildPlanView, reportLetterDeps } from "./reportLetter.ts"

function eq(a: unknown, b: unknown) {
	if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`다름\n 실제: ${JSON.stringify(a)}\n 기대: ${JSON.stringify(b)}`)
}
const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })), has_more: false })
const letter = (id: string, regs: string[], month: string, box?: string, sent = "") => ({
	id,
	properties: { "안내문 전송 상태": { select: { name: "✅ 완료" } }, "기간":{ date: { start: `${month}-01` } }, "등록": rel(...regs), "알림톡 발송함": rel(...(box ? [box] : [])), "보낸 전달사항": { rich_text: sent ? [{ plain_text: sent }] : [] } },
})

function mock(rows: Record<string, any[]>, opts: { memos?: Record<string, string>; bodies?: Record<string, unknown[]>; lines?: any[]; regs?: any[] } = {}) {
	const filters: any[] = []
	const eventRegs: string[][] = []
	Object.assign(reportLetterDeps, {
		dataSourceId: () => Promise.resolve("ds"),
		queryAllPages: (_ds: string, filter: any) => {
			filters.push(filter)
			return Promise.resolve(rows[filter.and[0].relation.contains] ?? [])
		},
		events: (_s: string, _m: string, regs: any[]) => {
			eventRegs.push(regs.map((r) => r.id))
			return Promise.resolve(opts.lines ?? [])
		},
		getPage: (id: string) => Promise.resolve({ id, properties: { "가정통신문 안내 메모": { rich_text: opts.memos?.[id] ? [{ plain_text: opts.memos[id] }] : [] } } }),
		body: (id: string) => Promise.resolve(opts.bodies?.[id] ?? []),
		regsInMonth: () => Promise.resolve(opts.regs ?? [{ id: "r1" }, { id: "r2" }]),
	})
	return { filters, eventRegs }
}

// 한 장(a)이 수학 r1·영어 r2 두 등록에 걸림. 10월은 수학만 다닐 때 보낸 장.
const oneLetter = {
	r1: [letter("a", ["r1", "r2"], "2026-12", "box"), letter("old", ["r1"], "2026-10", "box10"), { ...letter("x", ["r1"], "2026-09"), in_trash: true }],
	r2: [letter("a", ["r1", "r2"], "2026-12", "box")],
}

Deno.test("v2.8.0 항목 148 가정통신문 목록: 보낸 달마다 한 줄(두 등록에 걸린 한 장도 한 줄), 최근 달부터", async () => {
	const { filters } = mock(oneLetter)
	eq(await buildLetterList(["r1", "r2"]), [
		{ month: "2026-12", registrationId: "r1" },
		{ month: "2026-10", registrationId: "r1" },
	])
	eq(filters[0].and[1].or[0], { property: "안내문 전송 상태", select: { equals: "✅ 완료" } })
})

Deno.test("261125 가정통신문 목록: 상태가 ⚠️·⚪로 바뀌었어도 성공한 알림톡 전송로그가 있으면 보낸 장, 한 번도 안 보낸 장은 제외", async () => {
	const withStatus = (l: any, status: string, ...logs: string[]) => ({ ...l, properties: { ...l.properties, "안내문 전송 상태": { select: { name: status } }, "전송로그": rel(...logs) } })
	const { filters } = mock({
		r1: [
			withStatus(letter("a", ["r1"], "2026-12", "box"), "⚠️ 오류", "logOk"),
			withStatus(letter("b", ["r1"], "2026-11", "box"), "⚠️ 오류", "logReq"),
			withStatus(letter("c", ["r1"], "2026-10", "box"), "✅ 완료"),
			withStatus(letter("d", ["r1"], "2026-09", "box"), "⚪ 대기"),
		],
	})
	const logs: Record<string, any> = {
		logOk: { id: "logOk", properties: { "발송 구분": { select: { name: "월간 일정 안내" } }, "발송 상태": { select: { name: "성공" } } } },
		logReq: { id: "logReq", properties: { "발송 구분": { select: { name: "버튼 요청" } }, "발송 상태": { select: { name: "성공" } } } },
	}
	reportLetterDeps.getPage = ((id: string) => Promise.resolve(logs[id] ?? null)) as any
	eq(await buildLetterList(["r1"]), [
		{ month: "2026-12", registrationId: "r1" },
		{ month: "2026-10", registrationId: "r1" },
	])
	eq(filters[0].and[1].or[1], { property: "전송로그", relation: { is_not_empty: true } })
})

Deno.test("v2.8.0 가정통신문 목록: 등록이 없으면 조회하지 않고, 조회 실패해도 동기화를 막지 않는다", async () => {
	const { filters } = mock({})
	eq(await buildLetterList([]), [])
	eq(filters.length, 0)
	reportLetterDeps.queryAllPages = () => Promise.reject(new Error("notion down"))
	eq(await buildLetterList(["r1"]), [])
})

Deno.test("v2.8.0 항목 148 가정통신문 본문: 다니는 반 전부의 일정, 보낸 때 박아 둔 반별 전달사항 + 보낸 뒤 더해진 반, 파일 blockId는 뺀다", async () => {
	const { eventRegs } = mock({ r1: [letter("a", ["r1", "r2"], "2026-12", "box", "🏛 수학반\n보강을 엽니다.")] }, {
		bodies: {
			box: [{ type: "paragraph", text: "12월 안내" }, { type: "pdf", blockId: "blk", url: "https://f/a.pdf", name: "a.pdf" }],
			a: [{ type: "paragraph", text: "서아 안내" }],
		},
		lines: [
			{ id: "1", day: "2026-12-24", line: "12/24(목) 방학", sec: "휴원" },
			{ id: "2", day: "2026-12-19", line: "12/19(토) 특강", sec: "학원" },
			{ id: "3", day: "2026-12-05", line: "12/5(토) 설명회", sec: "학원" },
		],
	})
	const v = await buildLetterView("r1", "s1", "2026-12")
	eq(v?.label, "12월")
	eq(eventRegs, [["r1", "r2"]])
	eq(v?.schedule, { rest: ["12.24(목)  방학"], academy: ["12.05(토)  설명회", "12.19(토)  특강"], school: [] })
	// (대표 261125) 반별 전달사항 없음: 장에 옛 `보낸 전달사항`이 있어도 쓰지 않고 발송함 공통 안내만(이 발송함은 메모 없음)
	eq(v?.note, "")
	eq(v?.classBody, [{ type: "paragraph", text: "12월 안내" }, { type: "pdf", url: "https://f/a.pdf", name: "a.pdf" }])
	eq(v?.studentBody, [{ type: "paragraph", text: "서아 안내" }])
})

Deno.test("v2.8.0 가정통신문 본문: 전달사항은 발송함 공통 안내 메모, 보낸 장이 없는 달은 null, 발송함이 없어도 열린다", async () => {
	mock({ r1: [letter("a", ["r1"], "2026-12", "box")] }, { memos: { box: "전 반 공통 안내" } })
	eq((await buildLetterView("r1", "s1", "2026-12"))?.note, "전 반 공통 안내")
	mock({ r1: [letter("a", ["r1"], "2026-12")] })
	eq(await buildLetterView("r1", "s1", "2026-11"), null)
	const v = await buildLetterView("r1", "s1", "2026-12")
	eq([v?.note, v?.classBody], ["", []])
})

// ── (v2.8.0 항목 150) 월별 학습계획서: 반 × 달 발송함 하나, 학생 장 없음 ──
Deno.test("v2.8.0 항목 150 월별 학습계획서 목록: 그 등록의 반 학습계획 발송함 중 내용(메모·본문)이 있는 달만, 최근 달부터, 같은 달은 먼저 만든 것", async () => {
	const box = (id: string, month: string, created: string, memo = "", trash = false) => ({ id, created_time: created, in_trash: trash, properties: { "기간": { date: { start: `${month}-01` } }, "가정통신문 안내 메모": { rich_text: memo ? [{ plain_text: memo }] : [] } } })
	const boxes = [box("b12", "2026-12", "2026-11-20"), box("b12dup", "2026-12", "2026-11-21", "나중 것"), box("b11", "2026-11", "2026-10-20", "11월 계획"), box("b10", "2026-10", "2026-09-20"), box("bt", "2027-01", "2026-11-22", "지움", true)]
	const filters: any[] = []
	Object.assign(reportLetterDeps, {
		getPage: (id: string) => Promise.resolve(id === "reg1" ? { id, properties: { "클래스": rel("cls1") } } : { id, properties: {} }),
		batchDataSourceId: () => Promise.resolve("batches"),
		queryAllPages: (_ds: string, filter: any) => { filters.push(filter); return Promise.resolve(boxes) },
		hasBody: (id: string) => Promise.resolve(id === "b12"),
		body: (id: string) => Promise.resolve(id === "b12" ? [{ type: "paragraph", text: "12월에는 분수를 배워요" }] : []),
	})
	eq(await buildPlanList("reg1"), [{ month: "2026-12" }, { month: "2026-11" }])
	eq(filters[0], { and: [{ property: "클래스", relation: { contains: "cls1" } }, { property: "구분", select: { equals: "월별 학습계획" } }] })
	const v = await buildPlanView("reg1", "2026-12")
	eq([v?.label, v?.note, v?.classBody], ["12월", "", [{ type: "paragraph", text: "12월에는 분수를 배워요" }]])
	eq(await buildPlanView("reg1", "2027-03"), null)
	eq(await buildPlanList("regNoClass"), [])
})
