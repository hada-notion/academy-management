// (2.8) 시간표 적용 기간: 시작일·종료일 먼저, 비면 옛 적용 기간. 수업 만들기 직전 기간 확인.
import { periodOf, activeOn } from "./timetablePeriod.ts"
import { outsidePeriod, sessionPlanFromTimetable, type SessionPlan } from "./timetableSessionPlan.ts"
function assert(v: unknown, m = "assertion failed") { if (!v) throw new Error(m) }
const day = (start: string | null) => ({ type: "date", date: start ? { start, end: null } : null })
const range = (start: string, end: string | null) => ({ type: "date", date: { start, end } })
const tt = (p: Record<string, unknown>) => ({ properties: p })

Deno.test("시작일·종료일이 있으면 그것으로, 둘 다 비거나 칸이 없으면 옛 적용 기간", () => {
  assert(JSON.stringify(periodOf(tt({ 시작일: day("2026-11-03"), 종료일: day("2026-12-31"), "적용 기간": range("2026-01-01", "2026-02-01") }))) === '{"start":"2026-11-03","end":"2026-12-31"}')
  assert(JSON.stringify(periodOf(tt({ 시작일: day("2026-11-03"), 종료일: day(null) }))) === '{"start":"2026-11-03","end":null}') // 시작만 = 그날부터 계속
  assert(JSON.stringify(periodOf(tt({ 시작일: day(null), 종료일: day("2026-11-02") }))) === '{"start":null,"end":"2026-11-02"}') // 종료만 = 그날까지
  assert(JSON.stringify(periodOf(tt({ 시작일: day(null), 종료일: day(null), "적용 기간": range("2026-09-01", "2026-11-02") }))) === '{"start":"2026-09-01","end":"2026-11-02"}')
  assert(JSON.stringify(periodOf(tt({ "적용 기간": range("2026-11-03", "2026-11-03") }))) === '{"start":"2026-11-03","end":null}') // 옛 칸: 시작=끝이면 그날부터
  assert(JSON.stringify(periodOf(tt({}))) === '{"start":null,"end":null}')
  // 시각이 붙은 값은 서울 날짜로
  assert(periodOf(tt({ 시작일: { date: { start: "2026-11-02T16:00:00.000Z" } } })).start === "2026-11-03")
})

Deno.test("그 날짜에 적용 중인지(끝 포함, 비면 계속)", () => {
  const t = tt({ 시작일: day("2026-11-03"), 종료일: day("2026-11-30") })
  assert(!activeOn(t, "2026-11-02") && activeOn(t, "2026-11-03") && activeOn(t, "2026-11-30") && !activeOn(t, "2026-12-01"))
  assert(activeOn(tt({}), "2030-01-01"))
})

Deno.test("수업 만들기 직전: 기간 밖이면 만들지 않음, 기간이 없으면 계속", () => {
  const plan = (date: string, period?: SessionPlan["period"]): SessionPlan => ({ date, start: "20:00", end: "21:00", classId: "c", className: "n", teacherIds: [], regIds: [], period })
  assert(outsidePeriod(plan("2026-11-02", { start: "2026-11-03", end: null })))
  assert(outsidePeriod(plan("2026-12-01", { start: null, end: "2026-11-30" })))
  assert(!outsidePeriod(plan("2026-11-30", { start: "2026-11-03", end: "2026-11-30" })))
  assert(!outsidePeriod(plan("2026-11-02")))
  // 시간표 속성에서 계획을 읽을 때 기간도 함께 싣는다
  const U = "00000000-0000-4000-8000-000000000007"
  const props = { "클래스": { relation: [{ id: U }] }, "기준일": { formula: { date: { start: "2026-11-02" } } }, 종료일: day("2026-11-01"),
    "수업 추가 정보": { type: "formula", formula: { type: "string", string: JSON.stringify({ v: 1, date: "2026-11-02", start: "20:00", end: "21:00", cls: U, name: "중1 A", tch: [], reg: [] }) } } }
  const p = sessionPlanFromTimetable(props)!
  assert(p.period?.end === "2026-11-01" && outsidePeriod(p))
})
