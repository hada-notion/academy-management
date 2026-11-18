// _shared/makeupAssign.ts
//
// (v2.8.0 항목 92, C1) 보강을 v2.8 노션 보강 모델 하나로 — 결석 `보강 여부` → `보강 수업` → [보강 배정] → 🔵 보강 출석(`기존 결석`).
// 노션 출석 [보강 배정] 버튼(서버 없음)과 같은 결과를 서버 동작으로 낸다. 관리 앱(class-room `assign-makeup`·`create-makeup-session`)이
// 이 함수를 부르고, 뒤에 노션 버튼을 웹훅으로 바꾸면(N-13) 같은 함수를 부른다.
//
// [보강 배정]이 하는 일(v2.8.0 항목 13):
//   1. 출석 페이지 추가: `등록` = 결석.등록, `출석 상태` = 🔵 보강, `수업` = 결석.보강 수업, `기존 결석` = 결석
//   2. 새 출석 `수업일시` = 보강 수업.수업일시
//   3. 보강 수업 `등록`에 결석.등록 추가
// 서버는 여기에 버튼이 못 거는 조건을 더한다: 결석만, 보강 없음·보강 출석(기존 결석 있는 줄)은 막음, 이미 결석 아닌 보강이 있으면 막음
// (버튼은 두 번 누르면 두 장 생김), 보강 수업(수업 구분 보강)만, 그 수업에 이 학생 출석이 이미 있으면 막음.
// 출석 이름은 노션 이름 자동화와 같은 꼴("학생 MM.DD(요)")로 서버가 붙인다(자동화가 다시 붙여도 같은 값).
import { getPage, createPage, updatePageProperties, relIds, selectName, fullRelationIds, queryAllPages } from "./notionClient.ts"
import { DS_ATTENDANCE } from "./constants.ts"
import { seoulLabel } from "./seoulLabel.ts"
import { isMakeupSession } from "./sessionKind.ts"

export const ABSENT = "🔴 결석"
export const MAKEUP = "🔵 보강"
export const MAKEUP_DECISION = "보강 여부" // 보강 필요 / 보강 없음
export const MAKEUP_NONE = "보강 없음"
export const MAKEUP_DECISIONS = ["보강 필요", MAKEUP_NONE] as const
export const MAKEUP_SESSION = "보강 수업" // 결석 → 수업(양방향 `보강 대상`)
export const MAKEUP_ATTENDANCE = "보강 출석" // 결석 → 그 결석을 메운 보강 출석(양방향 `기존 결석`)
export const ORIGINAL_ABSENCE = "기존 결석"
export const MAKEUP_NEEDED = "보강 필요" // 수식(체크)

type Page = Record<string, any>

export class MakeupError extends Error {
	constructor(public status: number, message: string) { super(message) }
}

// 노션 "보강 대기" 보기와 같은 고급 필터: 🔴 결석 그리고 기존 결석 없음 그리고 (보강 여부 빔 그리고 보강 출석 빔 또는 보강 필요 체크).
// Notion API는 묶음을 두 단계까지만 받아서 (A 그리고 B 그리고 C 그리고 D) 또는 (보강 필요) 로 편다(보강 필요 수식 안에 결석·기존 결석 조건이 있음).
export function waitingFilter() {
	return {
		or: [
			{ and: [
				{ property: "출석 상태", select: { equals: ABSENT } },
				{ property: ORIGINAL_ABSENCE, relation: { is_empty: true } },
				{ property: MAKEUP_DECISION, select: { is_empty: true } },
				{ property: MAKEUP_ATTENDANCE, relation: { is_empty: true } },
			] },
			{ property: MAKEUP_NEEDED, formula: { checkbox: { equals: true } } },
		],
	}
}

const ids = (page: Page, prop: string): string[] => relIds(page?.properties?.[prop])
const same = (a: string, b: string) => String(a).replace(/-/g, "") === String(b).replace(/-/g, "")
const relation = (list: string[]) => ({ relation: list.map((id) => ({ id })) })

export function studentNameOf(att: Page): string {
	const f = att?.properties?.["학생이름(알림톡)"]?.formula?.string
	if (typeof f === "string" && f.trim()) return f.trim()
	const t = (att?.properties?.["출석"]?.title ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? "").join("").trim()
	return t.replace(/\s+\d{2}\.\d{2}\([일월화수목금토]\)\s*$/, "").trim()
}

