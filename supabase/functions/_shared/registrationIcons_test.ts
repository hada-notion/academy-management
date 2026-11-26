// 등록 아이콘 맞추기 단위 시험. Notion은 모두 가짜.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only", DATA_SOURCE_REGISTRATION_ID: "ds-reg" })) Deno.env.set(k, v)
const { registrationIconDeps, setRegistrationIconsForClass, setRegistrationIconForRegistration, classPageHex, NO_CLASS_COLOR, NO_CLASS_FOR_REG, NO_COLOR_FOR_REG } = await import("./registrationIcons.ts")

const cls = (props: Record<string, unknown>) => ({ id: "C1", properties: props })
const colorSelect = (name: string) => ({ select: { name } })
const colorCode = (t: string) => ({ rich_text: t ? [{ plain_text: t }] : [] })

Deno.test("classPageHex: 색 코드 우선, 없으면 색 이름, 둘 다 없으면 null", () => {
  assertEquals(classPageHex(cls({ 색: colorSelect("빨강"), "색 코드": colorCode("") })), "E5484D")
  assertEquals(classPageHex(cls({ 색: colorSelect("빨강"), "색 코드": colorCode("#12ab34") })), "12AB34")
  assertEquals(classPageHex(cls({ 색: { select: null }, "색 코드": colorCode("") })), null)
})

Deno.test("색이 없으면 아무것도 안 하고 실패 글", async () => {
  const saved = { ...registrationIconDeps }
  let touched = 0
  Object.assign(registrationIconDeps, { getPage: async () => cls({}), registrationsOfClass: async () => { touched++; return ["R1"] }, setIcons: async () => { touched++; return { done: 0, failed: [] } } })
  try {
    const r = await setRegistrationIconsForClass("C1")
    assertEquals([r.ok, r.message, touched], [false, NO_CLASS_COLOR, 0])
  } finally { Object.assign(registrationIconDeps, saved) }
})

Deno.test("등록 전부(수강상태 무관)에 그 색 사람 모양 · 결과 줄", async () => {
  const saved = { ...registrationIconDeps }
  const seen: unknown[] = []
  Object.assign(registrationIconDeps, {
    getPage: async () => cls({ 색: colorSelect("초록"), "색 코드": colorCode("") }),
    registrationsOfClass: async () => ["R1", "R2", "R2", "R3"],
    setIcons: async (ids: string[], hex: string) => { seen.push([ids, hex]); return { done: ids.length, failed: [] } },
  })
  try {
    const r = await setRegistrationIconsForClass("C1")
    assertEquals(seen, [[["R1", "R2", "R3"], "5BBF8A"]])
    assertEquals([r.ok, r.count, r.message], [true, 3, "등록 3개 아이콘을 맞췄어요"])
  } finally { Object.assign(registrationIconDeps, saved) }
})

Deno.test("일부 실패면 ok false · 안내", async () => {
  const saved = { ...registrationIconDeps }
  Object.assign(registrationIconDeps, { registrationsOfClass: async () => ["R1", "R2"], setIcons: async () => ({ done: 1, failed: ["R2"] }) })
  try {
    const r = await setRegistrationIconsForClass("C1", "5BBF8A") // hex를 알면 클래스 페이지를 읽지 않는다
    assertEquals([r.ok, r.count], [false, 1])
  } finally { Object.assign(registrationIconDeps, saved) }
})

Deno.test("가짜 fetch: 등록 DB를 클래스 관계로 조회 -> 업로드 한 번 -> 등록마다 PATCH", async () => {
  const calls: string[] = []
  let query: any
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"
    calls.push(`${method} ${url.replace(/^.*\/v1/, "")}`)
    if (url.includes("/data_sources/ds-reg/query")) { query = JSON.parse(init!.body as string); return new Response(JSON.stringify({ results: [{ id: "R1", properties: {} }, { id: "R2", properties: {} }], has_more: false }), { status: 200 }) }
    if (url.endsWith("/file_uploads")) return new Response(JSON.stringify({ id: "up-1" }), { status: 200 })
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  const r = await setRegistrationIconsForClass("C1", "E5484D")
  assertEquals(r.message, "등록 2개 아이콘을 맞췄어요")
  assertEquals(query.filter, { property: "클래스", relation: { contains: "C1" } })
  assertEquals(calls.filter((c) => c === "POST /file_uploads").length, 1)
  assertEquals(calls.filter((c) => c.startsWith("PATCH /pages/")), ["PATCH /pages/R1", "PATCH /pages/R2"])
})

