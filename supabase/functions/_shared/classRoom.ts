// _shared/classRoom.ts
//
// 수업방(class_room.html)이 부르는 class-room 함수의 실제 로직(v2.5.66). 업무 데이터는 모두 Notion에
// 읽고 쓴다(웹 전용 저장소 없음). 값을 고칠 때마다 "학습정보 수정일"을 함께 적어 학부모 리포트의
// 다시 만들기 대상에 들어가게 한다(Notion 자동화가 API 수정에도 도는지와 상관없이).
//
// 학생 연결 규칙은 [학습기록 생성] 버튼(createLearningRecordTarget.ts)과 같다:
//   - 그룹 진도 교재는 수업의 학생 전체, 개별 진도 교재는 그 교재를 가진 학생만.
//   - 보강 수업(`수업 구분` 보강)은 그룹 교재도 가진 학생만 연결하고 기록에 "보강"을 체크한다.
// 학습활동(출제)은 기존 create-assignment와 같은 공용 코드(finishCreateAssignment)를 쓴다.

import {
	getPage,
	queryAllPages,
	createPage,
	updatePageProperties,
	archivePage,
	mapWithConcurrency,
	relIds as relIdsFromProp,
	selectName,
	statusName,
	formulaString,
	dateStart,
	checkboxValue,
	anyTitleText,
	fetchWithRetry,
	notionHeaders,
	queryDataSource,
	fullRelationIds,
} from "./notionClient.ts"
import {
	DS_CLASS_SESSION,
	DS_ATTENDANCE,
	DS_LEARNING_RECORD,
	DS_STUDY_ACTIVITY,
} from "./constants.ts"
import {
	ASSIGNMENT_GEN_STATUS_SPEC,
	finishCreateAssignment,
	setAssignmentGenRunning,
	setAssignmentGenDone,
	setAssignmentGenError,
} from "./createAssignmentTarget.ts"
import { isRunning, markQueued } from "./statusTracking.ts"
import { ROUTINE_STATUS_SPEC, TARGET_ROUTINE_CHECKS } from "./routineCheck.ts"
import { enqueueSync, wakeSyncQueueWorker } from "./syncQueue.ts"
import { text as propText, numberOf as propNumber, fileUrlOf, dateStartOf } from "./reportCacheShared.ts"
import { readPageBodyBlocks } from "./feedBody.ts"
import { libraryCopyReady, readBooks, readUnits, sortUnits } from "./libraryCopy.ts"
import { textbookSources } from "./textbookSearch.ts"
import { cleanUnitIds, selectedUnitsProp, unitNamesOf, unitTextOf, unitIdsOf } from "./selectedUnits.ts"
import { runInBackground } from "./backgroundTask.ts"
import { seoulLabel } from "./seoulLabel.ts"
import { assignMakeup, checkAbsence, MakeupError, waitingFilter, MAKEUP_DECISION, MAKEUP_DECISIONS, MAKEUP_SESSION, ORIGINAL_ABSENCE } from "./makeupAssign.ts"
import { isDeletingFlagSet, queueCascadeDelete } from "./cascadeDeleteTarget.ts"
import { mirrorJobs, mirrorPageIds, mirrorSaved, removePages } from "./classRoomCopy.ts"
import { libraryIds } from "./libraryProp.ts"
import { isMakeupSession, SESSION_KIND_MAKEUP, SESSION_KIND_PROP } from "./sessionKind.ts"
import { attMemoKey, withAttMemoName } from "./attendanceMemo.ts"
import { ACTIVITY_MEMO, nameLearner, propKey } from "./propAlias.ts"

type Page = Record<string, any>

export class ClassRoomError extends Error {
	// detail(261123 출시 전 4번): 여러 줄 중 일부만 실패했을 때 어떤 줄이 됐고 안 됐는지(class-room이 응답 본문에 함께 싣는다).
	constructor(public status: number, message: string, public detail?: Record<string, unknown>) {
		super(message)
	}
}

export const KINDS = ["학습", "과제", "평가"] as const
export const ATTENDANCE_STATUSES = ["🟢 출석", "🔴 결석", "🔵 보강"] as const
export const HOMEWORK_SUBMITTED = "🔵 제출"
const HOMEWORK_MISSING = "🔴 미제출"
// 과제상태 3단계(v2.6.9): 제출 / 일부 제출 / 미제출. 제출 수는 "제출"만 센다(일부 제출은 세지 않음).
const HOMEWORK_PARTIAL = "🟡 일부 제출"
export const HOMEWORK_STATES = ["제출", "일부 제출", "미제출"] as const
const HOMEWORK_OPTION: Record<string, string> = { "제출": HOMEWORK_SUBMITTED, "일부 제출": HOMEWORK_PARTIAL, "미제출": HOMEWORK_MISSING }
// Notion 선택값 → 화면 상태("" = 아직 안 정함). 이모지가 달라도 글자로 판단한다.
export function homeworkState(name: string | null | undefined): string {
	const s = String(name ?? "")
	if (s.includes("일부")) return "일부 제출"
	if (s.includes("미제출")) return "미제출"
	if (s.includes("제출")) return "제출"
	return ""
}
const GROUP_PROGRESS = "그룹 진도"
const MAX_ITEMS = 60

// ---------- 작은 도우미 ----------
const rel = (page: Page, prop: string): string[] => relIdsFromProp(page?.properties?.[prop])
const relation = (ids: string[]) => ({ relation: ids.map((id) => ({ id })) })
const richText = (value: string) => ({ rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : [] })
function plain(page: Page, prop: string): string {
	const p = page?.properties?.[prop]
	return (p?.title ?? p?.rich_text ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("")
}
function numberOf(page: Page, prop: string): number | null {
	const v = page?.properties?.[prop]?.number
	return typeof v === "number" ? v : null
}
const nowStamp = () => ({ date: { start: new Date().toISOString() } })
const touched = () => ({ "학습정보 수정일": nowStamp() })
function dedupe(ids: string[]): string[] {
	return Array.from(new Set(ids.filter(Boolean)))
}
export function isId(v: unknown): v is string {
	return typeof v === "string" && /^[0-9a-z-]{1,64}$/i.test(v) // Notion 페이지 id(하이픈 있는/없는 hex). 경로 문자는 막는다
}
function ids(v: unknown, max = MAX_ITEMS): string[] {
	if (!Array.isArray(v) || v.length > max || !v.every(isId)) throw new ClassRoomError(400, "요청 형식이 올바르지 않습니다.")
	return dedupe(v)
}

// 서울 날짜 하루 범위와 "10.13(화)" 꼴 날짜 표시(기존 학습기록 제목과 같은 모양).
export function seoulDayRange(date: string): { start: string; end: string } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ClassRoomError(400, "날짜 형식이 올바르지 않습니다.")
	const start = new Date(`${date}T00:00:00+09:00`)
	const end = new Date(start.getTime() + 86_400_000)
	return { start: start.toISOString(), end: end.toISOString() }
}
export { seoulLabel } // 한 곳: _shared/seoulLabel.ts(학습기록·과제 제목과 같은 함수)
export function seoulTime(iso: string | null): string {
	if (!iso || !iso.includes("T")) return ""
	const d = new Date(new Date(iso).getTime() + 9 * 3_600_000)
	return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}
// 학습기록 제목 규칙: [구분] 교재명 또는 주제(클래스) 날짜
export function recordTitle(kind: string, subject: string, className: string, dateIso: string | null): string {
	const classPart = className ? ` · ${className}` : ""
	return [`[${kind}]`, `${subject}${classPart}`, seoulLabel(dateIso)].filter(Boolean).join(" ").trim()
}

async function getPages(pageIds: string[]): Promise<Page[]> {
	return await mapWithConcurrency(dedupe(pageIds), 6, (id) => getPage(id)) as Page[]
}
function studentName(attendance: Page): string {
	// (11/2) 예전 `학생이름(보고서)` 대신 `학생이름(알림톡)`.
	return formulaString(attendance, "학생이름(알림톡)") || plain(attendance, "출석")
}

// ---------- 조회 ----------
let teacherDsCache = ""
async function teacherDataSourceId(): Promise<string> {
	if (teacherDsCache) return teacherDsCache
	const res = await fetchWithRetry(`https://api.notion.com/v1/data_sources/${DS_CLASS_SESSION}`, { headers: notionHeaders() })
	if (!res.ok) throw new Error(`수업 DB 정보를 읽지 못했습니다: ${res.status}`)
	const ds = await res.json()
	const id = ds?.properties?.["담당강사"]?.relation?.data_source_id
	if (!id) throw new Error('수업 DB "담당강사" 관계의 대상 DB를 찾지 못했습니다.')
	teacherDsCache = id
	return id
}

export async function listTeachers() {
	const pages = await queryAllPages(await teacherDataSourceId())
	return pages
		.map((p: Page) => ({ id: p.id as string, name: anyTitleText(p), role: selectName(p, "직책") ?? "" }))
		.filter((t) => t.name)
		.sort((a, b) => a.name.localeCompare(b.name, "ko"))
}

function sessionSummary(p: Page) {
	const when = p.properties?.["수업일시"]?.date ?? {}
	return {
		id: p.id as string,
		name: anyTitleText(p),
		start: when.start ?? null,
		end: when.end ?? null,
		time: [seoulTime(when.start), seoulTime(when.end)].filter(Boolean).join("–"),
		teacherIds: rel(p, "담당강사"),
		classIds: rel(p, "클래스"),
		makeup: isMakeupSession(p),
		students: rel(p, "출석").length,
		records: rel(p, "학습기록").length,
		attendanceSummary: formulaString(p, "출석현황") ?? "",
		// (2.8 하루 수업 페이지, 앱서버 261118) 수업 구분(정규·보강·휴강 이름 그대로)·학습 내용 한 줄·처리 상태·오류·시간표.
		kind: selectName(p, SESSION_KIND_PROP) ?? "",
		summary: propText(p.properties?.["학습 내용"]).trim(),
		busy: propText(p.properties?.["실시간 처리 상태"]).trim(),
		error: propText(p.properties?.["마지막 오류"]).trim(),
		blockId: rel(p, "시간표")[0] ?? null,
	}
}

