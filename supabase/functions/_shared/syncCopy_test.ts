// 앱 [동기화] 버튼(app-api run sync-copy) 단위 시험: 처음 채우기가 끝난 DB만 바뀐 줄을 가져오고, 끝나지 않은 DB는 notFilled, full은 dbs 3개까지. 가짜 Notion · Supabase.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { syncCopy, SYNC_COPY_MAX_FULL } = await import("./appCopy.ts")

Deno.test("동기화 버튼: 커서가 있는 DB는 바뀐 줄을 사본에 넣고, 커서 없는 DB는 notFilled로 알림", async () => {
  const calls: { url: string; method: string }[] = []
  const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } })
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"
    calls.push({ url, method })
    if (url.includes("/v1/search")) return ok({ results: [{ object: "data_source", id: "ds-stu", title: [{ plain_text: "학생(학원) DB" }] }, { object: "data_source", id: "ds-en", title: [{ plain_text: "등록(학원) DB" }] }], has_more: false })
    if (url.includes("/v1/data_sources/ds-stu/query")) return ok({ results: [{ id: "p1", url: "u", properties: { 이름: { type: "title", title: [{ plain_text: "예시 학생" }] } }, created_time: "2026-11-01T00:00:00.000Z", last_edited_time: "2026-11-19T00:00:00.000Z" }], has_more: false })
    if (url.includes("/v1/data_sources/")) return ok({ properties: {} })
    if (url.includes("/rest/v1/sync_cursors") && method === "GET") {
      if (url.includes("order=last_synced_at.desc")) return ok([{ last_synced_at: "2026-11-19T01:00:00.000Z" }])
      return ok(url.includes(encodeURIComponent("app:학생(학원) DB")) ? [{ last_synced_at: "2026-11-19T00:00:00.000Z" }] : [])
    }
    if (url.includes("/rest/v1/sync_cursors") || url.includes("/rest/v1/app_rows")) return new Response(null, { status: 201 })
    return new Response("unexpected " + url, { status: 500 })
  }) as typeof fetch
  const r = await syncCopy(["학생(학원) DB", "등록(학원) DB"])
  assertEquals([r.changed, r.notFilled, r.syncedAt], [1, ["등록(학원) DB"], "2026-11-19T01:00:00.000Z"])
  assertEquals(calls.some((c) => c.method === "POST" && c.url.includes("/rest/v1/app_rows")), true)
})

Deno.test("동기화 버튼: full은 dbs를 줄 때만, 3개까지", async () => {
  assertEquals(SYNC_COPY_MAX_FULL, 3)
  await assertRejects(() => syncCopy(undefined, true))
  await assertRejects(() => syncCopy(["학생(학원) DB", "등록(학원) DB", "클래스(학원) DB", "강사(학원) DB"], true))
})