// ---------- 등록 한 줄(항목 156) ----------
const reg = (classIds: string[]) => ({ id: "R1", properties: { 클래스: { relation: classIds.map((id) => ({ id })) } } })
const withDeps = async (patch: Record<string, unknown>, run: () => Promise<void>) => {
  const saved = { ...registrationIconDeps }
  Object.assign(registrationIconDeps, patch)
  try { await run() } finally { Object.assign(registrationIconDeps, saved) }
}

Deno.test("등록 한 줄: 첫 클래스 색으로 그 등록 하나만 user 모양", async () => {
  const got: unknown[] = [], read: string[] = []
  await withDeps({
    getPage: async (id: string) => { read.push(id); return id === "R1" ? reg(["C1", "C2"]) : cls({ 색: colorSelect("파랑"), "색 코드": colorCode("") }) },
    setIcon: async (id: string, hex: string) => { got.push([id, hex]) },
    setIcons: async () => { throw new Error("여럿은 부르지 않음") },
  }, async () => {
    const r = await setRegistrationIconForRegistration("R1")
    assertEquals(got, [["R1", "7FA6D9"]])
    assertEquals(read, ["R1", "C1"])
    assertEquals([r.ok, r.count], [true, 1])
  })
})

Deno.test("등록 한 줄: 클래스 없음 -> 아무것도 안 바꾸고 조용한 성공", async () => {
  let touched = 0
  await withDeps({ getPage: async () => reg([]), setIcon: async () => { touched++ } }, async () => {
    const r = await setRegistrationIconForRegistration("R1")
    assertEquals([r.ok, r.count, r.message, touched], [true, 0, NO_CLASS_FOR_REG, 0])
  })
})

Deno.test("등록 한 줄: 색 없음 -> 아무것도 안 바꾸고 조용한 성공", async () => {
  let touched = 0
  await withDeps({ getPage: async (id: string) => (id === "R1" ? reg(["C1"]) : cls({ 색: { select: null }, "색 코드": colorCode("") })), setIcon: async () => { touched++ } }, async () => {
    const r = await setRegistrationIconForRegistration("R1")
    assertEquals([r.ok, r.count, r.message, touched], [true, 0, NO_COLOR_FOR_REG, 0])
  })
})

Deno.test("등록 한 줄: 붙이기 실패 -> ok false", async () => {
  await withDeps({
    getPage: async (id: string) => (id === "R1" ? reg(["C1"]) : cls({ 색: colorSelect("빨강"), "색 코드": colorCode("") })),
    setIcon: async () => { throw new Error("attach 실패") },
  }, async () => {
    const r = await setRegistrationIconForRegistration("R1")
    assertEquals([r.ok, r.count], [false, 0])
  })
})

Deno.test("등록 한 줄: 가짜 fetch 업로드 한 번 + 그 등록 PATCH 한 번", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"
    calls.push(`${method} ${url.replace(/^.*\/v1/, "")}`)
    if (url.endsWith("/pages/R1") && method === "GET") return new Response(JSON.stringify(reg(["C1"])), { status: 200 })
    if (url.endsWith("/pages/C1") && method === "GET") return new Response(JSON.stringify(cls({ 색: colorSelect("초록"), "색 코드": colorCode("") })), { status: 200 })
    if (url.endsWith("/file_uploads")) return new Response(JSON.stringify({ id: "up-1" }), { status: 200 })
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  const r = await setRegistrationIconForRegistration("R1")
  assertEquals(r.ok, true)
  assertEquals(calls.filter((c) => c === "POST /file_uploads").length, 1)
  assertEquals(calls.filter((c) => c.startsWith("PATCH /pages/")), ["PATCH /pages/R1"])
})