// 서울 날짜(YYYY-MM-DD). 날짜만 있는 값은 그대로.
export function seoulDate(iso: string | null): string {
	if (!iso) return ""
	if (!iso.includes("T")) return iso.slice(0, 10)
	return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}
export function teacherFilter(teacherId?: string) {
	if (teacherId !== undefined && teacherId !== "" && !isId(teacherId)) throw new ClassRoomError(400, "강사 형식이 올바르지 않습니다.")
	return teacherId ? [{ property: "담당강사", relation: { contains: teacherId } }] : []
}
// 클래스 이모지·이름. 리포트처럼 클래스 DB "이모지"를 쓰고(글·선택·수식 어느 형식이든), 없으면 페이지 아이콘. 비면 화면이 색 이모지를 정한다.
function textOf(page: Page, prop: string): string {
	const p = page?.properties?.[prop]
	return (plain(page, prop) || p?.select?.name || p?.formula?.string || "").trim()
}
async function classInfo(classIds: string[]): Promise<Map<string, { name: string; emoji: string }>> {
	const pages = await getPages(classIds)
	return new Map(pages.map((c: Page) => [c.id as string, { name: anyTitleText(c), emoji: textOf(c, "이모지") || (c.icon?.type === "emoji" ? c.icon.emoji : "") }]))
}

// 하루의 수업(클래스 이모지·이름, 등원한 학생 수)과 보강 대기실(수업에 연결되지 않은 그날의 🔵 보강 출석). 강사를 고르면 그 강사의 수업만.
export async function loadDay(date: string, teacherId?: string) {
	const { start, end } = seoulDayRange(date)
	const range = [
		{ property: "수업일시", date: { on_or_after: start } },
		{ property: "수업일시", date: { before: end } },
	]
	const [sessions, attendances] = await Promise.all([
		queryAllPages(DS_CLASS_SESSION, { and: [...range, ...teacherFilter(teacherId)] }),
		queryAllPages(DS_ATTENDANCE, { and: range }),
	])
	const classes = await classInfo(sessions.map((p: Page) => rel(p, "클래스")[0]).filter(Boolean))
	const arrived = new Map<string, number>()
	for (const a of attendances) if (dateStart(a, "등원스템프")) for (const sid of rel(a, "수업")) arrived.set(sid, (arrived.get(sid) ?? 0) + 1)
	const waiting = attendances.filter((a: Page) => !rel(a, "수업").length && selectName(a, "출석 상태") === "🔵 보강")
	return {
		date,
		sessions: sessions.map((p: Page) => {
			const c = classes.get(rel(p, "클래스")[0])
			return { ...sessionSummary(p), className: c?.name ?? "", classEmoji: c?.emoji ?? "", arrived: arrived.get(p.id as string) ?? 0 }
		}).sort((a, b) => String(a.start).localeCompare(String(b.start))),
		makeupWaiting: waiting.map((a: Page) => ({
			attendanceId: a.id as string,
			registrationId: rel(a, "등록")[0] ?? null,
			name: studentName(a),
			className: formulaString(a, "클래스(알림톡)") ?? "",
			start: a.properties?.["수업일시"]?.date?.start ?? null,
		})),
	}
}

// 달력 표시용: 기간(최대 6주) 안에서 수업이 있는 서울 날짜.
export async function loadDays(from: string, to: string, teacherId?: string) {
	const start = seoulDayRange(from).start, end = seoulDayRange(to).end
	const span = Date.parse(end) - Date.parse(start)
	if (span <= 0 || span > 42 * 86_400_000) throw new ClassRoomError(400, "기간이 올바르지 않습니다.")
	const sessions = await queryAllPages(DS_CLASS_SESSION, {
		and: [{ property: "수업일시", date: { on_or_after: start } }, { property: "수업일시", date: { before: end } }, ...teacherFilter(teacherId)],
	})
	return { dates: dedupe(sessions.map((p: Page) => seoulDate(p.properties?.["수업일시"]?.date?.start ?? null)).filter(Boolean)).sort() }
}

// ≡ 클래스 목록(v2.5.80): 고른 강사의 수업(기준일 4주 전 ~ 4주 뒤, 보강 제외)을 반별로 묶는다.
// 반마다 오늘 수업(시간순), 오늘 뒤 첫 수업, 오늘 전 마지막 수업을 돌려주고, 화면이 오늘 → 다음 → 마지막 순으로 연다.
export async function loadClasses(date: string, teacherId?: string) {
	const { start, end } = seoulDayRange(date)
	const t = Date.parse(start)
	const sessions = (await queryAllPages(DS_CLASS_SESSION, {
		and: [
			{ property: "수업일시", date: { on_or_after: new Date(t - 28 * 86_400_000).toISOString() } },
			{ property: "수업일시", date: { before: new Date(t + 29 * 86_400_000).toISOString() } },
			...teacherFilter(teacherId),
		],
	})).filter((p: Page) => !isMakeupSession(p) && rel(p, "클래스").length)
		.sort((a: Page, b: Page) => String(a.properties?.["수업일시"]?.date?.start).localeCompare(String(b.properties?.["수업일시"]?.date?.start)))
	const byClass = new Map<string, Page[]>()
	for (const p of sessions) { const c = rel(p, "클래스")[0]; byClass.set(c, [...(byClass.get(c) ?? []), p]) }
	const info = await classInfo([...byClass.keys()])
	const brief = (p?: Page) => p ? { id: p.id as string, date: seoulDate(p.properties?.["수업일시"]?.date?.start ?? null), time: sessionSummary(p).time } : null
	// 주간 시간표(v2.5.87): 기준일이 있는 주(월~일)의 수업. 학생 수는 기준일에 가장 가까운 수업(오늘 → 다음 → 지난)의 출석 수.
	const dow = (Date.parse(start) / 86_400_000 + 3.375) % 7 // 1970-01-01(목) 기준, 서울 자정 = UTC 15시
	const monday = t - Math.floor(dow) * 86_400_000, sunday = monday + 7 * 86_400_000
	return {
		classes: [...byClass].map(([classId, list]) => {
			const when = (p: Page) => String(p.properties?.["수업일시"]?.date?.start ?? "")
			const today = list.filter((p) => when(p) >= start && when(p) < end)
			return {
				classId,
				name: info.get(classId)?.name ?? "",
				emoji: info.get(classId)?.emoji ?? "",
				today: today.map((p) => { const s = sessionSummary(p); return { id: s.id, start: s.start, end: s.end, time: s.time } }),
				next: brief(list.find((p) => when(p) >= end)),
				last: brief(list.filter((p) => when(p) < start).at(-1)),
				week: list.filter((p) => Date.parse(when(p)) >= monday && Date.parse(when(p)) < sunday).map((p) => { const s = sessionSummary(p); return { id: s.id, date: seoulDate(s.start), time: s.time } }),
				students: (today[0] ?? list.find((p) => when(p) >= end) ?? list.filter((p) => when(p) < start).at(-1))?.properties?.["출석"]?.relation?.length ?? 0,
			}
		}),
	}
}

// 같은 반의 앞뒤 수업(기준 9주 전 ~ 5주 뒤, 보강 수업 제외, 날짜순 최대 90개). 반이 없는 보강 수업은 빈 목록.
async function classSessionPages(session: Page, around?: string) {
	const classId = rel(session, "클래스")[0]
	const anchor = around ? seoulDayRange(around).start : session.properties?.["수업일시"]?.date?.start
	if (!classId || !anchor) return { sessions: [] as Page[], range: [] }
	const t = Date.parse(anchor)
	const range = [
		{ property: "수업일시", date: { on_or_after: new Date(t - 63 * 86_400_000).toISOString() } },
		{ property: "수업일시", date: { before: new Date(t + 36 * 86_400_000).toISOString() } },
	]
	const sessions = (await queryAllPages(DS_CLASS_SESSION, { and: [{ property: "클래스", relation: { contains: classId } }, ...range] }))
		.filter((p: Page) => !isMakeupSession(p))
		.sort((a: Page, b: Page) => String(a.properties?.["수업일시"]?.date?.start).localeCompare(String(b.properties?.["수업일시"]?.date?.start)))
		.slice(0, 90)
	return { sessions, range }
}

// 수업들의 출석(같은 기간 안, 수업 90개씩 나눠 조회)
async function sessionAttendances(sessions: Page[], range: unknown[]) {
	const attendances: Page[] = []
	for (let i = 0; i < sessions.length; i += 90) {
		const part = sessions.slice(i, i + 90)
		if (!part.length) continue
		attendances.push(...await queryAllPages(DS_ATTENDANCE, { and: [...range, { or: part.map((p: Page) => ({ property: "수업", relation: { contains: p.id } })) }] }))
	}
	return attendances
}
// 수업들의 학습기록(수업 90개씩 나눠 조회, 중복 제거)
async function sessionRecords(sessions: Page[]) {
	const found = new Map<string, Page>()
	for (let i = 0; i < sessions.length; i += 90) {
		const part = sessions.slice(i, i + 90)
		for (const r of await queryAllPages(DS_LEARNING_RECORD, { or: part.map((p: Page) => ({ property: "수업", relation: { contains: p.id } })) })) found.set(r.id as string, r)
	}
	return [...found.values()]
}

