// (v2.8.0) 학부모 리포트 가정통신문: 보낸 달 목록과 한 통의 본문.
import { buildLetterList, buildLetterView, reportLetterDeps } from "./reportLetter.ts"

function eq(a: unknown, b: unknown) {
	if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`다름\n 실제: ${JSON.stringify(a)}\n 기대: ${JSON.stringify(b)}`)
}
const rel = (...ids: string[]) => ({ type: "relation", relation: ids.map((id) => ({ id })), has_more: false })
const letter = (id: string, reg: string, month: string, box?: string) => ({
	id,
	properties: { "기간": { date: { start: `${month}-01` } }, "등록": rel(reg), "알림톡 발송함": rel(...(box ? [box] : [])) },
})
const regPage = (id: string, name: string) => ({ id, properties: { "클래스명(등록)": { rollup: { type: "array", array: [{ type: "rich_text", rich_text: [{ plain_text: name }] }] } } } })

function mock(rows: Record<string, any[]>, opts: { note?: string; bodies?: Record<string, unknown[]>; lines?: any[] } = {}) {
	const filters: any[] = []
	Object.assign(reportLetterDeps, {
		dataSourceId: () => Promise.resolve("ds"),
		queryAllPages: (_ds: string, filter: any) => {
			filters.push(filter)
			return Promise.resolve(rows[filter.and[0].relation.contains] ?? [])
		},
		regsInMonth: () => Promise.resolve([regPage("r1", "중2 수학"), regPage("r2", "중2 영어")]),
		events: () => Promise.resolve(opts.lines ?? []),
		note: () => Promise.resolve(opts.note ?? "없음"),
		body: (id: string) => Promise.resolve(opts.bodies?.[id] ?? []),
	})
	return filters
}

Deno.test("v2.8.0 가정통신문 목록: 보낸 장만 찾고, 두 반이어도 달마다 한 줄, 최근 달부터", async () => {
	const filters = mock({
		r1: [letter("a", "r1", "2026-10"), letter("b", "r1", "2026-12"), { ...letter("x", "r1", "2026-09"), in_trash: true }],
		r2: [letter("c", "r2", "2026-12")],
	})
	eq(await buildLetterList(["r1", "r2"]), [{ month: "2026-12" }, { month: "2026-10" }])
	eq(filters[0].and[1], { property: "안내문 전송 상태", select: { equals: "✅ 완료" } })
})

Deno.test("v2.8.0 가정통신문 목록: 등록이 없으면 조회하지 않고, 조회 실패해도 동기화를 막지 않는다", async () => {
	const filters = mock({})
	eq(await buildLetterList([]), [])
	eq(filters.length, 0)
	reportLetterDeps.queryAllPages = () => Promise.reject(new Error("notion down"))
	eq(await buildLetterList(["r1"]), [])
})

Deno.test("v2.8.0 가정통신문 본문: 일정 구역·전달사항·반 공통 본문(발송함마다 한 번)·학생별 본문, 파일 blockId는 뺀다", async () => {
	mock({
		r1: [letter("a", "r1", "2026-12", "box1")],
		r2: [letter("c", "r2", "2026-12", "box2"), letter("old", "r2", "2026-11", "box9")],
	}, {
		note: "보강을 엽니다.",
		bodies: {
			box1: [{ type: "paragraph", text: "수학 안내" }, { type: "pdf", blockId: "blk", url: "https://f/a.pdf", name: "a.pdf" }],
			box2: [],
			a: [{ type: "paragraph", text: "서아 안내" }],
		},
		lines: [
			{ id: "1", day: "2026-12-24", line: "12/24(목) 방학", sec: "휴원" },
			{ id: "2", day: "2026-12-19", line: "12/19(토) 특강", sec: "학원" },
			{ id: "3", day: "2026-12-05", line: "12/5(토) 설명회", sec: "학원" },
		],
	})
	const v = await buildLetterView(["r1", "r2"], "s1", "2026-12")
	eq(v?.label, "12월")
	eq(v?.classes, ["중2 수학", "중2 영어"])
	eq(v?.schedule, { rest: ["12.24(목)  방학"], academy: ["12.05(토)  설명회", "12.19(토)  특강"], school: [] })
	eq(v?.note, "보강을 엽니다.")
	eq(v?.commonBodies, [{ className: "중2 수학", body: [{ type: "paragraph", text: "수학 안내" }, { type: "pdf", url: "https://f/a.pdf", name: "a.pdf" }] }])
	eq(v?.body, [{ type: "paragraph", text: "서아 안내" }])
})

Deno.test("v2.8.0 가정통신문 본문: 보낸 장이 없는 달은 null, 전달사항이 '없음'이면 비운다", async () => {
	mock({ r1: [letter("a", "r1", "2026-12")] })
	eq(await buildLetterView(["r1"], "s1", "2026-11"), null)
	eq((await buildLetterView(["r1"], "s1", "2026-12"))?.note, "")
})
