// (2.8, 261118) 일정이 대상에서 빠지거나 비공개가 될 때 그 일정을 싣던 리포트 찾기 — 조회 모양만(실제 DB 없음).
for (const [k, v] of Object.entries({ SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { noticeCacheQueries, selectRegistrationIdsByNoticeId } = await import("./reportCacheShared.ts")
function assert(v: unknown, m = "assertion failed") { if (!v) throw new Error(m) }

Deno.test("일정 id로 찾고, 옛 캐시(일정 id 목록 없음)는 제목·날짜로", () => {
  const q = noticeCacheQueries("ev-1", "검수 일정", "2026-11-20")
  assert(q.length === 2)
  assert(decodeURIComponent(q[0]) === 'student_fields->notice_ids=cs.["ev-1"]')
  assert(decodeURIComponent(q[1]) === 'student_fields->notice_ids=is.null&student_fields->notices=cs.[{"title":"검수 일정","date":"2026-11-20"}]')
  assert(noticeCacheQueries("ev-1").length === 1)
})

Deno.test("두 조회 결과를 합쳐 등록 id 하나씩", async () => {
  const urls: string[] = []
  globalThis.fetch = (async (input: Request | URL | string) => {
    const url = String(input); urls.push(url)
    const rows = url.includes("is.null") ? [{ registration_id: "r2" }, { registration_id: "r3" }] : [{ registration_id: "r1" }, { registration_id: "r2" }]
    return new Response(JSON.stringify(rows), { status: 200 })
  }) as typeof fetch
  const ids = await selectRegistrationIdsByNoticeId("ev-1", "검수 일정", "2026-11-20")
  assert(JSON.stringify(ids.sort()) === '["r1","r2","r3"]', JSON.stringify(ids))
  assert(urls.length === 2 && urls.every((u) => u.startsWith("https://mock.supabase/rest/v1/report_cache?select=registration_id&")))
})