// 반 요약(v2.5.94, 기준 v2.5.96): 학생 탭 위 반 요약과 학생별 출석률·최근 평가 점수. 범위는 캘린더·반 학습기록과 같은 같은 반 앞뒤 수업(9주 전 ~ 5주 뒤, 보강 제외).
// 출석률 = 학부모 리포트 월간 보고서와 같은 기준(v2.5.96): (출석 + 보강, 또는 상태 없이 등원) ÷ 확인된 출석(출석·보강·결석). 아직 아무것도 입력되지 않은 출석과 앞으로의 수업은 뺀다.
// 과제이행률(v2.5.96) = 그 달에 마감인 과제 학습활동(과제 마감일 기준) 중 제출 비율. 아직 마감일이 오지 않은 과제는 뺀다.
// 월은 보고 있는 수업 날짜의 달(학생별 출석률도 그 달). 반이 없는 보강 수업은 그 수업만 센다.
// 평가 = 같은 범위 "평가" 학습기록의 학습활동 점수(정답 문항 ÷ 전체 문항 × 100, 전체 문항이 있는 것만). 반 평균(소수 한 자리, 리포트 평가 추이와 같음)은 최근 5개, 학생별은 가장 최근 점수.
export async function loadClassStats(sessionId: string, now = Date.now()) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	let { sessions, range } = await classSessionPages(session)
	const attendances = sessions.length ? await sessionAttendances(sessions, range) : await getPages(rel(session, "출석"))
	if (!sessions.length) sessions = [session]
	const startOf = (p?: Page) => p?.properties?.["수업일시"]?.date?.start ?? null
	const byId = new Map(sessions.map((p) => [p.id as string, p]))
	const ym = seoulDate(startOf(session)).slice(0, 7), today = seoulDate(new Date(now).toISOString())
	const month = { present: 0, counted: 0 }, hw = { done: 0, total: 0 }
	const students: Record<string, { present: number; counted: number; score: number | null; scoreDate: string | null }> = {}
	const student = (id: string) => (students[id] ??= { present: 0, counted: 0, score: null, scoreDate: null })
	for (const a of attendances) {
		const start = startOf(byId.get(rel(a, "수업").find((id) => byId.has(id)) ?? ""))
		if (!start || Date.parse(start) > now || seoulDate(start).slice(0, 7) !== ym) continue
		const status = selectName(a, "출석 상태") ?? ""
		const present = status === "🟢 출석" || status === "🔵 보강" || (!status && !!dateStart(a, "등원스템프"))
		if (!present && status !== "🔴 결석") continue
		month.counted++
		if (present) month.present++
		const reg = rel(a, "등록")[0]
		if (reg) { const s = student(reg); s.counted++; if (present) s.present++ }
	}
	// 과제이행률·평가 점수: 같은 범위의 과제·평가 학습기록과 그 학습활동
	const records = (await sessionRecords(sessions)).filter((r) => ["과제", "평가"].includes(selectName(r, "구분") ?? ""))
	const acts: Page[] = []
	for (let i = 0; i < records.length; i += 90) {
		const part = records.slice(i, i + 90)
		acts.push(...await queryAllPages(DS_STUDY_ACTIVITY, { or: part.map((r) => ({ property: "학습기록", relation: { contains: r.id } })) }))
	}
	const homeworkIds = new Set(records.filter((r) => selectName(r, "구분") === "과제").map((r) => r.id as string))
	for (const a of acts) {
		if (!rel(a, "학습기록").some((id) => homeworkIds.has(id))) continue
		const due = seoulDate(dateStartOf(a.properties?.["과제 마감일"]) ?? null)
		if (!due || due.slice(0, 7) !== ym || due > today) continue
		hw.total++
		if (selectName(a, "과제상태") === HOMEWORK_SUBMITTED) hw.done++
	}
	const tests0 = records.filter((r) => selectName(r, "구분") === "평가")
	const summaries = new Map((await withSubjects(tests0)).map((r) => [r.id, r]))
	const tests = tests0.map((r) => {
		const start = startOf(byId.get(rel(r, "수업").find((id) => byId.has(id)) ?? ""))
		const scored = acts.filter((a) => rel(a, "학습기록").includes(r.id as string)).map((a) => ({ reg: rel(a, "등록")[0] ?? "", correct: numberOf(a, "정답 문항"), total: numberOf(a, "전체 문항") }))
			.filter((x) => x.total && x.total > 0 && typeof x.correct === "number").map((x) => ({ reg: x.reg, pct: (x.correct as number) / (x.total as number) * 100 }))
		const s = summaries.get(r.id as string)
		return { id: r.id as string, subject: s?.subject ?? "", range: s?.range ?? "", date: seoulDate(start), start: start ?? "", scored }
	}).filter((t) => t.scored.length && t.start && Date.parse(t.start) <= now).sort((a, b) => a.start.localeCompare(b.start))
	for (const t of tests) for (const x of t.scored) if (x.reg) { const s = student(x.reg); s.score = Math.round(x.pct); s.scoreDate = t.date }
	const pct = (n: number, d: number) => d ? Math.round(n / d * 100) : null
	return {
		month: { ym, ...month, rate: pct(month.present, month.counted) },
		homework: { ym, ...hw, rate: pct(hw.done, hw.total) },
		tests: tests.slice(-5).map((t) => ({ id: t.id, subject: t.subject, range: t.range, date: t.date, avg: Math.round(t.scored.reduce((n, x) => n + x.pct, 0) / t.scored.length * 10) / 10, count: t.scored.length })),
		students: Object.fromEntries(Object.entries(students).map(([id, s]) => [id, { ...s, rate: pct(s.present, s.counted) }])),
	}
}

// 반 학습기록(v2.5.89): 같은 반 앞뒤 수업(위 범위)의 학습기록을 수업 날짜·시각과 함께, 최근 수업부터.
// 반이 없는 보강 수업은 그 수업의 기록만. 학습기록 탭 날짜별 목록·교재 상세의 그 교재 기록에 쓴다.
export async function loadClassRecords(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	let { sessions } = await classSessionPages(session)
	if (!sessions.length) sessions = [session]
	const byId = new Map(sessions.map((p) => [p.id as string, p]))
	const pages = await sessionRecords(sessions), summaries = await withSubjects(pages)
	const startOfRecord = (r: Page) => { const sid = rel(r, "수업").find((id) => byId.has(id)); return sid ? byId.get(sid)?.properties?.["수업일시"]?.date?.start ?? "" : "" }
	// (v2.5.111 속도) 본문은 카드를 펼칠 때 record-body로 따로 읽는다
	const extra = await cardExtras(pages, [])
	const records = pages.map((r, i) => {
		const sid = rel(r, "수업").find((id) => byId.has(id)) ?? null
		const start = sid ? byId.get(sid)?.properties?.["수업일시"]?.date?.start ?? null : null
		return { ...summaries[i], ...extra(r), sessionId: sid, date: seoulDate(start), start }
	})
	records.sort((a, b) => String(b.start ?? "").localeCompare(String(a.start ?? "")) || a.title.localeCompare(b.title, "ko"))
	return { records: records.map(({ start, ...r }) => ({ ...r, time: seoulTime(start) })) }
}

