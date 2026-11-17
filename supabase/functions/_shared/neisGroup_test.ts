import { groupNeisRows, memberRows, continues, holidayDates, eventKey, ownedProperties, schoolPeriod, type NeisRow } from "./neisSchool.ts"
import { importRange, sameOwnedEvent } from "./neisManual.ts"
function assert(v: unknown, message = "assertion failed") { if (!v) throw new Error(message) }
const base: NeisRow = { ATPT_OFCDC_SC_CODE: "B10", SD_SCHUL_CODE: "7041238", AY: "2026", SCHUL_CRSE_SC_NM: "고등학교", DGHT_CRSE_SC_NM: "주간", EVENT_CNTNT: "", ONE_GRADE_EVENT_YN: "Y", TW_GRADE_EVENT_YN: "Y", THREE_GRADE_EVENT_YN: "N", SBTR_DD_SC_NM: "해당없음" }
const r = (AA_YMD: string, EVENT_NM: string, extra: Partial<NeisRow> = {}): NeisRow => ({ ...base, AA_YMD, EVENT_NM, ...extra })

// 2026-04-27(월)~04-30(목) 중간고사, 05-01(금) 근로자의 날 공휴일 아님 가정, 05-05(화) 어린이날 공휴일
Deno.test("이어진 날(평일 연속)은 한 줄, 끝날·묶인 날 기록", () => {
  const out = groupNeisRows([r("20260427", "1학기 중간고사"), r("20260428", "1학기 중간고사"), r("20260429", "1학기 중간고사"), r("20260430", "1학기 중간고사")])
  assert(out.length === 1 && out[0].AA_YMD === "20260427" && out[0].AA_YMD_END === "20260430")
  assert(memberRows(out[0]).length === 4 && memberRows(out[0])[3].AA_YMD === "20260430" && !("AA_YMD_END" in memberRows(out[0])[0]))
  const p = ownedProperties(out[0], "school", "key", [])
  assert(p["날짜"].date.start === "2026-04-27" && p["날짜"].date.end === "2026-04-30")
})

Deno.test("사이에 주말·공휴일만 있으면 이어짐, 평일이 비면 끊김", () => {
  const holiday = r("20260505", "어린이날", { SBTR_DD_SC_NM: "공휴일" })
  const hs = holidayDates([holiday])
  assert(continues("20260501", "20260504", hs)) // 금 → 월(주말 사이)
  assert(continues("20260504", "20260506", hs)) // 월 → 수(화 공휴일)
  assert(!continues("20260427", "20260429", hs)) // 월 → 수(화 평일 비어 있음)
  const out = groupNeisRows([r("20260430", "기말", {}), r("20260501", "기말"), r("20260504", "기말"), r("20260506", "기말"), holiday, r("20260508", "기말")])
  const g = out.filter(x => x.EVENT_NM === "기말")
  assert(g.length === 2 && g[0].AA_YMD_END === "20260506" && !g[1].AA_YMD_END, JSON.stringify(g.map(x => [x.AA_YMD, x.AA_YMD_END])))
})

Deno.test("이름·대상 학년·수업공제일명이 다르면 따로", () => {
  const out = groupNeisRows([
    r("20260427", "중간고사"), r("20260428", "중간고사", { THREE_GRADE_EVENT_YN: "Y" }),
    r("20260429", "중간고사", { SBTR_DD_SC_NM: "휴업일" }), r("20260430", "기말고사"),
  ])
  assert(out.length === 4 && out.every(x => !x.AA_YMD_END))
})

Deno.test("토요휴업일처럼 한 주씩 떨어진 줄은 묶지 않음, 하루짜리는 원래 줄·예전 키", async () => {
  const sats = [r("20260502", "토요휴업일", { SBTR_DD_SC_NM: "휴업일" }), r("20260509", "토요휴업일", { SBTR_DD_SC_NM: "휴업일" })]
  const out = groupNeisRows(sats)
  assert(out.length === 2 && out[0] === sats[0])
  assert(await eventKey(out[0], "s") === await eventKey(sats[0], "s"))
})

Deno.test("묶음 키 = 묶음+시작일: 끝날이 늘어도 같은 키, 하루짜리 키와는 다름", async () => {
  const a = groupNeisRows([r("20260427", "중간"), r("20260428", "중간")])[0]
  const b = groupNeisRows([r("20260427", "중간"), r("20260428", "중간"), r("20260429", "중간")])[0]
  assert(await eventKey(a, "s") === await eventKey(b, "s"))
  assert(await eventKey(a, "s") !== await eventKey(r("20260427", "중간"), "s"))
})

Deno.test("다시 가져오기 비교에 끝날 포함", () => {
  const g = groupNeisRows([r("20260427", "중간"), r("20260428", "중간")])[0]
  const props: any = ownedProperties(g, "school", "key", [])
  const page = { properties: { ...props, "이름": { title: [{ plain_text: "중간" }] }, "원본 행사내용": { rich_text: [] }, "수업공제일명": { rich_text: [{ plain_text: "해당없음" }] }, "대상 학년": { rich_text: [{ plain_text: "1학년, 2학년" }] } } }
  assert(sameOwnedEvent(page, g, "school", "key", []))
  const longer = groupNeisRows([r("20260427", "중간"), r("20260428", "중간"), r("20260429", "중간")])[0]
  assert(!sameOwnedEvent(page, longer, "school", "key", []))
})

Deno.test("학교 학사일정 기간: 비면 학년도 전체, 있으면 그 기간, 이상하면 오류", () => {
  const now = new Date("2026-11-18T00:00:00Z")
  const school = (date: unknown) => ({ properties: date === undefined ? {} : { "학사일정 기간": { type: "date", date } } })
  const all = importRange(school(undefined), now)
  assert(all.from === "20260301" && all.to === "20270228")
  assert(importRange(school(null), now).from === "20260301")
  const part = importRange(school({ start: "2026-09-01", end: "2026-12-31" }), now)
  assert(part.year === 2026 && part.from === "20260901" && part.to === "20261231")
  const one = importRange(school({ start: "2027-01-15", end: null }), now)
  assert(one.year === 2026 && one.from === "20270115" && one.to === "20270115")
  for (const bad of [{ start: "2026-12-31", end: "2026-09-01" }, { start: "2026-03-01", end: "2027-06-01" }]) {
    let threw = false; try { schoolPeriod(school(bad)) } catch { threw = true }; assert(threw, JSON.stringify(bad))
  }
})
