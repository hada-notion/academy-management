import { idFromString } from "./notionClient.ts"
import { type NeisRow, eventGrades, ownedProperties, textOf } from "./neisSchool.ts"
export function academicRange(now = new Date(), requested?: unknown) {
  const kst = new Date(now.getTime() + 9 * 3600000)
  const current = kst.getUTCFullYear() - (kst.getUTCMonth() < 2 ? 1 : 0)
  const year = requested === undefined ? current : Number(requested)
  if (!Number.isInteger(year) || year < 2000 || year > current + 1) throw new Error("학년도 형식/범위 오류")
  const end = new Date(Date.UTC(year + 1, 2, 0)).toISOString().slice(0, 10).replaceAll("-", "")
  return { year, from: `${year}0301`, to: end }
}
export function sameOwnedEvent(page: any, row: NeisRow, schoolId: string, key: string, gradeIds: string[]) {
  const props = ownedProperties(row, schoolId, key, gradeIds)
  return textOf(page, "이름") === row.EVENT_NM &&
    page.properties?.["날짜"]?.date?.start === props["날짜"].date.start &&
    !page.properties?.["날짜"]?.date?.end &&
    textOf(page, "원본 행사내용") === (row.EVENT_CNTNT ?? "") &&
    textOf(page, "수업공제일명") === (row.SBTR_DD_SC_NM ?? "") &&
    textOf(page, "대상 학년") === (eventGrades(row).map(n => `${n}학년`).join(", ") || "미지정") &&
    JSON.stringify((page.properties?.["학년"]?.relation ?? []).map((r: any) => r.id).sort()) === JSON.stringify([...gradeIds].sort())
}

export function buttonSchoolId(body: any): string | null {
  // 보낸 학교의 ID만 읽는다. source.automation_id/작성자 ID는 학교 ID로 사용하지 않는다.
  for (const value of [body?.pageId, body?.pageUrl, body?.data?.id, body?.data?.url, body?.id, body?.url]) {
    if (typeof value === "string") { const id = idFromString(value); if (id) return id }
  }
  return null
}

// 실패 뒤 이어서 하기 전 기다릴 시간. 노션 한도(429)면 한도가 풀리도록 길게(1번째 실패 10초, 2번째 20초),
// 그 밖은 짧게. 한 작업은 최대 3번(claim_neis_manual_run)이라 그 뒤는 "다시 눌러 이어서".
export function retryDelayMs(message: string, attempts: number): number {
  return /\b429\b/.test(message) ? 10000 * Math.min(Math.max(attempts, 1), 2) : 1500
}
