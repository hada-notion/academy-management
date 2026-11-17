// 일정 `구분`(선택) 이름 한 곳. 2.8부터 학교 일정은 세 값(🏫 학교 행사·📝 시험·🏖️ 방학/휴교)으로 나눈다.
// 옛 값 `🏫 학사 일정`도 같은 뜻(학교 일정)으로 읽는다 — 운영 학원 이관 전까지 남아 있다.
// 이모지 표기가 조금 달라도 이름 글자만으로 맞춘다(학부모 리포트 normalizeCategoryName과 같은 방식).
export const SCHOOL_EVENT = "학교 행사", SCHOOL_EXAM = "시험", SCHOOL_BREAK = "방학/휴교", LEGACY_SCHOOL = "학사 일정"
export const LEGACY_SCHOOL_OPTION = "🏫 학사 일정"
const SCHOOL_NAMES = new Set([SCHOOL_EVENT, SCHOOL_EXAM, SCHOOL_BREAK, LEGACY_SCHOOL])
export function categoryName(raw: unknown): string {
  return String(raw ?? "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").trim()
}
export function categoryOf(page: any): string {
  return categoryName(page?.properties?.["구분"]?.select?.name)
}
// 학교 일정(나이스에서 온 것 또는 사람이 그 값으로 고른 것)인가: 새 세 값 + 옛 학사 일정.
export function isSchoolCategory(raw: unknown): boolean {
  return SCHOOL_NAMES.has(categoryName(raw))
}

// ── 시험 낱말 표 한 곳(2.8, 담당 261118) ──────────────────────────────────────────
// 나이스 가져오기의 `구분` 판단과 시험정보 [시험 기간 연결] 찾기가 같은 표를 쓴다(띄어쓰기 무시).
// 시험 일정: 이름에 고사·시험·지필·평가 중 하나(예: "지필평가(2,3학년)", "전국연합학력평가", "수능모의평가").
export const EXAM_WORDS = ["고사", "시험", "지필", "평가"]
// 시험정보 쪽 시험 종류별로 일정 이름에서 찾을 낱말: 지필고사 ↔ 지필·고사·정기, 모의고사 ↔ 모의·학력평가·수능·수학능력.
export const PAPER_EXAM_WORDS = ["지필", "고사", "정기"]
export const MOCK_EXAM_WORDS = ["모의", "학력평가", "수능", "수학능력"]
const squashName = (s: unknown) => String(s ?? "").replace(/\s+/g, "")
export function hasAnyWord(name: unknown, words: string[]): boolean {
  const n = squashName(name)
  return words.some(w => n.includes(w))
}
export function isExamName(name: unknown): boolean {
  return hasAnyWord(name, EXAM_WORDS)
}
