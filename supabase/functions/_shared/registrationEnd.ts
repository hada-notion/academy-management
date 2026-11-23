// _shared/registrationEnd.ts
//
// (v2.8.0, 261123 종료 처리) 등록(학원) [종료 처리]의 노션 단계를 서버가 같이 한다. 동작 ID `reg-end-cleanup`
// (sync-registration-textbook/cleanup-on-end)이 교재 정리 앞에 이 일을 먼저 한다 — 관리 앱은 등록 줄의 `요청` 칸에
// reg-end-cleanup만 쓰면(앱 저장 길, 공용 요청 길) 노션 버튼과 같은 결과가 된다.
//
// 노션 버튼 원문(원본 스캔 11/18, docs/버튼-웹훅-매핑.md "종료 처리"):
//   1. 종료기준 = 종료일, 비면 오늘
//   2. 대상수업 = 이 등록의 수업 중 `수업 구분` ≠ 보강 이고 `수업일시` ≥ 종료기준 다음 날
//   3. 대상수업: `등록`에서 이 등록 빼기, `출석 조정 상태` = ⚪ 대기(→ 노션 자동화 [웹훅] 출석 조정이 출석 정리)
//   4. 이 등록: `종료일` = 종료기준, `시간표` = 비우기
//   5. (웹훅) 교재 정리 — cleanupUnusedBooksOnEnd, 이 파일 밖
//
// 노션 버튼이 1~4를 먼저 하고 부른 경우: 대상수업이 이미 없고(명단에서 빠짐) 종료일 · 시간표도 같아 아무것도 다시 쓰지 않는다.
// 같은 요청을 두 번 보내도 같다(두 번째는 고칠 것이 없음).
// 순서: 등록(종료일 · 시간표)을 먼저 — 그 뒤 수업이 ⚪ 대기가 되어 출석 조정이 돌 때 바뀐 종료일을 읽는다.
// 일부 수업을 고치지 못하면 오류를 던진다(고친 수업 수 · 못 고친 수 · 다시 누르면 남은 것만 고친다는 말). 지난 수업은 읽기만 한다.

import { isMakeupSession } from "./sessionKind.ts"

export const PROP_END = "종료일"
export const PROP_TIMETABLE = "시간표"
export const PROP_SESSIONS = "수업" // 등록 → 수업(두 방향, 수업 쪽 이름 `등록`)
export const SESSION_PROP_REG = "등록"
export const SESSION_PROP_DATE = "수업일시"
export const SESSION_PROP_FIX = "출석 조정 상태"
export const FIX_WAIT = "⚪ 대기"

type Page = Record<string, any>

export interface EndDeps {
	today(): string // 한국 날짜 YYYY-MM-DD
	// 이 등록이 들어 있는 수업 중 수업일시가 from(YYYY-MM-DD) 이후일 수 있는 것(넉넉히 — 정확한 거름은 이 파일이 한다)
	sessionsFrom(regId: string, from: string): Promise<Page[]>
	// 관계 칸 전체 id(25개 넘게 잘렸으면 끝까지)
	relationAll(page: Page, prop: string): Promise<string[]>
	patch(pageId: string, props: Record<string, unknown>): Promise<void>
	log(msg: string): void
}

export type EndResult = { basis: string; removed: string[]; registrationUpdated: boolean }

export class EndPartialError extends Error {
	constructor(message: string, public result: EndResult & { failed: string[] }) { super(message) }
}

const normId = (s: string) => String(s ?? "").replace(/-/g, "").toLowerCase()

// 날짜 칸 시작값 → 한국 날짜(YYYY-MM-DD). 날짜만 있으면 그대로, 시각이 있으면 한국 시간으로 바꿔 날짜만.
export function kstDateOf(start: string | null | undefined): string {
	if (!start) return ""
	if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start
	const t = Date.parse(start)
	if (Number.isNaN(t)) return ""
	return new Date(t + 9 * 3600_000).toISOString().slice(0, 10)
}

// 1. 종료기준
export function endBasis(reg: Page, today: string): string {
	const v = reg?.properties?.[PROP_END]?.date?.start
	return v ? kstDateOf(v) || today : today
}

