// appSave 단위 시험(v2.8.0 항목 75): 평평한 값 → Notion 속성, 저장 요청 검사, tmp 관계, 고치기 전 DB 확인 · 충돌.
// (지우기 · op delete: 허용 DB · 막는 관계 · 복사본 즉시 삭제 시험은 아래쪽)
// Notion · Supabase는 모두 가짜 응답. 실제 키 · 데이터 없음.
import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { toNotionProps, checkChanges, saveChanges, runGenerateClasses, writeOptions, SaveError, isWriteDb, checkAllowedProps, eventAffectsReport, saveDeps, checkRequestProp, FINANCE_PROPS } = await import("./appSave.ts")
const refreshed: string[] = []
saveDeps.refreshReport = (id: string) => { refreshed.push(id) }

// (재무 2바퀴) 결제 · 청구 결제 · 청구 항목 칸 형식 — 칸 형식도 10분 기억되고 선택지 목록 시험이 먼저 읽으므로 여기서 한 번 정한다.
const opts = (...n: string[]) => ({ options: n.map((name) => ({ name })) })
const PAY_SCHEMA = {
  결제: { type: "title" }, "결제 금액": { type: "number" }, 결제일: { type: "date" }, 구분: { type: "select", select: opts("지출", "매출") },
  "결제 수단": { type: "select", select: opts("현금", "카드", "계좌이체", "기타") }, 기타경비: { type: "number" }, 비고: { type: "rich_text" }, 손익: { type: "formula" }, 수강료: { type: "relation" },
}
const IPAY_SCHEMA = { 이름: { type: "title" }, "결제 금액": { type: "number" }, "결제 방법": { type: "select", select: opts("계좌이체", "현금", "카드", "기타") }, 결제일: { type: "date" }, 교재배부: { type: "relation" }, 결제상태: { type: "rollup" } }

// DB 찾기 결과는 10분 동안 기억되므로(아래 시험들도 같은 목록을 씀) 이 시험이 가장 먼저 Notion 검색을 흉내 낸다.
Deno.test("선택지 목록: 쓸 수 있는 DB의 고르기 칸만, 웹훅 칸 · 읽기 전용 DB는 없음", async () => {
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = String(input)
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/v1/search")) return ok({ results: [
      { id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] },
      { id: "ds-lib", title: [{ plain_text: "라이브러리(학원) DB" }] }, { id: "ds-tu", title: [{ plain_text: "수강료(학원) DB" }] },
      { id: "ds-ev", title: [{ plain_text: "일정(학원) DB" }] }, { id: "ds-tt", title: [{ plain_text: "시간표(학원) DB" }] },
      { id: "ds-pay", title: [{ plain_text: "결제(학원) DB" }] }, { id: "ds-item", title: [{ plain_text: "청구 항목(학원) DB" }] },
      { id: "ds-ipay", title: [{ plain_text: "청구 결제(학원) DB" }] }], has_more: false }) // 결제 · 청구 결제 · 청구 항목: 아래 record-payment 시험(DB 찾기는 10분 기억)
    if (url.includes("/v1/data_sources/ds-pay")) return ok({ properties: PAY_SCHEMA })
    if (url.includes("/v1/data_sources/ds-ipay")) return ok({ properties: IPAY_SCHEMA })
    if (url.includes("/v1/data_sources/ds-lib")) return ok({ properties: {
      교재명: { type: "title" }, 시리즈: { type: "select", select: { options: [{ name: "쎈" }, { name: "개념원리" }] } },
      "교재 유형": { type: "multi_select", multi_select: { options: [{ name: "개념" }] } }, "웹훅 버튼": { type: "select", select: { options: [{ name: "x" }] } } } })
    // 칸 형식은 10분 기억되므로 일정 DB 형식도 여기서 아래 시험과 같게 준다.
    if (url.includes("/v1/data_sources/ds-ev")) return ok({ properties: { 이름: { type: "title" }, 날짜: { type: "date" }, 잠금: { type: "checkbox" }, 숨김: { type: "checkbox" }, "학부모 공개": { type: "checkbox" }, 메모: { type: "rich_text" } } })
    if (url.includes("/v1/data_sources/ds-")) return ok({ properties: { 이름: { type: "title" }, 학생: { type: "relation" } } })
    return new Response("unexpected " + url, { status: 500 })
  }) as typeof fetch
  const o = await writeOptions()
  assertEquals(o["라이브러리(학원) DB"], { 시리즈: ["쎈", "개념원리"], "교재 유형": ["개념"] })
  assertEquals([o["학생(학원) DB"], "수강료(학원) DB" in o, "강사(학원) DB" in o], [{}, true, false]) // (재무 서버 261123) 수강료는 쓰기 DB
})

Deno.test("수업 생성 실행: 복사본에 있는 시간표만 기존 큐(generate-classes)에, 없는 id는 건너뜀", async () => {
  const A = "a".repeat(32), B = "b".repeat(32), Z = "c".repeat(32)
  const queued: any[] = []
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/rest/v1/app_rows?select=id")) return new Response(JSON.stringify([{ id: A }, { id: B }]), { status: 200 })
    if (url.includes("/rest/v1/sync_queue") && init?.method === "POST") { queued.push(...JSON.parse(String(init.body))); return new Response(null, { status: 201 }) }
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  assertEquals(await runGenerateClasses([A, Z]), { queued: 1, skipped: 1 })
  assertEquals(await runGenerateClasses(), { queued: 2, skipped: 0 })
  assertEquals(queued.length, 3)
  assertEquals(queued.every((q) => q.target === "generate-classes" && typeof q.payload?.timetableId === "string"), true)
  let err: unknown; try { await runGenerateClasses([Z]) } catch (e) { err = e }
  assertEquals(err instanceof SaveError, true)
})

const schema = {
  이름: { type: "title" }, 메모: { type: "rich_text" }, 수강료: { type: "number" },
  상태: { type: "select", options: ["등록 중", "종료"] }, 요일: { type: "multi_select", options: ["월", "수"] },
  등록일: { type: "date" }, 반평균숨김: { type: "checkbox" }, 클래스: { type: "relation" }, 전화: { type: "phone_number" },
  학생수: { type: "formula" }, 생성: { type: "button" },
}
const ID = "0123456789abcdef0123456789abcdef"

