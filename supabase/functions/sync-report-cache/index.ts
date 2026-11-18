// POST /functions/v1/sync-report-cache
// body: { registrationId: string } 또는 { pageId: string }
//   -- 등록 페이지의 수동 "학생 페이지 동기화" 버튼과 유지 중인 라이브러리·일정 자동화가 호출한다.
//   -- 등록 페이지 자체가 대상이면 토큰 보장 -> 출석 원본 -> 학습기록/학습활동 포함 완성 캐시까지
//      전체 최신화한다. 라이브러리·일정 자동화는 영향 등록의 캐시만 재계산해 불필요한 출석 전체 조회를 막는다.
// body: { registrationId, awaitCompletion: true }  (x-admin-key 필요)
//   -- 보고서 발송 직전(send-report)과 야간 점검(nightly-report-sync-audit)이 사용하는 내부 경로다.
// body: { mode: "all" }  (x-admin-key 필요)
//   -- 토큰이 있는 모든 등록을 다시 계산하는 수동 점검용 경로다. 정기 cron에서는 호출하지 않는다.
//
// [현재 상태, 2026-09-25] 등록·학습기록·학습활동·보고서 DB의 실시간 캐시 웹훅은 수업 생성 중
// Notion API 호출량을 줄이기 위해 제거했다. 라이브러리 교재는 변경 시 여러 학생에게 영향을 주고 편집 시점이
// 일정하지 않아 자동화를 유지하며, 일정 자동화도 유지한다. 시간당 출석 증분 동기화, 보고서 발송 직전
// 강제 재계산, 야간 점검, 수동 동기화가 나머지 안전망이다.
// 실제 캐시 조립 로직은 _shared/reportCacheBuilder.ts에 있다.

import { requireAdminKey, getBotUserId, CORS_HEADERS as ADMIN_CORS } from "../_shared/adminShared.ts"
import { noticeReportSyncNotNeeded } from "../_shared/scheduleVisibility.ts"
import { selectReportCacheByToken, selectRegistrationIdsByNoticeId, text, dateStartOf } from "../_shared/reportCacheShared.ts"
import { isNoticePage, resolveRegistrationIdsForNotice } from "../_shared/syncReportCacheTarget.ts"
import { eventKind, kindDisplay } from "../_shared/scheduleCategory.ts"
import { queryAllPages, mapWithConcurrency, extractPageId } from "../_shared/notionClient.ts"
import { makePageCache } from "../_shared/reportCacheShared.ts"
import { upsertReportCacheRows, type ReportCacheRow } from "../_shared/reportCacheShared.ts"
import {
  buildCacheRowForRegistration,
  resolveSharedLearningRegistrationIds,
  syncReportCacheForRegistration,
  withFreshNotices,
} from "../_shared/reportCacheBuilder.ts"
import { resolveRegistrationIds, DS_REGISTRATION } from "../_shared/syncReportCacheTarget.ts"
import { refreshStudentReport } from "../_shared/dailyReportRefresh.ts"
import { runInBackground, respondAccepted, respondNowOrAwait } from "../_shared/backgroundTask.ts"

