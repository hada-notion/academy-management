// (2.8 2단계) 일정 세부 구분 — 세부 구분으로 판단하고 옛 구분·안내 구분도 같은 뜻으로 읽는다. 나이스 가져오기가 세부를 채운다.
import { eventKind, isPublicKind, kindSection, kindDisplay, KIND, isEventPage } from "./scheduleCategory.ts"
import { isParentPublicEvent } from "./scheduleVisibility.ts"
import { detailKind, detailOptionsOf, categoryIsSelect, newEventProperties, type NeisRow } from "./neisSchool.ts"
import { eventLabel, sectionOf } from "./scheduleNotice.ts"
function assert(v: unknown, m = "assertion failed") { if (!v) throw new Error(m) }
const sel = (name: string) => ({ type: "select", select: name ? { name } : null })
const page = (p: Record<string, unknown>) => ({ id: "e", properties: { 날짜: { type: "date", date: { start: "2026-11-20" } }, 숨김: { type: "checkbox", checkbox: false }, "학부모 공개": { type: "checkbox", checkbox: true }, ...p } })

Deno.test("세부 구분이 있으면 그것으로, 없으면 옛 구분·안내 구분으로 같은 뜻", () => {
  assert(eventKind(page({ "세부 구분": sel("상담") })) === KIND.COUNSEL)
  assert(eventKind(page({ "세부 구분": sel("👔 직원 회의"), 구분: sel("📆 학원 일정") })) === KIND.STAFF) // 세부가 먼저, 이모지 무관
  assert(eventKind(page({ 구분: sel("💤 휴원") })) === KIND.CLOSED)
  assert(eventKind(page({ 구분: sel("📆 학원 일정"), "안내 구분": sel("상담") })) === KIND.COUNSEL)
  assert(eventKind(page({ 구분: sel("📆 학원 일정"), "안내 구분": sel("테스트") })) === KIND.TEST)
  assert(eventKind(page({ 구분: sel("📆 학원 일정") })) === KIND.ACADEMY)
  assert(eventKind(page({ 구분: sel("🏫 학사 일정") })) === KIND.SCHOOL_EVENT)
  assert(eventKind(page({ 구분: sel("🏖️ 방학/휴교"), 이름: { type: "title", title: [{ plain_text: "여름방학" }] } })) === KIND.VACATION)
  assert(eventKind(page({ 구분: sel("🏖️ 방학/휴교") })) === KIND.SCHOOL_OFF) // 이름에 방학이 없으면 학교 휴업
  assert(eventKind(page({ 구분: sel("✅ 할일") })) === KIND.TODO)
  // 구분이 수식(할일/학원 일정/학사 일정)이어도 세부 구분이 비면 수식 값으로
  assert(eventKind(page({ 구분: { type: "formula", formula: { type: "string", string: "학원 일정" } } })) === KIND.ACADEMY)
  assert(eventKind(page({})) === "")
})

Deno.test("학부모 공개: 직원 회의·할일·모름은 빼고 전부", () => {
  for (const k of ["학원 휴원", "학원 행사", "상담", "테스트", "학교 행사", "시험", "방학", "학교 휴업"]) assert(isParentPublicEvent(page({ "세부 구분": sel(k) })), k)
  for (const k of ["직원 회의", "할일"]) assert(!isParentPublicEvent(page({ "세부 구분": sel(k) })), k)
  assert(!isParentPublicEvent(page({})))
  assert(isParentPublicEvent(page({ 구분: sel("📆 학원 일정") })))
  assert([isPublicKind(""), isPublicKind(KIND.STAFF)].every((v) => !v))
})

Deno.test("가정통신문 구역·일정 안내 구분·리포트 묶음 이름", () => {
  assert([kindSection(KIND.CLOSED), kindSection(KIND.SCHOOL_OFF), kindSection(KIND.EXAM), kindSection(KIND.COUNSEL)].join() === "휴원,학교,학교,학원")
  assert(sectionOf(page({ "세부 구분": sel("방학") })) === "학교" && sectionOf(page({ 구분: sel("💤 휴원") })) === "휴원")
  assert(eventLabel(page({ "세부 구분": sel("상담") })) === "상담")
  assert(eventLabel(page({ "세부 구분": sel("학원 행사"), "안내 구분": sel("상담") })) === "학원") // 세부가 있으면 세부로
  assert(eventLabel(page({ 구분: sel("📆 학원 일정"), "안내 구분": sel("상담") })) === "상담") // 이관 전
  assert(eventLabel(page({ 구분: sel("📆 학원 일정"), "안내 구분": sel("휴강") })) === "휴강")
  assert([kindDisplay(KIND.CLOSED), kindDisplay(KIND.VACATION), kindDisplay(KIND.COUNSEL)].join() === "💤 휴원,🏫 학사 일정,📆 학원 일정")
})

