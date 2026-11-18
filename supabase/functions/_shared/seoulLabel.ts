// _shared/seoulLabel.ts
//
// "11.19(목)" 꼴 날짜 표시를 한국 시각(+9시간)으로 — 학습기록·과제 제목, 수업 창이 같은 함수를 쓴다.
// Edge Functions는 UTC로 돌아서 getDate()/getDay()를 그대로 쓰면 한국 아침 9시 전 수업이 전날로 붙는다(261119 9시간 점검).
// 날짜만 있는 값("2026-11-19")은 UTC 자정 + 9시간 = 같은 날이라 그대로 나온다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"]

export function seoulLabel(iso: string | null): string {
	if (!iso) return ""
	const t = new Date(iso).getTime()
	if (Number.isNaN(t)) return ""
	const d = new Date(t + 9 * 3_600_000)
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
	const dd = String(d.getUTCDate()).padStart(2, "0")
	return `${mm}.${dd}(${WEEKDAYS[d.getUTCDay()]})`
}
