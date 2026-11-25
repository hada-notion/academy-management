// _shared/monthlyNotice.ts
//
// (v2.8.0) 클래스 [월 수강료 생성](send-monthly-notice/create → 큐). 보고서 생성과 같은 모양이다.
//   클래스 `수강료 기간`의 달(비면 누른 날의 다음 달, 서울)의 반 수강료 발송함(구분 "수강료", 반 × 달)을 찾거나 만들고,
//   그 반을 다니는 등록마다 그 달 수강료가 없으면 만들어 발송함에 연결한다. 같은 학생의 그 달 다른 반
//   수강료와 `같은 달 수강료`로 서로 잇는다. 보내기는 수강료 DB 큐(_shared/noticeQueue.ts)가 같은 달 수강료를 한 통으로 보낸다.
// (10/28) 가정통신문(월간 일정 안내)도 같은 모양이다: 클래스 [월간 안내 생성](send-monthly-notice/create-letter) → 클래스 `안내 기간`의
//   달의 반 가정통신문 발송함(구분 "가정통신문") → 등록마다 가정통신문 한 장 → 같은 학생의 그 달 다른 반 가정통신문과 `같은 달 가정통신문`.
//   학생·반에 연결된 일정은 Notion 수식이 모으고, 연결 안 된 일정(학원 전체, 학생의 학교·학년)은 서버가 `학원 일정`에 넣는다
//   (만들 때 한 번, 보내기 직전에 다시). 보내기는 수강료와 같은 큐(_shared/noticeQueue.ts, kind "letter")다.
import { getScheduleConfig } from "./adminShared.ts"
import { LETTER_NOTICE_MEMO, propRich } from "./propAlias.ts"
import { getRollupText, syncStudentReport } from "./alimtalkShared.ts"
import { anyTitleText, createPage, fetchWithRetry, fullRelationIds, getPage, notionHeaders, queryAllPages, relIds, updatePageProperties } from "./notionClient.ts"
import { DS_REGISTRATION, DS_SCHEDULE_EVENT, DS_TUITION, NOTION_API, PROP_LAST_ERROR } from "./constants.ts"
import { enqueueSync } from "./syncQueue.ts"
import { letterMemo } from "./letterMemo.ts"
import { markDone, markError, markRunning, type StatusSpec } from "./statusTracking.ts"
import { isParentPublicEvent } from "./scheduleVisibility.ts"
import { eventKind } from "./scheduleCategory.ts"
import { inPeriodRegistration, resolveBatchDataSourceId, seoulDay, studentNameOf } from "./classReportPlan.ts"
import { eventLine, inMonth, isAcademyWide, monthFilter, monthLabel, nextMonthKey, type Section, sectionListText, sectionOf } from "./scheduleNotice.ts"
import { noteText } from "./lessonNotice.ts"
import { alimtalkVar, BULLET, NO_NOTE } from "./noticeBlocks.ts"

// 가정통신문 장의 전송로그 중 성공한 알림톡(발송 구분 "월간 일정 안내", 발송 상태 "성공")이 있나 = "보낸 적 있음".
// 다시 보내기 잠금(noticeQueue)과 학부모 리포트의 보낸 장 판단(reportLetter)이 같이 쓴다. 버튼 요청 줄은 발송 구분이 달라 세지 않는다.
export async function letterSentByLogs(page: any, getLog: (id: string) => Promise<any>): Promise<boolean> {
	const ids = (page?.properties?.["전송로그"]?.relation ?? []).map((r: any) => String(r.id))
	for (const id of ids) {
		const log: any = await getLog(id).catch(() => null)
		if (!log || log.archived || log.in_trash) continue
		if (log.properties?.["발송 구분"]?.select?.name === "월간 일정 안내" && log.properties?.["발송 상태"]?.select?.name === "성공") return true
	}
	return false
}

export const KIND_MONTHLY ="가정통신문"
// (v2.8.0 항목 150, 261125 대표) 월별 학습계획: 클래스 `안내 구분`이 "월별 학습계획"이면 [월간 안내 생성]이 반 × 달 발송함 하나만 만든다.
//   학생 장은 만들지 않고 알림톡도 없다(보낼 장이 없어 [일괄 전송]이 아무것도 보내지 않고, 보내기 길에서도 막는다).
//   내용은 그 발송함 페이지 본문(+ `가정통신문 안내 메모`)에 적고, 학부모 리포트 반 화면 홈 맨 아래 "월별 학습계획서"에서 읽는다.
export const KIND_PLAN = "월별 학습계획"
export const PROP_CLASS_NOTICE_KIND = "안내 구분"
export const isPlanClass = (cls: any) => String(cls?.properties?.[PROP_CLASS_NOTICE_KIND]?.select?.name ?? "") === KIND_PLAN
// (10/28) 수강료 생성은 보고서처럼 반 발송함(구분 "수강료", 반 × 달)을 만든다.
export const KIND_TUITION = "수강료"
// 클래스 [월 수강료 생성]
export const CLASS_TUITION_GEN_STATUS_SPEC: StatusSpec = { statusProp: "수강료 생성 상태", errorProp: PROP_LAST_ERROR, startedAtProp: "수강료 생성 처리 시작 시각" }
export const TARGET_MONTHLY_CREATE_CLASS = "monthly-create-class"
export const TARGET_MONTHLY_CREATE_REG = "monthly-create-reg"
// 클래스 [월간 안내 생성]
export const CLASS_LETTER_GEN_STATUS_SPEC: StatusSpec = { statusProp: "가정통신문 생성 상태", errorProp: PROP_LAST_ERROR, startedAtProp: "가정통신문 생성 처리 시작 시각" }
export const TARGET_LETTER_CREATE_CLASS = "letter-create-class"
export const TARGET_LETTER_CREATE_REG = "letter-create-reg"

