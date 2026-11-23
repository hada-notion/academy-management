// POST /functions/v1/clear-example-data
// (v2.8.0) 관리자 설정 화면의 "예시 데이터 비우기"(새 학원 최초 설치 때 한 번). 관리자 로그인 세션만 받는다.
//   action "state": 진행·잠김 상태만(가벼움, 대시보드용)
//   action "status": 워크스페이스 이름, 비울 DB별 건수, 진행·잠김 상태
//   action "start" + workspace + dbs(고른 DB 이름): 워크스페이스 이름이 맞으면 큐에 넣고 바로 답한다(실제 삭제는 process-sync-queue)
//   action "stop": 진행 중이면 멈춘다(처리 중인 묶음까지만 지운다)
// (v2.8.0, 261123) 초기 비밀번호(0000) 세션도 이 함수만은 받는다(adminSecurity.ts authorizeInitialSetup) — 설치 때 비밀번호를 바꾸지 않고 비우도록.
//   한 번 끝나면(done) 또는 이미 쓰던 학원(locked)이면 start가 409로 거절되므로 0000으로도 새 비밀번호로도 다시 비울 수 없다.
// 지울 DB 목록과 잠금 규칙은 _shared/exampleClear.ts.
import { CORS_HEADERS, requireAdminKey } from "../_shared/adminShared.ts"
import { authorizeInitialSetup } from "../_shared/adminSecurity.ts"
import { canStart, CLEAR_DBS, ClearError, KEEP_DBS, readFlag, start, status, stop } from "../_shared/exampleClear.ts"

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })

export async function handleClearExampleData(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST만 받습니다." }, 405)
  const authError = await requireAdminKey(req)
  // (261123 대표 "안A로 가자") 0000 세션은 DB를 고르지 못한다 — 비울 DB 전부(CLEAR_DBS, 남기는 DB는 KEEP_DBS 그대로).
  // 공개 주소에서 누가 0000으로 일부만 비우고 잠그는 일을 막는다. 새 비밀번호로 로그인한 관리자는 지금처럼 고른다.
  const initial = !!authError
  if (initial && !(await authorizeInitialSetup(req, req.headers.get("x-admin-key")))) return authError
  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === "state") {
      const { value, updatedAt } = await readFlag()
      return json({ flag: value, updatedAt, canStart: canStart(value, updatedAt), keep: KEEP_DBS, full: initial })
    }
    if (body.action === "status") {
      const s = await status()
      return json(initial ? { ...s, full: true, dbs: s.dbs.map((d) => ({ ...d, checked: true })), total: s.dbs.reduce((t, d) => t + d.count, 0) } : s)
    }
    if (body.action === "start") return json(await start(String(body.workspace ?? ""), initial ? [...CLEAR_DBS] : body.dbs))
    if (body.action === "stop") return json({ flag: await stop() })
    return json({ error: "알 수 없는 요청입니다." }, 400)
  } catch (err) {
    if (err instanceof ClearError) return json({ error: err.message }, err.status)
    console.error("[clear-example-data]", (err as Error)?.message)
    return json({ error: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 500)
  }
}

Deno.serve(handleClearExampleData)
