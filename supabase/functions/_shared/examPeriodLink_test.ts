import { pickExamPeriod, linkExamPeriod, nameMatches, academicYearOf, examTargetName } from "./examPeriodLink.ts"
function assert(v: unknown, msg = "assertion failed") { if (!v) throw new Error(msg) }
const sel = (name: string) => ({ select: { name } })
const rel = (...ids: string[]) => ({ relation: ids.map(id => ({ id })) })
const title = (s: string) => ({ title: [{ plain_text: s }] })
const day = (start: string, end: string | null = null) => ({ date: { start, end } })
const exam = (지필고사 = "1학기 중간고사", 연도 = "2026") => ({ id: "exam", properties: { "이름": title("2026 1학기 중간"), "지필고사": sel(지필고사), "연도": sel(연도) } })
const info = (시험일 = "2026-04-28", 학년 = "g2") => ({ id: "info", properties: { "학교": rel("school"), "시험": rel("exam"), "학년": rel(학년), "시험일": day(시험일) } })
const ev = (id: string, name: string, start: string, end: string | null = null, cat = "📝 시험", grades: string[] = []) =>
  ({ id, properties: { "이름": title(name), "구분": sel(cat), "날짜": day(start, end), "학년": rel(...grades) } })

Deno.test("시험 이름 맞추기: 띄어쓰기 무시, 학기+중간/기말", () => {
  assert(nameMatches("1학기 중간고사", "1학기 중간고사"))
  assert(nameMatches("1학기중간고사(1,2학년)", "1학기 중간고사"))
  assert(nameMatches("1학기 1차 지필평가(중간고사)", "1학기 중간고사"))
  assert(!nameMatches("2학기 중간고사", "1학기 중간고사"))
  assert(!nameMatches("1학기 기말고사", "1학기 중간고사"))
  assert(examTargetName(exam()) === "1학기 중간고사")
  assert(academicYearOf("2027-02-10") === 2026 && academicYearOf("2026-03-02") === 2026)
})

Deno.test("하나면 잇고, 시험일이 기간 안이면 경고 없음", () => {
  const r = pickExamPeriod(info(), exam(), [ev("e1", "1학기 중간고사", "2026-04-27", "2026-04-30"), ev("e2", "1학기 기말고사", "2026-07-01", "2026-07-03")])
  assert(r.ok && r.eventId === "e1" && r.warning === "", JSON.stringify(r))
})

Deno.test("시험일이 기간 밖이면 잇되 경고", () => {
  const r = pickExamPeriod(info("2026-05-04"), exam(), [ev("e1", "1학기 중간고사", "2026-04-27", "2026-04-30")])
  assert(r.ok && r.eventId === "e1" && r.warning.includes("밖"), JSON.stringify(r))
})

Deno.test("없으면 오류(구분이 시험이 아님·다른 해·이름 다름 모두 빠짐)", () => {
  const r = pickExamPeriod(info(), exam(), [
    ev("a", "1학기 중간고사", "2026-04-27", null, "🏫 학교 행사"),
    ev("b", "1학기 중간고사", "2025-04-27"),
    ev("c", "2학기 중간고사", "2026-10-05"),
  ])
  assert(!r.ok && r.error.includes("없습니다"), JSON.stringify(r))
})

Deno.test("여럿이면 학년으로 좁히고, 그래도 여럿이면 오류에 목록", () => {
  const two = [ev("g1", "1학기 중간고사", "2026-04-27", "2026-04-29", "📝 시험", ["g1"]), ev("g2", "1학기 중간고사", "2026-04-28", "2026-04-30", "📝 시험", ["g2"])]
  const r1 = pickExamPeriod(info("2026-04-28", "g2"), exam(), two)
  assert(r1.ok && r1.eventId === "g2", JSON.stringify(r1))
  const r2 = pickExamPeriod(info("2026-05-10", "g3"), exam(), [ev("x", "1학기 중간고사", "2026-04-27"), ev("y", "1학기 중간고사 ", "2026-04-28")])
  assert(!r2.ok && r2.error.includes("2개"), JSON.stringify(r2))
})

Deno.test("옛 구분(🏫 학사 일정)은 시험 기간으로 보지 않음", () => {
  const r = pickExamPeriod(info(), exam(), [ev("old", "1학기 중간고사", "2026-04-27", null, "🏫 학사 일정")])
  assert(!r.ok)
})

