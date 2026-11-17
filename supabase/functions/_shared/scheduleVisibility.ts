// 내부 운영 표시 여부와 학부모 공개 여부를 분리한다. 누락/잘못된 공개 값은 비공개.
export const NOTICE_VISIBILITY_POLICY = 1
import { eventKind, isPublicKind, isEventPage } from "./scheduleCategory.ts"
// 학부모 공개 대상 종류(2.8 2단계): 세부 구분이 직원 회의·할일이 아닌 것(옛 구분·안내 구분도 같은 뜻으로 읽음, scheduleCategory.eventKind).
export function isParentPublicEvent(page: any): boolean {
  const p = page?.properties
  return !page?.archived && !page?.in_trash &&
    p?.["숨김"]?.checkbox === false &&
    p?.["학부모 공개"]?.checkbox === true &&
    isPublicKind(eventKind(page))
}
// 기존 캐시에는 공개 결정의 근거가 없다. 재동기화 전까지 일정만 비공개로 반환한다.
export function publicNoticeFields(fields: Record<string, unknown>): Record<string, unknown> {
  // notice_ids(일정 페이지 id 목록)는 서버만 쓴다 — 학부모 응답에 싣지 않는다.
  const { notice_visibility_policy, notices, notice_ids: _ids, ...rest } = fields
  return { ...rest, notices: notice_visibility_policy === NOTICE_VISIBILITY_POLICY && Array.isArray(notices) ? notices : [] }
}

// 리포트 반영 웹훅(일정 → sync-report-cache)이 노션을 더 부르지 않고 끝내도 되는 일정(261118 원본 검수: 나이스 112건
// 가져오기 때 줄마다 리포트 반영이 돌아 노션 한도 429를 먹음). 조건 셋이 모두 맞을 때만:
//   ① 나이스에서 온 일정(`NEIS 동기화키`가 있음) ② 지금 학부모에게 공개가 아님 ③ 마지막 편집이 서버(봇).
// 서버(나이스 가져오기)는 새로 만들 때 숨김·비공개로 만들고, 다시 가져올 때 숨김·학부모 공개·구분을 쓰지 않는다.
// 그래서 봇이 마지막으로 고친 비공개 나이스 일정은 그 편집 전에도 비공개였고, 어느 학생 리포트에도 없다.
// 사람이 공개를 끈 편집은 마지막 편집자가 사람이라 그대로 반영한다. 서버가 나이스 일정의 숨김·학부모 공개·구분을
// 바꾸는 길이 생기면 이 조건을 다시 본다.
export function noticeReportSyncNotNeeded(page: any, botUserId: string | null): boolean {
  const p = page?.properties
  if (!p || !isEventPage(page)) return false
  const neisKey = (p["NEIS 동기화키"]?.rich_text ?? []).map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("").trim()
  if (!neisKey) return false
  if (isParentPublicEvent(page)) return false
  return !!botUserId && page?.last_edited_by?.id === botUserId
}