Deno.test("평평한 값 → Notion 속성(형식마다)", () => {
  assertEquals(toNotionProps({ 이름: "하다", 메모: "", 수강료: "270000", 상태: "등록 중", 요일: ["월", "수"], 등록일: "2026-11-01", 반평균숨김: true, 클래스: [ID, ID], 전화: "010-0000-0000" }, schema), {
    이름: { title: [{ type: "text", text: { content: "하다" } }] }, 메모: { rich_text: [] }, 수강료: { number: 270000 },
    상태: { select: { name: "등록 중" } }, 요일: { multi_select: [{ name: "월" }, { name: "수" }] },
    등록일: { date: { start: "2026-11-01", end: null } }, 반평균숨김: { checkbox: true }, 클래스: { relation: [{ id: ID }] }, 전화: { phone_number: "010-0000-0000" },
  })
  assertEquals(toNotionProps({ 상태: "", 등록일: null, 수강료: "" }, schema), { 상태: { select: null }, 등록일: { date: null }, 수강료: { number: null } })
  assertEquals(toNotionProps({ 등록일: { start: "2026-11-01", end: "2026-12-19" } }, schema), { 등록일: { date: { start: "2026-11-01", end: "2026-12-19" } } })
})

Deno.test("쓰지 않는 값: 없는 칸 · 수식 · 버튼 · 선택지에 없는 값 · 숫자 아님 · 날짜 형식 · id 아닌 관계", () => {
  for (const p of [{ 없는칸: 1 }, { 학생수: 3 }, { 생성: 1 }, { 상태: "휴원" }, { 요일: ["화"] }, { 수강료: "abc" }, { 등록일: "11/1" }, { 클래스: ["abc"] }])
    assertThrows(() => toNotionProps(p as never, schema), SaveError)
})

Deno.test("tmp 관계는 앞에서 만든 id로", () => {
  assertEquals(toNotionProps({ 클래스: ["tmp:c1"] }, schema, (v) => v === "tmp:c1" ? ID : v), { 클래스: { relation: [{ id: ID }] } })
})

Deno.test("저장 요청 검사: 빈 목록 · 많은 줄 · 쓸 수 없는 DB · id 없는 고치기 · 허용 밖 DB 지우기 없음", () => {
  for (const bad of [[], Array(61).fill({ op: "create", db: "학생(학원) DB", props: {} }), [{ op: "create", db: "출석(학원) DB", props: {} }],
    [{ op: "update", db: "학생(학원) DB", props: {} }], [{ op: "delete", db: "일정(학원) DB", id: ID }], [{ op: "bogus", db: "학생(학원) DB" }]])
    assertThrows(() => checkChanges(bad), SaveError)
  assertEquals(checkChanges([{ op: "create", db: "등록(학원) DB", tmp: "tmp:e1", props: {} }]).length, 1)
  assertEquals([isWriteDb("시간표(학원) DB"), isWriteDb("출석(학원) DB")], [true, false])
  // (261119) 시험 화면 입력은 쓰기. (재무 서버 261123) 재무는 수강료 · 기타경비 · 청구서 · 청구 항목만 쓰기, (2바퀴) 결제 · 청구 결제도 쓰기(칸 규칙은 PAYMENT_RULES)
  assertEquals(["시험(학원) DB", "시험정보(학원) DB", "성적(학원) DB"].map(isWriteDb), [true, true, true])
  assertEquals(["수강료(학원) DB", "결제(학원) DB", "청구 결제(학원) DB", "청구 항목(학원) DB", "기타경비(학원) DB", "청구서(학원) DB"].map(isWriteDb), [true, true, true, true, true, true])
  assertEquals(checkChanges([{ op: "create", db: "성적(학원) DB", props: {} }]).length, 1)
  assertThrows(() => checkChanges([{ op: "delete", db: "성적(학원) DB", id: ID, props: {} }]), SaveError)
})

// ---------- saveChanges(가짜 Notion · Supabase) ----------
type Call = { url: string; method: string; body?: any }
function mockFetch(opts: { copyDb?: string; edited?: string; locked?: boolean; copyFails?: boolean }) {
  const calls: Call[] = []
  let n = 0
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/v1/search")) return ok({ results: [{ id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] }, { id: "ds-ev", title: [{ plain_text: "일정(학원) DB" }] }, { id: "ds-tt", title: [{ plain_text: "시간표(학원) DB" }] }], has_more: false })
    if (url.includes("/v1/data_sources/ds-ev")) return ok({ properties: { 이름: { type: "title" }, 날짜: { type: "date" }, 잠금: { type: "checkbox" }, 숨김: { type: "checkbox" }, "학부모 공개": { type: "checkbox" }, 메모: { type: "rich_text" } } })
    if (url.includes("/v1/data_sources/ds-")) return ok({ properties: { 이름: { type: "title" }, 학생: { type: "relation" } } })
    if (url.endsWith("/v1/pages") && method === "POST") { n++; return ok({ id: `${"0".repeat(31)}${n}`, url: "u", properties: body.properties, last_edited_time: "2026-11-17T00:00:00.000Z" }) }
    if (url.includes("/v1/pages/") && method === "GET") return ok({ id: ID, properties: opts.locked ? { 잠금: { type: "checkbox", checkbox: true } } : {}, last_edited_time: opts.edited ?? "2026-11-17T00:00:00.000Z" })
    if (url.includes("/v1/pages/") && method === "PATCH") return ok({ id: ID, properties: body.properties, last_edited_time: "2026-11-17T01:00:00.000Z" })
    if (url.includes("/rest/v1/app_rows?select=db")) return ok(opts.copyDb ? [{ db: opts.copyDb }] : [])
    if (url.includes("/rest/v1/app_rows") && opts.copyFails && method === "POST") return new Response('{"message":"copy write failed"}', { status: 400 })
    if (url.includes("/rest/v1/app_rows")) return new Response(null, { status: 201 })
    return new Response("unexpected " + url, { status: 500 })
  }) as typeof fetch
  return calls
}