// 반 주간 캘린더: 같은 반의 앞뒤 수업(9주 전 ~ 5주 뒤, 보강 수업 제외)과 수업별 출석 요약.
// present = 출석 처리됐거나 등원한 학생, absent = 결석·보강, missing = 상태도 등원도 없는 학생. 반이 없는 보강 수업은 빈 목록.
export async function loadClassSessions(sessionId: string, around?: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	if (around !== undefined && around !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(around)) throw new ClassRoomError(400, "날짜 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	const { sessions, range } = await classSessionPages(session, around)
	if (!sessions.length) return { sessions: [] }
	const attendances = await sessionAttendances(sessions, range)
	// 과제 현황(v2.5.103): 같은 범위 과제 학습기록의 학습활동을 "과제 마감일"(서울 날짜)로 모아, 수업 날짜마다 그날 마감 과제의 제출 수/전체.
	const homeworkRecords = (await sessionRecords(sessions)).filter((r) => selectName(r, "구분") === "과제")
	const dueByDate = new Map<string, { done: number; total: number }>()
	for (let i = 0; i < homeworkRecords.length; i += 90) {
		const part = homeworkRecords.slice(i, i + 90)
		for (const a of await queryAllPages(DS_STUDY_ACTIVITY, { or: part.map((r) => ({ property: "학습기록", relation: { contains: r.id } })) })) {
			const due = seoulDate(dateStartOf(a.properties?.["과제 마감일"]) ?? null)
			if (!due) continue
			const d = dueByDate.get(due) ?? { done: 0, total: 0 }
			d.total++
			if (selectName(a, "과제상태") === HOMEWORK_SUBMITTED) d.done++
			dueByDate.set(due, d)
		}
	}
	return {
		sessions: sessions.map((p: Page) => {
			const mine = attendances.filter((a) => rel(a, "수업").includes(p.id as string))
			const status = (a: Page) => selectName(a, "출석 상태") ?? ""
			const start = p.properties?.["수업일시"]?.date?.start ?? null
			return {
				id: p.id as string,
				date: seoulDate(start),
				time: [seoulTime(start), seoulTime(p.properties?.["수업일시"]?.date?.end ?? null)].filter(Boolean).join("–"),
				total: rel(p, "출석").length,
				present: mine.filter((a) => status(a) === "🟢 출석" || (!status(a) && dateStart(a, "등원스템프"))).length,
				absent: mine.filter((a) => status(a) === "🔴 결석" || status(a) === "🔵 보강").length,
				missing: mine.filter((a) => !status(a) && !dateStart(a, "등원스템프")).length,
				hwDone: dueByDate.get(seoulDate(start))?.done ?? 0,
				hwTotal: dueByDate.get(seoulDate(start))?.total ?? 0,
			}
		}),
	}
}

// unitNames(v2.5.126): 학습기록 "선택 단원" 이름 — 고른 단원이 있으면 unit은 그 이름들(unitTextOf).
function recordSummary(r: Page, unitNames: Map<string, string> = new Map()) {
	return {
		id: r.id as string,
		title: anyTitleText(r),
		kind: selectName(r, "구분") ?? "",
		bookId: rel(r, "진도교재")[0] ?? null,
		topic: plain(r, "주제"),
		range: plain(r, "범위"),
		unit: unitTextOf(r, unitNames),
		unitIds: unitIdsOf(r),
		content: plain(r, "내용"),
		makeup: checkboxValue(r, "보강"),
		registrationIds: rel(r, "등록"),
		activities: rel(r, "학습활동").length,
		activityStatus: selectName(r, "학습활동 생성 상태") ?? "",
	}
}

// 기록 카드(v2.5.95, 학부모 리포트 학습기록 카드와 같은 규칙): 과제는 제출 수·마감일, 평가는 평균 점수, 그리고 페이지 본문(블록).
// 본문은 bodyIds(화면에 먼저 보이는 최근 기록)만 읽는다(리포트처럼 최근 것만, 동시 6개). 읽기 실패는 빈 본문.
async function cardExtras(records: Page[], bodyIds: string[]) {
	const graded = records.filter((r) => ["과제", "평가"].includes(selectName(r, "구분") ?? ""))
	const acts: Page[] = []
	for (let i = 0; i < graded.length; i += 90) {
		const part = graded.slice(i, i + 90)
		acts.push(...await queryAllPages(DS_STUDY_ACTIVITY, { or: part.map((r) => ({ property: "학습기록", relation: { contains: r.id } })) }))
	}
	const bodies = new Map(await mapWithConcurrency(dedupe(bodyIds), 6, async (id: string) => [id, await readPageBodyBlocks(id)] as const) as [string, unknown[]][])
	return (r: Page) => {
		const kind = selectName(r, "구분") ?? "", mine = acts.filter((a) => rel(a, "학습기록").includes(r.id as string))
		const scored = mine.map((a) => ({ c: numberOf(a, "정답 문항"), t: numberOf(a, "전체 문항") })).filter((x) => x.t && x.t > 0 && typeof x.c === "number")
		return {
			homework: kind === "과제" && mine.length ? {
				submitted: mine.filter((a) => selectName(a, "과제상태") === HOMEWORK_SUBMITTED).length,
				total: mine.length,
				due: seoulDate(mine.map((a) => dateStartOf(a.properties?.["과제 마감일"])).find(Boolean) ?? null) || null,
			} : null,
			score: kind === "평가" && scored.length ? { avg: Math.round(scored.reduce((n, x) => n + (x.c as number) / (x.t as number) * 100, 0) / scored.length), count: scored.length } : null,
			body: bodies.get(r.id as string) ?? [],
		}
	}
}

// 기록 카드 제목용 교재 이름(v2.5.89, 리포트 학습기록 카드 "교재 · 범위"): 라이브러리(교재) 이름 → 진도교재 이름(괄호 앞) → 주제.
async function withSubjects(records: Page[]) {
	const ids = dedupe(records.flatMap((r) => [rel(r, "교재")[0], rel(r, "진도교재")[0]].filter(Boolean) as string[]))
	const names = new Map((await getPages(ids)).map((b) => [b.id as string, anyTitleText(b)]))
	const unitNames = await unitNamesOf(records)
	return records.map((r) => {
		const regular = names.get(rel(r, "교재")[0] ?? ""), progress = names.get(rel(r, "진도교재")[0] ?? "")
		return { ...recordSummary(r, unitNames), subject: regular || (progress ?? "").replace(/\(.*\)$/, "").trim() || plain(r, "주제") }
	})
}

// 수업 상세: 학생(출석)·오늘 마감 과제·학습기록.
export async function loadSession(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	const attendances = await getPages(rel(session, "출석"))
	const students = attendances
		.map((a) => ({
			attendanceId: a.id as string,
			registrationId: rel(a, "등록")[0] ?? null,
			name: studentName(a),
			status: selectName(a, "출석 상태") ?? "",
			arrivedAt: dateStart(a, "등원스템프"),
			leftAt: dateStart(a, "하원스템프"),
			memo: plain(a, attMemoKey(a)), // 출석 메모: `메모(내부용)`, 아직 안 바꾼 학원은 `메모`(v2.8.0 항목 62)
			comment: plain(a, "선생님 한마디"),
			reportStatus: propText(a.properties?.["보고서 전송 상태"]).trim(), // (2.8) 일일 보고서 전송 상태

			dueActivityIds: rel(a, "과제"),
		}))
		.sort((x, y) => x.name.localeCompare(y.name, "ko"))
	// 오늘 마감 과제: 출석의 "과제" 관계(이 출석이 마감인 학습활동). 학습기록별로 묶는다.
	const dueIds = dedupe(students.flatMap((s) => s.dueActivityIds))
	const dueActivities = await getPages(dueIds)
	const dueRecordIds = dedupe(dueActivities.flatMap((a) => rel(a, "학습기록")))
	const dueRecords = await getPages(dueRecordIds)
	const attendanceByActivity = new Map<string, string>()
	for (const s of students) for (const id of s.dueActivityIds) attendanceByActivity.set(id, s.attendanceId)
	const homeworkDue = dueRecords.map((r) => {
		const items = dueActivities
			.filter((a) => rel(a, "학습기록").includes(r.id))
			.map((a) => ({
				activityId: a.id as string,
				attendanceId: attendanceByActivity.get(a.id) ?? null,
				registrationId: rel(a, "등록")[0] ?? null,
				submitted: selectName(a, "과제상태") === HOMEWORK_SUBMITTED,
			}))
		return { recordId: r.id as string, title: anyTitleText(r), range: plain(r, "범위"), items }
	})
	const recordPages = await getPages(rel(session, "학습기록"))
	const extra = await cardExtras(recordPages, []) // (v2.5.111 속도) 본문은 펼칠 때 record-body로
	const records = (await withSubjects(recordPages)).map((r, i) => ({ ...r, ...extra(recordPages[i]) }))
	return {
		session: await (async () => {
			const c = (await classInfo(rel(session, "클래스").slice(0, 1))).get(rel(session, "클래스")[0])
			return {
				...sessionSummary(session), className: c?.name ?? "", classEmoji: c?.emoji ?? "",
				// (2.8) 수업 안내: 메모(쓸 수 있음)·보낸 현황·미리보기(수식)
				notice: propText(session.properties?.[SESSION_NOTICE_MEMO]).trim(),
				noticeStatus: propText(session.properties?.["수업 안내 현황"]).trim(),
				noticePreview: propText(session.properties?.["수업 안내 미리보기"]).trim(),
			}
		})(),
		students: students.map(({ dueActivityIds: _drop, ...s }) => s),
		homeworkDue,
		records,
	}
}

// 학생 명부(v2.5.93): 이 수업 학생의 학교·학년·연락처와 학생 보고서 주소용 토큰. 학생 탭을 열 때만 읽는다(읽기만).
// 학교·학년·학생 연락처는 등록의 "학생정보"(원생) 페이지에서 리포트와 같은 속성으로, 우선 연락처는 등록의 "학부모 연락처"
// (알림톡 "우선 연락 대상"과 같은 값). 보고서 토큰이 꺼져 있으면("disabled:", adminShared.parseTokenValue와 같은 규칙) 주소를 주지 않는다.
export async function loadRoster(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	const attendances = await getPages(rel(session, "출석"))
	const regs = new Map((await getPages(dedupe(attendances.map((a) => rel(a, "등록")[0]).filter(Boolean) as string[]))).map((r) => [r.id as string, r]))
	const people = new Map((await getPages(dedupe([...regs.values()].map((r) => rel(r, "학생정보")[0]).filter(Boolean) as string[]))).map((p) => [p.id as string, p]))
	const students = attendances.map((a) => {
		const reg = regs.get(rel(a, "등록")[0] ?? ""), person = reg ? people.get(rel(reg, "학생정보")[0] ?? "") : undefined
		const raw = reg ? propText(reg.properties?.["토큰"]).trim() : "", off = raw.startsWith("disabled:")
		const of = (p: Page | undefined, name: string) => p ? propText(p.properties?.[name]).trim() : ""
		return {
			attendanceId: a.id as string,
			registrationId: reg?.id as string ?? null,
			name: studentName(a),
			school: of(person, "학교(설문)"),
			grade: of(person, "학년(설문)"),
			studentId: person?.id as string ?? null,
			studentPhone: of(person, "학생 연락처"),
			parentPhone: of(reg, "학부모 연락처"),
			// 연락처 전체(v2.6.9): 우선 연락 대상과 어머니·아버지·기타 보호자(학생과의 관계).
			primary: person ? selectName(person, "우선 연락 대상") ?? "" : "",
			motherPhone: of(person, "어머니 연락처"),
			fatherPhone: of(person, "아버지 연락처"),
			guardianPhone: of(person, "기타 보호자 연락처"),
			guardianRelation: of(person, "학생과의 관계"),
			reportToken: raw && !off ? raw : null,
			reportOff: off,
		}
	}).sort((x, y) => x.name.localeCompare(y.name, "ko"))
	return { students }
}

async function className(session: Page): Promise<string> {
	const classId = rel(session, "클래스")[0]
	if (!classId) return ""
	return anyTitleText(await getPage(classId) as Page)
}

// 이 수업 학생들의 진도교재(상태·진도방식·템플릿·가진 학생). 화면이 반 교재 / 템플릿 묶음 / 학생별로 나눈다.
export async function loadBooks(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	const registrations = await getPages(rel(session, "등록"))
	const owners = new Map<string, string[]>()
	for (const r of registrations) for (const b of rel(r, "진도교재")) owners.set(b, [...(owners.get(b) ?? []), r.id])
	const books = await getPages(Array.from(owners.keys()))
	// 교재 카드(v2.5.80): 리포트 교재 카드처럼 표지(라이브러리 "북커버")·쪽수·진행도·최근 학습 범위를 함께 준다.
	// v2.5.125: 라이브러리 교재의 단원(이름·시작쪽)도 함께 준다 — 기록 만들기에서 범위를 넣으면 화면이 바로 단원을 찾는다.
	// 라이브러리 복사본이 준비됐으면 표지·쪽수·단원을 Supabase에서 읽는다.
	const { regulars, unitsBy } = await libraryInfo(dedupe(books.flatMap((b) => libraryIds(b))))
	return {
		registrations: registrations.map((r) => ({ id: r.id as string, name: plain(r, "이름") || anyTitleText(r) })),
		books: books
			.map((b) => ({
				id: b.id as string,
				name: anyTitleText(b),
				status: statusName(b, "진행상태") ?? "",
				mode: selectName(b, "진도방식") ?? "",
				templateId: rel(b, "반별교재")[0] ?? null,
				ownerIds: owners.get(b.id) ?? [],
				...(() => {
					const libId = libraryIds(b)[0] ?? null, rp = libId ? regulars.get(libId) : undefined
					const progress = propNumber(b.properties?.["진행도"])
					return {
						libraryId: libId,
						units: (libId && unitsBy.get(libId)) || [],
						cover: rp?.cover ?? "",
						pages: rp?.pages ?? null,
						kind: rp?.kind ?? "",
						unit: rp?.unit ?? "",
						completedOn: dateStartOf(b.properties?.["수료일"]) ?? "",
						progress: progress === null ? null : Math.round(progress * 100),
						recent: propText(b.properties?.["최근 학습 범위"]),
					}
				})(),
			}))
			.sort((a, b) => a.name.localeCompare(b.name, "ko")),
	}
}

// 라이브러리 교재들의 표지·쪽수와 단원(v2.5.125). 복사본이 없으면 Notion에서 읽는다(단원은 실패해도 빈 목록).
type LibUnit = { id: string; name: string; page: number | null }
// (10/31) 교재 종류(`구분` 프로그램)·`진도 단위`도 함께 준다. 복사본에는 이 두 칸이 없어 라이브러리 페이지를 읽는다(반의 교재 몇 권).
type LibInfo = { cover: string; pages: number | null; kind: string; unit: string }
const libKindUnit = (r: Page) => ({ kind: propText(r.properties?.["구분"]) === "프로그램" ? "프로그램" : "", unit: propText(r.properties?.["진도 단위"]).trim() })
async function libraryInfo(ids: string[]): Promise<{ regulars: Map<string, LibInfo>; unitsBy: Map<string, LibUnit[]> }> {
	const regulars = new Map<string, LibInfo>(), unitsBy = new Map<string, LibUnit[]>()
	if (!ids.length) return { regulars, unitsBy }
	const push = (bookId: string | null, u: LibUnit) => { if (bookId) unitsBy.set(bookId, [...(unitsBy.get(bookId) ?? []), u]) }
	if (await libraryCopyReady()) {
		const [rows, units, libs] = await Promise.all([readBooks(ids), readUnits(ids), getPages(ids).catch(() => [] as Page[])])
		const bare = (id: unknown) => String(id ?? "").replace(/-/g, "")
		const extra = new Map(libs.map((l) => [bare(l.id), libKindUnit(l)]))
		for (const r of rows) regulars.set(r.id, { cover: r.cover, pages: r.pages, kind: "", unit: "", ...extra.get(bare(r.id)) })
		for (const u of units) push(u.book_id, { id: u.id, name: u.name, page: u.start_page })
		return { regulars, unitsBy }
	}
	for (const r of await getPages(ids)) regulars.set(r.id as string, { cover: fileUrlOf(r.properties?.["북커버"]) ?? "", pages: propNumber(r.properties?.["전체 분량"]), ...libKindUnit(r) })
	try {
		const src = await textbookSources()
		const pages = await queryAllPages(src.units, { or: ids.map((id) => ({ property: src.unitsLink, relation: { contains: id } })) })
		const rows = sortUnits(pages.map((p: Page) => ({ id: p.id as string, name: propText(p.properties?.["단원명"]).trim(), start_page: propNumber(p.properties?.["범위 시작"]), book: rel(p, src.unitsLink) })))
		for (const u of rows) for (const b of u.book.filter((x: string) => ids.includes(x))) push(b, { id: u.id, name: u.name, page: u.start_page })
	} catch (err) {
		console.error("[class-room] 단원목록 읽기 실패(단원 미리 보기 없음):", (err as Error).message)
	}
	return { regulars, unitsBy }
}

// 한 학습기록의 학생별 학습활동(제출 상태·점수).
export async function loadActivities(recordId: string) {
	if (!isId(recordId)) throw new ClassRoomError(400, "기록 형식이 올바르지 않습니다.")
	const record = await getPage(recordId) as Page
	const activities = await getPages(rel(record, "학습활동"))
	const attendances = await getPages(dedupe(activities.flatMap((a) => rel(a, "출석"))))
	const nameByAttendance = new Map(attendances.map((a) => [a.id as string, studentName(a)]))
	return {
		record: recordSummary(record, await unitNamesOf([record])),
		activities: activities
			.map((a) => {
				const attendanceId = rel(a, "출석")[0] ?? null
				return {
					id: a.id as string,
					attendanceId,
					registrationId: rel(a, "등록")[0] ?? null,
					name: (attendanceId && nameByAttendance.get(attendanceId)) || anyTitleText(a),
					submitted: selectName(a, "과제상태") === HOMEWORK_SUBMITTED,
					status: homeworkState(selectName(a, "과제상태")),
					correct: numberOf(a, "정답 문항"),
					total: numberOf(a, "전체 문항"),
					memo: plain(a, propKey(a, ACTIVITY_MEMO)), // 학습활동 메모: `메모(내부용)`, 아직 안 바꾼 학원은 `메모`(v2.8.0 항목 64)
				}
			})
			.sort((x, y) => x.name.localeCompare(y.name, "ko")),
	}
}

// 학생 공간: 이 등록(반)의 최근 과제·평가와 지난 메모. 학습활동의 "구분"은 학습기록에서 가져온 롤업이다.
function rollupSelect(page: Page, prop: string): string {
	const arr = page?.properties?.[prop]?.rollup?.array ?? []
	return arr.map((x: any) => x?.select?.name).find(Boolean) ?? ""
}
function formulaDate(page: Page, prop: string): string | null {
	const f = page?.properties?.[prop]?.formula
	// (v2.8.0 항목 81) 역슬래시가 빠져 글자로 온 날짜를 늘 버리던 정규식을 고침
	return f?.date?.start ?? (typeof f?.string === "string" && /^\d{4}-\d{2}-\d{2}/.test(f.string) ? f.string : null)
}
export async function loadStudent(registrationId: string) {
	if (!isId(registrationId)) throw new ClassRoomError(400, "학생 형식이 올바르지 않습니다.")
	const [acts, memos] = await Promise.all([
		queryDataSource(DS_STUDY_ACTIVITY, { filter: { property: "등록", relation: { contains: registrationId } }, sorts: [{ timestamp: "created_time", direction: "descending" }], page_size: 40 }),
		withAttMemoName((memoProp) => queryDataSource(DS_ATTENDANCE, {
			filter: { and: [{ property: "등록", relation: { contains: registrationId } }, { property: memoProp, rich_text: { is_not_empty: true } }] },
			sorts: [{ property: "수업일시", direction: "descending" }],
			page_size: 10,
		})),
	])
	const activities = ((acts as any).results ?? []) as Page[]
	const recordIds = dedupe(activities.flatMap((a) => rel(a, "학습기록")))
	const records = new Map((await getPages(recordIds)).map((r) => [r.id as string, r]))
	const named = (a: Page) => { const r = records.get(rel(a, "학습기록")[0]); return r ? { title: anyTitleText(r), range: plain(r, "범위") } : { title: anyTitleText(a), range: "" } }
	const kindOf = (a: Page) => rollupSelect(a, "구분") || (records.get(rel(a, "학습기록")[0]) ? selectName(records.get(rel(a, "학습기록")[0])!, "구분") ?? "" : "")
	return {
		homework: activities.filter((a) => kindOf(a) === "과제").slice(0, 8).map((a) => ({ id: a.id as string, ...named(a), due: formulaDate(a, "과제 마감일"), submitted: selectName(a, "과제상태") === HOMEWORK_SUBMITTED })),
		tests: activities.filter((a) => kindOf(a) === "평가" && numberOf(a, "전체 문항")).slice(0, 5).map((a) => ({ id: a.id as string, ...named(a), correct: numberOf(a, "정답 문항"), total: numberOf(a, "전체 문항") })),
		memos: (((memos as any).results ?? []) as Page[]).map((m) => ({ attendanceId: m.id as string, date: dateStart(m, "수업일시"), memo: plain(m, attMemoKey(m)) })),
	}
}

// ---------- 저장 (편집 모드의 [저장]) ----------
// (261123 출시 전 4번) 여러 줄을 3개씩 노션에 쓰다 한 줄이 실패해도 나머지는 끝까지 쓰고, 된 줄은 사본에도 반영한다.
// 하나라도 실패하면 502 + { saved, savedIds, failed: [{ id, error }] } — 앱은 실패한 줄만 작성 중으로 남긴다.
const failText = (err: unknown) => err instanceof ClassRoomError ? err.message : `노션에 쓰지 못했어요(${String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 120)})`
export async function settleWrites<T extends { id: string }>(items: T[], write: (it: T) => Promise<Page>): Promise<{ ok: Page[]; failed: { id: string; error: string }[] }> {
	const out = await mapWithConcurrency(items, 3, async (it) => {
		try { return { page: await write(it) } } catch (err) { return { id: it.id, error: failText(err) } }
	})
	return { ok: out.filter((o): o is { page: Page } => "page" in o).map((o) => o.page), failed: out.filter((o): o is { id: string; error: string } => !("page" in o)) }
}
export function partialFailure(what: string, total: number, ok: Page[], failed: { id: string; error: string }[], extra: Record<string, unknown> = {}): ClassRoomError {
	const first = failed[0]?.error ?? ""
	return new ClassRoomError(502, `${what} ${total}건 중 ${failed.length}건을 저장하지 못했어요 — ${first}`, { saved: ok.length, savedIds: ok.map((p) => p.id as string), failed, ...extra })
}

export async function saveAttendance(items: unknown) {
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw new ClassRoomError(400, "저장할 내용이 없습니다.")
	const updates = items.map((it: any) => {
		if (!isId(it?.attendanceId)) throw new ClassRoomError(400, "출석 형식이 올바르지 않습니다.")
		const props: Record<string, unknown> = { ...touched() }
		if (it.status !== undefined) {
			if (it.status !== "" && !(ATTENDANCE_STATUSES as readonly string[]).includes(it.status)) throw new ClassRoomError(400, "출석 상태가 올바르지 않습니다.")
			props["출석 상태"] = { select: it.status ? { name: it.status } : null }
		}
		if (it.comment !== undefined) props["선생님 한마디"] = richText(String(it.comment))
		// (v2.8.0 항목 94) 결석의 `보강 여부`(보강 필요 / 보강 없음, ""는 비우기 = 판단 전) — 노션에서 고르는 것과 같다.
		if (it.makeupDecision !== undefined) {
			if (it.makeupDecision !== "" && !(MAKEUP_DECISIONS as readonly string[]).includes(it.makeupDecision)) throw new ClassRoomError(400, "보강 여부가 올바르지 않습니다(보강 필요·보강 없음).")
			props[MAKEUP_DECISION] = { select: it.makeupDecision ? { name: it.makeupDecision } : null }
		}
		// (2.8 하루 수업 페이지) 등·하원 시각 고치기: ISO 시각, ""는 비우기.
		for (const [key, prop] of [["arrivedAt", "등원스템프"], ["leftAt", "하원스템프"]] as const) {
			if (it[key] === undefined) continue
			const v = String(it[key] ?? "")
			if (v && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) || Number.isNaN(Date.parse(v)))) throw new ClassRoomError(400, "등·하원 시각 형식이 올바르지 않습니다(ISO 시각).")
			props[prop] = { date: v ? { start: v } : null }
		}
		return { id: it.attendanceId as string, props, memo: it.memo === undefined ? undefined : richText(String(it.memo)) }
	})
	// 출석 메모는 `메모(내부용)`으로 쓰고, 아직 안 바꾼 학원이면 `메모`로 다시 쓴다(v2.8.0 항목 62).
	const { ok, failed } = await settleWrites(updates, (u) => (u.memo === undefined
		? updatePageProperties(u.id, u.props)
		: withAttMemoName((memoProp) => updatePageProperties(u.id, { ...u.props, [memoProp]: u.memo }))) as Promise<Page>)
	await mirrorSaved("cr_attendance", ok) // 복사본 함께 쓰기(v2.5.115, v2.5.116부터 Notion 수정 응답을 그대로) — 된 줄만
	if (failed.length) throw partialFailure("출결", updates.length, ok, failed)
	return { saved: updates.length }
}