Deno.test("흐름: 작업중 → 잇기 ✅ / 학교·시험 없으면 ⚠️, 찾지 못해도 함수는 결과로 끝남", async () => {
  const writes: [string, Record<string, unknown>][] = []
  const pages: Record<string, any> = { info: info(), exam: exam() }
  const deps = { getPage: async (id: string) => pages[id], schoolEvents: async () => [ev("e1", "1학기 중간고사", "2026-04-27", "2026-04-30")], update: async (id: string, p: Record<string, unknown>) => { writes.push([id, p]) }, now: () => "2026-11-18T00:00:00Z" }
  const ok = await linkExamPeriod("info", deps)
  assert(ok.ok)
  assert((writes[0][1]["상태"] as any).select.name === "🔄 작업중")
  const last = writes[writes.length - 1][1] as any
  assert(last["상태"].select.name === "✅ 완료" && last["시험일정"].relation[0].id === "e1" && last["마지막 오류"].rich_text.length === 0)
  writes.length = 0
  pages.info = { id: "info", properties: { "학교": rel(), "시험": rel("exam") } }
  const bad = await linkExamPeriod("info", deps)
  const lastBad = writes[writes.length - 1][1] as any
  assert(!bad.ok && lastBad["상태"].select.name === "⚠️ 오류" && !("시험일정" in lastBad))
})

Deno.test("시험 이름이 없으면 종류 낱말로: 지필평가(2,3학년) ↔ 지필고사, 다른 학기·중간/기말은 뺌", () => {
  const evs = [ev("p", "지필평가(2,3학년)", "2026-04-27", "2026-04-30"), ev("q", "2학기 지필평가", "2026-10-05", "2026-10-08"), ev("w", "1학기 기말고사", "2026-07-01")]
  const r = pickExamPeriod(info("2026-04-28"), exam(), evs)
  assert(r.ok && r.eventId === "p", JSON.stringify(r))
})

Deno.test("낱말로 여럿이면 시험일이 든 기간으로 좁힘", () => {
  const evs = [ev("a", "정기고사", "2026-04-27", "2026-04-30"), ev("b", "정기고사", "2026-07-01", "2026-07-03")]
  const r = pickExamPeriod(info("2026-07-02"), exam("1학기 기말고사"), evs)
  assert(r.ok && r.eventId === "b", JSON.stringify(r))
})

Deno.test("모의고사: 전국연합학력평가·수능모의평가를 낱말로, 'N월'로 좁힘", () => {
  const mock = (name: string) => ({ id: "exam", properties: { "이름": title(name), "시험 구분": sel("모의고사"), "모의고사(수능)": sel(name), "연도": sel("2026") } })
  const evs = [ev("m3", "전국연합학력평가", "2026-03-26"), ev("m6", "수능모의평가", "2026-06-04"), ev("m9", "수능모의평가", "2026-09-03"), ev("x", "1학기 중간고사", "2026-04-27")]
  const r6 = pickExamPeriod(info(""), mock("6월 모의고사"), evs)
  assert(r6.ok && r6.eventId === "m6", JSON.stringify(r6))
  const r3 = pickExamPeriod(info(""), mock("3월 모의고사"), evs)
  assert(r3.ok && r3.eventId === "m3", JSON.stringify(r3))
})

Deno.test("학기 표시 없는 일정은 날짜로 학기를 봄(원본 검수: 2학기 기말이 4월 지필평가에 이어지던 것)", () => {
  const evs = [ev("p1", "지필평가(2,3학년)", "2026-04-22", "2026-04-23")]
  const r = pickExamPeriod(info("2026-12-10"), exam("2학기 기말고사"), evs)
  assert(!r.ok && r.error.includes("없습니다"), JSON.stringify(r))
  const both = [ev("a", "1차 정기시험", "2026-04-27", "2026-04-30"), ev("b", "2차 정기시험", "2026-12-07", "2026-12-10")]
  const r1 = pickExamPeriod(info(""), exam("1학기 중간고사"), both)
  assert(r1.ok && r1.eventId === "a", JSON.stringify(r1))
  const r2 = pickExamPeriod(info(""), exam("2학기 기말고사"), both)
  assert(r2.ok && r2.eventId === "b", JSON.stringify(r2))
})
