// 일정 `구분`(선택) 이름 한 곳. 2.8부터 학교 일정은 세 값(🏫 학교 행사·📝 시험·🏖️ 방학/휴교)으로 나눈다.
// 옛 값 `🏫 학사 일정`도 같은 뜻(학교 일정)으로 읽는다 — 운영 학원 이관 전까지 남아 있다.
// 이모지 표기가 조금 달라도 이름 글자만으로 맞춘다(학부모 리포트 normalizeCategoryName과 같은 방식).
export const SCHOOL_EVENT = "학교 행사", SCHOOL_EXAM = "시험", SCHOOL_BREAK = "방학/휴교", LEGACY_SCHOOL = "학사 일정"
export const LEGACY_SCHOOL_OPTION = "🏫 학사 일정"
const SCHOOL_NAMES = new Set([SCHOOL_EVENT, SCHOOL_EXAM, SCHOOL_BREAK, LEGACY_SCHOOL])
export function categoryName(raw: unknown): string {
  return String(raw ?? "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").trim()
}
// 칸 값 이름: 선택·상태·수식(글자) 어느 형식이든(2.8 2단계에서 `구분`이 수식이 된다).
export function propName(prop: any): string {
  return String(prop?.select?.name ?? prop?.status?.name ?? prop?.formula?.string ?? "").trim()
}
export function categoryOf(page: any): string {
  return categoryName(propName(page?.properties?.["구분"]))
}

// ── 일정 세부 구분(2.8 2단계, 대표 261118) ─────────────────────────────────────────
// 일정의 종류는 `세부 구분`(선택 10개)으로 판단한다. `구분`은 나중에 수식(할일/학원 일정/학사 일정), `안내 구분`은 없어진다.
// 세부 구분이 비었거나 칸이 아직 없으면(이관 전) 옛 `구분`(6개·옛 학사 일정)과 `안내 구분`(상담·테스트·휴원)으로 같은 뜻을 읽는다.
export const KIND = {
  TODO: "할일", CLOSED: "학원 휴원", ACADEMY: "학원 행사", COUNSEL: "상담", TEST: "테스트", STAFF: "직원 회의",
  SCHOOL_EVENT: "학교 행사", EXAM: "시험", VACATION: "방학", SCHOOL_OFF: "학교 휴업",
} as const
export type EventKind = typeof KIND[keyof typeof KIND]
const KINDS = new Set<string>(Object.values(KIND))
const SCHOOL_KINDS = new Set<string>([KIND.SCHOOL_EVENT, KIND.EXAM, KIND.VACATION, KIND.SCHOOL_OFF])
export const DETAIL_PROP = "세부 구분"

export function eventKind(page: any): EventKind | "" {
  const p = page?.properties ?? {}
  const detail = categoryName(propName(p[DETAIL_PROP]))
  if (KINDS.has(detail)) return detail as EventKind
  // 옛 값: 안내 구분 → 구분
  const label = categoryName(propName(p["안내 구분"]) || (p["안내 구분"]?.rich_text ?? []).map((t: any) => t?.plain_text ?? "").join(""))
  if (label === "상담") return KIND.COUNSEL
  if (label === "테스트") return KIND.TEST
  if (label === "휴원") return KIND.CLOSED
  const cat = categoryOf(page)
  if (!cat) return ""
  if (cat.includes("할일")) return KIND.TODO
  if (cat.includes("휴원")) return KIND.CLOSED
  if (cat === SCHOOL_EXAM) return KIND.EXAM
  // 옛 🏖️ 방학/휴교는 이름에 "방학"(방학식 빼고)이면 방학, 나머지(토요휴업일·대체공휴일·재량휴업·공휴일·수능일·선거일 등) 학교 휴업
  // — 노션 기존 행 옮기기와 나이스 새 일정(neisSchool.detailKind)과 같은 규칙(261118).
  if (cat === SCHOOL_BREAK) return isVacationName(titleText(p["이름"])) ? KIND.VACATION : KIND.SCHOOL_OFF
  if (cat === SCHOOL_EVENT || cat === LEGACY_SCHOOL || cat === "학사 일정") return KIND.SCHOOL_EVENT
  if (cat === "학원 일정") return KIND.ACADEMY
  return ""
}
// 이름이 방학인가: "방학"이 들어 있고 "방학식"은 아님(방학식은 행사).
export const isVacationName = (name: unknown) => { const n = String(name ?? ""); return n.includes("방학") && !n.includes("방학식") }
const titleText = (prop: any) => (prop?.title ?? []).map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("")
export const isSchoolKind = (k: string) => SCHOOL_KINDS.has(k)
// 학부모에게 공개할 수 있는 종류: 직원 회의·할일·모름 빼고 전부.
export const isPublicKind = (k: string) => !!k && k !== KIND.STAFF && k !== KIND.TODO
// 가정통신문(월간 일정 안내) 구역: 학원 휴원 → 휴원, 학교 4종 → 학교(학사), 그 밖 → 학원.
export function kindSection(k: string): "휴원" | "학원" | "학교" {
  return k === KIND.CLOSED ? "휴원" : isSchoolKind(k) ? "학교" : "학원"
}
// 학부모 리포트에 보이는 묶음 이름(화면 색·아이콘이 이 이름으로 정해짐): 휴원·학사 일정·할일·학원 일정.
export function kindDisplay(k: string): string {
  return k === KIND.CLOSED ? "💤 휴원" : isSchoolKind(k) ? "🏫 학사 일정" : k === KIND.TODO ? "✅ 할일" : "📆 학원 일정"
}
// 일정 페이지인가: 날짜 + (구분 또는 세부 구분) — 구분이 수식이 돼도 알아본다.
export function isEventPage(page: any): boolean {
  const p = page?.properties ?? {}
  return p["날짜"] !== undefined && (["select", "formula"].includes(p["구분"]?.type) || p[DETAIL_PROP]?.type === "select")
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