const activityMemoName = nameLearner(ACTIVITY_MEMO)
export function resetActivityMemoName() { activityMemoName.reset() }

export async function saveActivities(items: unknown) {
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw new ClassRoomError(400, "저장할 내용이 없습니다.")
	const updates = items.map((it: any) => {
		if (!isId(it?.activityId)) throw new ClassRoomError(400, "학습활동 형식이 올바르지 않습니다.")
		const props: Record<string, unknown> = { ...touched() }
		if (it.status !== undefined) {
			if (it.status !== "" && !(HOMEWORK_STATES as readonly string[]).includes(it.status)) throw new ClassRoomError(400, "과제 상태가 올바르지 않습니다.")
			props["과제상태"] = { select: it.status ? { name: HOMEWORK_OPTION[it.status] } : null }
		} else if (it.submitted !== undefined) props["과제상태"] = { select: { name: it.submitted ? HOMEWORK_SUBMITTED : HOMEWORK_MISSING } }
		// 학습활동 메모(v2.6.9, 내부용 — 학부모 리포트에 보이지 않음)
		let memo: unknown = undefined
		if (it.memo !== undefined) {
			if (typeof it.memo !== "string") throw new ClassRoomError(400, "메모 형식이 올바르지 않습니다.")
			memo = richText(it.memo.trim().slice(0, 2000))
		}
		for (const [key, prop] of [["correct", "정답 문항"], ["total", "전체 문항"]] as const) {
			if (it[key] === undefined) continue
			const v = it[key]
			if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000)) throw new ClassRoomError(400, "점수가 올바르지 않습니다.")
			props[prop] = { number: v }
		}
		if (typeof it.correct === "number" && typeof it.total === "number" && it.correct > it.total) throw new ClassRoomError(400, "맞힌 문항이 전체 문항보다 많습니다.")
		return { id: it.activityId as string, props, memo }
	})
	// 학습활동 메모는 `메모(내부용)`으로 쓰고, 아직 안 바꾼 학원이면 `메모`로 다시 쓴다(v2.8.0 항목 64).
	const { ok, failed } = await settleWrites(updates, (u) => (u.memo === undefined
		? updatePageProperties(u.id, u.props)
		: activityMemoName.run((memoProp) => updatePageProperties(u.id, { ...u.props, [memoProp]: u.memo }))) as Promise<Page>)
	await mirrorSaved("cr_activities", ok) // 복사본 함께 쓰기(v2.5.115, v2.5.116부터 Notion 수정 응답을 그대로) — 된 줄만
	if (failed.length) throw partialFailure("학생별 결과", updates.length, ok, failed)
	return { saved: updates.length }
}