// 배정할 수 있는 결석인지(쓰기 전에 모두 확인 — create-makeup-session이 수업을 만들기 전에 부른다).
export async function checkAbsence(absence: Page): Promise<void> {
	const name = studentNameOf(absence) || "이"
	if (absence?.archived || absence?.in_trash) throw new MakeupError(404, "지워진 출석입니다.")
	if (selectName(absence, "출석 상태") !== ABSENT) throw new MakeupError(409, `${name} 학생 출석은 결석이 아닙니다(보강은 결석에서 배정).`)
	if (ids(absence, ORIGINAL_ABSENCE).length) throw new MakeupError(409, `${name} 학생 출석은 보강 출석입니다 — 원래 결석에서 배정해 주세요.`)
	if (selectName(absence, MAKEUP_DECISION) === MAKEUP_NONE) throw new MakeupError(409, `${name} 학생 결석은 보강 없음으로 정해져 있습니다.`)
	if (!ids(absence, "등록").length) throw new MakeupError(409, `${name} 학생 출석에 등록이 없습니다.`)
	// 이미 결석이 아닌 보강 출석이 있으면 배정 끝(노션 보강 필요 수식과 같은 판단). 보강도 결석이면 다시 배정할 수 있다.
	for (const id of await fullRelationIds(absence, MAKEUP_ATTENDANCE)) {
		const m = await getPage(id) as Page
		if (m?.archived || m?.in_trash) continue
		if (selectName(m, "출석 상태") !== ABSENT) throw new MakeupError(409, `${name} 학생 결석은 이미 보강이 배정돼 있습니다.`)
	}
}

export function checkSession(session: Page): void {
	if (!session || session.archived || session.in_trash) throw new MakeupError(404, "보강 수업이 없습니다.")
	if (!isMakeupSession(session)) throw new MakeupError(409, "수업 구분이 보강인 수업에만 배정할 수 있습니다.")
	if (!session.properties?.["수업일시"]?.date?.start) throw new MakeupError(409, "보강 수업에 수업일시가 없습니다.")
}

// [보강 배정] 한 번. 돌려주는 값: 새 보강 출석 id(복사본 맞추기에 씀).
export async function assignMakeup(absenceId: string, sessionId: string, pages?: { absence?: Page; session?: Page }): Promise<{ attendanceId: string; absenceId: string; sessionId: string }> {
	const absence = pages?.absence ?? await getPage(absenceId) as Page
	const session = pages?.session ?? await getPage(sessionId) as Page
	checkSession(session)
	await checkAbsence(absence)
	const regId = ids(absence, "등록")[0]
	const already = await queryAllPages(DS_ATTENDANCE, { and: [{ property: "수업", relation: { contains: sessionId } }, { property: "등록", relation: { contains: regId } }] })
	if (already.some((a: Page) => !a.archived && !a.in_trash)) throw new MakeupError(409, `${studentNameOf(absence) || "이"} 학생은 이 보강 수업에 이미 출석이 있습니다.`)
	const when = session.properties["수업일시"].date
	// 결석에 고른 보강 수업(사람이 버튼 전에 고르는 칸) — 양방향이라 수업 `보강 대상`도 채워진다.
	await updatePageProperties(absenceId, { [MAKEUP_SESSION]: relation([sessionId]) })
	const created = await createPage(DS_ATTENDANCE, {
		"출석": { title: [{ text: { content: `${studentNameOf(absence)} ${seoulLabel(when.start)}`.trim() } }] },
		"등록": relation([regId]),
		"출석 상태": { select: { name: MAKEUP } },
		"수업": relation([sessionId]),
		[ORIGINAL_ABSENCE]: relation([absenceId]),
		"수업일시": { date: { start: when.start, ...(when.end ? { end: when.end } : {}) } },
		"학습정보 수정일": { date: { start: new Date().toISOString() } },
	}) as Page
	const roster = await fullRelationIds(session, "등록")
	if (!roster.some((id) => same(id, regId))) await updatePageProperties(sessionId, { "등록": relation([...roster, regId]) })
	return { attendanceId: created.id as string, absenceId, sessionId }
}