Deno.test("만들기: 학생 → 등록(tmp로 학생 연결), 복사본에 반영", async () => {
  const calls = mockFetch({})
  const r = await saveChanges(checkChanges([
    { op: "create", db: "학생(학원) DB", tmp: "tmp:s1", props: { 이름: "예시 학생" } },
    { op: "create", db: "등록(학원) DB", props: { 이름: "예시 등록", 학생: ["tmp:s1"] } },
  ]))
  assertEquals(r.map((x) => x.ok), [true, true])
  const created = calls.filter((c) => c.url.endsWith("/v1/pages"))
  assertEquals(created[1].body.properties.학생, { relation: [{ id: r[0].id }] })
  assertEquals(created[0].body.parent, { data_source_id: "ds-stu" })
  assertEquals(calls.filter((c) => c.url.includes("/rest/v1/app_rows?on_conflict=id")).length, 2)
})

Deno.test("고치기: 다른 DB 줄이면 쓰지 않음, 그사이 바뀌면 충돌", async () => {
  mockFetch({ copyDb: "등록(학원) DB" })
  let r = await saveChanges(checkChanges([{ op: "update", db: "학생(학원) DB", id: ID, props: { 이름: "x" } }]))
  assertEquals([r[0].ok, r[0].error], [false, "이 DB의 줄이 아닙니다."])
  const calls = mockFetch({ copyDb: "학생(학원) DB", edited: "2026-11-17T05:00:00.000Z" })
  r = await saveChanges(checkChanges([{ op: "update", db: "학생(학원) DB", id: ID, edited: "2026-11-17T00:00:00.000Z", props: { 이름: "x" } }]))
  assertEquals([r[0].ok, r[0].conflict], [false, true])
  assertEquals(calls.some((c) => c.method === "PATCH"), false)
})

Deno.test("앞 줄이 실패하면 그 tmp를 가리키는 뒤 줄도 실패, 다른 줄은 계속", async () => {
  mockFetch({})
  const r = await saveChanges(checkChanges([
    { op: "create", db: "학생(학원) DB", tmp: "tmp:s1", props: { 없는칸: "x" } },
    { op: "create", db: "등록(학원) DB", props: { 학생: ["tmp:s1"] } },
    { op: "create", db: "학생(학원) DB", props: { 이름: "다른 학생" } },
  ]))
  assertEquals(r.map((x) => x.ok), [false, false, true])
})

// (261123 출시 전 5번) 노션엔 만들었는데 사본 쓰기만 실패: 실패로 답하면 앱이 다시 만들어 중복이 생긴다.
Deno.test("출시 전 5번: 사본 쓰기만 실패해도 새 id와 함께 성공 + '노션엔 저장됨, 앱 사본만 못 맞춤', tmp를 가리키는 뒤 줄도 이어 감", async () => {
  const calls = mockFetch({ copyFails: true })
  const r = await saveChanges(checkChanges([
    { op: "create", db: "학생(학원) DB", tmp: "tmp:s1", props: { 이름: "예시 학생" } },
    { op: "create", db: "등록(학원) DB", props: { 이름: "예시 등록", 학생: ["tmp:s1"] } },
  ]))
  assertEquals(r.map((x) => x.ok), [true, true])
  assertEquals(typeof r[0].id, "string")
  assertEquals(r[0].tmp, "tmp:s1")
  assertEquals(r[0].warn, "노션엔 저장됨, 앱 사본만 못 맞춤 — 잠시 뒤 저절로 맞춰져요(다시 저장하지 않아도 돼요)")
  assertEquals(calls.filter((c) => c.url.endsWith("/v1/pages")).length, 2, "노션에 한 번씩만")
  assertEquals(calls.filter((c) => c.url.endsWith("/v1/pages"))[1].body.properties.학생, { relation: [{ id: r[0].id }] })
})

// ---------- 일정(학원) DB(2.8): 앱이 쓰는 칸만, 잠긴 줄 날짜 거절, 리포트 맞추기 ----------
const EV = "일정(학원) DB"
Deno.test("일정: 받는 칸 12개만(잠금 칸 버림), 그 밖 칸은 거절", () => {
  checkAllowedProps(EV, { 이름: "x", 날짜: { start: "2026-04-27", end: "2026-04-30" }, "세부 구분": "시험", "기록(내부용)": "", 숨김: false, "학부모 공개": true, 클래스: [], 학생: [], 학교: [], 학년: [] })
  for (const p of [{ 메모: "x" }, { "NEIS 동기화키": "k" }, { 수업공제일명: "x" }, { "원본 행사내용": "x" }, { 잠금: true }]) assertThrows(() => checkAllowedProps(EV, p), SaveError)
  checkAllowedProps("학생(학원) DB", { 메모: "x" }) // 다른 DB는 그대로
})
Deno.test("루틴(261119): 이름·클래스·순서·설명·쉬기만 받고 루틴 체크·지우기는 거절", () => {
  const RT = "루틴(학원) DB"
  assertEquals(isWriteDb(RT), true)
  checkAllowedProps(RT, { 이름: "단어 암기", 클래스: [], 순서: 1, 설명: "", 쉬기: false })
  assertThrows(() => checkAllowedProps(RT, { "루틴 체크": [] }), SaveError)
  assertEquals(checkChanges([{ op: "create", db: RT, props: {} }]).length, 1)
  assertThrows(() => checkChanges([{ op: "delete", db: RT, id: ID, props: {} }]), SaveError)
})
Deno.test("일정: 리포트 맞추기는 기록(내부용)만 바꾼 때 빼고", () => {
  assertEquals([eventAffectsReport(EV, { "학부모 공개": false }), eventAffectsReport(EV, { 날짜: "2026-05-01" }), eventAffectsReport("학생(학원) DB", { 이름: "x" })], [true, true, false])
})
Deno.test("일정 저장: (잠금 칸 버림) 예전에 잠긴 줄이어도 날짜를 쓰고, 숨김 고치기도 쓰고 리포트 맞춤", async () => {
  refreshed.length = 0
  let calls = mockFetch({ copyDb: EV, locked: true })
  let r = await saveChanges(checkChanges([{ op: "update", db: EV, id: ID, props: { 날짜: { start: "2026-05-01", end: "2026-05-03" } } }]))
  assertEquals(r[0].ok, true)
  assertEquals(calls.some((c) => c.method === "PATCH"), true)
  calls = mockFetch({ copyDb: EV, locked: true })
  r = await saveChanges(checkChanges([{ op: "update", db: EV, id: ID, props: { "학부모 공개": false } }]))
  assertEquals(r[0].ok, true)
  assertEquals(calls.some((c) => c.method === "PATCH"), true)
  assertEquals(refreshed, [ID, ID]) // 날짜·학부모 공개 둘 다 리포트에 영향
  r = await saveChanges(checkChanges([{ op: "update", db: EV, id: ID, props: { 메모: "x" } }]))
  assertEquals(r[0].ok, false)
})

