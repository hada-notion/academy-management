// POST /functions/v1/sync-class-room-copy — 수업 관리 복사본 동기화(v2.5.113). 관리자 키(x-admin-key) 필요.
// body:
//   { mode: "reconcile", table: "cr_sessions", fromDays?: 120, toDays?: 60 } — 표 하나를 기간 전체 대조(처음 채우기·매일 밤).
//       함수 한 번 실행 시간 한도 안에 끝나도록 표 하나씩 부른다.
//   { mode: "incremental", table?: "cr_…" } — 마지막 동기화 이후 Notion에서 바뀐 것만(표를 안 주면 네 표 모두).
//   { mode: "class", sessionId } — 그 수업이 속한 반의 앞뒤 수업과 출석·기록·학습활동만.
//   { mode: "library" } — 라이브러리·단원목록 복사본 전체 대조(v2.5.125, 10분마다).
//   { mode: "events" } — (261123 웹훅 반영) 노션 웹훅 대기열 처리(_shared/notionEventsApply.ts). 예약 notion-events-drain이 할 일이 있을 때 1분마다.
//   { mode: "app", step: "fill" | "incremental" | "reconcile-next", db? } — 관리 앱 읽기 복사본 app_rows(v2.8.0 항목 74, _shared/appCopy.ts).
//       fill = 커서 없는 첫 DB 처음 채우기, incremental = 커서 있는 DB 모두 바뀐 것만, reconcile-next = 가장 오래 전 대조한 DB 하나. db를 주면 그 DB만 reconcile.
// Notion은 읽기만 한다. 실제 로직은 _shared/classRoomCopy.ts. 수업 관리(class-room)는 아직 이 표를 읽지 않는다.
import { CORS_HEADERS, requireAdminKey } from "../_shared/adminShared.ts"
import { COPY_TABLES, isCopyTable, reconcileTable, incrementalTable, syncClassOfSession } from "../_shared/classRoomCopy.ts"
import { reconcileLibrary } from "../_shared/libraryCopy.ts"
import { textbookSources } from "../_shared/textbookSearch.ts"
import { drainEvents, liveDeps } from "../_shared/notionEventsApply.ts"
import { liveWatchDeps, watchPoll, type ExistingRow } from "../_shared/notionSubscriptionWatch.ts"
import { APP_DBS, isAppDb, reconcileApp, incrementalApp, reconcileNext, nextUnfilled } from "../_shared/appCopy.ts"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } })
const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{32,36}$/i.test(v)
const days = (v: unknown, fallback: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 400 ? v as number : fallback)

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405)
  const authError = await requireAdminKey(req)
  if (authError) return authError
  const startedAt = Date.now()
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.mode === "reconcile") {
      if (!isCopyTable(body.table)) return json({ error: `table은 ${COPY_TABLES.join(", ")} 중 하나여야 합니다.` }, 400)
      const result = await reconcileTable(body.table, days(body.fromDays, 120), days(body.toDays, 60))
      return json({ ok: true, mode: "reconcile", results: [result], ms: Date.now() - startedAt })
    }
    if (body?.mode === "incremental") {
      if (body.table !== undefined && !isCopyTable(body.table)) return json({ error: "table 값이 올바르지 않습니다." }, 400)
      const tables = body.table ? [body.table] : [...COPY_TABLES]
      const results = []
      for (const t of tables) results.push(await incrementalTable(t))
      return json({ ok: true, mode: "incremental", results, ms: Date.now() - startedAt })
    }
    if (body?.mode === "class") {
      if (!isId(body.sessionId)) return json({ error: "sessionId 형식이 올바르지 않습니다." }, 400)
      return json({ ok: true, mode: "class", results: await syncClassOfSession(body.sessionId), ms: Date.now() - startedAt })
    }
    if (body?.mode === "library") {
      return json({ ok: true, mode: "library", result: await reconcileLibrary(await textbookSources()), ms: Date.now() - startedAt })
    }
    if (body?.mode === "events") {
      return json({ ok: true, mode: "events", result: await drainEvents(liveDeps, `cron-${crypto.randomUUID().slice(0, 8)}`, 90_000), ms: Date.now() - startedAt })
    }
    if (body?.mode === "app") {
      if (body.db !== undefined) {
        if (!isAppDb(body.db)) return json({ error: `db는 ${APP_DBS.join(", ")} 중 하나여야 합니다.` }, 400)
        return json({ ok: true, mode: "app", results: [await reconcileApp(body.db)], ms: Date.now() - startedAt })
      }
      if (body.step === "fill") {
        const db = await nextUnfilled()
        return json({ ok: true, mode: "app", step: "fill", results: db ? [await reconcileApp(db)] : [], done: !db, ms: Date.now() - startedAt })
      }
      if (body.step === "incremental") {
        const results = []
        // (261123) 구독 끊김 대조: 사본에 넣기 전 값과 견줘 웹훅이 놓친 줄을 센다(_shared/notionSubscriptionWatch.ts).
        const batches: { rows: any[]; pages: any[]; existing: ExistingRow[] | null }[] = []
        const before = async (_db: string, rows: any[], pages: any[]) => { batches.push({ rows, pages, existing: await liveWatchDeps.existing(rows.map((r) => r.id)) }) }
        for (const db of APP_DBS) { const r = await incrementalApp(db, before); if (r) results.push(r) }
        const watch = await watchPoll(batches, liveWatchDeps).catch((e) => ({ error: (e as Error).message }))
        return json({ ok: true, mode: "app", step: "incremental", results, watch, ms: Date.now() - startedAt })
      }
      if (body.step === "reconcile-next") return json({ ok: true, mode: "app", step: "reconcile-next", results: [await reconcileNext()], ms: Date.now() - startedAt })
      return json({ error: 'app의 step은 "fill", "incremental", "reconcile-next" 중 하나여야 합니다.' }, 400)
    }
    return json({ error: 'mode는 "reconcile", "incremental", "class", "library", "events", "app" 중 하나여야 합니다.' }, 400)
  } catch (err) {
    console.error("[sync-class-room-copy]", (err as Error).message)
    return json({ error: (err as Error).message, ms: Date.now() - startedAt }, 500)
  }
})