Deno.test("일정 페이지 알아보기: 구분 선택·수식 또는 세부 구분 + 날짜", () => {
  assert(isEventPage(page({ 구분: sel("📆 학원 일정") })))
  assert(isEventPage(page({ 구분: { type: "formula", formula: { string: "학원 일정" } } })))
  assert(isEventPage(page({ "세부 구분": sel("상담") })))
  assert(!isEventPage({ properties: { 구분: sel("평가") } }))
})

const row: NeisRow = { ATPT_OFCDC_SC_CODE: "B10", SD_SCHUL_CODE: "7041238", AY: "2026", AA_YMD: "20261002", EVENT_NM: "체육대회", EVENT_CNTNT: "", SCHUL_CRSE_SC_NM: "중학교", ONE_GRADE_EVENT_YN: "Y", SBTR_DD_SC_NM: "해당없음" }
Deno.test("나이스 세부 구분 규칙: 방학 → 학교 휴업(휴업일·공휴일·토요휴업일) → 시험 → 학교 행사", () => {
  const k = (EVENT_NM: string, SBTR_DD_SC_NM = "해당없음") => detailKind({ ...row, EVENT_NM, SBTR_DD_SC_NM })
  assert(k("여름방학", "휴업일") === "방학" && k("겨울방학") === "방학")
  assert(k("방학식") === "학교 행사") // 방학식은 행사
  assert(k("개교기념일", "휴업일") === "학교 휴업" && k("추석", "공휴일") === "학교 휴업" && k("토요휴업일") === "학교 휴업")
  assert(k("1학기 중간고사") === "시험" && k("지필평가(2,3학년)") === "시험")
  assert(k("체육대회") === "학교 행사")
})

Deno.test("나이스 새 일정: 세부 칸·선택지가 있을 때만 채움, 구분이 수식이면 구분을 쓰지 않음", () => {
  const DETAIL = ["✅ 할일", "💤 학원 휴원", "📆 학원 행사", "💬 상담", "📝 테스트", "👔 직원 회의", "🏫 학교 행사", "📝 시험", "🏖️ 방학", "🚫 학교 휴업"]
  const schema = { properties: { 구분: { type: "formula" }, "세부 구분": { type: "select", select: { options: DETAIL.map((name) => ({ name })) } } } }
  assert(!categoryIsSelect(schema) && detailOptionsOf(schema).length === 10)
  const p: any = newEventProperties({ ...row, EVENT_NM: "추석", SBTR_DD_SC_NM: "공휴일" }, "s", "k", [], ["🏫 학교 행사"], { categorySelect: false, detailOptions: detailOptionsOf(schema) })
  assert(!("구분" in p) && p["세부 구분"].select.name === "🚫 학교 휴업" && p["숨김"].checkbox === true && !("잠금" in p))
  // 세부 칸이 없는 학원(이관 전): 세부는 안 쓰고 구분만(예전과 같음)
  const old: any = newEventProperties(row, "s", "k", [], ["🏫 학교 행사"])
  assert(!("세부 구분" in old) && old["구분"].select.name === "🏫 학교 행사")
})

Deno.test("옛 방학/휴교: 이름에 방학(방학식 빼고) → 방학, 나머지 → 학교 휴업(노션 옮기기와 같은 규칙)", () => {
  const old = (name: string) => eventKind(page({ 구분: sel("🏖️ 방학/휴교"), 이름: { type: "title", title: [{ plain_text: name }] } }))
  for (const n of ["여름방학", "동계방학", "하계 방학"]) assert(old(n) === KIND.VACATION, n)
  for (const n of ["토요휴업일", "대체공휴일", "학교장재량휴업일", "삼일절", "대학수학능력시험", "지방선거일"]) assert(old(n) === KIND.SCHOOL_OFF, n)
})
