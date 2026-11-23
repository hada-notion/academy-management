import { externalKey } from "./externalKeys.ts"
import { SCHOOL_EVENT, SCHOOL_EXAM, SCHOOL_BREAK, LEGACY_SCHOOL, LEGACY_SCHOOL_OPTION, categoryName, isExamName, isVacationName, KIND, DETAIL_PROP } from "./scheduleCategory.ts"
// 학교별 행사 종류를 필터링하지 않는다. 모든 원본 행을 보존한다.
export type NeisRow = Record<string, string | null>
const gradeFields = ["ONE_GRADE_EVENT_YN", "TW_GRADE_EVENT_YN", "THREE_GRADE_EVENT_YN", "FR_GRADE_EVENT_YN", "FIV_GRADE_EVENT_YN", "SIX_GRADE_EVENT_YN"]
export function eventGrades(row: NeisRow): number[] {
  return gradeFields.flatMap((field, i) => row[field] === "Y" ? [i + 1] : [])
}
export function safeWebsite(raw: string | null): string | null {
  if (!raw?.trim()) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw)
    return ["https:", "http:"].includes(url.protocol) ? url.href : null
  } catch { return null }
}
export async function eventKey(row: NeisRow, schoolPageId: string): Promise<string> {
  // API에 행사 고유 ID가 없으므로 날짜/행사명 변경은 다른 키가 된다. 기존 일정은 삭제하지 않는다.
  // 이어진 날 묶음(AA_YMD_END)은 "시작일~"(묶음+시작일)을 날짜 자리에 넣는다 — 끝날이 늘어도 같은 줄을 고친다.
  // 하루짜리는 예전 키와 같다.
  const day = row.AA_YMD_END && row.AA_YMD_END !== row.AA_YMD ? `${row.AA_YMD}~` : row.AA_YMD
  const value = JSON.stringify([schoolPageId.replaceAll("-", ""), row.ATPT_OFCDC_SC_CODE, row.SD_SCHUL_CODE, row.AY, day, row.DGHT_CRSE_SC_NM, row.SCHUL_CRSE_SC_NM, row.EVENT_NM, eventGrades(row)])
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return "neis:" + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")
}
export function richText(value: string | null): { rich_text: { text: { content: string } }[] } {
  const text = value ?? ""
  return { rich_text: Array.from({ length: Math.ceil(text.length / 1900) }, (_, i) => ({ text: { content: text.slice(i * 1900, (i + 1) * 1900) } })) }
}
export function textOf(page: any, name: string): string {
  const p = page.properties?.[name]
  return (p?.rich_text ?? p?.title ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("")
}
export async function neisRows(service: "schoolInfo" | "SchoolSchedule", params: Record<string, string>): Promise<NeisRow[]> {
  // 관리 앱 [관리자 설정]에서 넣은 키 먼저, 없으면 함수 Secret(_shared/externalKeys.ts).
  const key = await externalKey("NEIS_API_KEY")
  if (!key) throw new Error("나이스 키(NEIS_API_KEY)가 없습니다. 관리 앱 [관리자 설정] > 외부 키에 붙여 넣거나 Supabase Secrets에 넣어 주세요.")
  const rows: NeisRow[] = []
  for (let pIndex = 1; pIndex <= 100; pIndex++) {
    const url = new URL("https://open.neis.go.kr/hub/" + service)
    Object.entries({ ...params, KEY: key, Type: "json", pSize: "100", pIndex: String(pIndex) }).forEach(([k, v]) => url.searchParams.set(k, v))
    // URL에는 인증키가 포함되어 있으므로 기존 fetchWithRetry의 URL 로그를 사용하지 않는다.
    let res: Response
    try { res = await fetch(url, { signal: AbortSignal.timeout(12000) }) }
    catch { throw new Error("나이스 연결 실패/시간 초과. 다음 실행에서 다시 조회합니다.") }
    if (!res.ok) throw new Error("나이스 HTTP " + res.status)
    const json = await res.json()
    if (json.RESULT) {
      if (json.RESULT.CODE === "INFO-200") return rows
      throw new Error("나이스 응답 오류: " + json.RESULT.CODE)
    }
    const data = json[service]
    const head = data?.find((x: any) => x.head)?.head
    const status = head?.find((x: any) => x.RESULT)?.RESULT?.CODE
    if (status !== "INFO-000") throw new Error("나이스 응답 형식/상태 오류")
    const part = data?.find((x: any) => x.row)?.row
    const total = head?.find((x: any) => x.list_total_count)?.list_total_count
    if (!Array.isArray(part) || !Number.isInteger(total)) throw new Error("나이스 목록 형식 오류")
    rows.push(...part)
    if (rows.length >= total) return rows
    if (part.length === 0) throw new Error("나이스 페이지 누락")
  }
  throw new Error("나이스 페이지 상한 초과: 부분 결과를 동기화하지 않습니다.")
}
const isoDay = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
export function ownedProperties(row: NeisRow, pageId: string, key: string, gradeIds: string[]) {
  const d = row.AA_YMD ?? "", e = row.AA_YMD_END ?? ""
  if (!/^\d{8}$/.test(d) || !row.EVENT_NM) throw new Error("학사일자/행사명 누락")
  return {
    "이름": { title: [{ text: { content: row.EVENT_NM.slice(0, 1900) } }] },
    "날짜": { date: { start: isoDay(d), end: /^\d{8}$/.test(e) && e > d ? isoDay(e) : null } },
    "학교": { relation: [{ id: pageId }] }, "학년": { relation: gradeIds.map(id => ({ id })) },
    "대상 학년": richText(eventGrades(row).map(n => `${n}학년`).join(", ") || "미지정"),
    "수업공제일명": richText(row.SBTR_DD_SC_NM), "원본 행사내용": richText(row.EVENT_CNTNT),
    "NEIS 동기화키": richText(key),
    // 구분/숨김/학부모 공개/메모/태그/담당자/진행상태/본문은 동기화 소유가 아니므로 절대 덮어쓰지 않는다(구분은 새로 만들 때만).
  }
}

// 일정 `구분` 규칙(새로 만들 때만): ① 수업공제일명 공휴일 또는 이름에 "토요휴업일" → 방학/휴교(숨김 그대로)
// ② 수업공제일명 휴업일 → 방학/휴교 ③ 이름에 시험 낱말(고사·시험·지필·평가, scheduleCategory EXAM_WORDS) → 시험 ④ 그 밖 → 학교 행사.
export function schoolCategory(row: NeisRow): typeof SCHOOL_EVENT | typeof SCHOOL_EXAM | typeof SCHOOL_BREAK {
  const deduct = (row.SBTR_DD_SC_NM ?? "").trim(), name = row.EVENT_NM ?? ""
  if (deduct === "공휴일" || name.includes("토요휴업일") || deduct === "휴업일") return SCHOOL_BREAK
  if (isExamName(name)) return SCHOOL_EXAM
  return SCHOOL_EVENT
}

// 일정 DB 스키마에서 `구분` 선택 칸의 옵션 이름(이모지 포함 원래 이름).
export function categoryOptionsOf(schema: any): string[] {
  const p = schema?.properties?.["구분"]
  return p?.type === "select" ? (p.select?.options ?? []).map((o: any) => o?.name).filter((n: unknown) => typeof n === "string" && n) : []
}

// 새로 만들 일정의 `구분` 옵션 이름: 학원 DB에 있는 옵션 중 이름 글자가 같은 것. 새 값이 아직 없는 학원(이관 전)은 옛 `🏫 학사 일정`.
export function newCategoryOption(row: NeisRow, categoryOptions: string[]): string {
  const want = schoolCategory(row)
  return categoryOptions.find(o => categoryName(o) === want)
    ?? categoryOptions.find(o => categoryName(o) === LEGACY_SCHOOL)
    ?? LEGACY_SCHOOL_OPTION
}

// (2.8 2단계, 대표 261118) 나이스 일정의 `세부 구분`(새로 만들 때만): ① 이름에 "방학"(방학식 빼고) → 방학
// ② 수업공제일명 휴업일·공휴일 또는 이름에 "토요휴업일" → 학교 휴업 ③ 이름에 시험 낱말 → 시험 ④ 그 밖 → 학교 행사.
// 공휴일도 새 일정이라 숨김 그대로(모든 새 나이스 일정은 숨김·비공개로 만든다).
export function detailKind(row: NeisRow): string {
  const deduct = (row.SBTR_DD_SC_NM ?? "").trim(), name = row.EVENT_NM ?? ""
  if (isVacationName(name)) return KIND.VACATION
  if (deduct === "휴업일" || deduct === "공휴일" || name.includes("토요휴업일")) return KIND.SCHOOL_OFF
  if (isExamName(name)) return KIND.EXAM
  return KIND.SCHOOL_EVENT
}
// 일정 DB 스키마의 `세부 구분` 선택지(이모지 포함 원래 이름). 칸이 없거나 선택 칸이 아니면 빈 목록 → 채우지 않음.
export function detailOptionsOf(schema: any): string[] {
  const p = schema?.properties?.[DETAIL_PROP]
  return p?.type === "select" ? (p.select?.options ?? []).map((o: any) => o?.name).filter((n: unknown) => typeof n === "string" && n) : []
}
// `구분`이 아직 선택 칸인가(2단계에서 수식이 되면 쓰지 않는다 — 수식 칸에 쓰면 Notion이 거절).
export function categoryIsSelect(schema: any): boolean {
  return schema?.properties?.["구분"]?.type === "select"
}

// 최초 생성 전용. 기존 일정 업데이트에는 ownedProperties만 사용한다(구분·숨김·학부모 공개는 사람이 고친 값 유지).
// extra.categorySelect = false면 `구분`을 쓰지 않음(수식), extra.detailOptions에 맞는 선택지가 있으면 `세부 구분`을 채움.
// (2.8, 대표 261118) 일정 `잠금` 칸은 버림 — 잠금을 쓰지 않는다(관리 앱이 학사 일정을 스스로 잠가 보여 줌).
export function newEventProperties(row: NeisRow, pageId: string, key: string, gradeIds: string[], categoryOptions: string[] = [],
  extra: { categorySelect?: boolean; detailOptions?: string[] } = {}) {
  const want = detailKind(row)
  const detail = (extra.detailOptions ?? []).find(o => categoryName(o) === want)
  return {
    ...ownedProperties(row, pageId, key, gradeIds),
    ...(extra.categorySelect === false ? {} : { "구분": { select: { name: newCategoryOption(row, categoryOptions) } } }),
    ...(detail ? { [DETAIL_PROP]: { select: { name: detail } } } : {}),
    "숨김": { checkbox: true },
    "학부모 공개": { checkbox: false },
  }
}

// ── 이어진 날 묶기(2.8, 대표 261118) ──────────────────────────────────────────────
// 나이스는 여러 날 행사(시험·방학 등)를 날마다 한 줄로 준다. 같은 행사 이름·같은 대상 학년·같은 수업공제일명·같은
// 학교과정/주야과정이 이어진 날(사이에 주말·공휴일만)이면 한 줄로 묶는다. 묶음 대표 줄 = 첫날 줄 +
// AA_YMD_END(끝날) + AA_YMD_DAYS(묶인 날들, 쉼표). 하루짜리는 원래 줄 그대로(키도 예전과 같음).
const ymdTime = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)))
const nextYmd = (d: string) => new Date(ymdTime(d) + 86400000).toISOString().slice(0, 10).replaceAll("-", "")
const isWeekend = (d: string) => { const w = new Date(ymdTime(d)).getUTCDay(); return w === 0 || w === 6 }
// 공휴일 = 같은 학교 나이스 줄 중 수업공제일명이 공휴일인 날.
export function holidayDates(rows: NeisRow[]): Set<string> {
  return new Set(rows.filter(r => (r.SBTR_DD_SC_NM ?? "").trim() === "공휴일" && /^\d{8}$/.test(r.AA_YMD ?? "")).map(r => r.AA_YMD as string))
}
// a 다음 b가 "이어진 날"인가: a와 b 사이(둘 다 빼고)의 날이 모두 주말 또는 공휴일.
export function continues(a: string, b: string, holidays: Set<string>): boolean {
  if (b <= a) return false
  for (let d = nextYmd(a), n = 0; d < b; d = nextYmd(d), n++) {
    if (n > 31) return false
    if (!isWeekend(d) && !holidays.has(d)) return false
  }
  return true
}
export function groupNeisRows(rows: NeisRow[]): NeisRow[] {
  const holidays = holidayDates(rows)
  const groupKey = (r: NeisRow) => JSON.stringify([r.EVENT_NM, eventGrades(r), (r.SBTR_DD_SC_NM ?? "").trim(), r.SCHUL_CRSE_SC_NM, r.DGHT_CRSE_SC_NM])
  const byKey = new Map<string, NeisRow[]>()
  rows.forEach(r => { const k = groupKey(r); byKey.set(k, [...(byKey.get(k) ?? []), r]) })
  const out: NeisRow[] = []
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => String(a.AA_YMD).localeCompare(String(b.AA_YMD)))
    let cur: NeisRow[] = []
    const flush = () => {
      if (!cur.length) return
      const days = [...new Set(cur.map(r => r.AA_YMD as string))]
      out.push(days.length === 1 ? cur[0] : { ...cur[0], AA_YMD_END: days[days.length - 1], AA_YMD_DAYS: days.join(",") })
      cur = []
    }
    for (const r of sorted) {
      const last = cur[cur.length - 1]
      if (last && (r.AA_YMD === last.AA_YMD || continues(last.AA_YMD as string, r.AA_YMD as string, holidays))) cur.push(r)
      else { flush(); cur.push(r) }
    }
    flush()
  }
  // 처리 순서를 고정(이어서 하기 커서가 같은 줄을 가리키게): 시작일, 그다음 원래 순서.
  const order = new Map(rows.map((r, i) => [r, i]))
  return out.sort((a, b) => String(a.AA_YMD).localeCompare(String(b.AA_YMD)) || (order.get(a) ?? 0) - (order.get(b) ?? 0))
}
// 묶음 대표 줄의 날마다 예전(날짜별) 줄. 하루짜리는 자기 자신 하나.
export function memberRows(row: NeisRow): NeisRow[] {
  const days = (row.AA_YMD_DAYS ?? "").split(",").filter(Boolean)
  if (days.length < 2) return [row]
  return days.map(d => { const { AA_YMD_END: _e, AA_YMD_DAYS: _d, ...rest } = row; return { ...rest, AA_YMD: d } })
}

// ── 학교 `학사일정 기간`(2.8) ───────────────────────────────────────────────────
// 비면 null(학년도 전체). 값이 있으면 { from, to }(YYYYMMDD). 이상하면 오류(가져오지 않음).
export function schoolPeriod(page: any): { from: string; to: string } | null {
  const p = page?.properties?.["학사일정 기간"]
  if (!p || p.type !== "date" && p.date === undefined) return null
  const start = String(p.date?.start ?? "").slice(0, 10), endRaw = String(p.date?.end ?? "").slice(0, 10)
  if (!start) return null
  const end = endRaw || start
  const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"))
  if (!ok(start) || !ok(end)) throw new Error(`학사일정 기간 형식 오류(${start}~${end}). 날짜로 다시 고르세요.`)
  if (end < start) throw new Error(`학사일정 기간의 끝(${end})이 시작(${start})보다 앞입니다.`)
  if (Date.parse(end) - Date.parse(start) > 366 * 86400000) throw new Error(`학사일정 기간이 1년을 넘습니다(${start}~${end}). 1년 안으로 고르세요.`)
  return { from: start.replaceAll("-", ""), to: end.replaceAll("-", "") }
}