// 2. 대상수업 하나인가: 보강 아님 · 수업일시 한국 날짜가 종료기준보다 뒤
export function isTargetSession(session: Page, basis: string): boolean {
	if (isMakeupSession(session)) return false
	const d = kstDateOf(session?.properties?.[SESSION_PROP_DATE]?.date?.start)
	return !!d && d > basis
}

export async function endRegistration(reg: Page, deps: EndDeps): Promise<EndResult> {
	const regId = String(reg.id)
	const basis = endBasis(reg, deps.today())

	// 4단계(먼저): 종료일 · 시간표 — 이미 같으면 쓰지 않는다.
	const props = reg.properties ?? {}
	const curEnd = props[PROP_END]?.date?.start ?? null
	const curTt = Array.isArray(props[PROP_TIMETABLE]?.relation) ? props[PROP_TIMETABLE].relation.length : 0
	const update: Record<string, unknown> = {}
	if (curEnd !== basis) update[PROP_END] = { date: { start: basis } }
	if (curTt > 0 || props[PROP_TIMETABLE]?.has_more) update[PROP_TIMETABLE] = { relation: [] }
	const registrationUpdated = Object.keys(update).length > 0
	if (registrationUpdated) await deps.patch(regId, update)

	// 2~3단계: 대상수업마다 명단에서 빼고 출석 조정 ⚪ 대기
	const candidates = await deps.sessionsFrom(regId, basis)
	const targets = candidates.filter((s) => isTargetSession(s, basis))
	const removed: string[] = []
	const failed: string[] = []
	for (const s of targets) {
		try {
			const ids = await deps.relationAll(s, SESSION_PROP_REG)
			const keep = ids.filter((id) => normId(id) !== normId(regId))
			if (keep.length === ids.length) continue // 이미 빠짐(다른 요청이 먼저 함)
			await deps.patch(String(s.id), {
				[SESSION_PROP_REG]: { relation: keep.map((id) => ({ id })) },
				[SESSION_PROP_FIX]: { select: { name: FIX_WAIT } },
			})
			removed.push(String(s.id))
		} catch (err) {
			failed.push(String(s.id))
			deps.log(`[registrationEnd] 수업 ${String(s.id).slice(-6)} 고치기 실패: ${(err as Error)?.message ?? err}`)
		}
	}
	const result = { basis, removed, registrationUpdated }
	if (failed.length) {
		throw new EndPartialError(
			`앞으로 수업 ${targets.length}개 중 ${failed.length}개에서 이 학생을 빼지 못했어요(뺀 수업 ${removed.length}개). 다시 누르면 남은 수업만 고쳐요`,
			{ ...result, failed },
		)
	}
	return result
}

// 요청 결과 칸에 붙는 한 줄(사람 말)
export function endNote(r: EndResult, books?: { unlinked?: unknown[]; deleted?: unknown[] }): string {
	const parts = [`종료일 ${r.basis}`, r.removed.length ? `앞으로 수업 ${r.removed.length}개에서 뺌` : "뺄 앞으로 수업 없음"]
	const b = (books?.unlinked?.length ?? 0) + (books?.deleted?.length ?? 0)
	if (b) parts.push(`시작 안 한 교재 ${b}개 정리`)
	return parts.join(" · ")
}

// 앱 확인 창 미리보기(읽기만): 이 종료일이면 빠질 앞으로 수업. endDate가 있으면 그 날짜, 없으면 등록 종료일 · 오늘.
export async function previewEnd(reg: Page, deps: Pick<EndDeps, "today" | "sessionsFrom">, endDate?: string | null): Promise<{ basis: string; dates: string[] }> {
	const basis = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : endBasis(reg, deps.today())
	const targets = (await deps.sessionsFrom(String(reg.id), basis)).filter((s) => isTargetSession(s, basis))
	const dates = targets.map((s) => kstDateOf(s?.properties?.[SESSION_PROP_DATE]?.date?.start)).sort()
	return { basis, dates }
}