Deno.test("일정(2.8 2단계): 세부 구분·기록(내부용) 받고 구분은 거절, 기록만 바꾸면 리포트 맞추기 안 함", () => {
  checkAllowedProps(EV, { "세부 구분": "상담", "기록(내부용)": "메모" })
  assertThrows(() => checkAllowedProps(EV, { 구분: "📆 학원 일정" }), SaveError)
  assertEquals([eventAffectsReport(EV, { "기록(내부용)": "x" }), eventAffectsReport(EV, { "세부 구분": "상담" })], [false, true])
})

Deno.test("일정(홈 할 일 261124): 진행상태·담당자 받고, 그것만 바꾸면 리포트 맞추기 안 함", () => {
  checkAllowedProps(EV, { 진행상태: "완료", 담당자: [] })
  checkAllowedProps(EV, { 완료: "완료" }) // 칸 이름을 "완료"로 바꾼 뒤
  assertEquals(eventAffectsReport(EV, { 완료: "완료" }), false)
  assertEquals([eventAffectsReport(EV, { 진행상태: "완료" }), eventAffectsReport(EV, { 담당자: [] }), eventAffectsReport(EV, { 진행상태: "완료", 날짜: "2026-05-01" })], [false, false, true])
})

Deno.test("칸 이름 바꾼 뒤(261124): 옛 이름 진행상태로 와도 새 이름 완료로 쓰고, 옛 이름이 있는 DB는 그대로", () => {
  const sch = { 완료: { type: "status" } } as never
  assertEquals(toNotionProps({ 진행상태: "완료" }, sch), { 완료: { status: { name: "완료" } } })
  assertEquals(toNotionProps({ 진행상태: "완료" }, { 진행상태: { type: "status" } } as never), { 진행상태: { status: { name: "완료" } } })
})

Deno.test("일정 할 일 두 칸(261124): 달성여부 · 우선순위 받고 리포트 맞추기 안 함, 아이콘 붙은 선택지로 맞춤", () => {
  checkAllowedProps(EV, { 달성여부: "달성", 우선순위: "" })
  assertEquals([eventAffectsReport(EV, { 달성여부: "달성" }), eventAffectsReport(EV, { 우선순위: "중요" })], [false, false])
  const sch = { 달성여부: { type: "select", options: ["✔️ 달성", "✖️ 미달성"] }, 우선순위: { type: "select", options: ["‼️ 중요", "💤 보류"] } } as never
  assertEquals(toNotionProps({ 달성여부: "미달성", 우선순위: "중요" }, sch), { 달성여부: { select: { name: "✖️ 미달성" } }, 우선순위: { select: { name: "‼️ 중요" } } })
  assertEquals(toNotionProps({ 달성여부: "", 우선순위: "" }, sch), { 달성여부: { select: null }, 우선순위: { select: null } })
  assertEquals(toNotionProps({ 달성여부: "달성" }, { 달성여부: { type: "select", options: ["달성", "미달성"] } } as never), { 달성여부: { select: { name: "달성" } } })
  assertThrows(() => toNotionProps({ 달성여부: "보통" }, sch), SaveError)
})

// ---------- 라이브러리(교재) 입력: 새 교재는 textbook-api, 고치기는 save + 라이브러리 복사본 맞추기 ----------
Deno.test("라이브러리: 새 교재는 save로 만들지 않고, 고치면 라이브러리 복사본 맞추기를 부른다", async () => {
  const LIB = "라이브러리(학원) DB"
  const synced: string[] = []
  const orig = saveDeps.syncLibraryBook
  saveDeps.syncLibraryBook = (id: string) => { synced.push(id) }
  try {
    const calls = mockFetch({ copyDb: LIB })
    let r = await saveChanges(checkChanges([{ op: "create", db: LIB, props: { 교재명: "예시 교재" } }]))
    assertEquals([r[0].ok, String(r[0].error).includes("textbook-api")], [false, true])
    assertEquals(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/pages")), false)
    r = await saveChanges(checkChanges([{ op: "update", db: LIB, id: ID, props: { 교재명: "예시 교재 2" } }]))
    assertEquals([r[0].ok, synced], [true, [ID]])
  } finally { saveDeps.syncLibraryBook = orig }
})

const TT = "시간표(학원) DB"
// ---------- 지우기(op delete): 휴지통 + 복사본 즉시 삭제, 연결된 기록이 있으면 거절, 허용 밖 DB 거절 ----------
function mockDelete(page: Record<string, unknown>, copyDb: string | null = TT) {
  const calls = mockFetch({ copyDb: copyDb ?? undefined })
  const base = globalThis.fetch
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"
    if (url.includes("/v1/pages/") && method === "GET") { calls.push({ url, method }); return new Response(JSON.stringify({ id: ID, last_edited_time: "2026-11-17T00:00:00.000Z", ...page }), { status: 200 }) }
    if (url.includes("/rest/v1/app_rows") && method === "DELETE") { calls.push({ url, method }); return new Response(null, { status: 204 }) }
    return base(input, init)
  }) as typeof fetch
  return calls
}
Deno.test("지우기: 연결된 기록이 없으면 휴지통으로 보내고 복사본 줄을 바로 지움", async () => {
  const calls = mockDelete({ properties: { 수업: { type: "relation", relation: [] } } }, TT)
  const r = await saveChanges(checkChanges([{ op: "delete", db: TT, id: ID }]))
  assertEquals([r[0].ok, r[0].deleted], [true, true])
  const patch = calls.find((c) => c.method === "PATCH")
  assertEquals(patch?.body, { archived: true })
  assertEquals(calls.some((c) => c.method === "DELETE" && c.url.includes("/rest/v1/app_rows")), true)
})
Deno.test("지우기: 시간표에 수업이 연결돼 있으면 지우지 않고 이유를 돌려줌", async () => {
  const calls = mockDelete({ properties: { 수업: { type: "relation", relation: [{ id: "a" }, { id: "b" }] } } })
  const r = await saveChanges(checkChanges([{ op: "delete", db: TT, id: ID }]))
  assertEquals([r[0].ok, r[0].blocked], [false, { 수업: 2 }])
  assertEquals(String(r[0].error).includes("수업 2건"), true)
  assertEquals(calls.some((c) => c.method === "PATCH" || c.method === "DELETE"), false)
})
Deno.test("지우기 금지(대표 261119): 학생·등록·클래스·강사·과목·영역·진도관리·시즌은 요청 검사에서 400, 문구는 그대로 앱에 보임", () => {
  for (const db of ["학생(학원) DB", "등록(학원) DB", "클래스(학원) DB", "강사(학원) DB", "과목(학원) DB", "영역(학원) DB", "진도관리(학원) DB", "시즌(학원) DB"]) {
    const e = assertThrows(() => checkChanges([{ op: "delete", db, id: ID }]), SaveError) as InstanceType<typeof SaveError>
    assertEquals([e.status, e.message], [400, "삭제하지 않아요 — 종료·보류로 처리해요"])
  }
})
Deno.test("지우기: 허용 밖 DB(라이브러리 · 일정 · 시험 등)와 id 없는 요청은 요청 검사에서 거절", () => {
  for (const db of ["라이브러리(학원) DB", "일정(학원) DB", "시험(학원) DB", "성적(학원) DB", "루틴(학원) DB", "학교(학원) DB"]) assertThrows(() => checkChanges([{ op: "delete", db, id: ID }]), SaveError)
  assertThrows(() => checkChanges([{ op: "delete", db: TT }]), SaveError)
})
Deno.test("지우기: 다른 DB의 줄 · 그사이 바뀐 줄은 지우지 않음, 이미 휴지통이면 복사본만 맞춤", async () => {
  let calls = mockDelete({ properties: {} }, "등록(학원) DB")
  let r = await saveChanges(checkChanges([{ op: "delete", db: TT, id: ID }]))
  assertEquals([r[0].ok, r[0].error], [false, "이 DB의 줄이 아닙니다."])
  calls = mockDelete({ properties: {}, last_edited_time: "2026-11-17T05:00:00.000Z" })
  r = await saveChanges(checkChanges([{ op: "delete", db: TT, id: ID, edited: "2026-11-17T00:00:00.000Z" }]))
  assertEquals([r[0].ok, r[0].conflict], [false, true])
  assertEquals(calls.some((c) => c.method === "PATCH"), false)
  calls = mockDelete({ properties: {}, in_trash: true })
  r = await saveChanges(checkChanges([{ op: "delete", db: TT, id: ID }]))
  assertEquals([r[0].ok, calls.some((c) => c.method === "PATCH"), calls.some((c) => c.method === "DELETE")], [true, false, true])
})

