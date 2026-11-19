// POST /functions/v1/app-api — 관리 앱 읽기 · 저장(v2.8.0 항목 74 · 75). 관리자 비밀번호로 로그인한 관리자 세션만 통과한다
// (adminSecurity.ts SECURITY_BROWSER_ROUTES). 읽기는 Supabase 복사본(app_rows)만, 쓰기(save)는 Notion에 먼저 쓴다.
// body:
//   { action: "list", db: "학생(학원) DB", since?: ISO } — 그 DB 줄 전체(since가 있으면 그 뒤 동기화된 줄만)
//   { action: "status" } — DB마다 줄 수 · 마지막 동기화(앱 자료 상태)
//   { action: "save", changes: [{ op: "create"|"update", db, id?, tmp?, edited?, props }] } — (항목 75) 입력 범위 DB만 Notion에 먼저 쓰고
//       복사본에 반영. 줄마다 성공 · 실패 · 충돌을 돌려준다. 지우기는 없다. 로직은 _shared/appSave.ts.
// 읽기 로직은 _shared/appCopy.ts.
import { CORS_HEADERS, requireAdminKey } from "../_shared/adminShared.ts"
import { APP_DBS, isAppDb, listApp, statusApp, warmSources, syncCopy, lastSyncedAt, rootTitle, NotionBusyError } from "../_shared/appCopy.ts"
import { checkChanges, saveChanges, runGenerateClasses, writeOptions, SaveError } from "../_shared/appSave.ts"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } })
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.length <= 40

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405)
  const authError = await requireAdminKey(req)
  if (authError) return authError
  // (v2.8.0 항목 101) 어느 요청이 느린지 로그로 보려고 action 이름과 걸린 시간을 한 줄 남긴다 — 1초 넘은 요청만(평소 수십 개 list는 안 남김).
  const t0 = Date.now()
  let action = "?", dbName = ""
  try {
    const raw = await req.text()
    if (raw.length > 200_000) return json({ error: "요청이 너무 큽니다." }, 413)
    let body: any
    try { body = JSON.parse(raw) } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400) }
    action = String(body?.action ?? "?").slice(0, 20); dbName = typeof body?.db === "string" ? body.db.slice(0, 40) : ""
    if (body?.action === "list") {
      if (!isAppDb(body.db)) return json({ error: `db는 ${APP_DBS.join(", ")} 중 하나여야 합니다.` }, 400)
      if (body.since !== undefined && body.since !== null && !isIso(body.since)) return json({ error: "since 형식이 올바르지 않습니다." }, 400)
      const at = new Date().toISOString()
      const rows = await listApp(body.db, body.since ?? null)
      warmSources() // (항목 99) 앱 첫 로드가 데우기 — 응답은 안 기다림
      return json({ ok: true, db: body.db, at, rows })
    }
    if (body?.action === "status") { const dbs = await statusApp(); const [syncedAt, title] = await Promise.all([lastSyncedAt(), rootTitle()]); return json({ ok: true, dbs, syncedAt, rootTitle: title }) }
    if (body?.action === "save") {
      const results = await saveChanges(checkChanges(body.changes))
      return json({ ok: results.every((r) => r.ok), results })
    }
    // (항목 76) 시간표마다 다음 수업 한 번을 기존 수업 생성 큐에 넣는다. timetableIds가 없으면 시간표 전부.
    if (body?.action === "run") {
      // [동기화] 버튼: 노션 → 사본을 지금 한 번 맞춘다(바뀐 줄만, dbs 없으면 전체 앱 DB). full:true는 dbs 1~3개를 통째로 대조(노션에서 지운 줄도 뺌).
      if (body.name === "sync-copy") {
        if (body.dbs !== undefined && (!Array.isArray(body.dbs) || body.dbs.length > 40 || !body.dbs.every(isAppDb))) return json({ error: "dbs는 앱 DB 이름 목록이어야 합니다." }, 400)
        if (body.full === true && (!Array.isArray(body.dbs) || !body.dbs.length || body.dbs.length > 3)) return json({ error: "full은 dbs를 1~3개 줄 때만 씁니다." }, 400)
        return json({ ok: true, ...(await syncCopy(body.dbs, body.full === true)) })
      }
      if (body.name !== "generate-classes") return json({ error: 'run의 name은 "generate-classes" 또는 "sync-copy"여야 합니다.' }, 400)
      return json({ ok: true, ...(await runGenerateClasses(body.timetableIds)) })
    }
    // 쓸 수 있는 DB의 고르기 칸 선택지(앱이 Notion에 있는 값만 고르게).
    if (body?.action === "options") return json({ ok: true, dbs: await writeOptions() })
    return json({ error: 'action은 "list", "status", "save", "run", "options" 중 하나여야 합니다.' }, 400)
  } catch (err) {
    if (err instanceof SaveError) return json({ error: err.message }, err.status)
    // (v2.8.0 항목 100) Notion 한도(429)로 DB 찾기가 오래 걸릴 때: 503 + busy — 앱은 안내 띠를 띄우고 retryAfterSec 뒤 한 번 다시 부른다.
    if (err instanceof NotionBusyError) {
      const res = json({ error: "Notion이 바빠요. 잠시 뒤 다시 시도해 주세요.", busy: true, retryAfterSec: err.retryAfterSec }, 503)
      res.headers.set("Retry-After", String(err.retryAfterSec))
      return res
    }
    console.error("[app-api]", (err as Error).message)
    return json({ error: "처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요." }, 500)
  } finally {
    const ms = Date.now() - t0
    if (ms >= 1000) console.log(`[app-api] action=${action}${dbName ? ` db=${dbName}` : ""} ${ms}ms`)
  }
})
