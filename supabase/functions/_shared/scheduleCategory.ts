// 일정 `구분`(선택) 이름 한 곳. 2.8부터 학교 일정은 세 값(🎒 학교 행사·📝 시험·🏖️ 방학/휴교)으로 나눈다.
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