// ---------- (재무 서버 261123) 재무 칸 · `요청` 칸 ----------
Deno.test("재무 쓰기: 사람이 고치는 칸만, 수식 칸 거절, 수강료 · 청구 항목은 만들기 거절", () => {
  checkAllowedProps("수강료(학원) DB", { "청구금액 조정": -10000, "청구금액 조정 사유": "결석 1회", "메모(내부용)": "", "실제 수업량": 7 })
  for (const f of ["청구금액", "결제 관리", "반별 생성", "결제금액", "관련 결제", "요청", "안내문 전송 상태"])
    assertThrows(() => checkAllowedProps("수강료(학원) DB", { [f]: 1 }), SaveError)
  assertThrows(() => checkAllowedProps("수강료(학원) DB", { "메모(내부용)": "x" }, "create"), SaveError, "만들지 않아요")
  assertThrows(() => checkAllowedProps("청구 항목(학원) DB", { "배부일": "2026-11-23" }, "create"), SaveError)
  checkAllowedProps("청구 항목(학원) DB", { "교재비 수기입력": 12000, "배부일": "2026-11-23" })
  checkAllowedProps("기타경비(학원) DB", { 이름: "예시 모의고사비", "기타경비 항목": "모의고사비", "받는 방식": "한 번", "신고 금액": 15000, 클래스: [ID] }, "create")
  assertThrows(() => checkAllowedProps("기타경비(학원) DB", { "청구 항목": [ID] }), SaveError)
  checkAllowedProps("청구서(학원) DB", { 이름: "예시 청구서", 등록: [ID] }, "create")
  assertThrows(() => checkAllowedProps("청구서(학원) DB", { "총 금액": 1 }), SaveError)
  // 수식 칸은 칸 형식 검사로도 거절(이중 방어)
  assertThrows(() => toNotionProps({ 청구금액: 1 }, { 청구금액: { type: "formula" } }), SaveError)
  assertEquals(Object.keys(FINANCE_PROPS).length, 6)
})

Deno.test("재무 2바퀴 결제 줄: 결제 내역 줄 만들기(구분 · 결제 수단 필수) · 결제 줄 고치기(금액 · 수단 · 결제일 · 비고만) · 청구 결제는 고치기만", () => {
  const P = "결제(학원) DB", IP = "청구 결제(학원) DB"
  checkAllowedProps(P, { 결제: "11월 예시 교구", "결제 금액": 50000, 결제일: "2026-11-23", 구분: "지출", "결제 수단": "카드" }, "create")
  checkAllowedProps(P, { 결제: "11월 청구서 결제 합계", "결제 금액": 15000, 결제일: "2026-11-30", 구분: "매출", "결제 수단": "현금", 비고: "청구서" }, "create")
  for (const miss of ["구분", "결제 수단", "결제 금액", "결제일", "결제"]) {
    const row: Record<string, unknown> = { 결제: "x", "결제 금액": 1000, 결제일: "2026-11-23", 구분: "지출", "결제 수단": "현금" }
    delete row[miss]
    assertThrows(() => checkAllowedProps(P, row, "create"), SaveError, "꼭 채울")
  }
  assertThrows(() => checkAllowedProps(P, { 결제: "x", "결제 금액": 1000, 결제일: "2026-11-23", 구분: "매출", "결제 수단": "현금", 수강료: [ID] }, "create"), SaveError, "쓰지 않는 칸")
  checkAllowedProps(P, { "결제 금액": 200000, "결제 수단": "현금", 결제일: "2026-11-22", 비고: "일부" })
  for (const bad of [{ 구분: "지출" }, { 결제: "새 이름" }, { 수강료: [ID] }, { 손익: 1 }]) assertThrows(() => checkAllowedProps(P, bad), SaveError)
  for (const bad of [{ "결제 수단": "" }, { "결제 금액": 0 }, { "결제 금액": -1 }, { "결제 금액": 1.5 }, { 결제일: "" }]) assertThrows(() => checkAllowedProps(P, bad), SaveError)
  checkAllowedProps(IP, { "결제 금액": 10000, "결제 방법": "카드", 결제일: "2026-11-23" })
  checkAllowedProps(IP, { "결제 방법": "" }) // 노션 버튼도 결제 방법을 비워 두므로 비울 수 있음
  assertThrows(() => checkAllowedProps(IP, { "결제 금액": 1000, 교재배부: [ID] }, "create"), SaveError, "청구 항목 [결제]")
  assertThrows(() => checkAllowedProps(IP, { 교재배부: [ID] }), SaveError)
  // 고르기 값은 노션 선택지에서만(청구 결제 결제 방법 4개)
  const ipay = { "결제 방법": { type: "select", options: ["계좌이체", "현금", "카드", "기타"] } }
  toNotionProps({ "결제 방법": "기타" }, ipay)
  assertThrows(() => toNotionProps({ "결제 방법": "상품권" }, ipay), SaveError, "선택지")
})