// 알림톡 발송함(학원) DB: 반 × 달 × 구분
const PROP_MAILBOX_TITLE = "이름"
const PROP_MAILBOX_KIND = "구분"
const PROP_MAILBOX_PERIOD = "기간"
const PROP_MAILBOX_CLASS = "클래스"
// 수강료(학원) DB
const PROP_TUITION_MAILBOX = "알림톡 발송함"
// 클래스(학원) DB: 가정통신문의 달(1일~말일). 비면 누른 날의 다음 달.
export const PROP_CLASS_NOTICE_PERIOD = "안내 기간"
// 클래스(학원) DB: 수강료의 달(1일~말일, 보고서 기간과 같은 방식). 비면 누른 날의 다음 달.
export const PROP_CLASS_TUITION_PERIOD = "수강료 기간"
// (v2.8.0 항목 69) 클래스 `수강료 생성 대상`·`가정통신문 생성 대상`에는 더 적지 않는다. 반의 발송함은 클래스 `알림톡 발송함`에서 연다.
// 수강료(학원) DB: 같은 학생의 같은 달 다른 반 수강료(한쪽 자기 관계, 서로 모두 잇는다).
const PROP_TUITION_SIBLINGS = "같은 달 수강료"
// 알림톡 발송함(학원) DB: 가정통신문 발송함의 반 전달사항(그 반 학생 모두, 그 달만). (10/29) 클래스 '안내 메모'를 대신한다.
// 알림톡 발송함(학원) DB: 이 발송함의 가정통신문(가정통신문 DB '알림톡 발송함'의 짝). 가정통신문 DB id를 여기서 찾는다.
const PROP_MAILBOX_LETTERS = "가정통신문"
// 가정통신문(학원) DB: 등록 × 달 한 장
const PROP_LETTER_TITLE = "이름"
const PROP_LETTER_PERIOD = "기간"
const PROP_LETTER_REG = "등록"
const PROP_LETTER_MAILBOX = "알림톡 발송함"
export const PROP_LETTER_SIBLINGS = "같은 달 가정통신문"
const PROP_LETTER_EVENTS = "학원 일정"

export type CreateClassPayload = { classId: string; month: string }
export type CreateRegPayload = { classId: string; month: string; regId: string; amount: number | null; mailboxId?: string; last?: boolean }
type Line = { id: string; day: string; line: string; sec: Section }

const textOf = (arr: any): string => (Array.isArray(arr) ? arr.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("") : "")
const key = (id: string) => String(id ?? "").replace(/-/g, "").toLowerCase()
const alive = (p: any) => !!p && !p.in_trash && !p.archived

// 클래스 버튼의 대상 달: 클래스 '안내 기간'의 시작일이 있는 달, 비면 누른 날의 다음 달(서울).
// 시작과 끝이 다른 달이면 고칠 곳을 문장으로 알린다(보고서 기간과 같은 방식).
export function monthFromClass(cls: any, now = new Date(), prop = PROP_CLASS_NOTICE_PERIOD): string {
	const d = cls?.properties?.[prop]?.date
	const start = seoulDay(d?.start)
	if (!start) return nextMonthKey(now)
	const end = seoulDay(d?.end)
	if (end && end.slice(0, 7) !== start.slice(0, 7)) throw new Error(`클래스 '${prop}'은 한 달 안(1일~말일)으로 넣어 주세요. 비우면 다음 달입니다.`)
	return start.slice(0, 7)
}
// 클래스 [월 수강료 생성]의 달: 클래스 '수강료 기간'(비면 다음 달).
export const tuitionMonthFromClass = (cls: any, now = new Date()) => monthFromClass(cls, now, PROP_CLASS_TUITION_PERIOD)
// 클래스 [월간 안내 생성]의 달: 클래스 '안내 기간'(비면 다음 달).
export const letterMonthFromClass = (cls: any, now = new Date()) => monthFromClass(cls, now, PROP_CLASS_NOTICE_PERIOD)

