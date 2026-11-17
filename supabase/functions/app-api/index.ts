// POST /functions/v1/app-api — 관리 앱 읽기(v2.8.0 항목 74). 관리자 비밀번호로 로그인한 관리자 세션만 통과한다
// (adminSecurity.ts SECURITY_BROWSER_ROUTES). Notion은 읽지도 쓰지도 않고 Supabase 복사본(app_rows)만 돌려준다.
// body:
//   { action: "list", db: "학생(학원) DB", since?: ISO } — 그 DB 줄 전체(since가 있으면 그 뒤 동기화된 줄만)
//   { action: "status" } — DB마다 줄 수 · 마지막 동기화(앱 자료 상태)
// 실제 로직은 _shared/appCopy.ts. 쓰기(저장)는 다음 항목에서 Notion 먼저 쓰는 방식으로 더한다.
import { CORS_HEADERS, requireAdminKey } from "../_shared/adminShared.ts"
import { APP_DBS, isAppDb, listApp, statusApp } from "../_shared/appCopy.ts"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } })
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.length <= 40

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405)
  const authError = await requireAdminKey(req)
  if (authError) return authError
  try {
    const raw = await req.text()
    if (raw.length > 4_000) return json({ error: "요청이 너무 큽니다." }, 413)
    let body: any
    try { body = JSON.parse(raw) } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400) }
    if (body?.action === "list") {
      if (!isAppDb(body.db)) return json({ error: `db는 ${APP_DBS.join(", ")} 중 하나여야 합니다.` }, 400)
      if (body.since !== undefined && body.since !== null && !isIso(body.since)) return json({ error: "since 형식이 올바르지 않습니다." }, 400)
      const at = new Date().toISOString()
      return json({ ok: true, db: body.db, at, rows: await listApp(body.db, body.since ?? null) })
    }
    if (body?.action === "status") return json({ ok: true, dbs: await statusApp() })
    return json({ error: 'action은 "list", "status" 중 하나여야 합니다.' }, 400)
  } catch (err) {
    console.error("[app-api]", (err as Error).message)
    return json({ error: "처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요." }, 500)
  }
})
