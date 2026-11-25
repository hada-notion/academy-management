// _shared/attendanceLearningRecord.ts
//
// (v2.8.0 항목 151, 261126) 출석 한 장에서 [학습기록 생성]. 개별 진도 학원용:
//   출석 → 등록 → 등록의 진도교재 중 진도방식 "개별 진도" · 진행상태 "진행 중"인 것마다, 그 출석 하나의 학습기록 1개.
// 그룹 진도 교재 · 같은 수업의 다른 학생은 건드리지 않는다(수업 버튼 길 create-learning-record는 그대로).
// 중복 막기: 이 출석 · 이 교재로 이미 학습기록이 있으면 만들지 않는다(다시 눌러도 늘지 않음).
// "오늘 학습" 체크는 보지도 바꾸지도 않는다(출석 한 장 길은 교재를 고르는 체크가 필요 없음).

import { getPage, createPage, queryAllPages, relIds as relIdsFromProp, selectName, dateStart as dateStartFromProp, anyTitleText } from "./notionClient.ts"
import { DS_LEARNING_RECORD } from "./constants.ts"
import { libraryIds } from "./libraryProp.ts"
import { seoulLabel } from "./seoulLabel.ts"

type Page = Record<string, any>

export const NO_INDIVIDUAL_BOOKS = "이 학생 등록에 진행 중인 개별 진도 교재가 없어요"
export const ATTENDANCE_NO_REGISTRATION = "이 출석에 등록이 연결되어 있지 않아요"
export const ALL_RECORDS_EXIST = "이 출석의 학습기록이 이미 모두 있어요"
const INDIVIDUAL = "개별 진도"
const IN_PROGRESS = "진행 중"

export const attendanceRecordDeps = {
	getPage: (id: string) => getPage(id) as Promise<Page>,
	createPage: (ds: string, props: Record<string, unknown>) => createPage(ds, props) as Promise<Page>,
	// 이 출석 · 이 교재로 이미 있는 학습기록 수
	countRecords: async (attendanceId: string, bookId: string) =>
		(await queryAllPages(DS_LEARNING_RECORD, { and: [
			{ property: "출석", relation: { contains: attendanceId } },
			{ property: "진도교재", relation: { contains: bookId } },
		] })).length,
}

const rel = (page: Page, prop: string) => relIdsFromProp(page?.properties?.[prop])
const uniq = (a: string[]) => Array.from(new Set(a))

export type AttendanceRecordResult = { ok: boolean; created: string[]; skipped: string[]; message?: string }

export async function createLearningRecordForAttendance(attendanceId: string): Promise<AttendanceRecordResult> {
	const d = attendanceRecordDeps
	const att = await d.getPage(attendanceId)
	const regId = uniq(rel(att, "등록"))[0]
	if (!regId) return { ok: false, created: [], skipped: [], message: ATTENDANCE_NO_REGISTRATION }
	const reg = await d.getPage(regId)
	const books = await Promise.all(uniq(rel(reg, "진도교재")).map((id) => d.getPage(id)))
	const targets = books.filter((b) => selectName(b, "진도방식") === INDIVIDUAL && selectName(b, "진행상태") === IN_PROGRESS)
	if (!targets.length) return { ok: false, created: [], skipped: [], message: NO_INDIVIDUAL_BOOKS }

	const sessionId = uniq(rel(att, "수업"))[0]
	const classId = uniq(rel(att, "클래스"))[0]
	const className = classId ? anyTitleText(await d.getPage(classId)) : ""
	const date = dateStartFromProp(att, "수업일시")
	const dateLabel = date ? seoulLabel(date) : ""

	const created: string[] = [], skipped: string[] = []
	for (const book of targets) {
		const bookId = book.id as string
		if ((await d.countRecords(attendanceId, bookId)) > 0) { skipped.push(bookId); continue }
		const libId = libraryIds(book)[0]
		const lib = libId ? await d.getPage(libId) : null
		const subjects = lib ? rel(lib, "과목") : []
		const title = ["[학습]", `${lib ? anyTitleText(lib) : anyTitleText(book)}${className ? ` · ${className}` : ""}`, dateLabel].filter(Boolean).join(" ").trim()
		const props: Record<string, unknown> = {
			"학습": { title: [{ text: { content: title } }] },
			"진도교재": { relation: [{ id: bookId }] },
			"출석": { relation: [{ id: attendanceId }] },
			"등록": { relation: [{ id: regId }] },
			"구분": { select: { name: "학습" } },
			...(sessionId ? { "수업": { relation: [{ id: sessionId }] } } : {}),
			...(classId ? { "클래스": { relation: [{ id: classId }] } } : {}),
			...(libId ? { "교재": { relation: [{ id: libId }] } } : {}),
			...(subjects.length ? { "과목": { relation: subjects.map((id) => ({ id })) } } : {}),
		}
		const page = await d.createPage(DS_LEARNING_RECORD, props)
		created.push(page.id as string)
	}
	return { ok: true, created, skipped, ...(created.length ? {} : { message: ALL_RECORDS_EXIST }) }
}
