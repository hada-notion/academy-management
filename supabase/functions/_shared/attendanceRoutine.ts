// _shared/attendanceRoutine.ts
//
// (v2.8.0 항목 152, 261126) 출석 한 장에서 [루틴 생성]. 출석 → 그 반(출석의 클래스, 없으면 수업의 클래스)의 루틴(쉬기 아님)마다
// 그 출석 하나의 루틴 체크 1개. 같은 수업 다른 학생은 건드리지 않는다(수업 버튼 [루틴 체크 생성]은 그대로).
// 중복 막기: 이 출석 · 이 루틴 체크가 이미 있으면 만들지 않는다(다시 눌러도 늘지 않음).
// 루틴 항목은 수업 버튼과 같은 곳(클래스 '루틴' 관계의 루틴(학원) DB 행)에서 가져온다. 쉬기는 체크박스 칸이다.

import { createPage, fullRelationIds, getPage, queryAllPages, relIds } from "./notionClient.ts"
import { P_CHECK, P_ROUTINE, checkDsFromSession, routineCheckProps } from "./routineCheck.ts"

type Page = Record<string, any>

export const NO_ROUTINES = "이 반에 쓰는 루틴이 없어요. 클래스의 루틴 탭에서 루틴을 추가하거나 '쉬기'를 풀어 주세요"
export const ALL_CHECKS_EXIST = "이 출석의 루틴 체크가 이미 모두 있어요"
export const NO_CHECK_DB = "수업 DB에 '루틴 체크' 관계가 없어요. 루틴 체크(학원) DB를 먼저 연결해 주세요"
export const ATTENDANCE_NO_CLASS = "이 출석에 클래스가 연결되어 있지 않아요"

const cid = (id: unknown) => String(id ?? "").replace(/-/g, "")
const gone = (p: any) => !p || p.in_trash || p.archived
const plain = (prop: any): string => (prop?.title ?? prop?.rich_text ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("").trim()
const rel = (page: Page, prop: string) => relIds(page?.properties?.[prop])

export const attendanceRoutineDeps = {
	getPage: (id: string) => getPage(id) as Promise<Page>,
	createPage: (ds: string, props: Record<string, unknown>) => createPage(ds, props) as Promise<Page>,
	fullRelationIds: (page: Page, prop: string) => fullRelationIds(page, prop) as Promise<string[]>,
	checkDs: checkDsFromSession,
	// 이 출석에 이미 있는 루틴 체크의 루틴 id들
	existingRoutineIds: async (ds: string, attendanceId: string): Promise<string[]> =>
		(await queryAllPages(ds, { property: P_CHECK.attendance, relation: { contains: attendanceId } }))
			.filter((p: Page) => !gone(p)).map((p: Page) => cid(relIds(p.properties?.[P_CHECK.routine])[0])),
}

export type AttendanceRoutineResult = { ok: boolean; created: string[]; skipped: string[]; message?: string }

export async function createRoutineChecksForAttendance(attendanceId: string): Promise<AttendanceRoutineResult> {
	const d = attendanceRoutineDeps
	const att = await d.getPage(attendanceId)
	const sessionId = rel(att, "수업")[0]
	let classId = rel(att, "클래스")[0]
	if (!classId && sessionId) classId = rel(await d.getPage(sessionId), "클래스")[0]
	if (!classId) return { ok: false, created: [], skipped: [], message: ATTENDANCE_NO_CLASS }
	const ds = await d.checkDs()
	if (!ds) return { ok: false, created: [], skipped: [], message: NO_CHECK_DB }

	const cls = await d.getPage(classId)
	const routines = (await Promise.all((await d.fullRelationIds(cls, "루틴")).map((id) => d.getPage(id).catch(() => null))))
		.filter((p: any) => !gone(p) && p.properties?.[P_ROUTINE.rest]?.checkbox !== true)
		.sort((a: any, b: any) => (a.properties?.[P_ROUTINE.order]?.number ?? 999) - (b.properties?.[P_ROUTINE.order]?.number ?? 999))
	if (!routines.length) return { ok: false, created: [], skipped: [], message: NO_ROUTINES }

	const have = new Set(await d.existingRoutineIds(ds, attendanceId))
	const regId = rel(att, "등록")[0] ?? null
	const attTitle = plain(att.properties?.["출석"]) || plain(Object.values(att.properties ?? {}).find((v: any) => v?.type === "title"))
	const created: string[] = [], skipped: string[] = []
	for (const r of routines as Page[]) {
		const routineId = cid(r.id)
		if (have.has(routineId)) { skipped.push(routineId); continue }
		const props = routineCheckProps({ routineId, routineName: plain(r.properties?.[P_ROUTINE.title]), attendanceId: cid(attendanceId), attendanceTitle: attTitle, sessionId: sessionId ?? "", registrationId: regId })
		if (!sessionId) delete props[P_CHECK.session]
		const page = await d.createPage(ds, props)
		created.push(page.id as string)
	}
	return { ok: true, created, skipped, ...(created.length ? {} : { message: ALL_CHECKS_EXIST }) }
}
