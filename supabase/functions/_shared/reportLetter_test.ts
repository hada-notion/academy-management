// (v2.8.0 항목 146) 학부모 리포트 가정통신문: 학생당 한 장 — 달마다 한 줄, 본문은 다니는 반 전부의 일정·반별 전달사항.
import { buildLetterList, buildLetterView, reportLetterDeps } from "./reportLetter.ts"

function eq(a: unknown, b: unknown) {
	if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`다름\n 실제: ${JSON.stringify(a)}\n 기대: ${JSON.stringify(b)}`)
}
const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })), has_more: false })
const letter = (id: string, regs: string[], month: string, box?: string, sent = "") => ({
	id,
	properties: { "기간": { date: { start: `${month}-01` } }, "등록": rel(...regs), "알림톡 발송함": rel(...(box ? [box] : [])), "보낸 전달사항": { rich_text: sent ? [{ plain_text: sent }] : [] } },
})

function mock(rows: Record<string, any[]>, opts: { memos?: Record<string, string>; bodies?: Record<string, unknown[]>; lines?: any[]; regs?: any[]; classNotes?: { classId: string; name: string; text: string }[] } = {}) {
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
		classNotes: () => Promise.resolve(opts.classNotes ?? []),
	})
	return { filters, eventRegs }
}

// 한 장(a)이 수학 r1·영어 r2 두 등록에 걸림. 10월은 수학만 다닐 때 보낸 장.
const oneLetter = {
	r1: [letter("a", ["r1", "r2"], "2026-12", "box"), letter("old", ["r1"], "2026-10", "box10"), { ...letter("x", ["r1"], "2026-09"), in_trash: true }],
	r2: [letter("a", ["r1", "r2"], "2026-12", "box")],
}

Deno.test("v2.8.0 항목 146 가정통신문 목록: 보낸 달마다 한 줄(두 등록에 걸린 한 장도 한 줄), 최근 달부터", async () => {
	const { filters } = mock(oneLetter)
	eq(await buildLetterList(["r1", "r2"]), [
		{ month: "2026-12", registrationId: "r1" },
		{ month: "2026-10", registrationId: "r1" },
	])
	eq(filters[0].and[1], { property: "안내문 전송 상태", select: { equals: "✅ 완료" } })
})

Deno.test("v2.8.0 가정통신문 목록: 등록이 없으면 조회하지 않고, 조회 실패해도 동기화를 막지 않는다", async () => {
	const { filters } = mock({})
	eq(await buildLetterList([]), [])
	eq(filters.length, 0)
	reportLetterDeps.queryAllPages = () => Promise.reject(new Error("notion down"))
	eq(await buildLetterList(["r1"]), [])
})

Deno.test("v2.8.0 항목 146 가정통신문 본문: 다니는 반 전부의 일정, 보낸 때 박아 둔 반별 전달사항 + 보낸 뒤 더해진 반, 파일 blockId는 뺀다", async () => {
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
		// 지금 클래스 칸: 수학반은 보낸 뒤 비었고(박아 둔 것을 씀), 영어반은 보낸 뒤 더해짐
		classNotes: [{ classId: "cB", name: "영어반", text: "교재 지참" }, { classId: "cA", name: "수학반", text: "다음 달 글" }],
	})
	const v = await buildLetterView("r1", "s1", "2026-12")
	eq(v?.label, "12월")
	eq(eventRegs, [["r1", "r2"]])
	eq(v?.schedule, { rest: ["12.24(목)  방학"], academy: ["12.05(토)  설명회", "12.19(토)  특강"], school: [] })
	eq(v?.notes, [{ name: "수학반", text: "보강을 엽니다." }, { name: "영어반", text: "교재 지참" }])
	eq(v?.note, "수학반\n보강을 엽니다.\n\n영어반\n교재 지참")
	eq(v?.classBody, [{ type: "paragraph", text: "12월 안내" }, { type: "pdf", url: "https://f/a.pdf", name: "a.pdf" }])
	eq(v?.studentBody, [{ type: "paragraph", text: "서아 안내" }])
})

Deno.test("v2.8.0 가정통신문 본문: 반별 전달사항이 없으면 발송함 메모, 보낸 장이 없는 달은 null, 발송함이 없어도 열린다", async () => {
	mock({ r1: [letter("a", ["r1"], "2026-12", "box")] }, { memos: { box: "전 반 공통 안내" } })
	eq((await buildLetterView("r1", "s1", "2026-12"))?.note, "전 반 공통 안내")
	mock({ r1: [letter("a", ["r1"], "2026-12")] })
	eq(await buildLetterView("r1", "s1", "2026-11"), null)
	const v = await buildLetterView("r1", "s1", "2026-12")
	eq([v?.note, v?.notes, v?.classBody], ["", [], []])
})
