// POST /functions/v1/app-api — 관리 앱 읽기 · 저장(v2.8.0 항목 74 · 75). 관리자 비밀번호로 로그인한 관리자 세션만 통과한다
// (adminSecurity.ts SECURITY_BROWSER_ROUTES). 읽기는 Supabase 복사본(app_rows)만, 쓰기(save)는 Notion에 먼저 쓴다.
// body:
//   { action: "list", db: "학생(학원) DB", since?: ISO } — 그 DB 줄 전체(since가 있으면 그 뒤 동기화된 줄만)
//   { action: "changes", since: ISO|null, dbs: [...] } — (261123 자동 갱신) since 뒤 바뀐 줄 · 지운 줄(_shared/appChanges.ts) + subscription(구독 끊김 감지 한 줄). 노션은 안 부름
//   { action: "status" } — DB마다 줄 수 · 마지막 동기화(앱 자료 상태)
//   { action: "admin-status" } — 관리자 설정(261123): 노션 연결(최상위 제목 · 마지막 동기화) + 노션 연동 구독 상태(_shared/notionSubscriptionStatus.ts)
//   { action: "save", changes: [{ op: "create"|"update", db, id?, tmp?, edited?, props }] } — (항목 75) 입력 범위 DB만 Notion에 먼저 쓰고
//       복사본에 반영. 줄마다 성공 · 실패 · 충돌을 돌려준다. 지우기는 없다. 로직은 _shared/appSave.ts.
//   { action: "record-payment", requestId, tuitionId | itemId, date?, method?, memo? } — (재무 서버 261123 · 2바퀴) 노션 [결제] 버튼과 같은
//       결제 줄 하나(전액): tuitionId = 수강료 [결제] → 결제(학원) 매출 줄, itemId = 청구 항목 [결제] → 청구 결제(학원) 줄. 그 줄을 다시 읽어
//       결제 관리 / 결제 상태 · 결제금액을 돌려준다. 같은 requestId는 한 번만. 금액(amount)은 받지 않음 — 일부 · 초과 · 지출 줄은 save.
//       로직은 _shared/appPayment.ts. 실제 결제 · 발송은 없음.
//   { action: "end-preview", id, endDate? } — (261123 종료 처리) 등록 [종료 처리] 확인 창 숫자: 이 종료일(없으면 등록 종료일 · 오늘)이면
//       빠질 앞으로 수업의 날짜들. 읽기만. 실제 종료는 등록 `요청` = reg-end-cleanup(save) — 같은 거름(_shared/registrationEnd.ts).
// 읽기 로직은 _shared/appCopy.ts.
import { CORS_HEADERS, getCurrentAdminKey } from "../_shared/adminShared.ts"
import { securityEnabled } from "../_shared/adminSecurity.ts"
import { requireAccess, teacherAppDeny, maskTeacherRows, teacherReadDbs, teacherWriteDbs, TEACHER_DB, type Access } from "../_shared/teacherAccess.ts"
import { APP_DBS, isAppDb, listApp, statusApp, warmSources, syncCopy, lastSyncedAt, rootTitle, NotionBusyError } from "../_shared/appCopy.ts"
import { checkChanges, saveChanges, runGenerateClasses, writeOptions, SaveError } from "../_shared/appSave.ts"
import { checkPaymentInput, recordPayment } from "../_shared/appPayment.ts"
import { appChanges, checkChangesInput, ChangesInputError } from "../_shared/appChanges.ts"
import { subscriptionStatus, healthOf } from "../_shared/notionSubscriptionStatus.ts"
import { getPage } from "../_shared/notionClient.ts"
import { previewEnd } from "../_shared/registrationEnd.ts"
import { END_DEPS } from "../_shared/registrationEndNotion.ts"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } })
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.length <= 40

