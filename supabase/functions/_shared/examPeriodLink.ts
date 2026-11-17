// 시험정보 [시험 기간 연결](2.8, 대표 261118): 시험정보의 학교 · 구분 시험 · 이름에 시험 이름 · 그 해 일정(시험 기간)을
// 찾아 시험정보 `시험일정`에 잇는다. 하나면 잇고(✅), 없거나 여럿이면 잇지 않고 `마지막 오류`에 이유(⚠️).
// 시험일이 그 기간 밖이면 잇되 `마지막 오류`에 경고를 남긴다.
// 순수 판단(pickExamPeriod)과 노션 읽기·쓰기(linkExamPeriod, deps로 주입)를 나눴다 — 시험은 판단과 흐름을 따로 본다.
import { eventKind, KIND, PAPER_EXAM_WORDS, MOCK_EXAM_WORDS, hasAnyWord } from "./scheduleCategory.ts"

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
// 낱말로 찾을 때 다른 시험이 분명한 일정은 뺀다: 학기가 다름(1학기 ↔ 2학기), 중간 ↔ 기말, "N월" 다름.
// 일정 이름에 학기가 없으면("지필평가", "2차 정기시험") 날짜로 학기를 본다: 3~8월 = 1학기, 9~2월 = 2학기(261118 원본 검수).
export function semesterOfDate(iso: string): string | undefined {
  const m = Number(String(iso).slice(5, 7))
  return m >= 1 && m <= 12 ? (m >= 3 && m <= 8 ? "1" : "2") : undefined
}
export function conflictsWith(eventName: string, target: string, eventStart = ""): boolean {
  const e = squash(eventName), t = squash(target)
  const sem = (s: string) => /(\d)학기/.exec(s)?.[1]
  const half = (s: string) => s.includes("중간") ? "중간" : s.includes("기말") ? "기말" : ""
  const mon = (s: string) => /(\d{1,2})월/.exec(s)?.[1]
  const differs = (a?: string, b?: string) => !!a && !!b && a !== b
  return differs(sem(e) ?? semesterOfDate(eventStart), sem(t)) || differs(half(e), half(t)) || differs(mon(e), mon(t))
}
// 시험 종류 낱말: 시험 `시험 구분`이 모의고사이거나 `모의고사(수능)`만 고른 시험 → 모의 낱말, 그 밖 → 지필 낱말.
export function examKindWords(exam: any): string[] {
  const kind = selectName(exam, "시험 구분")
  const mock = kind === "모의고사" || (!kind && !selectName(exam, "지필고사") && !!selectName(exam, "모의고사(수능)"))
  return mock ? MOCK_EXAM_WORDS : PAPER_EXAM_WORDS
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
  const pool = events.filter(e => !e?.archived && !e?.in_trash &&
    eventKind(e) === KIND.EXAM && // 세부 구분 시험(옛 구분 📝 시험도)
    academicYearOf(dateStart(e, "날짜")) === year)
  // 1) 이름에 시험 이름(예: "1학기 중간고사")이 든 것. 2) 없으면 시험 종류 낱말(scheduleCategory 표 —
  // 지필고사 ↔ 지필·고사·정기, 모의고사 ↔ 모의·학력평가·수능·수학능력)이 든 것.
  let found = pool.filter(e => nameMatches(titleOf(e), target))
  if (!found.length) found = pool.filter(e => hasAnyWord(titleOf(e), examKindWords(exam)) && !conflictsWith(titleOf(e), target, dateStart(e, "날짜")))
  // 여럿이면 차례로 좁힌다(좁힌 결과가 비면 앞 단계 그대로): 시험정보 학년 → 시험일이 기간 안 → "N월" 시험이면 그 달 시작.
  const narrow = (keep: (e: any) => boolean) => { if (found.length > 1) { const n = found.filter(keep); if (n.length) found = n } }
  const grade = relIds(info, "학년")[0]
  if (grade) narrow(e => { const g = relIds(e, "학년").map(plain); return !g.length || g.includes(plain(grade)) })
  if (examDay) narrow(e => { const s = dateStart(e, "날짜"), t = dateEnd(e, "날짜") || s; return examDay >= s && examDay <= t })
  const month = /(\d{1,2})월/.exec(target)?.[1]
  if (month) narrow(e => Number(dateStart(e, "날짜").slice(5, 7)) === Number(month))
  const label = (e: any) => { const s = dateStart(e, "날짜"), t = dateEnd(e, "날짜"); return `${titleOf(e)}(${t && t !== s ? `${s}~${t}` : s})` }
  if (!found.length) return { ok: false, error: `${year}학년도 이 학교의 구분 "시험" 일정 중 이름에 "${target}"(또는 ${examKindWords(exam).join("·")})가 든 것이 없습니다. 학교에서 [학사일정 가져오기]를 먼저 누르거나 일정 이름·구분을 확인하세요.` }
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