// "2026-12" → { start: "2026-12-01", end: "2026-12-31" }
export function monthRange(month: string): { start: string; end: string } {
	const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7))
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
	return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` }
}
// 수강료·가정통신문 이름: "26.12 김하윤 (중1) 수학반 수강료"(등록 이름, Notion 이름 자동화와 같다. 등록 이름이 비면 학생 이름)
const yymm = (month: string) => `${month.slice(2, 4)}.${month.slice(5, 7)}`
export const tuitionTitle = (month: string, regName: string) => `${yymm(month)} ${regName} 수강료`
export const letterTitle = (month: string, regName: string) => `${yymm(month)} ${regName} 가정통신문`
const regNameOf = (reg: any) => anyTitleText(reg).trim() || studentNameOf(reg)

// 테스트에서 Notion·발송을 바꿔 끼울 수 있게 한다.
export const monthlyDeps = {
	getPage,
	createPage,
	queryAllPages,
	update: updatePageProperties,
	fullRelationIds,
	enqueue: enqueueSync,
	batchDataSourceId: resolveBatchDataSourceId,
	letterDataSourceId: () => resolveLetterDataSourceId(),
	token: async (regId: string) => (await syncStudentReport(regId)).access_token,
	tuitionConfigRow: async () => (await getScheduleConfig("수강료 안내"))?.rowId ?? null,
	markRunning: (id: string, spec: StatusSpec) => markRunning(id, spec),
	markDone: (id: string, spec: StatusSpec) => markDone(id, spec),
	markError: (id: string, spec: StatusSpec, message: string) => markError(id, spec, message),
	memo: letterMemo,
}

const inMonthReg = (reg: any, month: string) => alive(reg) && inPeriodRegistration(reg, { kind: "", className: "", ...monthRange(month) })

async function appendError(pageId: string, line: string): Promise<void> {
	const deps = monthlyDeps
	const page: any = await deps.getPage(pageId).catch(() => null)
	const prev = textOf(page?.properties?.[PROP_LAST_ERROR]?.rich_text).trim()
	const next = (prev ? `${prev}\n${line}` : line).slice(0, 1900)
	await deps.update(pageId, { [PROP_LAST_ERROR]: { rich_text: [{ text: { content: next } }] } }).catch(() => {})
}

// 마지막 학생 뒤: 중간 실패가 '마지막 오류'에 남아 있으면 ⚠️ 오류, 아니면 ✅ 완료.
async function finishParent(pageId: string, spec: StatusSpec): Promise<void> {
	const deps = monthlyDeps
	const page: any = await deps.getPage(pageId)
	const err = textOf(page?.properties?.[PROP_LAST_ERROR]?.rich_text).trim()
	if (err) await deps.markError(pageId, spec, err)
	else await deps.markDone(pageId, spec)
}

// 가정통신문(학원) DB 데이터소스 id. 전용 Secret 없이 발송함 DB '가정통신문' 관계가 가리키는 곳을 읽는다.
let letterDsCache: string | null = null
export async function resolveLetterDataSourceId(): Promise<string> {
	if (letterDsCache) return letterDsCache
	const res = await fetchWithRetry(`${NOTION_API}/data_sources/${await resolveBatchDataSourceId()}`, { headers: notionHeaders() })
	if (!res.ok) throw new Error(`알림톡 발송함 DB 정보 읽기 실패: ${res.status} ${await res.text()}`)
	const id = (await res.json())?.properties?.[PROP_MAILBOX_LETTERS]?.relation?.data_source_id
	if (!id) throw new Error(`알림톡 발송함 DB에 '${PROP_MAILBOX_LETTERS}' 관계(가정통신문 DB)가 없습니다.`)
	letterDsCache = String(id)
	return letterDsCache
}

const samePeriod = (page: any, prop: string, range: { start: string }) => alive(page) && seoulDay(page?.properties?.[prop]?.date?.start) === range.start

// 그 반의 그 달 발송함(구분 kind)을 찾고, create면 없을 때 만든다.
export async function findClassMailbox(classId: string, month: string, create: { className: string } | null, kind = KIND_MONTHLY): Promise<any | null> {
	const deps = monthlyDeps
	const ds = await deps.batchDataSourceId()
	const range = monthRange(month)
	const found = await deps.queryAllPages(ds, {
		and: [
			{ property: PROP_MAILBOX_CLASS, relation: { contains: classId } },
			{ property: PROP_MAILBOX_KIND, select: { equals: kind } },
		],
	})
	const same = found.find((b: any) => samePeriod(b, PROP_MAILBOX_PERIOD, range))
	if (same || !create) return same ?? null
	return await deps.createPage(ds, {
		// (11/2) 이름은 보고서 발송함("반 주간 보고서 10.19~10.25")처럼 반 → 구분 → 기간: "중1 A 수학 수강료 26.12".
		[PROP_MAILBOX_TITLE]: { title: [{ text: { content: `${create.className} ${kind} ${month.slice(2, 4)}.${month.slice(5, 7)}` } }] },
		[PROP_MAILBOX_KIND]: { select: { name: kind } },
		[PROP_MAILBOX_PERIOD]: { date: { start: range.start, end: range.end } },
		[PROP_MAILBOX_CLASS]: { relation: [{ id: classId }] },
	})
}

// 그 달에 다니는 그 학생의 등록들.
export async function studentRegsInMonth(studentId: string, month: string): Promise<any[]> {
	return (await monthlyDeps.queryAllPages(DS_REGISTRATION, { property: "학생정보", relation: { contains: studentId } })).filter((r: any) => inMonthReg(r, month))
}

const classNameOfReg = (reg: any) => getRollupText(reg, "클래스명(등록)").trim()

// 두 반 이상 다니는 학생에게 일부 반에만 걸린 일정은 날짜 뒤에 그 반 이름을 붙인다("11/14(토) 중1 B 보충 수업").
// 다니는 반 모두에 걸린 일정·학생 개인·학원 전체·학교 일정과 한 반만 다니는 학생은 그대로.
export function withClassPrefix(line: string, event: any, classNameById: Map<string, string>): string {
	if (classNameById.size < 2) return line
	const names = relIds(event?.properties?.["클래스"]).map((id) => classNameById.get(key(id))).filter((n): n is string => !!n)
	const unique = Array.from(new Set(names)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	if (!unique.length || unique.length >= new Set(classNameById.values()).size) return line
	// 일정 이름에 반 이름이 이미 있으면 붙이지 않는다("영어반 영어반 보충 수업" 방지).
	if (unique.every((n) => line.includes(n))) return line
	return line.replace(/^(\S+) /, `$1 ${unique.join(" · ")} `)
}

const eventQuery = (month: string) => (link: { prop: string; id: string } | null) =>
	monthlyDeps.queryAllPages(DS_SCHEDULE_EVENT, { and: [...(link ? [{ property: link.prop, relation: { contains: link.id } }] : []), ...monthFilter(month)] })
const showable = (e: any, month: string) => alive(e) && isParentPublicEvent(e) && inMonth(eventLine(e)?.day ?? null, month)

// 학생·반에 연결되지 않은 그 달 학부모 공개 일정: 학원 전체 + 학교·학년(일정의 학교·학년이 비었거나 학생 것과 같을 때).
// 가정통신문 '학원 일정'에 서버가 넣는 일정이다(학생·반 일정은 Notion 수식이 모은다).
export async function unlinkedMonthEvents(studentId: string, month: string): Promise<any[]> {
	const st: any = await monthlyDeps.getPage(studentId).catch(() => null)
	const schoolId = relIds(st?.properties?.["학교"])[0]
	const gradeId = relIds(st?.properties?.["학년"])[0]
	const q = eventQuery(month)
	const [academy, school, grade] = await Promise.all([
		q(null),
		schoolId ? q({ prop: "학교", id: schoolId }) : Promise.resolve([]),
		gradeId ? q({ prop: "학년", id: gradeId }) : Promise.resolve([]),
	])
	return pickUnlinked([...academy, ...school, ...grade], schoolId, gradeId, month)
}

// (261125) 연결 안 된 일정 고르기 한 곳. rows = 그 달 일정 후보(조회 결과를 합친 것 또는 그 달 공개 일정 전부).
// 학원 전체(클래스·학생·학교·학년 모두 빔) + 학교·학년이 학생 것과 맞는 일정(학교·학년 중 비지 않은 칸은 모두 맞아야 함).
// 같은 일정은 한 번, rows 순서대로. 가정통신문 생성·보내기·발송함 [일정 다시 가져오기]가 같은 규칙을 쓴다.
export function pickUnlinked(rows: any[], schoolId: string | undefined, gradeId: string | undefined, month: string): any[] {
	const sch = schoolId ? key(schoolId) : "", grd = gradeId ? key(gradeId) : ""
	const byId = new Map<string, any>()
	for (const e of rows) {
		if (!showable(e, month)) continue
		if (isAcademyWide(e) || schoolGradeFits(e, sch, grd)) byId.set(key(e.id), e)
	}
	return Array.from(byId.values())
}
// 학교·학년 일정이 그 학생 것인가: 둘 중 하나는 학생 것과 같고, 채워진 칸은 모두 학생 것과 같다.
function schoolGradeFits(e: any, sch: string, grd: string): boolean {
	const es = relIds(e?.properties?.["학교"]).map(key), eg = relIds(e?.properties?.["학년"]).map(key)
	const hit = (!!sch && es.includes(sch)) || (!!grd && eg.includes(grd))
	if (!hit) return false
	if (es.length && !(sch && es.includes(sch))) return false
	if (eg.length && !(grd && eg.includes(grd))) return false
	return true
}

// 그 학생의 그 달 학부모 공개 일정(리포트와 같은 규칙): 학생 개인 + 다니는 반 전부 + 연결 안 된 일정(위). 같은 일정은 한 번만,
// 날짜순. regs = 그 달 다니는 그 학생의 등록들. unlinked를 주면 다시 읽지 않는다.
export async function studentMonthEvents(studentId: string, month: string, regs: any[], unlinked?: any[]): Promise<Line[]> {
	const classNameById = new Map<string, string>()
	for (const r of regs) for (const id of relIds(r?.properties?.["클래스"])) classNameById.set(key(id), classNameOfReg(r) || "반")
	const classIds = Array.from(new Set(regs.flatMap((r: any) => relIds(r?.properties?.["클래스"]))))
	const q = eventQuery(month)
	const [own, cls, rest] = await Promise.all([
		q({ prop: "학생", id: studentId }),
		Promise.all(classIds.map((id) => q({ prop: "클래스", id }))).then((l) => l.flat()),
		unlinked ? Promise.resolve(unlinked) : unlinkedMonthEvents(studentId, month),
	])
	const byId = new Map<string, any>()
	for (const e of [...own, ...cls, ...rest]) if (showable(e, month)) byId.set(key(e.id), e)
	return Array.from(byId.values())
		.map((e) => {
			const base = eventLine(e) ?? { day: "", line: "" }
			return { id: String(e.id), day: base.day, line: base.line ? withClassPrefix(base.line, e, classNameById) : "", sec: sectionOf(e) }
		})
		.filter((l) => l.line)
		.sort((a, b) => a.day.localeCompare(b.day))
}

// 그 등록의 그 달(청구기간 시작이 그 달) 수강료.
async function monthTuitionsOfReg(regId: string, month: string): Promise<any[]> {
	return (await monthlyDeps.queryAllPages(DS_TUITION, { property: "등록", relation: { contains: regId } }))
		.filter((t: any) => alive(t) && seoulDay(t?.properties?.["청구기간"]?.date?.start)?.slice(0, 7) === month)
}

// 같은 학생의 그 달 수강료·가정통신문(듣는 반마다 한 장)을 서로 잇는다(prop = '같은 달 수강료'·'같은 달 가정통신문').
// 각 장에는 자기를 뺀 나머지 전부가 들어간다. 방금 만든 장은 조회에 늦게 잡힐 수 있어 mine으로 직접 넣는다. 이미 같으면 쓰지 않는다.
async function linkSiblings(prop: string, ofReg: (regId: string, month: string) => Promise<any[]>, studentId: string, month: string, regId: string, mine: any[]): Promise<void> {
	const deps = monthlyDeps
	const others = (await studentRegsInMonth(studentId, month)).filter((r: any) => key(r.id) !== key(regId))
	const group = new Map<string, any>()
	for (const t of mine) if (t?.id) group.set(key(t.id), t)
	for (const r of others) for (const t of await ofReg(String(r.id), month)) group.set(key(t.id), t)
	if (group.size < 2) return
	for (const [k, t] of group) {
		const want = Array.from(group.keys()).filter((x) => x !== k).sort()
		const have = relIds(t?.properties?.[prop]).map(key).sort()
		if (want.join(",") === have.join(",")) continue
		await deps.update(String(t.id), { [prop]: { relation: Array.from(group.values()).filter((x) => key(x.id) !== k).map((x) => ({ id: String(x.id) })) } })
	}
}
export const linkSiblingTuitions = (studentId: string, month: string, regId: string, mine: any[]) => linkSiblings(PROP_TUITION_SIBLINGS, monthTuitionsOfReg, studentId, month, regId, mine)

// ── 1) 클래스 [월 수강료 생성] ────────────────────────────────────────────────
const amountOf = (cls: any): number | null => {
	const p = cls?.properties?.["월간 수업 총량"]
	const n = p?.number ?? p?.formula?.number ?? p?.rollup?.number
	return typeof n === "number" ? n : null
}

export async function processMonthlyCreateClassItem(p: CreateClassPayload): Promise<void> {
	const deps = monthlyDeps
	const spec = CLASS_TUITION_GEN_STATUS_SPEC
	try {
		await deps.markRunning(p.classId, spec)
		const cls: any = await deps.getPage(p.classId)
		const amount = amountOf(cls)
		if (amount === null) return await deps.markError(p.classId, spec, "클래스 '월간 수업 총량'을 넣어 주세요(수강료 청구 기준).")
		const regs = (await deps.queryAllPages(DS_REGISTRATION, { property: "클래스", relation: { contains: p.classId } })).filter((r: any) => inMonthReg(r, p.month))
		console.log(`[monthly-create] class=${p.classId} ${p.month} 대상 등록 ${regs.length}`)
		if (!regs.length) return await deps.markError(p.classId, spec, `${monthLabel(p.month)}에 이 반을 다니는 학생이 없습니다.`)
		const mailbox = await findClassMailbox(p.classId, p.month, { className: anyTitleText(cls).trim() || "클래스" }, KIND_TUITION)
		const mailboxId = String(mailbox.id)
		for (let i = 0; i < regs.length; i++) {
			const item: CreateRegPayload = { classId: p.classId, month: p.month, regId: String(regs[i].id), amount, mailboxId, ...(i === regs.length - 1 ? { last: true } : {}) }
			await deps.enqueue(TARGET_MONTHLY_CREATE_REG, item)
		}
	} catch (err) {
		await deps.markError(p.classId, spec, (err as Error).message).catch(() => {})
		throw err
	}
}

// 등록 1건: 그 등록의 그 달 수강료가 없으면 만들어 반 수강료 발송함에 잇는다(있으면 빈 발송함만 연결). 다시 해도 같다.
// 그 뒤 같은 학생의 그 달 다른 반 수강료와 '같은 달 수강료'로 서로 잇는다(두 반·세 반 학생의 합산 안내용).
// 수강료의 '일괄전송 선택'은 켜지 않는다(보내기는 학생 단위로 따로 만든다).
export async function processMonthlyCreateRegItem(p: CreateRegPayload): Promise<void> {
	const deps = monthlyDeps
	try {
		const reg: any = await deps.getPage(p.regId)
		const studentId = relIds(reg?.properties?.["학생정보"])[0]
		const studentName = studentNameOf(reg)
		if (!studentId) {
			await appendError(p.classId, `${studentName || p.regId}: 등록에 학생이 연결되어 있지 않아 건너뜀`)
		} else {
			const range = monthRange(p.month)
			const existing = (await monthTuitionsOfReg(p.regId, p.month))
			let mine: any[] = existing
			if (existing.length) {
				for (const t of existing) {
					if (p.mailboxId && !relIds(t?.properties?.[PROP_TUITION_MAILBOX]).length) await deps.update(String(t.id), { [PROP_TUITION_MAILBOX]: { relation: [{ id: p.mailboxId }] } })
				}
			} else {
				const rowId = await deps.tuitionConfigRow().catch(() => null)
				const created = await deps.createPage(DS_TUITION, {
					"청구명": { title: [{ text: { content: tuitionTitle(p.month, regNameOf(reg)) } }] },
					"청구기간": { date: { start: range.start, end: range.end } },
					"등록": { relation: [{ id: p.regId }] },
					"실제 수업량": { number: p.amount },
					...(p.mailboxId ? { [PROP_TUITION_MAILBOX]: { relation: [{ id: p.mailboxId }] } } : {}),
					...(rowId ? { "알림톡 설정": { relation: [{ id: rowId }] } } : {}),
					"일괄전송 선택": { checkbox: false },
				})
				mine = [created]
			}
			await linkSiblingTuitions(studentId, p.month, p.regId, mine)
		}
		if (p.last) await finishParent(p.classId, CLASS_TUITION_GEN_STATUS_SPEC)
	} catch (err) {
		// 반 상태는 마지막 학생에서 정한다. 여기서는 오류 문장만 남기고 큐가 다시 시도한다(다시 해도 이미 만든 것은 건너뜀).
		const message = `수강료 생성 실패(다시 누르면 빠진 학생만 만듭니다): ${(err as Error).message}`
		await appendError(p.classId, message)
		if (p.last) await deps.markError(p.classId, CLASS_TUITION_GEN_STATUS_SPEC, message).catch(() => {})
		throw err
	}
}

// ── 2) 클래스 [월간 안내 생성] ─────────────────────────────────────────────────
// (v2.8.0 항목 148, 261125 대표) 그 달 발송함 하나 → 학생당 한 장. 반마다 눌러도 같은 달 발송함에 반이 더해지고(`클래스`),
// 학생은 그 달 한 장에 이 반 등록이 더해진다(`등록`). 클래스 `요청` = class-letter-create를 여러 줄 한꺼번에 바꿔도 같은 길.
// 큐는 한 번에 하나씩이라 두 반을 거의 같이 눌러도 차례로 돌고, 방금 만든 발송함·장은 표 letter_month_pages로 찾는다.
// 그 반이 이미 든 옛 반별 발송함(반 × 달)이 있으면 그 반은 그대로 옛 발송함을 쓴다(이미 만든 장을 옮기지 않음).
export const monthMailboxTitle = (month: string) => `${KIND_MONTHLY} ${month.slice(2, 4)}.${month.slice(5, 7)}`
const PROP_MAILBOX_RESULT = "요청 결과"
const isMonthMailbox = (box: any, month: string) => alive(box) && anyTitleText(box).trim() === monthMailboxTitle(month) &&
	samePeriod(box, PROP_MAILBOX_PERIOD, monthRange(month))

// 그 달 가정통신문 발송함: 이 반이 든 것(옛 반별 또는 이미 더한 달 발송함) → 기억 표 → 이름·기간이 맞는 달 발송함 → 새로 만듦.
export async function findMonthMailbox(classId: string, month: string): Promise<any> {
	const deps = monthlyDeps
	const own = await findClassMailbox(classId, month, null, KIND_MONTHLY)
	if (own) return own
	const memo = await deps.memo.get(month, "box")
	if (memo) {
		const box: any = await deps.getPage(memo).catch(() => null)
		if (isMonthMailbox(box, month)) return box
	}
	const ds = await deps.batchDataSourceId()
	const found = (await deps.queryAllPages(ds, { property: PROP_MAILBOX_KIND, select: { equals: KIND_MONTHLY } })).find((b: any) => isMonthMailbox(b, month))
	const box = found ?? await deps.createPage(ds, {
		[PROP_MAILBOX_TITLE]: { title: [{ text: { content: monthMailboxTitle(month) } }] },
		[PROP_MAILBOX_KIND]: { select: { name: KIND_MONTHLY } },
		[PROP_MAILBOX_PERIOD]: { date: { start: monthRange(month).start, end: monthRange(month).end } },
		[PROP_MAILBOX_CLASS]: { relation: [{ id: classId }] },
	})
	await deps.memo.put(month, "box", "", String(box.id), !!memo)
	return box
}

// relation 칸에 id를 더한다(이미 있으면 쓰지 않음). 25개 넘는 관계도 빠지지 않게 전부 읽는다.
async function addRelation(page: any, prop: string, id: string): Promise<boolean> {
	const deps = monthlyDeps
	const have = (relIds(page?.properties?.[prop]).length >= 25 || page?.properties?.[prop]?.has_more) ? await deps.fullRelationIds(page, prop) : relIds(page?.properties?.[prop])
	if (have.map(key).includes(key(id))) return false
	await deps.update(String(page.id), { [prop]: { relation: [...have, id].map((x) => ({ id: x })) } })
	return true
}

// 그 달 일정(학원 전체·학교·학년 후보)을 한 번만 읽는다. 같은 큐 실행 안의 학생들이 같이 쓴다(2분).
const monthRowsCache = new Map<string, { at: number; rows: Promise<any[]> }>()
function monthRows(month: string): Promise<any[]> {
	const hit = monthRowsCache.get(month)
	if (hit && Date.now() - hit.at < 120_000) return hit.rows
	const rows = eventQuery(month)(null)
	rows.catch(() => monthRowsCache.delete(month))
	monthRowsCache.set(month, { at: Date.now(), rows })
	return rows
}

export async function processLetterCreateClassItem(p: CreateClassPayload): Promise<void> {
	const deps = monthlyDeps
	const spec = CLASS_LETTER_GEN_STATUS_SPEC
	try {
		await deps.markRunning(p.classId, spec)
		const cls: any = await deps.getPage(p.classId)
		if (isPlanClass(cls)) {
			// 월별 학습계획: 반 × 달 발송함 하나(다시 눌러도 하나). 학생 장·알림톡 없음.
			const box = await findClassMailbox(p.classId, p.month, { className: anyTitleText(cls).trim() || "클래스" }, KIND_PLAN)
			console.log(`[letter-create] class=${p.classId} ${p.month} 월별 학습계획 발송함 ${box?.id}`)
			return await deps.markDone(p.classId, spec)
		}
		const regs = (await deps.queryAllPages(DS_REGISTRATION, { property: "클래스", relation: { contains: p.classId } })).filter((r: any) => inMonthReg(r, p.month))
		console.log(`[letter-create] class=${p.classId} ${p.month} 대상 등록 ${regs.length}`)
		if (!regs.length) return await deps.markError(p.classId, spec, `${monthLabel(p.month)}에 이 반을 다니는 학생이 없습니다.`)
		const mailbox = await findMonthMailbox(p.classId, p.month)
		await addRelation(mailbox, PROP_MAILBOX_CLASS, p.classId)
		const mailboxId = String(mailbox.id)
		for (let i = 0; i < regs.length; i++) {
			const item: CreateRegPayload = { classId: p.classId, month: p.month, regId: String(regs[i].id), amount: null, mailboxId, ...(i === regs.length - 1 ? { last: true } : {}) }
			await deps.enqueue(TARGET_LETTER_CREATE_REG, item)
		}
	} catch (err) {
		await deps.markError(p.classId, spec, (err as Error).message).catch(() => {})
		throw err
	}
}

// 그 등록의 그 달(기간 시작이 그 달) 가정통신문.
async function monthLettersOfReg(regId: string, month: string): Promise<any[]> {
	const ds = await monthlyDeps.letterDataSourceId()
	return (await monthlyDeps.queryAllPages(ds, { property: PROP_LETTER_REG, relation: { contains: regId } }))
		.filter((t: any) => alive(t) && seoulDay(t?.properties?.[PROP_LETTER_PERIOD]?.date?.start)?.slice(0, 7) === month)
}

// 가정통신문 '학원 일정'을 연결 안 된 그 달 일정으로 맞춘다(같으면 쓰지 않음). 넣은 일정을 돌려준다. events를 주면 다시 읽지 않는다.
async function bundleUnlinked(letter: any, studentId: string, month: string, given?: any[]): Promise<any[]> {
	const events = given ?? await unlinkedMonthEvents(studentId, month)
	const want = events.map((e: any) => key(e.id)).sort()
	const have = relIds(letter?.properties?.[PROP_LETTER_EVENTS]).map(key).sort()
	if (want.join(",") !== have.join(",")) {
		await monthlyDeps.update(String(letter.id), { [PROP_LETTER_EVENTS]: { relation: events.slice(0, 100).map((e: any) => ({ id: String(e.id) })) } })
	}
	return events
}

const mailboxOf = (letter: any) => relIds(letter?.properties?.[PROP_LETTER_MAILBOX])[0] ?? ""
const sentLetter = (letter: any) => String(letter?.properties?.["안내문 전송 상태"]?.select?.name ?? "") === "✅ 완료"

// 이 발송함에 있는 그 학생의 그 달 장: 기억 표 → 그 학생 그 달 등록들이 든 장 중 이 발송함 것.
async function findStudentLetter(studentId: string, month: string, mailboxId: string, regId: string): Promise<any | null> {
	const deps = monthlyDeps
	const memo = await deps.memo.get(month, "student", key(studentId))
	if (memo) {
		const page: any = await deps.getPage(memo).catch(() => null)
		if (alive(page) && key(mailboxOf(page)) === key(mailboxId)) return page
	}
	const regIds = new Set([key(regId), ...(await studentRegsInMonth(studentId, month)).map((r: any) => key(r.id))])
	for (const id of regIds) {
		const hit = (await monthLettersOfReg(id, month)).find((l: any) => key(mailboxOf(l)) === key(mailboxId))
		if (hit) return hit
	}
	return null
}

// 등록 1건: 이 발송함에 그 학생의 그 달 장이 없으면 만들고(등록·발송함·학원 일정을 한 번에), 있으면 '등록'에 이 등록을 더한다.
// 이미 보낸 장이면 알림톡은 다시 보내지 않는다(웹 리포트 본문에는 더한 반 전달사항이 보임) — 발송함 '요청 결과'에 수를 적는다.
// 옛 반별 발송함이면 옛 방식(등록 × 달 한 장)처럼 그 등록의 장을 찾는다. 다시 해도 같다.
export async function processLetterCreateRegItem(p: CreateRegPayload): Promise<void> {
	const deps = monthlyDeps
	try {
		const reg: any = await deps.getPage(p.regId)
		const studentId = relIds(reg?.properties?.["학생정보"])[0]
		if (!studentId) {
			await appendError(p.classId, `${studentNameOf(reg) || p.regId}: 등록에 학생이 연결되어 있지 않아 건너뜀`)
		} else if (p.mailboxId) {
			const st: any = await deps.getPage(studentId).catch(() => null)
			const events = pickUnlinked(await monthRows(p.month), relIds(st?.properties?.["학교"])[0], relIds(st?.properties?.["학년"])[0], p.month)
			const letter = await findStudentLetter(studentId, p.month, p.mailboxId, p.regId)
			if (!letter) {
				const range = monthRange(p.month)
				const created = await deps.createPage(await deps.letterDataSourceId(), {
					[PROP_LETTER_TITLE]: { title: [{ text: { content: letterTitle(p.month, studentNameOf(reg) || regNameOf(reg)) } }] },
					[PROP_LETTER_PERIOD]: { date: { start: range.start, end: range.end } },
					[PROP_LETTER_REG]: { relation: [{ id: p.regId }] },
					[PROP_LETTER_MAILBOX]: { relation: [{ id: p.mailboxId }] },
					[PROP_LETTER_EVENTS]: { relation: events.slice(0, 100).map((e: any) => ({ id: String(e.id) })) },
				})
				await deps.memo.put(p.month, "student", key(studentId), String(created.id), true)
			} else {
				await deps.memo.put(p.month, "student", key(studentId), String(letter.id), true)
				const added = await addRelation(letter, PROP_LETTER_REG, p.regId)
				await bundleUnlinked(letter, studentId, p.month, events)
				if (added && sentLetter(letter)) await deps.memo.put(p.month, "late", key(studentId), String(letter.id))
			}
		}
		if (p.last) {
			const late = p.mailboxId ? await deps.memo.count(p.month, "late") : 0
			if (late && p.mailboxId) {
				await deps.update(p.mailboxId, { [PROP_MAILBOX_RESULT]: { rich_text: [{ text: { content: `보낸 뒤 더해진 학생 ${late}명 — 알림톡은 다시 보내지 않았어요(학부모 리포트 가정통신문에는 보여요)` } }] } })
					.catch((err: unknown) => console.warn("[letter-create] 요청 결과 쓰기 건너뜀:", (err as Error).message))
			}
			await finishParent(p.classId, CLASS_LETTER_GEN_STATUS_SPEC)
		}
	} catch (err) {
		const message = `월간 안내 생성 실패(다시 누르면 빠진 학생만 만듭니다): ${(err as Error).message}`
		await appendError(p.classId, message)
		if (p.last) await deps.markError(p.classId, CLASS_LETTER_GEN_STATUS_SPEC, message).catch(() => {})
		throw err
	}
}

// ── 2-1) 발송함 [일정 다시 가져오기] (261125) ──────────────────────────────────────
// 가정통신문 발송함(반 × 달)에 묶인 가정통신문마다 '학원 일정'을 그 달 연결 안 된 일정으로 다시 맞춘다(만들 때·보낼 때와 같은 규칙,
// bundleUnlinked). 늦게 넣거나 빠진 학원 전체·학교·학년 일정을 한 번에 넣는 버튼이다. 보내지 않는다(발송 상태·전송 내역 그대로).
// 학생·반에 연결된 일정은 노션 수식이 모으므로 여기서 하지 않는다.
// 결과에는 그 달 학부모 공개인데 종류(세부 구분, 옛 구분)를 몰라 빠진 일정 중 이 발송함 학생에게 걸린 것을 이름으로 돌려준다.
export type RefetchResult = { letters: number; changed: number; events: number; skipped: string[] }
const REFETCH_PARALLEL = 3

// 그 달 공개·숨김 아님인데 종류가 비어 학부모에게 안 나가는 일정 중 이 학생들·이 반에 걸린 것.
export function noKindEvents(rows: any[], month: string, who: { classIds: string[]; studentIds: string[]; schools: { sch: string; grd: string }[] }): any[] {
	const cls = new Set(who.classIds.map(key)), stu = new Set(who.studentIds.map(key))
	const byId = new Map<string, any>()
	for (const e of rows) {
		const p = e?.properties
		if (!alive(e) || p?.["숨김"]?.checkbox !== false || p?.["학부모 공개"]?.checkbox !== true || eventKind(e) !== "") continue
		if (!inMonth(eventLine(e)?.day ?? null, month)) continue
		const mine = isAcademyWide(e) ||
			relIds(p?.["클래스"]).some((id) => cls.has(key(id))) ||
			relIds(p?.["학생"]).some((id) => stu.has(key(id))) ||
			who.schools.some((s) => schoolGradeFits(e, s.sch, s.grd))
		if (mine) byId.set(key(e.id), e)
	}
	return Array.from(byId.values()).sort((a, b) => (eventLine(a)?.day ?? "").localeCompare(eventLine(b)?.day ?? ""))
}

export async function refetchMailboxEvents(mailboxId: string): Promise<RefetchResult> {
	const deps = monthlyDeps
	const box: any = await deps.getPage(mailboxId)
	if (!alive(box)) throw new LetterBlocked("발송함을 찾지 못했어요(지웠거나 연동에 공유되지 않음).")
	if (String(box?.properties?.[PROP_MAILBOX_KIND]?.select?.name ?? "") !== KIND_MONTHLY) throw new LetterBlocked("[일정 다시 가져오기]는 구분이 가정통신문인 발송함에서만 눌러요.")
	const boxMonth = String(seoulDay(box?.properties?.[PROP_MAILBOX_PERIOD]?.date?.start) ?? "").slice(0, 7)
	if (!boxMonth) throw new LetterBlocked("발송함 '기간'이 비어 있어요.")
	const letters = (await deps.queryAllPages(await deps.letterDataSourceId(), { property: PROP_LETTER_MAILBOX, relation: { contains: mailboxId } })).filter(alive)
	if (!letters.length) throw new LetterBlocked("이 발송함에 가정통신문이 없어요. 클래스 [월간 안내 생성]을 먼저 눌러 주세요.")
	const monthRows = new Map<string, any[]>()
	const rowsOf = async (month: string) => {
		if (!monthRows.has(month)) monthRows.set(month, await eventQuery(month)(null))
		return monthRows.get(month)!
	}
	await rowsOf(boxMonth)
	const put = new Set<string>(), studentIds: string[] = [], schools: { sch: string; grd: string }[] = [], failed: string[] = []
	let changed = 0
	const one = async (letter: any) => {
		try {
			const month = String(seoulDay(letter?.properties?.[PROP_LETTER_PERIOD]?.date?.start) ?? "").slice(0, 7) || boxMonth
			const regId = relIds(letter?.properties?.[PROP_LETTER_REG])[0]
			if (!regId) throw new Error("등록 연결 없음")
			const reg: any = await deps.getPage(regId)
			const studentId = relIds(reg?.properties?.["학생정보"])[0]
			if (!studentId) throw new Error("등록에 학생 연결 없음")
			const st: any = await deps.getPage(studentId)
			const schoolId = relIds(st?.properties?.["학교"])[0], gradeId = relIds(st?.properties?.["학년"])[0]
			studentIds.push(studentId)
			schools.push({ sch: schoolId ? key(schoolId) : "", grd: gradeId ? key(gradeId) : "" })
			const events = pickUnlinked(await rowsOf(month), schoolId, gradeId, month)
			const before = relIds(letter?.properties?.[PROP_LETTER_EVENTS]).map(key).sort().join(",")
			await bundleUnlinked(letter, studentId, month, events)
			if (events.map((e: any) => key(e.id)).sort().join(",") !== before) changed++
			for (const e of events) put.add(key(e.id))
		} catch (err) {
			console.warn("[letter-refetch] 가정통신문 건너뜀:", letter?.id, (err as Error).message)
			failed.push(anyTitleText(letter).trim() || String(letter?.id ?? ""))
		}
	}
	for (let i = 0; i < letters.length; i += REFETCH_PARALLEL) await Promise.all(letters.slice(i, i + REFETCH_PARALLEL).map(one))
	if (failed.length) throw new Error(`가정통신문 ${letters.length}장 중 ${failed.length}장을 고치지 못했어요(${failed.slice(0, 3).join(", ")}${failed.length > 3 ? " 외" : ""}). 다시 누르면 남은 장만 바뀌어요`)
	const skipped = noKindEvents(await rowsOf(boxMonth), boxMonth, { classIds: relIds(box?.properties?.[PROP_MAILBOX_CLASS]), studentIds, schools })
		.map((e) => eventLine(e)?.line ?? (textOf(e?.properties?.["이름"]?.title).trim() || "이름 없음"))
	return { letters: letters.length, changed, events: put.size, skipped }
}

// 요청 결과 한 줄(160자 안): "가정통신문 3장 · 넣은 일정 2개 · 고친 장 1 · 세부 구분 비어 빠짐: 12/3(목) 재량휴원일"
export function refetchNote(r: RefetchResult): string {
	const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s)
	const head = `가정통신문 ${r.letters}장 · 넣은 일정 ${r.events}개 · ${r.changed ? `고친 장 ${r.changed}` : "바뀐 것 없음"}`
	if (!r.skipped.length) return head
	const names = r.skipped.slice(0, 3).map((s) => clip(s, 24)).join(", ") + (r.skipped.length > 3 ? ` 외 ${r.skipped.length - 3}개` : "")
	return `${head} · 세부 구분 비어 빠짐: ${names}`
}

// ── 3) 가정통신문 보내기(noticeQueue kind "letter"가 부른다) ──────────────────────────
// 보내기 전에 막힌 경우(일정도 전달사항도 없음 등). 다시 해도 같으므로 큐 재시도 없이 ⚠️.
export class LetterBlocked extends Error {}

// 같은 학생의 그 달 반 이름(이름순, 같은 이름은 한 번). #{클래스}에 쓴다.
const classNamesOf = (regs: any[]) => Array.from(new Set(regs.map(classNameOfReg).filter(Boolean))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
// (261125 대표 "보내는 메세지에 클래스도 너무 많다") 옛 템플릿의 #{클래스}: 반이 3개까지는 " · "로 잇고, 넘으면 "첫 반 외 n개".
// Notion 가정통신문 `클래스목록(알림톡)` 수식도 같은 규칙(미리보기용, 서버는 이 값을 읽지 않음).
export const LETTER_CLASS_MAX = 3
export function letterClassText(names: string[]): string {
	return names.length > LETTER_CLASS_MAX ? `${names[0]} 외 ${names.length - 1}개` : names.join(" · ")
}


// (10/29 사용자) 전달사항: 같은 달 반마다 가정통신문 발송함의 '가정통신문 전달사항'(반 이름순). 가정통신문은 반 공지라
// 학생 개인 메모는 넣지 않는다(개별 전달은 따로 메시지로). 하나뿐이면 문장만, 둘 이상이면 반마다 "🏛 반 이름" 줄 아래 "  • 문구".
// (11/2 사용자) 예전 "  • (반 이름) …"은 솔라피가 첫 줄 앞 공백을 지워 들여쓰기가 어긋났다. 반 이름 줄이 이모지로 시작하면 맞는다. 모두 비면 없음. 문구마다 50자까지.
export async function letterNote(letter: any, regs: any[]): Promise<string> {
	const className = new Map(regs.map((r: any) => [key(r.id), classNameOfReg(r)]))
	const sibs = await Promise.all(relIds(letter?.properties?.[PROP_LETTER_SIBLINGS]).map((id) => monthlyDeps.getPage(id).catch(() => null)))
	const seen = new Set<string>()
	const perClass: [string, string][] = []
	for (const l of [letter, ...sibs.filter(alive)]) {
		const name = className.get(key(relIds(l?.properties?.[PROP_LETTER_REG])[0] ?? ""))
		const boxId = relIds(l?.properties?.[PROP_LETTER_MAILBOX])[0]
		if (!name || !boxId || seen.has(key(boxId))) continue
		seen.add(key(boxId))
		const box: any = await monthlyDeps.getPage(boxId).catch(() => null)
		const memo = textOf(propRich(box, LETTER_NOTICE_MEMO)).trim()
		if (memo) perClass.push([name, noteText(memo)])
	}
	perClass.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
	if (!perClass.length) return noteText("")
	if (perClass.length === 1) return perClass[0][1]
	return perClass.map(([name, text]) => `🏛 ${name}\n${BULLET}${text}`).join("\n")
}

// 월간 일정 안내 한 통의 변수. 보내기 직전에 '학원 일정'을 다시 넣고 페이지를 다시 읽어 (일정안내) 수식 값을 먼저 쓴다.
// 수식이 없거나 비면 서버가 같은 규칙으로 계산한 값(학생·다니는 반 전부·연결 안 된 일정).
// (10/29) 그 달 일정이 0건이어도 전달사항(이 장 메모·반 발송함 메모)이 있으면 보낸다(일정 구역 없이 전달사항만). 둘 다 없으면 LetterBlocked.
export async function buildLetterNotice(letter: any): Promise<{ registrationId: string; title: string; period: { start: string; end: string }; variables: Record<string, string>; afterSent?: () => Promise<void> }> {
	const deps = monthlyDeps
	const registrationId = relIds(letter?.properties?.[PROP_LETTER_REG])[0]
	if (!registrationId) throw new LetterBlocked("이 가정통신문에 연결된 등록이 없습니다.")
	const month = String(seoulDay(letter?.properties?.[PROP_LETTER_PERIOD]?.date?.start) ?? "").slice(0, 7)
	if (!month) throw new LetterBlocked("가정통신문 '기간'이 비어 있습니다.")
	// (항목 150) 월별 학습계획 발송함에 든 장은 보내지 않는다(학습계획은 알림톡이 없다).
	const boxId = mailboxOf(letter)
	if (boxId) {
		const box: any = await deps.getPage(boxId).catch(() => null)
		if (String(box?.properties?.[PROP_MAILBOX_KIND]?.select?.name ?? "") === KIND_PLAN) throw new LetterBlocked("월별 학습계획은 알림톡을 보내지 않습니다(학부모 리포트 반 화면에서 봅니다).")
	}
	const reg: any = await deps.getPage(registrationId)
	const studentId = relIds(reg?.properties?.["학생정보"])[0]
	if (!studentId) throw new LetterBlocked("등록에 학생이 연결되어 있지 않습니다.")
	const regs = await studentRegsInMonth(studentId, month)
	if (!regs.length) throw new LetterBlocked(`${monthLabel(month)}에 다니는 등록이 없습니다.`)
	const unlinked = await bundleUnlinked(letter, studentId, month)
	// 같은 묶음의 다른 반 가정통신문도 미리보기가 맞게 같은 '학원 일정'으로 맞춘다(실패해도 보내기는 계속).
	for (const id of relIds(letter?.properties?.[PROP_LETTER_SIBLINGS])) {
		const sib: any = await deps.getPage(id).catch(() => null)
		if (alive(sib)) await bundleUnlinked(sib, studentId, month, unlinked).catch((err: unknown) => console.warn("[letter] 같은 달 가정통신문 학원 일정 건너뜀:", id, (err as Error).message))
	}
	const lines = await studentMonthEvents(studentId, month, regs, unlinked)
	const fresh: any = await deps.getPage(String(letter.id)).catch(() => letter)
	// 변수 값: "변수(알림톡)" 수식 → 옛 "(일정안내)" 수식 → 서버 계산(_shared/noticeBlocks.ts alimtalkVar).
	// (11/2) 가정통신문 (일정안내) 수식은 (알림톡)으로 이름을 바꿨다. 예전 이름은 읽지 않는다.
	const f = (name: string, fallback: string) => alimtalkVar(fresh, name, fallback)
	const studentName = studentNameOf(reg)
	// (v2.8.0 항목 148, 대표 261125 "클래스에도 전달사항 넣지마") #{전달사항} = 발송함 공통 안내(`가정통신문 안내 메모`)만.
	const note = f("전달사항", await letterNote(fresh, regs))
	if (!lines.length && (!note.trim() || note.trim() === NO_NOTE)) throw new LetterBlocked(`${monthLabel(month)} 학부모 공개 일정과 전달사항이 없어 보내지 않았습니다. 일정이나 발송함 가정통신문 안내 메모를 넣은 뒤 [안내문 전송]을 누르세요.`)
	return {
		registrationId,
		title: studentName || "월간 일정 안내",
		period: monthRange(month),
		variables: {
			"#{학생이름}": f("학생이름", studentName),
			"#{클래스}": f("클래스", letterClassText(classNamesOf(regs))),
			// 옛 (일정안내) 수식은 ": 반" 모양이라 읽지 않는다. 둘 이상이면 "• 반" 목록.
			// (10/29 다시 신청한 본문) 머리줄 "🏛 클래스"까지 담는 블록. 값이 공백으로 시작하지 않게.
			"#{안내월}": f("안내월", monthLabel(month)),
			// (v2.8.0 구역) 월간 일정 안내 [일정 안내]의 세 작은 구역 목록. 날짜가 들어가 서버가 서울 날짜로 만든다.
			"#{휴원목록}": sectionListText(lines, "휴원"),
			"#{학원목록}": sectionListText(lines, "학원"),
			"#{학사목록}": sectionListText(lines, "학교"),
			"#{전달사항}": note,
			"#{페이지ID}": `${Deno.env.get("REPORT_PATH") ?? "/academy-management/student_report.html"}?token=${await deps.token(registrationId)}`,
		},
	}
}
