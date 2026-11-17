// 시험정보 [시험 기간 연결](2.8, 대표 261118): 시험정보의 학교 · 구분 시험 · 이름에 시험 이름 · 그 해 일정(시험 기간)을
// 찾아 시험정보 `시험일정`에 잇는다. 하나면 잇고(✅), 없거나 여럿이면 잇지 않고 `마지막 오류`에 이유(⚠️).
// 시험일이 그 기간 밖이면 잇되 `마지막 오류`에 경고를 남긴다.
// 순수 판단(pickExamPeriod)과 노션 읽기·쓰기(linkExamPeriod, deps로 주입)를 나눴다 — 시험은 판단과 흐름을 따로 본다.
import { categoryName, SCHOOL_EXAM } from "./scheduleCategory.ts"

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, "")
const selectName = (page: any, prop: string) => String(page?.properties?.[prop]?.select?.name ?? "").trim()
const titleOf = (page: any) => (page?.properties?.["이름"]?.title ?? []).map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("").trim()
const relIds = (page: any, prop: string): string[] => (page?.properties?.[prop]?.relation ?? []).map((r: any) => r.id)
const dateStart = (page: any, prop: string) => String(page?.properties?.[prop]?.date?.start ?? "").slice(0, 10)
const dateEnd = (page: any, prop: string) => String(page?.properties?.[prop]?.date?.end ?? "").slice(0, 10)
const plain = (id: string) => id.replaceAll("-", "").toLowerCase()

// 시험 이름: 시험 DB `지필고사`(예: 1학기 중간고사) → `모의고사(수능)` → 제목.
export function examTargetName(exam: any): string {
  return selectName(exam, "지필고사") || selectName(exam, "모의고사(수능)") || titleOf(exam)
}
// 일정 이름에 시험 이름이 들어 있나(띄어쓰기 무시). "1학기 중간고사"는 "1학기 1차 지필평가(중간고사)"처럼
// 학기와 중간/기말이 함께 있으면 맞는 것으로 본다.
export function nameMatches(eventName: string, target: string): boolean {
  const e = squash(eventName), t = squash(target)
  if (!t) return false
  if (e.includes(t)) return true
  const m = /^(\d)학기(중간|기말)/.exec(t)
  return !!m && e.includes(`${m[1]}학기`) && e.includes(m[2])
}
// 학년도: 3월~다음 해 2월.
export function academicYearOf(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return m < 3 ? y - 1 : y
}

export type PickResult =
  | { ok: true; eventId: string; warning: string }
  | { ok: false; error: string }

// info = 시험정보 페이지, exam = 시험 페이지, events = 같은 학교 일정들(학교로 이미 거른 것).
export function pickExamPeriod(info: any, exam: any, events: any[]): PickResult {
  const target = examTargetName(exam)
  if (!target) return { ok: false, error: "시험 이름이 비어 있습니다. 시험의 지필고사(또는 모의고사)를 고르세요." }
  const examDay = dateStart(info, "시험일")
  const year = Number(selectName(exam, "연도")) || academicYearOf(examDay)
  if (!year) return { ok: false, error: "시험 연도가 비어 있습니다. 시험의 연도나 시험정보의 시험일을 넣으세요." }
  let found = events.filter(e => !e?.archived && !e?.in_trash &&
    categoryName(e?.properties?.["구분"]?.select?.name) === SCHOOL_EXAM &&
    nameMatches(titleOf(e), target) &&
    academicYearOf(dateStart(e, "날짜")) === year)
  // 여럿이면 시험정보 학년으로 좁힌다(일정 학년이 비었거나 그 학년을 포함한 것).
  const grade = relIds(info, "학년")[0]
  if (found.length > 1 && grade) {
    const narrowed = found.filter(e => { const g = relIds(e, "학년").map(plain); return !g.length || g.includes(plain(grade)) })
    if (narrowed.length) found = narrowed
  }
  const label = (e: any) => { const s = dateStart(e, "날짜"), t = dateEnd(e, "날짜"); return `${titleOf(e)}(${t && t !== s ? `${s}~${t}` : s})` }
  if (!found.length) return { ok: false, error: `${year}학년도 이 학교의 구분 "시험" 일정 중 이름에 "${target}"가 든 것이 없습니다. 학교에서 [학사일정 가져오기]를 먼저 누르거나 일정 이름·구분을 확인하세요.` }
  if (found.length > 1) return { ok: false, error: `맞는 시험 기간이 ${found.length}개입니다: ${found.slice(0, 5).map(label).join(", ")}${found.length > 5 ? " 외" : ""}. 시험정보 시험일정에서 직접 고르세요.` }
  const ev = found[0], s = dateStart(ev, "날짜"), t = dateEnd(ev, "날짜") || s
  const warning = examDay && (examDay < s || examDay > t) ? `경고: 시험일(${examDay})이 시험 기간(${t !== s ? `${s}~${t}` : s}) 밖입니다.` : ""
  return { ok: true, eventId: ev.id, warning }
}

export type ExamLinkDeps = {
  getPage: (id: string) => Promise<any>
  schoolEvents: (schoolId: string) => Promise<any[]>
  update: (pageId: string, properties: Record<string, unknown>) => Promise<unknown>
  now: () => string
}
const rich = (s: string) => ({ rich_text: s ? [{ text: { content: s.slice(0, 1900) } }] : [] })

// 시험정보 페이지 하나를 처리한다. 결과를 시험정보 칸(상태·시험일정·마지막 오류·마지막 동기화)에 쓴다.
export async function linkExamPeriod(infoId: string, deps: ExamLinkDeps): Promise<PickResult> {
  await deps.update(infoId, { "상태": { select: { name: "🔄 작업중" } }, "처리 시작 시각": { date: { start: deps.now() } } })
  let result: PickResult
  try {
    const info = await deps.getPage(infoId)
    const schoolId = relIds(info, "학교")[0], examId = relIds(info, "시험")[0]
    if (!schoolId || !examId) result = { ok: false, error: "학교와 시험을 먼저 고르세요." }
    else {
      const [exam, events] = await Promise.all([deps.getPage(examId), deps.schoolEvents(schoolId)])
      result = pickExamPeriod(info, exam, events)
    }
  } catch (err) {
    result = { ok: false, error: `시험 기간을 찾지 못했습니다: ${(err as Error).message}` }
  }
  if (result.ok) {
    await deps.update(infoId, {
      "시험일정": { relation: [{ id: result.eventId }] },
      "상태": { select: { name: "✅ 완료" } },
      "마지막 오류": rich(result.warning),
      "마지막 동기화": { date: { start: deps.now() } },
    })
  } else {
    await deps.update(infoId, { "상태": { select: { name: "⚠️ 오류" } }, "마지막 오류": rich(result.error) })
  }
  return result
}