Deno.test("요청 칸: 그 DB의 동작 ID만 · 고치기만, 안내문 전송 둘 · 삭제 · 상태 값은 거절", () => {
  for (const [db, id] of [["클래스(학원) DB", "class-tuition-create"], ["클래스(학원) DB", "class-etc-charge"], ["청구서(학원) DB", "cart-progress-book"], ["등록(학원) DB", "reg-end-cleanup"]])
    checkAllowedProps(db as any, { 요청: id }, "update")
  const bad: [string, string, string][] = [
    ["수강료(학원) DB", "tuition-notice", "update"], ["청구서(학원) DB", "cart-notice", "update"], ["청구서(학원) DB", "cart-delete", "update"],
    ["클래스(학원) DB", "cart-progress-book", "update"], ["클래스(학원) DB", "✅ 완료", "update"], ["클래스(학원) DB", "", "update"],
    ["클래스(학원) DB", "class-tuition-create", "create"], ["청구서(학원) DB", "cart-progress-book", "create"],
  ]
  for (const [db, id, op] of bad) assertThrows(() => checkRequestProp(db, { 요청: id }, op as any), SaveError)
  assertThrows(() => checkChanges([{ op: "update", db: "수강료(학원) DB", id: ID, props: { 요청: "tuition-notice" } }]).forEach((c) => checkAllowedProps(c.db as any, c.props!, c.op as any)), SaveError)
  checkRequestProp("클래스(학원) DB", { 이름: "x" }, "create") // 요청 칸 없으면 그대로
})


// ---------- (재무 서버 261123 · 2바퀴) [결제] record-payment(_shared/appPayment.ts) ----------
// 노션 [결제] 버튼 둘(수강료 → 결제(학원), 청구 항목 → 청구 결제(학원))과 같은 결제 줄 · 전액만(금액 거절) · 같은 요청 id 한 번 · 입력 검사.
// 결제 관리 · 결제 상태는 노션 수식처럼 가짜 Notion이 계산한다. 일부 · 초과는 결제 줄 고치기(save)로 — 위 PAYMENT_RULES 시험.
// (CI 목록이 이 파일을 돌리므로 여기에 둔다. DB 찾기 · 칸 형식은 맨 위 시험의 결과를 그대로 쓴다.)
const { checkPaymentInput, paymentProps, recordPayment, paymentDeps, kstToday } = await import("./appPayment.ts")
paymentDeps.sleep = () => Promise.resolve()

const TU = "11111111111111111111111111111111", OTHER = "22222222222222222222222222222222", IT = "33333333333333333333333333333333"
const TODAY = kstToday()

// 가짜 노션: 수강료 하나(청구금액 270,000 + 기타경비 금액 15,000), 청구 항목 하나(교재비 금액 15,000), 결제 줄 목록.
function world(opts: { lagReads?: number; createFails?: number } = {}) {
  const payments: any[] = []
  const reqs = new Map<string, any>()
  const copies: any[] = []
  let lag = opts.lagReads ?? 0, creates = 0
  const mineOf = (link: string, id: string) => {
    const mine = payments.filter((p) => (p.properties[link]?.relation ?? []).some((r: any) => r.id === id))
    const shown = lag > 0 ? mine.slice(0, -1) : mine
    if (lag > 0) lag--
    return { shown, sum: shown.reduce((a, p) => a + p.properties["결제 금액"].number, 0) }
  }
  const tuitionPage = () => {
    const { shown, sum } = mineOf("수강료", TU), due = 270000 + 15000
    const state = shown.length === 0 ? "🔴미납" : sum === due ? "🟢 결제 완료" : sum < due ? "🔴미납" : "🟠과오납"
    return {
      id: TU, parent: { type: "data_source_id", data_source_id: "ds-tu" }, in_trash: false, last_edited_time: "2026-11-23T00:00:00.000Z",
      properties: {
        청구명: { type: "title", title: [{ plain_text: "예시학생 수학A 11월" }] },
        청구금액: { type: "formula", formula: { type: "number", number: 270000 } },
        "기타경비 금액": { type: "formula", formula: { type: "number", number: 15000 } },
        "결제 관리": { type: "formula", formula: { type: "string", string: state } },
        결제금액: { type: "rollup", rollup: { type: "number", number: sum } },
        "관련 결제": { type: "relation", relation: shown.map((p) => ({ id: p.id })) },
      },
    }
  }
  const itemPage = () => {
    const { shown, sum } = mineOf("교재배부", IT)
    return {
      id: IT, parent: { type: "data_source_id", data_source_id: "ds-item" }, in_trash: false, last_edited_time: "2026-11-23T00:00:00.000Z",
      properties: {
        이름: { type: "title", title: [{ plain_text: "예시학생 모의고사비 청구서 (중등 모의고사비)" }] },
        "교재비 금액": { type: "formula", formula: { type: "number", number: 15000 } },
        "결제 상태": { type: "formula", formula: { type: "string", string: sum >= 15000 ? "🟢결제 완료" : "🔴미납" } },
        결제금액: { type: "rollup", rollup: { type: "number", number: sum } },
        교재결제: { type: "relation", relation: shown.map((p) => ({ id: p.id })) },
      },
    }
  }
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
    if (url.endsWith(`/v1/pages/${TU}`)) return ok(tuitionPage())
    if (url.endsWith(`/v1/pages/${IT}`)) return ok(itemPage())
    if (url.includes("/v1/pages/") && method === "GET") { const p = payments.find((x) => url.endsWith(x.id)); return p ? ok(p) : ok({ message: "nf" }, 404) }
    if (url.endsWith("/v1/pages") && method === "POST") {
      creates++
      if (opts.createFails && creates <= opts.createFails) return ok({ message: "validation" }, 400)
      const id = `${String(payments.length + 1).padStart(8, "0")}aaaaaaaaaaaaaaaaaaaaaaaa`
      const props: Record<string, any> = {}
      for (const [k, v] of Object.entries<any>(body.properties)) {
        if (v.title) props[k] = { type: "title", title: v.title.map((t: any) => ({ plain_text: t.text.content })) }
        else if (v.rich_text) props[k] = { type: "rich_text", rich_text: v.rich_text.map((t: any) => ({ plain_text: t.text.content })) }
        else props[k] = { type: Object.keys(v)[0], ...v }
      }
      const page = { id, icon: body.icon, parent: body.parent, last_edited_time: "2026-11-23T00:00:00.000Z", properties: props }
      payments.push(page)
      return ok(page)
    }
    if (url.includes("/rest/v1/app_payment_requests")) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)?.[1] ?? "")
      if (method === "GET") return ok(reqs.has(id) ? [reqs.get(id)] : [])
      if (method === "POST") { const r = body[0]; if (reqs.has(r.id)) return ok([], 201); reqs.set(r.id, { ...r, payment_id: null, error: null }); return ok([r], 201) }
      if (method === "PATCH") { reqs.set(id, { ...reqs.get(id), ...body }); return new Response(null, { status: 204 }) }
      if (method === "DELETE") { reqs.delete(id); return new Response(null, { status: 204 }) }
    }
    if (url.includes("/rest/v1/app_rows")) { copies.push(...body); return new Response(null, { status: 201 }) }
    return new Response("unexpected " + method + " " + url, { status: 500 })
  }) as typeof fetch
  return { payments, reqs, copies }
}

