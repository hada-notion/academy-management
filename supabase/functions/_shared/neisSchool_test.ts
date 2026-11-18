import { eventKey, eventGrades, ownedProperties, newEventProperties, schoolCategory, newCategoryOption, categoryOptionsOf, safeWebsite, type NeisRow } from "./neisSchool.ts"
function assert(v: unknown, message = "assertion failed") { if (!v) throw new Error(message) }
const row: NeisRow = { ATPT_OFCDC_SC_CODE: "B10", SD_SCHUL_CODE: "7041238", AY: "2026", AA_YMD: "20261002", EVENT_NM: "중간고사", EVENT_CNTNT: "", SCHUL_CRSE_SC_NM: "중학교", ONE_GRADE_EVENT_YN: "N", TW_GRADE_EVENT_YN: "Y", THREE_GRADE_EVENT_YN: "N", SBTR_DD_SC_NM: "해당없음" }
Deno.test("대상 학년 Y만 연결", () => assert(JSON.stringify(eventGrades(row)) === "[2]"))
Deno.test("키는 내용 변경에 안정적, 학교/날짜/행사/학년 변경은 구별", async () => {
 const k = await eventKey(row, "abc")
 assert(k === await eventKey({ ...row, EVENT_CNTNT: "변경" }, "abc"))
 for (const r of [{ ...row, EVENT_NM: "기말고사" }, { ...row, AA_YMD: "20261003" }, { ...row, TW_GRADE_EVENT_YN: "N", THREE_GRADE_EVENT_YN: "Y" }]) assert(k !== await eventKey(r, "abc"))
 assert(k !== await eventKey(row, "def"))
})
Deno.test("숨김/메모/본문/진행상태 보존", () => { const props = ownedProperties(row, "abc", "key", ["grade2"]); for (const key of ["숨김", "학부모 공개", "메모", "진행상태", "태그", "담당자"]) assert(!(key in props)); assert(props["날짜"].date.start === "2026-10-02") })
Deno.test("공휴일/토요일/애매한 행사도 수집", () => { for (const name of ["한글날", "토요휴업일", "창체의날"]) assert(ownedProperties({ ...row, EVENT_NM: name }, "abc", "key", [])["이름"].title[0].text.content === name) })
Deno.test("웹사이트 안전 프로토콜", () => { assert(safeWebsite("javascript:alert(1)") === null); assert(safeWebsite("https://cheonwang.sen.ms.kr") === "https://cheonwang.sen.ms.kr/"); assert(safeWebsite(null) === null) })

Deno.test("나이스 100건 넘어도 페이지를 끝까지 수집", async () => {
  const { neisRows } = await import("./neisSchool.ts")
  const original = globalThis.fetch
  Deno.env.set("NEIS_API_KEY", "offline-test-only")
  let calls = 0
  globalThis.fetch = async input => {
    calls++; const u = new URL(String(input)); const index = Number(u.searchParams.get("pIndex"))
    return new Response(JSON.stringify({ SchoolSchedule: [{ head: [{ list_total_count: 102 }, { RESULT: { CODE: "INFO-000" } }] }, { row: Array.from({ length: index === 1 ? 100 : 2 }, () => row) }] }))
  }
  try { assert((await neisRows("SchoolSchedule", {})).length === 102); assert(calls === 2) }
  finally { globalThis.fetch = original; Deno.env.delete("NEIS_API_KEY") }
})
Deno.test("API 오류를 빈 목록으로 숨기지 않음", async () => {
 const { neisRows } = await import("./neisSchool.ts")
 const original = globalThis.fetch; Deno.env.set("NEIS_API_KEY", "offline-test-only")
 globalThis.fetch = async () => new Response(JSON.stringify({ RESULT: { CODE: "ERROR-290" } }))
 try { let failed = false; try { await neisRows("SchoolSchedule", {}) } catch { failed = true }; assert(failed) }
 finally { globalThis.fetch = original; Deno.env.delete("NEIS_API_KEY") }
})
Deno.test("인증키 없이는 샘플로 동기화하지 않음", async () => {
 const { neisRows } = await import("./neisSchool.ts")
 let failed = false; try { await neisRows("SchoolSchedule", {}) } catch { failed = true }; assert(failed)
})

Deno.test("신규 학사일정만 숨김 체크/학부모 비공개", () => {
 const props = newEventProperties(row, "school", "key", ["grade2"])
 assert(props["숨김"].checkbox === true)
 assert(props["학부모 공개"].checkbox === false)
 assert(!("숨김" in ownedProperties(row, "school", "key", ["grade2"])))
 assert(!("학부모 공개" in ownedProperties(row, "school", "key", ["grade2"])))
})

