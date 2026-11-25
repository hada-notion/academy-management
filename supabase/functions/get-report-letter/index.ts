// POST /functions/v1/get-report-letter
// body: { token: string, month: "YYYY-MM", registrationId: string }
//
// (v2.8.0) 학부모 리포트에서 가정통신문 한 통을 누를 때 본문을 읽는다. 토큰의 캐시 목록에 있는 반·달(보낸 달)만 연다.
// (v2.8.0 항목 150) kind "plan": 월별 학습계획서(반 화면 홈 맨 아래).
//   body: { token, kind: "plan", registrationId } → { plans: [{ month }] } (내용이 있는 달, 최근부터)
//   body: { token, kind: "plan", registrationId, month } → { plan: { month, label, note, classBody } }
//   registrationId는 토큰 학생의 등록(같은 student_key의 캐시 줄)이어야 한다.
import { buildLetterView, buildPlanList, buildPlanView } from "../_shared/reportLetter.ts"
import { CORS_HEADERS, selectReportCacheByToken, selectReportCacheOverviewsByStudentKey } from "../_shared/reportCacheShared.ts"

const key = (id: unknown) => String(id ?? "").replace(/-/g, "").toLowerCase()

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
    const { token, month, registrationId, kind } = await req.json().catch(() => ({}))
    if (kind === "plan") {
      if (!token || !/^[0-9a-f-]{32,36}$/i.test(String(registrationId ?? "")) || (month != null && !/^\d{4}-\d{2}$/.test(String(month)))) return json({ error: "token, registrationId가 필요합니다." }, 400)
      const row = await selectReportCacheByToken(String(token))
      if (!row) return json({ error: "유효하지 않은 토큰입니다." }, 404)
      const mine = key(row.registration_id) === key(registrationId) ||
        (await selectReportCacheOverviewsByStudentKey(row.student_key)).some((o: any) => key(o?.registration_id) === key(registrationId))
      if (!mine) return json({ error: "이 반의 학습계획서가 없습니다." }, 404)
      if (month == null) return json({ plans: await buildPlanList(String(registrationId)) })
      const plan = await buildPlanView(String(registrationId), String(month))
      if (!plan) return json({ error: "이 달 학습계획서가 없습니다." }, 404)
      return json({ plan })
    }
    if (!token || !registrationId || !/^\d{4}-\d{2}$/.test(String(month ?? ""))) return json({ error: "token, month, registrationId가 필요합니다." }, 400)

    const row = await selectReportCacheByToken(String(token))
    if (!row) return json({ error: "유효하지 않은 토큰입니다." }, 404)
    const letters = (row.student_fields as any)?.letters ?? []
    if (!letters.some((l: any) => l?.month === month && l?.registrationId === registrationId)) return json({ error: "이 달 가정통신문이 없습니다." }, 404)

    const view = await buildLetterView(String(registrationId), row.student_key, month)
    if (!view) return json({ error: "이 달 가정통신문이 없습니다." }, 404)
    return json({ letter: view })
  } catch (err) {
    console.error("get-report-letter failed", err)
    return json({ error: "가정통신문을 불러오지 못했습니다." }, 500)
  }
})