// ---------- 학습기록 만들기·고치기 ----------
type SessionContext = { session: Page; attendances: Page[]; regToAttendance: Map<string, string[]>; className: string; makeup: boolean; date: string | null }
async function sessionContext(sessionId: string): Promise<SessionContext> {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	const attendances = await getPages(rel(session, "출석"))
	const regToAttendance = new Map<string, string[]>()
	for (const a of attendances) for (const r of rel(a, "등록")) regToAttendance.set(r, [...(regToAttendance.get(r) ?? []), a.id])
	return { session, attendances, regToAttendance, className: await className(session), makeup: isMakeupSession(session), date: dateStart(session, "수업일시") }
}

// 교재 기준 대상 등록: 직접 고른 학생이 있으면 그 학생들(수업 학생 중), 아니면
// 그룹 진도(보강 수업 제외)는 수업 학생 전체, 그 밖에는 그 교재를 가진 수업 학생.
function targetRegistrations(ctx: SessionContext, book: Page | null, chosen: string[] | null, registrations: Page[]): string[] {
	const sessionRegs = rel(ctx.session, "등록")
	if (chosen && chosen.length) {
		const picked = chosen.filter((r) => sessionRegs.includes(r))
		if (!picked.length) throw new ClassRoomError(400, "이 수업의 학생을 골라 주세요.")
		return picked
	}
	if (!book) return sessionRegs
	if (selectName(book, "진도방식") === GROUP_PROGRESS && !ctx.makeup) return sessionRegs
	const owners = registrations.filter((r) => rel(r, "진도교재").includes(book.id)).map((r) => r.id as string)
	if (!owners.length) throw new ClassRoomError(400, "이 교재를 가진 학생이 이 수업에 없습니다.")
	return owners
}

// 기록을 만든다. books가 있으면 교재마다 하나씩(템플릿 묶음 일괄 생성 포함), 없으면 교재 없는 기록 하나.
// 같은 수업에 같은 구분·같은 교재(교재 없으면 같은 주제) 기록이 이미 있으면 새로 만들지 않고 그 기록을 돌려준다.
export async function createRecords(body: any) {
	const kind = body?.kind
	if (!(KINDS as readonly string[]).includes(kind)) throw new ClassRoomError(400, "학습·과제·평가 중에서 골라 주세요.")
	const bookIds = body?.bookIds === undefined ? [] : ids(body.bookIds, 30)
	const chosen = body?.registrationIds === undefined ? null : ids(body.registrationIds)
	const topic = typeof body?.topic === "string" ? body.topic.trim().slice(0, 200) : ""
	// 기록 만들기 창(v2.5.79)은 범위·내용을 처음부터 함께 보낸다. 새로 만드는 기록에만 넣는다.
	for (const key of ["range", "content"]) if (body?.[key] !== undefined && typeof body[key] !== "string") throw new ClassRoomError(400, "입력 형식이 올바르지 않습니다.")
	const range = typeof body?.range === "string" ? body.range.trim().slice(0, 200) : ""
	const content = typeof body?.content === "string" ? body.content.trim().slice(0, 2000) : ""
	// 고른 단원(v2.5.126): unitBookId(라이브러리 교재)가 같은 기록에만 넣는다. 학습기록 DB에 단원 관계("단원" 또는 "선택 단원")가 없으면 넣지 않는다.
	const unitIds = cleanUnitIds(body?.unitIds), unitBookId = typeof body?.unitBookId === "string" ? body.unitBookId : null
	const unitProp = unitIds?.length && unitBookId ? await selectedUnitsProp() : null, unitsOn = !!unitProp
	const ctx = await sessionContext(body?.sessionId)
	const registrations = await getPages(rel(ctx.session, "등록"))
	const existing = await getPages(rel(ctx.session, "학습기록"))
	const results: { id: string; title: string; created: boolean }[] = []
	const targets: (Page | null)[] = bookIds.length ? await getPages(bookIds) : [null]
	// (261123 출시 전 4번) 교재 여러 권 중 하나가 실패해도 앞에서 만든 기록은 사본에 넣고, 만든 것 · 못 만든 것을 함께 답한다.
	const failed: { id: string; error: string }[] = []
	let firstErr: unknown = null
	for (const book of targets) try {
		const same = existing.find((r) => selectName(r, "구분") === kind && (book ? rel(r, "진도교재")[0] === book.id : !rel(r, "진도교재").length && plain(r, "주제") === topic))
		if (same && !chosen) {
			results.push({ id: same.id, title: anyTitleText(same), created: false })
			continue
		}
		const regs = targetRegistrations(ctx, book, chosen, registrations)
		const attendanceIds = dedupe(regs.flatMap((r) => ctx.regToAttendance.get(r) ?? []))
		const regularBookId = book ? libraryIds(book)[0] ?? null : null
		const regularBook = regularBookId ? await getPage(regularBookId) as Page : null
		const subjectIds = regularBook ? rel(regularBook, "과목") : []
		const subject = book ? (regularBook ? anyTitleText(regularBook) : anyTitleText(book)) : topic || kind
		const props: Record<string, unknown> = {
			"학습": { title: [{ text: { content: recordTitle(kind, subject, ctx.className, ctx.date) } }] },
			"구분": { select: { name: kind } },
			"출석": relation(attendanceIds),
			"등록": relation(regs),
			"수업": relation([ctx.session.id]),
			...touched(),
		}
		// (v2.8.0 항목 81) [학습기록 생성]처럼 수업의 클래스를 채운다 — 클래스 "평가" 탭이 이 칸으로 거른다
		const classId = rel(ctx.session, "클래스")[0]
		if (classId) props["클래스"] = relation([classId])
		if (book) props["진도교재"] = relation([book.id])
		if (regularBookId) props["교재"] = relation([regularBookId])
		if (subjectIds.length) props["과목"] = relation(subjectIds)
		if (topic) props["주제"] = richText(topic)
		if (range) props["범위"] = richText(range)
		if (content) props["내용"] = richText(content)
		if (ctx.makeup) props["보강"] = { checkbox: true }
		if (unitProp && regularBookId === unitBookId) props[unitProp] = relation(unitIds!)
		const page = await createPage(DS_LEARNING_RECORD, props) as Page
		existing.push(page)
		results.push({ id: page.id as string, title: anyTitleText(page) || String((props["학습"] as any).title[0].text.content), created: true })
	} catch (err) {
		firstErr ??= err
		failed.push({ id: book?.id as string ?? "", error: failText(err) })
	}
	// 복사본 함께 쓰기(v2.5.115): 새 기록과, "학습기록" 관계가 바뀐 수업
	if (results.length) await mirrorJobs([["cr_records", results.map((r) => r.id)], ["cr_sessions", [ctx.session.id as string]]])
	if (failed.length) {
		if (!results.some((r) => r.created)) throw firstErr // 하나도 안 만들었으면 예전과 같은 오류(400 등)
		throw new ClassRoomError(502, `기록 ${targets.length}건 중 ${failed.length}건을 만들지 못했어요 — ${failed[0].error}`, { records: results, failed })
	}
	return { records: results, unitsSaved: unitIds?.length ? unitsOn : undefined }
}

