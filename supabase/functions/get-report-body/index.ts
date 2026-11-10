// POST /functions/v1/get-report-body
// body: { token: string, reportId: string }
//
// (v2.8.0) 학부모 리포트에서 주간·월간·수료 보고서를 볼 때 그 보고서의 본문(반 공통 = 발송함, 학생 개인 = 보고서 페이지)을 읽는다.
// 토큰의 캐시(report_comments)에 있는 보고서만, 그중 보낸(✅ 완료) 것만 연다.
import { buildReportBodyView } from "../_shared/reportBody.ts"
import { CORS_HEADERS, selectReportCacheByToken } from "../_shared/reportCacheShared.ts"

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })
}

const key = (id: unknown) => String(id ?? "").replace(/-/g, "").toLowerCase()

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)

  try {
    const { token, reportId } = await req.json().catch(() => ({}))
    if (!token || !reportId || !/^[0-9a-f-]{32,36}$/i.test(String(reportId))) return json({ error: "token, reportId가 필요합니다." }, 400)

    const row = await selectReportCacheByToken(String(token))
    if (!row) return json({ error: "유효하지 않은 토큰입니다." }, 404)
    const comments = (row.registration_detail as any)?.report_comments ?? []
    if (!comments.some((c: any) => key(c?.id) === key(reportId))) return json({ error: "이 보고서가 없습니다." }, 404)

    const view = await buildReportBodyView(String(reportId), row.registration_id)
    // 안 보낸 보고서는 오류가 아니라 빈 본문(화면은 칸을 숨긴다).
    return json({ body: view ?? { classBody: [], studentBody: [] } })
  } catch (err) {
    console.error("get-report-body failed", err)
    return json({ error: "보고서 본문을 불러오지 못했습니다." }, 500)
  }
})
