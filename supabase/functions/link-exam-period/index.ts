// POST /functions/v1/link-exam-period — 시험정보 [시험 기간 연결] 버튼(길잡이 동작 exam-period-link, 2.8).
// 시험정보의 학교 · 구분 시험 · 이름에 시험 이름 · 그 해 일정을 찾아 `시험일정`에 잇는다. 판단은 _shared/examPeriodLink.ts.
// 노션 호출이 몇 번뿐이라(시험정보·시험 읽기, 그 학교 일정 한 번 조회, 쓰기 2번) 기다렸다 결과를 돌려준다.
// 찾지 못한 것은 함수 오류가 아니라 결과다 — 시험정보 `상태` ⚠️ + `마지막 오류`에 이유, 응답은 200(노션 자동화가 멈추지 않게).
import { CORS_HEADERS, requireAdminKey } from "../_shared/adminShared.ts"
import { extractPageId, getPage, queryAllPages, updatePageProperties } from "../_shared/notionClient.ts"
import { schoolSources } from "../_shared/schoolNotion.ts"
import { linkExamPeriod } from "../_shared/examPeriodLink.ts"

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } })

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  const denied = await requireAdminKey(req); if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const infoId = extractPageId(body)
    if (!infoId) return json({ error: "시험정보 페이지 ID가 필요합니다." }, 400)
    const result = await linkExamPeriod(infoId, {
      getPage,
      schoolEvents: async (schoolId) => { const { events } = await schoolSources(); return queryAllPages(events, { property: "학교", relation: { contains: schoolId } }) },
      update: updatePageProperties,
      now: () => new Date().toISOString(),
    })
    return json({ pageId: infoId, ...result })
  } catch (e) {
    // 상태 칸조차 못 쓴 경우(권한·네트워크). 길잡이가 다시 넘기도록 5xx.
    console.error("[link-exam-period]", (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