export async function updateRecord(body: any) {
	if (!isId(body?.recordId)) throw new ClassRoomError(400, "기록 형식이 올바르지 않습니다.")
	const record = await getPage(body.recordId) as Page
	const props: Record<string, unknown> = { ...touched() }
	for (const [key, prop] of [["topic", "주제"], ["range", "범위"], ["content", "내용"]] as const) {
		if (body[key] === undefined) continue
		if (typeof body[key] !== "string") throw new ClassRoomError(400, "입력 형식이 올바르지 않습니다.")
		props[prop] = richText(body[key].trim())
	}
	// 고른 단원(v2.5.126): unitIds를 보내면(빈 배열이면 지움) "선택 단원"을 그대로 바꾼다. 속성이 없는 학원은 건너뛴다.
	const unitIds = cleanUnitIds(body?.unitIds)
	const unitProp = unitIds !== null ? await selectedUnitsProp() : null, unitsOn = !!unitProp
	if (unitProp) props[unitProp] = relation(unitIds!)
	let bookId = rel(record, "진도교재")[0] ?? null
	let regularBook: Page | null = null
	if (body.bookId !== undefined) {
		if (body.bookId !== null && !isId(body.bookId)) throw new ClassRoomError(400, "교재 형식이 올바르지 않습니다.")
		bookId = body.bookId
		props["진도교재"] = relation(bookId ? [bookId] : [])
		const book = bookId ? await getPage(bookId) as Page : null
		const regularBookId = book ? libraryIds(book)[0] ?? null : null
		regularBook = regularBookId ? await getPage(regularBookId) as Page : null
		props["교재"] = relation(regularBookId ? [regularBookId] : [])
		props["과목"] = relation(regularBook ? rel(regularBook, "과목") : [])
	}
	// 교재나 주제가 바뀌면 제목도 규칙대로 다시 짓는다.
	if (body.bookId !== undefined || body.topic !== undefined) {
		const sessionId = rel(record, "수업")[0]
		const session = sessionId ? await getPage(sessionId) as Page : null
		const topic = body.topic !== undefined ? String(body.topic).trim() : plain(record, "주제")
		let subject = topic || (selectName(record, "구분") ?? "")
		if (bookId) {
			if (!regularBook && body.bookId === undefined) {
				const book = await getPage(bookId) as Page
				const rb = libraryIds(book)[0]
				regularBook = rb ? await getPage(rb) as Page : null
				subject = regularBook ? anyTitleText(regularBook) : anyTitleText(book)
			} else subject = regularBook ? anyTitleText(regularBook) : anyTitleText(await getPage(bookId) as Page)
		}
		const kind = selectName(record, "구분") ?? "학습"
		props["학습"] = { title: [{ text: { content: recordTitle(kind, subject, session ? await className(session) : "", session ? dateStart(session, "수업일시") : null) } }] }
	}
	await mirrorSaved("cr_records", [await updatePageProperties(record.id, props) as Page]) // 복사본 함께 쓰기(v2.5.115)
	return { ok: true, unitsSaved: unitIds?.length ? unitsOn : undefined }
}

// 기존 [학습활동 생성] 버튼과 같은 처리. 같은 기록을 두 번 눌러도 처리 중이면 새로 만들지 않는다.
export async function createActivities(recordId: string) {
	if (!isId(recordId)) throw new ClassRoomError(400, "기록 형식이 올바르지 않습니다.")
	const record = await getPage(recordId) as Page
	const kind = selectName(record, "구분")
	if (!kind || !(KINDS as readonly string[]).includes(kind)) throw new ClassRoomError(400, "구분이 학습·과제·평가인 기록만 학습활동을 만들 수 있습니다.")
	if (isRunning(record, ASSIGNMENT_GEN_STATUS_SPEC)) return { status: "already_processing" }
	const registrationIds = dedupe(rel(record, "등록"))
	if (!registrationIds.length) throw new ClassRoomError(400, "이 기록에 연결된 학생이 없습니다.")
	await setAssignmentGenRunning(recordId)
	runInBackground(async () => {
		try {
			await finishCreateAssignment(recordId, kind, registrationIds)
			await setAssignmentGenDone(recordId)
			// 복사본 함께 쓰기(v2.5.115): 기록·새 학습활동·마감 과제가 붙은 출석
			try {
				const [rec] = await mirrorPageIds("cr_records", [recordId])
				const acts = await mirrorPageIds("cr_activities", rel(rec ?? {}, "학습활동"))
				await mirrorPageIds("cr_attendance", acts.flatMap((a) => rel(a, "출석")))
			} catch (err) { console.error("[classRoom] 복사본 함께 쓰기 실패(다음 증분이 맞춤):", (err as Error).message) }
		} catch (err) {
			await setAssignmentGenError(recordId, (err as Error).message)
		}
	})
	return { status: "started", students: registrationIds.length }
}

// ---------- 보강 (v2.8.0 항목 92, C1 — v2.8 노션 보강 모델 하나로) ----------
// 노션과 같은 흐름: 결석 `보강 여부` → `보강 수업` → [보강 배정] → 🔵 보강 출석(`기존 결석` = 원래 결석).
// [보강 배정]은 _shared/makeupAssign.ts 한 곳, 지우기는 노션 [삭제]와 같은 큐(cascade-delete)라 결석이 보강 대기로 돌아오는 정리도 같다.
// (옛 방식 — 수업 없는 🔵 보강 출석을 대기실로 보고 그 출석을 보강 수업에 붙이기 — 은 v2.8에서 쓰지 않는다.)
const makeupError = (err: unknown): never => {
	if (err instanceof MakeupError) throw new ClassRoomError(err.status, err.message)
	throw err
}
async function mirrorMakeup(sessionId: string, attendanceIds: string[]) {
	await mirrorJobs([["cr_sessions", [sessionId]], ["cr_attendance", attendanceIds]]) // 복사본 함께 쓰기(v2.5.115)
}

// 노션 "보강 대기" 보기와 같은 목록(판단 안 한 결석 + 보강 필요인데 배정 안 된 결석).
export async function loadMakeupWaiting() {
	const rows = await queryAllPages(DS_ATTENDANCE, waitingFilter())
	return {
		waiting: rows.map((a: Page) => ({
			attendanceId: a.id as string,
			registrationId: rel(a, "등록")[0] ?? null,
			name: studentName(a),
			className: formulaString(a, "클래스(알림톡)") ?? "",
			start: a.properties?.["수업일시"]?.date?.start ?? null,
			decision: selectName(a, MAKEUP_DECISION) ?? "",
			sessionId: rel(a, MAKEUP_SESSION)[0] ?? null,
		})).sort((x, y) => String(x.start ?? "").localeCompare(String(y.start ?? ""))),
	}
}

// 결석 하나를 보강 수업에 배정 = 노션 출석 [보강 배정].
export async function assignMakeupAction(body: any) {
	if (!isId(body?.absenceId) || !isId(body?.sessionId)) throw new ClassRoomError(400, "결석과 보강 수업을 골라 주세요.")
	const r = await assignMakeup(body.absenceId, body.sessionId).catch(makeupError)
	await mirrorMakeup(r.sessionId, [r.attendanceId, r.absenceId])
	return r
}

// 보강 수업을 만들고(1명 = 1:1, 여러 명 = 그룹) 고른 결석을 차례로 배정한다. 시간표·클래스는 비워 두고 `수업 구분`을 보강으로 둔다.
// 결석은 수업을 만들기 전에 모두 확인한다(하나라도 안 되면 아무것도 만들지 않음).
export async function createMakeupSession(body: any) {
	if (body?.attendanceIds !== undefined) throw new ClassRoomError(400, "보강은 결석에서 배정합니다(v2.8) — absenceIds에 결석을 보내 주세요.")
	const absenceIds = body?.absenceIds === undefined ? [] : ids(body.absenceIds, 30)
	if (!isId(body?.teacherId)) throw new ClassRoomError(400, "담당강사를 골라 주세요.")
	const start = typeof body?.start === "string" && !Number.isNaN(Date.parse(body.start)) ? body.start : null
	const end = typeof body?.end === "string" && !Number.isNaN(Date.parse(body.end)) ? body.end : null
	if (!start) throw new ClassRoomError(400, "보강 시각을 정해 주세요.")
	const absences = await getPages(absenceIds)
	for (const a of absences) await checkAbsence(a).catch(makeupError)
	if (new Set(absences.map((a) => rel(a, "등록")[0])).size !== absences.length) throw new ClassRoomError(409, "같은 학생의 결석을 한 보강 수업에 두 번 배정할 수 없습니다.")
	const label = `${seoulLabel(start)} ${seoulTime(start)}`.trim()
	const session = await createPage(DS_CLASS_SESSION, {
		"이름": { title: [{ text: { content: `보강 ${label}` } }] },
		"수업일시": { date: { start, ...(end ? { end } : {}) } },
		"담당강사": relation([body.teacherId]),
		[SESSION_KIND_PROP]: { select: { name: SESSION_KIND_MAKEUP } },
	}) as Page
	const sessionId = session.id as string
	const made: string[] = []
	// (261123 출시 전 4번) 보강 수업을 만든 뒤 배정 하나가 실패해도 나머지를 배정하고, 만든 수업 · 배정한 결석은 사본에 넣는다.
	// 실패가 있으면 502 + { sessionId, assigned, failed } — 앱은 수업을 다시 만들지 않는다(sessionId가 있으니 이미 노션에 있음).
	const failed: { id: string; error: string }[] = []
	let current = session
	for (const a of absences) {
		try {
			const r = await assignMakeup(a.id as string, sessionId, { absence: a, session: current }).catch(makeupError)
			made.push(r.attendanceId)
			current = await getPage(sessionId) as Page // 명단(등록)이 늘었으니 다시 읽고 다음 배정
		} catch (err) { failed.push({ id: a.id as string, error: failText(err) }) }
	}
	await mirrorMakeup(sessionId, [...made, ...absences.map((a) => a.id as string)])
	if (failed.length) throw new ClassRoomError(502, `보강 수업은 만들었고 결석 ${absences.length}건 중 ${failed.length}건을 배정하지 못했어요 — ${failed[0].error}`, { sessionId, assigned: made, failed })
	return { sessionId, assigned: made }
}

