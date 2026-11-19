// 같은 이름 DB 좁히기 호출 수 시험(261120 비아 시간 초과): 조상을 공유하면 노드마다 한 번만 부르고, Secrets로 좁혀지면 조상 조회가 없고, 시간 상한이 지나면 더 부르지 않는다.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { narrowSameName, ancestorsWithin, notionStats, clearAncestorCaches, topPageTitleFrom } = await import("./appCopy.ts")

// 관 A · 관 B 각각: 데이터소스 d<i> → DB b<i> → 메뉴 페이지(관마다 하나) → 블록 → 관 최상위 페이지 → 워크스페이스. 같은 관 DB는 조상을 모두 공유.
const N = 20
function tree(): Record<string, any> {
  const t: Record<string, any> = {}
  for (const g of ["a", "b"]) {
    t[`pages/top-${g}`] = { parent: { type: "workspace" }, properties: { title: { type: "title", title: [{ plain_text: `하다 (${g})` }] } } }
    t[`blocks/blk-${g}`] = { parent: { type: "page_id", page_id: `top-${g}` } }
    t[`pages/menu-${g}`] = { parent: { type: "block_id", block_id: `blk-${g}` } }
    for (let i = 0; i < N; i++) {
      t[`data_sources/d${i}-${g}`] = { parent: { type: "database_id", database_id: `b${i}-${g}` } }
      t[`databases/b${i}-${g}`] = { parent: { type: "page_id", page_id: `menu-${g}` } }
    }
  }
  return t
}
function mockNotion(nodes: Record<string, any>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: Request | URL | string) => {
    const key = String(input).replace("https://api.notion.com/v1/", ""); calls.push(key)
    return nodes[key] ? new Response(JSON.stringify(nodes[key]), { status: 200 }) : new Response("{}", { status: 404 })
  }) as typeof fetch
  return calls
}

Deno.test("좁히기: 같은 조상을 공유하는 두 관 × 20개 이름이어도 노드마다 한 번만 부름(대략 DB 40개 × 2 + 공통 조상 6개)", async () => {
  clearAncestorCaches()
  const calls = mockNotion(tree())
  const found = new Map<string, string[]>()
  for (let i = 0; i < N; i++) found.set(`이름${i}(학원) DB`, [`d${i}-a`, `d${i}-b`])
  const c0 = notionStats.calls
  const r = await narrowSameName(found, ancestorsWithin(10_000), [], "d0-b") // 기준 DB = 관 B의 d0
  for (let i = 0; i < N; i++) assertEquals(r.map.get(`이름${i}(학원) DB`), [`d${i}-b`], `이름${i}`)
  assertEquals(r.problems.size, 0)
  assertEquals(notionStats.calls - c0, calls.length)
  // 순차 방식은 (후보 40 + 기준 1) × 깊이 5~6 = 200번 이상. 메모하면 노드 수(데이터소스 40 + DB 40 + 공통 조상 6) 이하.
  assertEquals(calls.length <= 40 + 40 + 6, true, `calls=${calls.length}`)
  assertEquals(new Set(calls).size, calls.length, "같은 노드를 두 번 부르지 않음")
})

Deno.test("좁히기: Secrets id로 이미 하나로 좁혀지면 조상 조회 없음", async () => {
  clearAncestorCaches()
  const calls = mockNotion(tree())
  const r = await narrowSameName(new Map([["이름(학원) DB", ["d1-a", "d1-b"]]]), ancestorsWithin(10_000), ["d1-b"], "d0-b")
  assertEquals([r.map.get("이름(학원) DB"), calls.length], [["d1-b"], 0])
})

Deno.test("좁히기: 시간 상한이 지나면 더 부르지 않고 모호함으로 남김, 시스템 타이틀은 메모를 재사용", async () => {
  clearAncestorCaches()
  let calls = mockNotion(tree())
  const r = await narrowSameName(new Map([["이름(학원) DB", ["d2-a", "d2-b"]]]), ancestorsWithin(-1), [], "d0-b")
  assertEquals([r.map.has("이름(학원) DB"), r.problems.has("이름(학원) DB"), calls.length], [false, true, 0])
  // 메모가 비어 있지 않게 한 번 구한 뒤: 타이틀 조회는 이미 아는 노드를 다시 부르지 않음
  clearAncestorCaches()
  calls = mockNotion(tree())
  await narrowSameName(new Map([["이름(학원) DB", ["d3-a", "d3-b"]]]), ancestorsWithin(10_000), [], "d3-b")
  const before = calls.length
  assertEquals(await topPageTitleFrom("d3-b"), "하다 (b)")
  assertEquals(calls.length - before <= 1, true, `추가 호출 ${calls.length - before}번`) // 최상위 페이지 본문만 새로 읽음(이미 부른 노드는 메모)
})
