// appSave 단위 시험(v2.8.0 항목 75): 평평한 값 → Notion 속성, 저장 요청 검사, tmp 관계, 고치기 전 DB 확인 · 충돌.
// Notion · Supabase는 모두 가짜 응답. 실제 키 · 데이터 없음.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { toNotionProps, checkChanges, saveChanges, runGenerateClasses, writeOptions, SaveError, isWriteDb, checkAllowedProps, eventAffectsReport, saveDeps } = await import("./appSave.ts")
const refreshed: string[] = []
saveDeps.refreshReport = (id: string) => { refreshed.push(id) }

// DB 찾기 결과는 10분 동안 기억되므로(아래 시험들도 같은 목록을 씀) 이 시험이 가장 먼저 Notion 검색을 흉내 낸다.
Deno.test("선택지 목록: 쓸 수 있는 DB의 고르기 칸만, 웹훅 칸 · 읽기 전용 DB는 없음", async () => {
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = String(input)
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/v1/search")) return ok({ results: [
      { id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] },
      { id: "ds-lib", title: [{ plain_text: "라이브러리(학원) DB" }] }, { id: "ds-tu", title: [{ plain_text: "수강료(학원) DB" }] },
      { id: "ds-ev", title: [{ plain_text: "일정(학원) DB" }] }], has_more: false })
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
  assertEquals([o["학생(학원) DB"], "수강료(학원) DB" in o, "강사(학원) DB" in o], [{}, false, false])
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

Deno.test("저장 요청 검사: 빈 목록 · 많은 줄 · 쓸 수 없는 DB · id 없는 고치기 · 지우기 없음", () => {
  for (const bad of [[], Array(61).fill({ op: "create", db: "학생(학원) DB", props: {} }), [{ op: "create", db: "수강료(학원) DB", props: {} }],
    [{ op: "update", db: "학생(학원) DB", props: {} }], [{ op: "delete", db: "학생(학원) DB", id: ID, props: {} }]])
    assertThrows(() => checkChanges(bad), SaveError)
  assertEquals(checkChanges([{ op: "create", db: "등록(학원) DB", tmp: "tmp:e1", props: {} }]).length, 1)
  assertEquals([isWriteDb("시간표(학원) DB"), isWriteDb("청구서(학원) DB")], [true, false])
  // (261119) 시험 화면 입력은 쓰기, 재무는 아직 읽기만
  assertEquals(["시험(학원) DB", "시험정보(학원) DB", "성적(학원) DB"].map(isWriteDb), [true, true, true])
  assertEquals(["수강료(학원) DB", "결제(학원) DB", "청구 결제(학원) DB", "청구 항목(학원) DB"].map(isWriteDb), [false, false, false, false])
  assertEquals(checkChanges([{ op: "create", db: "성적(학원) DB", props: {} }]).length, 1)
  assertThrows(() => checkChanges([{ op: "delete", db: "성적(학원) DB", id: ID, props: {} }]), SaveError)
})

// ---------- saveChanges(가짜 Notion · Supabase) ----------
type Call = { url: string; method: string; body?: any }
function mockFetch(opts: { copyDb?: string; edited?: string; locked?: boolean }) {
  const calls: Call[] = []
  let n = 0
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/v1/search")) return ok({ results: [{ id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] }, { id: "ds-ev", title: [{ plain_text: "일정(학원) DB" }] }], has_more: false })
    if (url.includes("/v1/data_sources/ds-ev")) return ok({ properties: { 이름: { type: "title" }, 날짜: { type: "date" }, 잠금: { type: "checkbox" }, 숨김: { type: "checkbox" }, "학부모 공개": { type: "checkbox" }, 메모: { type: "rich_text" } } })
    if (url.includes("/v1/data_sources/ds-")) return ok({ properties: { 이름: { type: "title" }, 학생: { type: "relation" } } })
    if (url.endsWith("/v1/pages") && method === "POST") { n++; return ok({ id: `${"0".repeat(31)}${n}`, url: "u", properties: body.properties, last_edited_time: "2026-11-17T00:00:00.000Z" }) }
    if (url.includes("/v1/pages/") && method === "GET") return ok({ id: ID, properties: opts.locked ? { 잠금: { type: "checkbox", checkbox: true } } : {}, last_edited_time: opts.edited ?? "2026-11-17T00:00:00.000Z" })
    if (url.includes("/v1/pages/") && method === "PATCH") return ok({ id: ID, properties: body.properties, last_edited_time: "2026-11-17T01:00:00.000Z" })
    if (url.includes("/rest/v1/app_rows?select=db")) return ok(opts.copyDb ? [{ db: opts.copyDb }] : [])
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

// ---------- 일정(학원) DB(2.8): 앱이 쓰는 칸만, 잠긴 줄 날짜 거절, 리포트 맞추기 ----------
const EV = "일정(학원) DB"
Deno.test("일정: 받는 칸 10개만(잠금 칸 버림), 그 밖 칸은 거절", () => {
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