Deno.test("입력 검사: 요청 id · 대상 줄 하나(수강료 또는 청구 항목) · 금액은 거절(전액만) · 지출은 save로 · 날짜", () => {
  const base = { requestId: "req-00000001", tuitionId: TU }
  assertEquals(checkPaymentInput(base), { requestId: "req-00000001", target: "tuition", targetId: TU, date: TODAY, method: undefined, memo: undefined })
  assertEquals(checkPaymentInput({ requestId: "req-00000001", itemId: IT, method: "카드" }), { requestId: "req-00000001", target: "item", targetId: IT, date: TODAY, method: "카드", memo: undefined })
  assertThrows(() => checkPaymentInput({ ...base, amount: 60000 }), SaveError, "전액")
  assertThrows(() => checkPaymentInput({ requestId: "req-00000001", kind: "지출", name: "예시 교구", amount: 1000 }), SaveError, "save")
  for (const bad of [{ ...base, requestId: "x" }, { requestId: "req-00000001" }, { ...base, itemId: IT }, { ...base, date: "2026/11/23" }, { ...base, tuitionId: "abc" },
    { requestId: "req-00000001", itemId: IT, memo: "비고 칸 없음" }])
    assertThrows(() => checkPaymentInput(bad), SaveError)
  assertEquals(checkPaymentInput({ ...base, kind: "매출", amount: "" }).target, "tuition") // 1바퀴 호출 모양(kind 매출 · 빈 금액)은 그대로 받음
})

Deno.test("결제 줄 속성 = 노션 [결제] 버튼과 같음(수강료: 제목 · 청구금액 + 기타경비 금액 · 오늘 · 매출 / 청구 항목: 교재비 금액 · 교재배부 · 오늘)", () => {
  const tu = { properties: { 청구명: { title: [{ plain_text: "예시학생 수학A 11월" }] }, 청구금액: { formula: { number: 270000 } }, "기타경비 금액": { formula: { number: 15000 } } } }
  assertEquals(paymentProps(checkPaymentInput({ requestId: "req-00000001", tuitionId: TU }), tu), { 결제: "예시학생 수학A 11월 결제", "결제 금액": 285000, 결제일: TODAY, 구분: "매출", 수강료: [TU] })
  assertEquals(paymentProps(checkPaymentInput({ requestId: "req-00000001", tuitionId: TU, date: "2026-11-20", method: "계좌이체", memo: "1차" }), tu),
    { 결제: "예시학생 수학A 11월 결제", "결제 금액": 285000, 결제일: "2026-11-20", 구분: "매출", 수강료: [TU], "결제 수단": "계좌이체", 비고: "1차" })
  const item = { properties: { "교재비 금액": { formula: { number: 15000 } } } }
  assertEquals(paymentProps(checkPaymentInput({ requestId: "req-00000001", itemId: IT }), item), { "결제 금액": 15000, 결제일: TODAY, 교재배부: [IT] })
  assertThrows(() => paymentProps(checkPaymentInput({ requestId: "req-00000001", itemId: IT }), { properties: {} }), SaveError, "금액")
})

Deno.test("수강료 [결제]: 노션 줄 하나(💵) · 전액 · 수강료 다시 읽어 결제 관리를 돌려줌 · 사본 둘 반영", async () => {
  const w = world()
  const r = await recordPayment(checkPaymentInput({ requestId: "req-full-0001", tuitionId: TU, method: "현금" }))
  assertEquals(w.payments.length, 1)
  assertEquals([w.payments[0].icon, w.payments[0].properties["결제 금액"].number, w.payments[0].properties["결제 수단"].select.name], [{ type: "emoji", emoji: "💵" }, 285000, "현금"])
  assertEquals([r.duplicate, r.tuition?.["결제 관리"], r.tuition?.["결제금액"], r.tuition?.["관련 결제"], r.item, r.payment.db], [false, "🟢 결제 완료", 285000, [w.payments[0].id], null, "결제(학원) DB"])
  assertEquals(w.copies.map((c) => c.db), ["결제(학원) DB", "수강료(학원) DB"])
  assertEquals([w.reqs.get("req-full-0001").state, w.reqs.get("req-full-0001").kind, w.reqs.get("req-full-0001").amount], ["done", "매출", 285000])
})

