// _shared/timetablePeriod.ts
//
// (2.8, 대표 261118 "시작일 종료일 2개로") 시간표가 적용되는 기간 한 곳.
// 새 칸 `시작일`·`종료일`(날짜 하나씩)을 먼저 읽고, 둘 다 비었거나 칸이 아직 없으면(이관 전) 옛 `적용 기간`(날짜 범위 한 칸)을 읽는다.
// 비면 계속, 시작만 있으면 그날부터 계속, 종료만 있으면 그날까지. 날짜는 서울 날짜(YYYY-MM-DD).
// 시간표 변경 안내(timetableNotice)·등록 안내·수업 만들기(generate-classes·큐)가 같은 함수를 쓴다.
export const TIMETABLE_START_PROP = "시작일"
export const TIMETABLE_END_PROP = "종료일"
export const TIMETABLE_PERIOD_PROP = "적용 기간" // 옛 칸(날짜 범위)

function seoulDayOf(v: unknown): string | null {
	if (typeof v !== "string" || !v) return null
	if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
	const t = Date.parse(v)
	return Number.isNaN(t) ? null : new Date(t + 9 * 3_600_000).toISOString().slice(0, 10)
}
const dateStartOf = (prop: any): string | null => seoulDayOf(prop?.date?.start ?? prop?.formula?.date?.start)

export function periodOf(t: any): { start: string | null; end: string | null } {
	const p = t?.properties ?? {}
	const start = dateStartOf(p[TIMETABLE_START_PROP]), end = dateStartOf(p[TIMETABLE_END_PROP])
	if (start || end) return { start, end }
	const d = p[TIMETABLE_PERIOD_PROP]?.date
	const s = seoulDayOf(d?.start), e = seoulDayOf(d?.end)
	return { start: s, end: e && e !== s ? e : null } // 옛 칸: 끝이 시작과 같으면 시작일만(그날부터 계속)
}

// 그 날짜에 적용 중인 시간표인지.
export function activeOn(t: any, day: string): boolean {
	const p = periodOf(t)
	return (!p.start || p.start <= day) && (!p.end || p.end >= day)
}
