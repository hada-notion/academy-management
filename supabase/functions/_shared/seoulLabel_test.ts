// 한국 시각 경계 시험(261119 9시간 점검): 학습기록·과제 제목 날짜, 리포트 이번 달 출석 요약.
import { seoulLabel } from "./seoulLabel.ts"
import { inSeoulMonth } from "./reportCacheBuilder.ts"

function eq(a: unknown, b: unknown) {
	if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

Deno.test("seoulLabel: 한국 아침 08:59·09:00 수업도 그날 날짜·요일", () => {
	eq(seoulLabel("2026-11-18T23:59:00.000Z"), "11.19(목)") // 한국 11/19 08:59
	eq(seoulLabel("2026-11-19T00:00:00.000Z"), "11.19(목)") // 한국 11/19 09:00
	eq(seoulLabel("2026-11-19T08:59:00+09:00"), "11.19(목)")
	eq(seoulLabel("2026-11-18T14:59:00.000Z"), "11.18(수)") // 한국 11/18 23:59
	eq(seoulLabel("2026-11-18T15:00:00.000Z"), "11.19(목)") // 한국 11/19 00:00
})

Deno.test("seoulLabel: 날짜만 있는 값·빈 값", () => {
	eq(seoulLabel("2026-11-19"), "11.19(목)")
	eq(seoulLabel(null), "")
	eq(seoulLabel("아님"), "")
})

Deno.test("inSeoulMonth: 매달 1일 한국 00:30에도 이번 달은 그 달", () => {
	// 한국 12/01 00:30 = UTC 11/30 15:30 → 서울 오늘 2026-12-01
	const today = new Date("2026-11-30T15:30:00.000Z").toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
	eq(today, "2026-12-01")
	eq(inSeoulMonth("2026-11-30T15:30:00.000Z", today), true) // 12/01 00:30 수업
	eq(inSeoulMonth("2026-11-30T23:59:00.000Z", today), true) // 12/01 08:59 수업
	eq(inSeoulMonth("2026-11-30T14:59:00.000Z", today), false) // 11/30 23:59 수업 = 지난달
	eq(inSeoulMonth("2026-12-01", today), true)
	eq(inSeoulMonth("2026-11-30", today), false)
	eq(inSeoulMonth(null, today), false)
})
