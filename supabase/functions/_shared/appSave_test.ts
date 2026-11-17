// appSave 단위 시험(v2.8.0 항목 75): 평평한 값 → Notion 속성, 저장 요청 검사, tmp 관계, 고치기 전 DB 확인 · 충돌.
// Notion · Supabase는 모두 가짜 응답. 실제 키 · 데이터 없음.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { toNotionProps, checkChanges, saveChanges, runGenerateClasses, SaveError, isWriteDb } = await import("./appSave.ts")

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
})

// ---------- saveChanges(가짜 Notion · Supabase) ----------
type Call = { url: string; method: string; body?: any }
function mockFetch(opts: { copyDb?: string; edited?: string }) {
  const calls: Call[] = []
  let n = 0
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/v1/search")) return ok({ results: [{ id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] }], has_more: false })
    if (url.includes("/v1/data_sources/ds-")) return ok({ properties: { 이름: { type: "title" }, 학생: { type: "relation" } } })
    if (url.endsWith("/v1/pages") && method === "POST") { n++; return ok({ id: `${"0".repeat(31)}${n}`, url: "u", properties: body.properties, last_edited_time: "2026-11-17T00:00:00.000Z" }) }
    if (url.includes("/v1/pages/") && method === "GET") return ok({ id: ID, properties: {}, last_edited_time: opts.edited ?? "2026-11-17T00:00:00.000Z" })
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