function isRegistrationPage(page: any): boolean {
  const props = page?.properties ?? {}
  return props["학생정보"]?.type === "relation" &&
    props["클래스"]?.type === "relation" &&
    props["토큰"]?.type === "rich_text"
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ADMIN_CORS })

  // 키 없이 오는 요청(학부모 리포트 화면, 라이브러리·일정 자동화)은 할 수 있는 일을 좁힌다(v2.7.19).
  // 학부모 화면은 자기 리포트 토큰으로 자기 등록만, 자동화는 라이브러리·일정 페이지만 갱신한다.
  // 키가 없는데 등록 페이지를 직접 지정하면 거절한다. 오류 문구도 키가 없으면 일반 문구로만 돌려준다.
  const keyed = req.headers.has("x-admin-key") && (await requireAdminKey(req)) === null
  try {
    const body = await req.json().catch(() => ({}))
    const cachedGetPage = makePageCache()

    if (body?.mode === "all") {
      const authError = await requireAdminKey(req)
      if (authError) return authError
      const registrations = await queryAllPages(DS_REGISTRATION, {
        property: "토큰",
        rich_text: { is_not_empty: true },
      })
      const rows = await mapWithConcurrency(registrations, 4, (reg) => buildCacheRowForRegistration(reg, cachedGetPage))
      const validRows = rows.filter((r): r is ReportCacheRow => r !== null)
      await upsertReportCacheRows(validRows)
      return new Response(JSON.stringify({ synced: validRows.length, skipped: rows.length - validRows.length }), {
        headers: { ...ADMIN_CORS, "Content-Type": "application/json" },
      })
    }

    const rawId = (typeof body?.registrationId === "string" && body.registrationId) || extractPageId(body)
    if (!rawId) throw new Error("registrationId를 찾을 수 없습니다.")

    const plainId = (id: string) => String(id || "").replace(/-/g, "").toLowerCase()
    if (!keyed && typeof body?.registrationId === "string") {
      const row = typeof body?.token === "string" && body.token ? await selectReportCacheByToken(body.token) : null
      if (!row || plainId(row.registration_id) !== plainId(rawId)) {
        return new Response(JSON.stringify({ error: "인증 실패" }), { status: 401, headers: { ...ADMIN_CORS, "Content-Type": "application/json" } })
      }
    }

    if (body?.awaitCompletion === true) {
      const authError = await requireAdminKey(req)
      if (authError) return authError
    }

    const sourcePage = await cachedGetPage(rawId)
    // 서버가 만든·고친 비공개 나이스 일정은 리포트에 없으므로 대상 학생을 찾지 않고 바로 끝낸다(노션 한도 아끼기).
    // 관리 앱 저장(appSave)은 같은 봇으로 쓰므로 키와 함께 force를 보내 건너뛰지 않게 한다(앱에서 공개를 끈 것도 반영).
    const forced = keyed && body?.force === true
    if (!forced && noticeReportSyncNotNeeded(sourcePage, await getBotUserId())) {
      return new Response(JSON.stringify({ synced: 0, registrationIds: [], skipped: "비공개 나이스 일정(서버 편집)" }), {
        headers: { ...ADMIN_CORS, "Content-Type": "application/json" },
      })
    }
    if (!keyed && typeof body?.registrationId !== "string" && isRegistrationPage(sourcePage)) {
      return new Response(JSON.stringify({ error: "인증 실패" }), { status: 401, headers: { ...ADMIN_CORS, "Content-Type": "application/json" } })
    }

    if (isRegistrationPage(sourcePage)) {
      const doFullRefresh = async (fanOutSharedLearning = false) => {
        // 같은 버튼 안에서 토큰이 없으면 먼저 발급하고, 출석 원본과 학습기록·학습활동을 포함한
        // 완성 캐시까지 갱신한다. 알림톡 발송 함수는 호출하지 않는다.
        await refreshStudentReport(rawId)

        if (!fanOutSharedLearning) return { synced: 1, registrationIds: [rawId] }

        // Notion 등록 페이지의 수동 버튼은 그룹 공통 학습기록/학습활동을 공유하는 다른 학생의
        // report_cache도 갱신한다. 공통 원본은 한 번만 읽고, 동시 폭주를 피하려고 한 명씩 처리한다.
        const sharedCache = makePageCache()
        const affectedIds = await resolveSharedLearningRegistrationIds(rawId, sharedCache)
        let synced = 1
        for (const id of affectedIds) {
          if (id === rawId) continue
          try {
            const row = await syncReportCacheForRegistration(id, sharedCache)
            if (row) synced += 1
          } catch (err) {
            // 한 학생의 오류 때문에 나머지 같은 반 학생 갱신이 중단되지 않게 한다.
            console.error(`공유 학습기록 캐시 갱신 실패(${id}):`, (err as Error).message)
          }
        }
        return { synced, registrationIds: affectedIds }
      }

      // 웹앱 FAB는 완료 응답을 기다린 뒤 데이터를 다시 읽으므로 동기로 처리한다. Notion 등록 페이지
      // 버튼은 웹훅 응답 제한에 걸리지 않도록 빠른 202를 반환하고 실제 최신화는 백그라운드에서 끝낸다.
      const explicitRegistrationRequest = typeof body?.registrationId === "string"
      if (explicitRegistrationRequest || body?.awaitCompletion === true) {
        const result = await doFullRefresh(false)
        return new Response(JSON.stringify({ ...result, fullRefresh: true, sharedFanOut: false }), {
          headers: { ...ADMIN_CORS, "Content-Type": "application/json" },
        })
      }

      runInBackground(async () => {
        try {
          await doFullRefresh(true)
        } catch (err) {
          console.error(`등록 학생 페이지 수동 동기화 실패(${rawId}):`, (err as Error).message)
        }
      })
      return respondAccepted({ registrationIds: [rawId], fullRefresh: true, sharedFanOut: true })
    }

    // 라이브러리·일정 자동화는 기존처럼 영향받는 등록의 완성 캐시만 다시 만든다. 여기까지 전체 출석
    // 동기화를 확대하면 편집 한 건이 여러 학생의 누적 출석 조회로 fan-out되므로 의도적으로 분리한다.
    // (v2.8.0 항목 95) 반을 많이 고른 일정은 학생 수십 명을 다시 만들어 25초를 넘긴다 — 바로 202로 답하고 뒤에서 끝낸다
    // (전에는 길잡이가 시간 초과로 보고 같은 일을 세 번 더 다시 시켰다). awaitCompletion이면 기다려 결과를 준다.
    const syncAffected = async () => {
      // 일정이면: 웹훅 본문에 온 새 속성을 가장 믿는다(Notion 조회는 바뀌기 전 값을 한동안 돌려줌). 그 값으로 지금 대상을 찾고,
      // 다시 만드는 리포트들도 그 값으로 일정을 싣거나 뺀다(withFreshNotices). 그 위에 지금 이 일정을 싣고 있는 리포트(옛 대상).
      const notice = isNoticePage(sourcePage)
      const fromBody = body?.data?.properties && typeof body?.data?.id === "string" &&
        body.data.id.replace(/-/g, "").toLowerCase() === String(sourcePage.id).replace(/-/g, "").toLowerCase()
      const freshNotice = notice && fromBody ? { ...sourcePage, properties: { ...sourcePage.properties, ...body.data.properties } } : sourcePage
      if (notice) withFreshNotices(cachedGetPage, [freshNotice])
      const currentIds = notice ? await resolveRegistrationIdsForNotice(freshNotice, cachedGetPage) : await resolveRegistrationIds(rawId, cachedGetPage)
      const registrationIds = notice
        ? [...new Set([...currentIds, ...await selectRegistrationIdsByNoticeId(
          sourcePage.id,
          // 옛 캐시(일정 id 목록 없음)는 리포트에 실린 제목·날짜로 찾는다 — reportCacheBuilder와 같은 계산.
          text(sourcePage.properties?.["이름"]) || kindDisplay(eventKind(sourcePage)),
          dateStartOf(sourcePage.properties?.["날짜"]) ?? undefined,
        )])]
        : currentIds
      const rows = await mapWithConcurrency(registrationIds, 4, (id) => syncReportCacheForRegistration(id, cachedGetPage))
      const synced = rows.filter((r): r is ReportCacheRow => r !== null).length
      return { synced, registrationIds, fullRefresh: false }
    }
    return await respondNowOrAwait(body?.awaitCompletion === true, syncAffected, `sync-report-cache 뒤 처리 끝(${rawId}):`, { pageId: rawId, fullRefresh: false }, ADMIN_CORS)
  } catch (err) {
    console.error("sync-report-cache 실패:", (err as any)?.message ?? err)
    return new Response(JSON.stringify({ error: keyed ? String((err as any)?.message ?? err) : "동기화하지 못했습니다." }), {
      status: 500,
      headers: { ...ADMIN_CORS, "Content-Type": "application/json" },
    })
  }
})