const OPTIONS = ["✅ 할일", "📆 학원 일정", "🏫 학교 행사", "📝 시험", "🏖️ 방학/휴교", "💤 휴원"]
Deno.test("구분 규칙 4줄", () => {
 // ① 공휴일·토요휴업일 → 방학/휴교
 for (const [name, deduct] of [["개천절", "공휴일"], ["토요휴업일", "휴업일"], ["토요휴업일", "해당없음"]] as const) assert(schoolCategory({ ...row, EVENT_NM: name, SBTR_DD_SC_NM: deduct }) === "방학/휴교", name)
 // ② 휴업일 → 방학/휴교 (이름에 시험이 있어도 휴업일이 먼저)
 for (const name of ["여름방학", "재량휴업일", "개교기념일", "시험 후 재량휴업"]) assert(schoolCategory({ ...row, EVENT_NM: name, SBTR_DD_SC_NM: "휴업일" }) === "방학/휴교", name)
 // ③ 고사·시험 → 시험
 for (const name of ["중간고사", "2학기 기말고사", "전국연합학력평가 시험"]) assert(schoolCategory({ ...row, EVENT_NM: name, SBTR_DD_SC_NM: "해당없음" }) === "시험", name)
 // ④ 그 밖 → 학교 행사 (수업공제일명이 비어도)
 for (const [name, deduct] of [["현장체험학습", "해당없음"], ["방학식", "해당없음"], ["체육대회", null]] as const) assert(schoolCategory({ ...row, EVENT_NM: name, SBTR_DD_SC_NM: deduct }) === "학교 행사", name)
})
Deno.test("새로 만들 때만 구분을 쓰고, 다시 가져오기(ownedProperties)는 구분을 건드리지 않음", () => {
 assert(newEventProperties(row, "school", "key", [], OPTIONS)["구분"]?.select.name === "📝 시험")
 const holiday = newEventProperties({ ...row, EVENT_NM: "토요휴업일", SBTR_DD_SC_NM: "휴업일" }, "school", "key", [], OPTIONS)
 assert(holiday["구분"]?.select.name === "🏖️ 방학/휴교" && holiday["숨김"].checkbox === true)
 assert(newEventProperties({ ...row, EVENT_NM: "체육대회" }, "school", "key", [], OPTIONS)["구분"]?.select.name === "🏫 학교 행사")
 assert(!("구분" in ownedProperties(row, "school", "key", [])))
})
Deno.test("구분 옵션 이름은 학원 DB의 것(이모지가 달라도 글자로), 새 값이 없으면 옛 학사 일정", () => {
 assert(newCategoryOption(row, ["📝시험"]) === "📝시험")
 assert(newCategoryOption(row, ["📆 학원 일정", "🏫 학사 일정", "💤 휴원"]) === "🏫 학사 일정")
 assert(newCategoryOption(row, []) === "🏫 학사 일정")
 assert(categoryOptionsOf({ properties: {} }).length === 0)
 assert(categoryOptionsOf({ properties: { "구분": { type: "rich_text", rich_text: {} } } }).length === 0)
 assert(JSON.stringify(categoryOptionsOf({ properties: { "구분": { type: "select", select: { options: OPTIONS.map(name => ({ name })) } } } })) === JSON.stringify(OPTIONS))
 const props = newEventProperties(row, "school", "key", [])
 assert(props["숨김"].checkbox === true && props["학부모 공개"].checkbox === false)
})

Deno.test("(2.8 잠금 칸 버림) 나이스 새 일정·다시 가져오기 모두 잠금을 쓰지 않음", () => {
 assert(!("잠금" in newEventProperties(row, "school", "key", [], OPTIONS)))
 assert(!("잠금" in newEventProperties(row, "school", "key", [])))
 assert(!("잠금" in ownedProperties(row, "school", "key", [])))
})

Deno.test("시험 낱말 넓힘: 지필·평가도 시험, 휴업일이면 방학/휴교가 먼저", () => {
  for (const name of ["지필평가(2,3학년)", "수능모의평가", "전국연합학력평가", "1학기 중간고사", "기말 시험"]) assert(schoolCategory({ ...row, EVENT_NM: name, SBTR_DD_SC_NM: "해당없음" }) === "시험", name)
  assert(schoolCategory({ ...row, EVENT_NM: "지필평가 후 재량휴업", SBTR_DD_SC_NM: "휴업일" }) === "방학/휴교")
  assert(schoolCategory({ ...row, EVENT_NM: "체육대회", SBTR_DD_SC_NM: "해당없음" }) === "학교 행사")
})