// 보강 출석 하나를 지운다 = 그 보강 출석 [삭제]: 원래 결석의 `보강 출석`을 비워 보강 대기에 다시 뜨게 하고 보강 수업 명단에서도 뺀다.
export async function unlinkMakeup(attendanceId: string) {
	if (!isId(attendanceId)) throw new ClassRoomError(400, "출석 형식이 올바르지 않습니다.")
	const attendance = await getPage(attendanceId) as Page
	if (!rel(attendance, ORIGINAL_ABSENCE).length) throw new ClassRoomError(409, "보강 출석(기존 결석이 있는 출석)만 여기서 뺄 수 있습니다.")
	if (isDeletingFlagSet(attendance)) return { ok: true, status: "already_processing" }
	await queueCascadeDelete(attendanceId)
	return { ok: true, status: "queued" }
}

// 보강 수업을 지운다 = 그 수업 [삭제]: 보강 출석까지 휴지통, 원래 결석은 보강 대기로 돌아오고 `보강 수업`도 비워진다.
// 학습기록이 있으면 막는다(노션 [삭제]는 기록까지 지우므로 앱에서는 먼저 확인).
export async function deleteMakeupSession(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await getPage(sessionId) as Page
	if (!isMakeupSession(session)) throw new ClassRoomError(409, "보강 수업만 여기서 지울 수 있습니다.")
	if (rel(session, "학습기록").length) throw new ClassRoomError(409, "이 보강 수업에 학습기록이 있어요. 기록을 먼저 지워 주세요.")
	if (isDeletingFlagSet(session)) return { ok: true, status: "already_processing" }
	await queueCascadeDelete(sessionId)
	return { ok: true, status: "queued", attendances: rel(session, "출석").length }
}

// ---------- 요청 처리 ----------
// 기록 카드 본문(v2.5.111): 카드를 펼칠 때 그 기록 한 장의 Notion 본문만 읽는다(feedBody.ts와 같은 블록 목록).
export async function loadRecordBody(recordId: string) {
	if (!isId(recordId)) throw new ClassRoomError(400, "기록 형식이 올바르지 않습니다.")
	return { recordId, body: await readPageBodyBlocks(recordId) }
}

// ---------- (2.8 하루 수업 페이지, 앱서버 261118) 수업 안내 메모·루틴 체크 ----------
export const SESSION_NOTICE_MEMO = "수업 안내 메모"
// 수업 안내 메모 쓰기(보내기는 하지 않음 — 수업 [수업 안내 전송]이 따로).
export async function updateSession(body: any) {
	if (!isId(body?.sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	if (body.notice === undefined) throw new ClassRoomError(400, "바꿀 내용이 없습니다.")
	const saved = await updatePageProperties(body.sessionId, { [SESSION_NOTICE_MEMO]: richText(String(body.notice ?? "")) }) as Page
	await mirrorSaved("cr_sessions", [saved])
	return { saved: 1, notice: plain(saved, SESSION_NOTICE_MEMO).trim() }
}
export const routineDeps = { getPage, getPages: (ids: string[]) => getPages(ids), fullRelationIds }
// 이 수업의 루틴 체크(수업 '루틴 체크' 관계): 루틴 이름·출석·등록·완료. 루틴을 안 쓰는 학원(칸 없음)은 빈 목록.
export async function loadRoutines(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const session = await routineDeps.getPage(sessionId) as Page
	if (!session?.properties?.["루틴 체크"]) return { sessionId, available: false, status: "", checks: [] }
	const checkIds = await routineDeps.fullRelationIds(session, "루틴 체크")
	const checks = await routineDeps.getPages(checkIds)
	const routines = new Map((await routineDeps.getPages(dedupe(checks.map((c) => rel(c, "루틴")[0]).filter(Boolean) as string[])))
		.map((r: Page) => [r.id as string, { name: anyTitleText(r), order: numberOf(r, "순서") }]))
	return {
		sessionId,
		available: true,
		status: propText(session.properties?.["루틴 체크 상태"]).trim(),
		checks: checks.filter((c) => !c.archived && !c.in_trash).map((c) => {
			const r = routines.get(rel(c, "루틴")[0])
			return {
				checkId: c.id as string,
				routineId: rel(c, "루틴")[0] ?? null,
				routineName: r?.name ?? "",
				order: r?.order ?? null,
				attendanceId: rel(c, "출석")[0] ?? null,
				registrationId: rel(c, "등록")[0] ?? null,
				done: checkboxValue(c, "완료") === true,
			}
		}).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.routineName.localeCompare(b.routineName, "ko")),
	}
}
// (2.8, 담당 261118) 루틴 체크 했음/안 했음: 루틴 체크 줄의 `완료` 칸만 쓴다(보내기 없음).
// 루틴 체크 줄이 아닌 페이지(완료 체크·루틴 관계가 없음)는 쓰지 않는다. 학부모 리포트가 다음 재계산 때 바뀐 값을 싣도록
// 그 줄의 출석에 "학습정보 수정일"을 적는다(출석 저장과 같은 방식).
export async function saveRoutines(items: unknown) {
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw new ClassRoomError(400, "저장할 내용이 없습니다.")
	const wants = items.map((it: any) => {
		if (!isId(it?.checkId) || typeof it?.done !== "boolean") throw new ClassRoomError(400, "루틴 체크 형식이 올바르지 않습니다.")
		return { id: it.checkId as string, done: it.done as boolean }
	})
	const pages = await routineDeps.getPages(wants.map((w) => w.id))
	const byId = new Map(pages.map((p: Page) => [String(p.id).replaceAll("-", ""), p]))
	for (const w of wants) {
		const p = byId.get(w.id.replaceAll("-", ""))
		if (!p || p.archived || p.in_trash || p.properties?.["완료"]?.type !== "checkbox" || !p.properties?.["루틴"]) throw new ClassRoomError(400, "루틴 체크 줄이 아닙니다.")
	}
	await mapWithConcurrency(wants, 3, (w) => updatePageProperties(w.id, { "완료": { checkbox: w.done } }))
	const attendanceIds = dedupe(wants.flatMap((w) => rel(byId.get(w.id.replaceAll("-", "")) as Page, "출석")))
	await mapWithConcurrency(attendanceIds, 3, (id) => updatePageProperties(id, touched()).catch((err: unknown) =>
		console.warn("[class-room] 루틴 체크 뒤 출석 수정일 건너뜀:", id, (err as Error).message)))
	return { saved: wants.length }
}

// [루틴 체크 생성]과 같은 길(create-class-reports/routine-checks와 같은 잠금 → ⏳ 대기열 → 큐 routine-checks).
export async function createRoutineChecks(sessionId: string) {
	if (!isId(sessionId)) throw new ClassRoomError(400, "수업 형식이 올바르지 않습니다.")
	const page = await getPage(sessionId)
	if (isRunning(page, ROUTINE_STATUS_SPEC)) return { sessionId, queued: false, message: "already_processing" }
	await markQueued(sessionId, ROUTINE_STATUS_SPEC)
	await enqueueSync(TARGET_ROUTINE_CHECKS, { sessionId })
	wakeSyncQueueWorker()
	return { sessionId, queued: true }
}

export async function handleClassRoom(body: any): Promise<unknown> {
	switch (body?.action) {
		case "update-session": return await updateSession(body)
		case "routines": return await loadRoutines(body.sessionId)
		case "create-routine-checks": return await createRoutineChecks(body.sessionId)
		case "save-routines": return await saveRoutines(body.items)
		case "teachers": return { teachers: await listTeachers() }
		case "day": return await loadDay(String(body.date ?? ""), body.teacherId)
		case "days": return await loadDays(String(body.from ?? ""), String(body.to ?? ""), body.teacherId)
		case "session": return await loadSession(body.sessionId)
		case "classes": return await loadClasses(String(body.date ?? ""), body.teacherId)
		case "class-sessions": return await loadClassSessions(body.sessionId, body.around)
		case "class-records": return await loadClassRecords(body.sessionId)
		case "roster": return await loadRoster(body.sessionId)
		case "class-stats": return await loadClassStats(body.sessionId)
		case "books": return await loadBooks(body.sessionId)
		case "activities": return await loadActivities(body.recordId)
		case "record-body": return await loadRecordBody(body.recordId)
		case "student": return await loadStudent(body.registrationId)
		case "save-attendance": return await saveAttendance(body.items)
		case "save-activities": return await saveActivities(body.items)
		case "create-records": return await createRecords(body)
		case "update-record": return await updateRecord(body)
		case "create-activities": return await createActivities(body.recordId)
		case "makeup-waiting": return await loadMakeupWaiting()
		case "assign-makeup": return await assignMakeupAction(body)
		case "create-makeup-session": return await createMakeupSession(body)
		case "unlink-makeup": return await unlinkMakeup(body.attendanceId)
		case "delete-makeup-session": return await deleteMakeupSession(body.sessionId)
		default: throw new ClassRoomError(400, "지원하지 않는 작업입니다.")
	}
}
