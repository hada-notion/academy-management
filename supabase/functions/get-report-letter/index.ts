// POST /functions/v1/get-report-letter
// body: { token: string, month: "YYYY-MM" }
//
// (v2.8.0) 학부모 리포트에서 가정통신문 한 통을 누를 때 본문을 읽는다. 토큰의 캐시 목록에 있는 달(보낸 달)만 연다.
import { getPage } from "../_shared/notionClient.ts"
import { buildLetterView } from "../_shared/reportLetter.ts"
import { CORS_HEADERS, relationIds, selectReportCacheByToken } from "../_shared/reportCacheShared.ts"

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  try {
    const { token, month } = await req.json().catch(() => ({}))
    if (!token || !/^\d{4}-\d{2}$/.test(String(month ?? ""))) return json({ error: "token과 month가 필요합니다." }, 400)

    const row = await selectReportCacheByToken(String(token))
    if (!row) return json({ error: "유효하지 않은 토큰입니다." }, 404)
    const letters = (row.student_fields as any)?.letters ?? []
    if (!letters.some((l: any) => l?.month === month)) return json({ error: "이 달 가정통신문이 없습니다." }, 404)

    const student = await getPage(row.student_key)
    const view = await buildLetterView(relationIds(student?.properties?.["등록"]), row.student_key, month)
    if (!view) return json({ error: "이 달 가정통신문이 없습니다." }, 404)
    return json({ letter: view })
  } catch (err) {
    console.error("get-report-letter failed", err)
    return json({ error: "가정통신문을 불러오지 못했습니다." }, 500)
  }
})