// (강사계정 261123) 시험이 노션 · 사본 없이 경로째 돌 수 있게 손잡이만 바꿔 끼운다(기본 = 실제 함수).
const DEFAULT_DEPS = { listApp, writeOptions, saveChanges, statusApp, appChanges, syncCopy, lastSyncedAt, rootTitle, warmSources, healthOf }
export type AppApiDeps = typeof DEFAULT_DEPS
export async function handleAppApi(req: Request, deps: Partial<AppApiDeps> = {}): Promise<Response> {
  const D = { ...DEFAULT_DEPS, ...deps }
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405)
  // (강사계정 261123) 원장 세션은 그대로 통과, 강사 세션은 동작마다 거른다(_shared/teacherAccess.ts — 재무 · 관리자 설정 · 강사 DB 쓰기는 원장만).
  const access: Access | Response = await requireAccess(req, CORS_HEADERS, securityEnabled() ? "" : await getCurrentAdminKey())
  if (access instanceof Response) return access
  const teacher = access.role === "teacher" ? access : null
  // 강사가 읽을 수 있는 DB = 편집허용 메뉴들의 화면 DB(_shared/teacherAccess.ts MENU_DBS). 원장은 null(전부).
  const readable = teacher ? teacherReadDbs(teacher.menus) : null
  const writable = teacher ? teacherWriteDbs(teacher.editMenus) : null // 편집허용 메뉴의 쓰기 DB(댓글허용만인 메뉴는 읽기만)
  // (v2.8.0 항목 101) 어느 요청이 느린지 로그로 보려고 action 이름과 걸린 시간을 한 줄 남긴다 — 1초 넘은 요청만(평소 수십 개 list는 안 남김).
  const t0 = Date.now()
  let action = "?", dbName = ""
  try {
    const raw = await req.text()
    if (raw.length > 200_000) return json({ error: "요청이 너무 큽니다." }, 413)
    let body: any
    try { body = JSON.parse(raw) } catch { return json({ error: "요청 형식이 올바르지 않습니다." }, 400) }
    action = String(body?.action ?? "?").slice(0, 20); dbName = typeof body?.db === "string" ? body.db.slice(0, 40) : ""
    // (강사계정) 누가 로그인했나 — 앱이 메뉴를 거를 때. 원장은 role만.
    if (body?.action === "me") return json(teacher ? { ok: true, role: "teacher", name: teacher.name, menus: teacher.menus, editMenus: teacher.editMenus, readDbs: [...readable!], writeDbs: [...writable!] } : { ok: true, role: "owner" })
    if (teacher) {
      const denied = teacherAppDeny(teacher, body)
      if (denied) return json({ error: denied[1], role: "teacher" }, denied[0])
    }
    if (body?.action === "list") {
      if (!isAppDb(body.db)) return json({ error: `db는 ${APP_DBS.join(", ")} 중 하나여야 합니다.` }, 400)
      if (body.since !== undefined && body.since !== null && !isIso(body.since)) return json({ error: "since 형식이 올바르지 않습니다." }, 400)
      const at = new Date().toISOString()
      const rows0 = await D.listApp(body.db, body.since ?? null)
      const rows = teacher && body.db === TEACHER_DB ? maskTeacherRows(rows0 as any[], teacher.teacherId) : rows0
      D.warmSources() // (항목 99) 앱 첫 로드가 데우기 — 응답은 안 기다림
      return json({ ok: true, db: body.db, at, rows })
    }
    // 열린 화면 자동 갱신(261123): Realtime 신호 · 60초 따라잡기 때. 사본만 읽는다.
    if (body?.action === "changes") {
      const { since, dbs: dbs0 } = checkChangesInput(body)
      const dbs = readable ? dbs0.filter((d: string) => readable.has(d)) : dbs0
      if (!dbs.length) return json({ ok: true, now: new Date().toISOString(), rows: [], gone: [], crAt: null, subscription: null })
      // (261123) 구독 끊김도 함께 — 홈 입력 점검이 경고를 띄운다(표 한 줄 읽기, 실패해도 바뀐 줄은 그대로 돌려줌).
      const [changes, health] = await Promise.all([D.appChanges(since, dbs), D.healthOf().catch(() => null)])
      if (teacher) (changes as any).rows = (changes as any).rows.map((r: any) => r?.db === TEACHER_DB ? maskTeacherRows([r], teacher.teacherId)[0] : r)
      return json({ ...changes, subscription: teacher ? null : health })
    }
    if (body?.action === "status") { const dbs = (await D.statusApp()).filter((d) => !readable || readable.has(d.db)); const [syncedAt, title] = await Promise.all([D.lastSyncedAt(), D.rootTitle()]); return json({ ok: true, dbs, syncedAt, rootTitle: title }) }
    // 관리자 설정 칸(261123): 노션 연결 확인 + 연동 구독 상태. 노션 연결은 최상위 페이지 제목을 실제로 읽어 본다(못 읽으면 null).
    if (body?.action === "admin-status") {
      const [title, syncedAt, subscription] = await Promise.all([rootTitle(), lastSyncedAt(), subscriptionStatus().catch(() => null)])
      return json({ ok: true, notion: { ok: !!title, rootTitle: title }, syncedAt, subscription })
    }
    if (body?.action === "save") {
      const results = await D.saveChanges(checkChanges(body.changes))
      return json({ ok: results.every((r) => r.ok), results })
    }
    if (body?.action === "record-payment") return json(await recordPayment(checkPaymentInput(body)))
    if (body?.action === "end-preview") {
      const id = String(body.id ?? "")
      if (!/^[0-9a-f-]{32,36}$/i.test(id)) return json({ error: "등록 id가 올바르지 않습니다." }, 400)
      if (body.endDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.endDate))) return json({ error: "종료일 형식이 올바르지 않습니다." }, 400)
      const reg = await getPage(id)
      if (!reg?.properties?.["종료일"] || !reg?.properties?.["수업"]) return json({ error: "등록 줄이 아닙니다." }, 400)
      return json({ ok: true, ...(await previewEnd(reg, END_DEPS, body.endDate ?? null)) })
    }
    // (항목 76) 시간표마다 다음 수업 한 번을 기존 수업 생성 큐에 넣는다. timetableIds가 없으면 시간표 전부.
    if (body?.action === "run") {
      // [동기화] 버튼: 노션 → 사본을 지금 한 번 맞춘다(바뀐 줄만, dbs 없으면 전체 앱 DB). full:true는 dbs 1~3개를 통째로 대조(노션에서 지운 줄도 뺌).
      if (body.name === "sync-copy") {
        if (body.dbs !== undefined && (!Array.isArray(body.dbs) || body.dbs.length > 40 || !body.dbs.every(isAppDb))) return json({ error: "dbs는 앱 DB 이름 목록이어야 합니다." }, 400)
        if (body.full === true && (!Array.isArray(body.dbs) || !body.dbs.length || body.dbs.length > 3)) return json({ error: "full은 dbs를 1~3개 줄 때만 씁니다." }, 400)
        const dbs = writable && body.dbs === undefined ? APP_DBS.filter((d) => writable.has(d)) : body.dbs
        return json({ ok: true, ...(await D.syncCopy(dbs, body.full === true)) })
      }
      if (body.name !== "generate-classes") return json({ error: 'run의 name은 "generate-classes" 또는 "sync-copy"여야 합니다.' }, 400)
      return json({ ok: true, ...(await runGenerateClasses(body.timetableIds)) })
    }
    // 쓸 수 있는 DB의 고르기 칸 선택지(앱이 Notion에 있는 값만 고르게).
    if (body?.action === "options") {
      const dbs = await D.writeOptions()
      if (readable) for (const k of Object.keys(dbs)) if (!readable.has(k)) delete (dbs as any)[k]
      return json({ ok: true, dbs })
    }
    return json({ error: 'action은 "me", "list", "changes", "status", "admin-status", "save", "record-payment", "end-preview", "run", "options" 중 하나여야 합니다.' }, 400)
  } catch (err) {
    if (err instanceof SaveError) return json({ error: err.message }, err.status)
    if (err instanceof ChangesInputError) return json({ error: err.message }, 400)
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
}
Deno.serve((req: Request) => handleAppApi(req))