Deno.test("청구 항목 [결제]: 청구 결제 줄 하나(아이콘 없음 · 제목 없음) · 교재비 금액 · 결제 방법 · 결제 상태를 돌려줌", async () => {
  const w = world()
  const r = await recordPayment(checkPaymentInput({ requestId: "req-item-0001", itemId: IT, method: "카드" }))
  const p = w.payments[0]
  assertEquals([w.payments.length, p.icon, p.parent.data_source_id, "이름" in p.properties, p.properties["결제 금액"].number, p.properties["결제 방법"].select.name, p.properties["교재배부"].relation],
    [1, undefined, "ds-ipay", false, 15000, "카드", [{ id: IT }]])
  assertEquals([r.tuition, r.item?.["결제 상태"], r.item?.["결제금액"], r.item?.["교재결제"], r.payment.db], [null, "🟢결제 완료", 15000, [p.id], "청구 결제(학원) DB"])
  assertEquals(w.copies.map((c) => c.db), ["청구 결제(학원) DB", "청구 항목(학원) DB"])
  // 같은 id 다시 → 같은 줄, 다른 대상(수강료)에 같은 id → 거절
  const again = await recordPayment(checkPaymentInput({ requestId: "req-item-0001", itemId: IT, method: "카드" }))
  assertEquals([w.payments.length, again.duplicate, again.payment.id], [1, true, p.id])
  await assertRejects(() => recordPayment(checkPaymentInput({ requestId: "req-item-0001", tuitionId: TU })), SaveError, "다른 결제")
  // 결제 방법이 노션 선택지에 없으면 노션에 쓰기 전에 거절(자리도 잡지 않음)
  await assertRejects(() => recordPayment(checkPaymentInput({ requestId: "req-item-0002", itemId: IT, method: "상품권" })), SaveError, "선택지")
  assertEquals(w.reqs.has("req-item-0002"), false)
})

Deno.test("같은 요청 id 두 번(차례로 · 동시에): 결제 줄은 하나", async () => {
  const w = world()
  const input = checkPaymentInput({ requestId: "req-dup-00001", tuitionId: TU })
  const first = await recordPayment(input)
  const again = await recordPayment(input)
  assertEquals([w.payments.length, again.duplicate, again.payment.id], [1, true, first.payment.id])
  const w2 = world()
  const twin = checkPaymentInput({ requestId: "req-dup-00002", tuitionId: TU })
  const both = await Promise.allSettled([recordPayment(twin), recordPayment(twin)])
  assertEquals(w2.payments.length, 1)
  assertEquals(both.filter((x) => x.status === "fulfilled").length >= 1, true)
  await assertRejects(() => recordPayment(checkPaymentInput({ requestId: "req-dup-00002", tuitionId: OTHER })), SaveError, "다른 결제")
})

Deno.test("노션 롤업이 늦으면 관계 칸에 새 줄이 보일 때까지 다시 읽음", async () => {
  const w = world({ lagReads: 2 })
  const r = await recordPayment(checkPaymentInput({ requestId: "req-lag-00001", tuitionId: TU }))
  assertEquals([w.payments.length, r.tuition?.["결제 관리"]], [1, "🟢 결제 완료"])
})

Deno.test("노션이 거절(4xx)하면 자리를 비워 같은 id로 다시 기록 가능 · 다른 DB 줄은 거절", async () => {
  const w = world({ createFails: 1 })
  const input = checkPaymentInput({ requestId: "req-fail-0001", tuitionId: TU })
  await assertRejects(() => recordPayment(input), SaveError)
  assertEquals(w.reqs.has("req-fail-0001"), false)
  await recordPayment(input)
  assertEquals(w.payments.length, 1)
  const w2 = world()
  await assertRejects(() => recordPayment(checkPaymentInput({ requestId: "req-other-001", tuitionId: OTHER })), SaveError)
  await assertRejects(() => recordPayment(checkPaymentInput({ requestId: "req-other-002", itemId: TU })), SaveError, "청구 항목(학원) DB의 줄이 아니에요")
  assertEquals(w2.reqs.size, 0)
})

Deno.test("재무 2바퀴 원본 확인: 결제 줄을 고치면 연결된 수강료를 다시 읽어 사본에 넣음(결제 관리가 사본에 바로) · 실패해도 저장은 성공", async () => {
  const PAYID = "44444444444444444444444444444444", TUX = "55555555555555555555555555555555"
  for (const failTu of [false, true]) {
    const upserts: any[] = []
    globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
      const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
      if (url.includes("/rest/v1/app_rows?select=db")) return ok([{ db: "결제(학원) DB" }])
      if (url.endsWith(`/v1/pages/${PAYID}`) && method === "PATCH") return ok({ id: PAYID, properties: { "결제 금액": { type: "number", number: 50000 }, 수강료: { type: "relation", relation: [{ id: TUX }] } }, last_edited_time: "2026-11-23T00:00:00.000Z" })
      if (url.endsWith(`/v1/pages/${TUX}`)) return failTu ? new Response('{"message":"gone"}', { status: 404 }) : ok({ id: TUX, properties: { "결제 관리": { type: "formula", formula: { type: "string", string: "🟢결제 완료" } } }, last_edited_time: "2026-11-23T00:00:00.000Z" })
      if (url.includes("/rest/v1/app_rows")) { upserts.push(...body); return new Response(null, { status: 201 }) }
      return new Response("unexpected " + method + " " + url, { status: 500 })
    }) as typeof fetch
    const r = await saveChanges(checkChanges([{ op: "update", db: "결제(학원) DB", id: PAYID, props: { "결제 금액": 50000 } }]))
    assertEquals(r[0].ok, true)
    if (!failTu) {
      assertEquals(upserts.map((u) => u.db), ["결제(학원) DB", "수강료(학원) DB"])
      assertEquals((r[0].linked?.[0] as any)?.props?.["결제 관리"], "🟢결제 완료")
    } else assertEquals([upserts.map((u) => u.db), r[0].linked], [["결제(학원) DB"], undefined])
  }
})
