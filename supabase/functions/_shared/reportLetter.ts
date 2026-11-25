// _shared/reportLetter.ts
//
// (v2.8.0) 학부모 리포트의 가정통신문. 보낸 달 목록만 캐시(student_fields.letters)에 싣고, 본문은 누를 때 읽는다
// (get-report-letter). 그래서 본문·사진을 고쳐도 동기화 없이 바로 보이고, 사진 주소가 만료되지 않는다.
// (v2.8.0 항목 148, 261125 대표) 학생당 한 장: 리포트 첫 화면 일정 아래에서 달마다 한 줄. 반별 전달사항은 반 이름 머리글로.
// 내용: 일정(알림톡과 같은 계산, 다니는 반 전부) + 반별 전달사항 + 안내(발송함 페이지 본문) + 학생별 본문(가정통신문 페이지 본문).
import { readPageBodyBlocks } from "./feedBody.ts"
import { LETTER_NOTICE_MEMO, propRich } from "./propAlias.ts"
import { fetchWithRetry, getPage, notionHeaders, queryAllPages, relIds } from "./notionClient.ts"
import { NOTION_API } from "./constants.ts"
import { resolveBatchDataSourceId, seoulDay } from "./classReportPlan.ts"
import { KIND_PLAN, letterSentByLogs, resolveLetterDataSourceId, studentMonthEvents, studentRegsInMonth } from "./monthlyNotice.ts"
import { dotDate, monthLabel, type Section } from "./scheduleNotice.ts"

const PROP_PERIOD = "기간"
const PROP_REG = "등록"
const PROP_MAILBOX = "알림톡 발송함"
const PROP_STATUS = "안내문 전송 상태"
const SENT = "✅ 완료"
const LIST_LIMIT = 24

export const reportLetterDeps = {
	queryAllPages,
	getPage,
	dataSourceId: () => resolveLetterDataSourceId(),
	events: (studentId: string, month: string, regs: any[]) => studentMonthEvents(studentId, month, regs),
	body: readPageBodyBlocks,
	regsInMonth: (studentId: string, month: string) => studentRegsInMonth(studentId, month),
	batchDataSourceId: () => resolveBatchDataSourceId(),
	// 페이지 본문에 블록이 하나라도 있나(한 개만 읽음).
	hasBody: async (pageId: string): Promise<boolean> => {
		const res = await fetchWithRetry(`${NOTION_API}/blocks/${pageId}/children?page_size=1`, { headers: notionHeaders() })
		if (!res.ok) return false
		return ((await res.json())?.results ?? []).length > 0
	},
}

const alive = (p: any) => !!p && !p.in_trash && !p.archived
const monthOf = (letter: any) => String(seoulDay(letter?.properties?.[PROP_PERIOD]?.date?.start) ?? "").slice(0, 7)

// 보낸 장: 상태 ✅이거나, 상태가 손으로 바뀌었어도 전송로그에 성공한 알림톡이 있는 장(다시 보내기 잠금과 같은 판단). 한 번도 안 보낸 장은 제외.
async function sentLettersOfReg(ds: string, regId: string): Promise<any[]> {
	const pages = await reportLetterDeps.queryAllPages(ds, {
		and: [
			{ property: PROP_REG, relation: { contains: regId } },
			{ or: [{ property: PROP_STATUS, select: { equals: SENT } }, { property: "전송로그", relation: { is_not_empty: true } }] },
		],
	})
	const out: any[] = []
	for (const p of pages.filter(alive)) {
		if (p?.properties?.[PROP_STATUS]?.select?.name === SENT || await letterSentByLogs(p, (id) => reportLetterDeps.getPage(id))) out.push(p)
	}
	return out
}

// 캐시에 싣는 목록: 보낸 달, 최근 달부터. (v2.8.0 항목 148) 학생당 한 장이라 같은 달은 한 줄(registrationId = 그 장이 걸린 등록 하나).
// 실패해도 리포트 동기화는 계속한다.
export async function buildLetterList(regIds: string[]): Promise<{ month: string; registrationId: string }[]> {
	if (!regIds.length) return []
	try {
		const ds = await reportLetterDeps.dataSourceId()
		const perReg = await Promise.all(regIds.map(async (registrationId) => (await sentLettersOfReg(ds, registrationId)).map((l) => ({ month: monthOf(l), registrationId }))))
		const byMonth = new Map<string, { month: string; registrationId: string }>()
		for (const x of perReg.flat()) if (x.month && !byMonth.has(x.month)) byMonth.set(x.month, x)
		return Array.from(byMonth.values()).sort((a, b) => b.month.localeCompare(a.month)).slice(0, LIST_LIMIT)
	} catch (err) {
		console.warn("[report-letter] 가정통신문 목록 건너뜀:", (err as Error)?.message ?? err)
		return []
	}
}

// 화면에 보내는 본문에는 blockId를 빼고 새로 받은 주소만 남긴다. 파일은 그 주소로 바로 열린다.
// (보고서 본문 reportBody.ts도 같이 쓴다.)
export function publicBody(blocks: unknown[]): unknown[] {
	return blocks.map((b: any) => {
		if (!b || typeof b !== "object") return b
		const { blockId: _blockId, ...rest } = b
		return Array.isArray(rest.children) ? { ...rest, children: publicBody(rest.children) } : rest
	})
}

// 알림톡 일정 한 줄("11/7(토) 내용")을 화면 한 줄("11.07(토)  내용")로.
function eventText(line: string): string {
	const cut = line.indexOf(" ")
	return cut < 0 ? dotDate(line) : `${dotDate(line.slice(0, cut))}  ${line.slice(cut + 1).trim()}`
}

export type LetterView = {
	month: string
	label: string
	schedule: { rest: string[]; academy: string[]; school: string[] }
	note: string
	classBody: unknown[]
	studentBody: unknown[]
}

// 그 학생의 이 달 가정통신문(그 등록이 걸린 보낸 장). 보낸 장이 없으면 null.
// 일정은 알림톡과 같은 계산(그 학생이 그 달 다니는 반 전부). 안내 = 발송함 본문, 학생 안내 = 장 본문.
export async function buildLetterView(regId: string, studentId: string, month: string): Promise<LetterView | null> {
	const deps = reportLetterDeps
	const letter = (await sentLettersOfReg(await deps.dataSourceId(), regId)).find((l) => monthOf(l) === month)
	if (!letter) return null
	const boxId = relIds(letter?.properties?.[PROP_MAILBOX])[0]
	const [regs, box, classBody, studentBody] = await Promise.all([
		deps.regsInMonth(studentId, month),
		boxId ? deps.getPage(boxId).catch(() => null) : Promise.resolve(null),
		boxId ? deps.body(boxId) : Promise.resolve([]),
		deps.body(String(letter.id)),
	])
	const lines = await deps.events(studentId, month, regs.length ? regs : [await deps.getPage(regId)])
	const ofSection = (sec: Section) => lines.filter((l) => l.sec === sec).sort((a, b) => a.day.localeCompare(b.day)).map((l) => eventText(l.line))
	// (v2.8.0 항목 148, 대표 261125) 전달사항은 발송함 공통 안내(`가정통신문 안내 메모`)만. 반별 전달사항은 없다.
	const boxNote = propRich(box as any, LETTER_NOTICE_MEMO).map((t: any) => t?.plain_text ?? "").join("").trim()
	return {
		month,
		label: monthLabel(month),
		schedule: { rest: ofSection("휴원"), academy: ofSection("학원"), school: ofSection("학교") },
		note: boxNote,
		classBody: publicBody(classBody),
		studentBody: publicBody(studentBody),
	}
}

// ── 월별 학습계획(v2.8.0 항목 150, 261125 대표) ─────────────────────────────────────
// 반 × 달 발송함(구분 "월별 학습계획") 하나. 학생 장이 없어 캐시에 싣지 않고, 리포트 반 화면 홈 탭을 열 때
// 그 등록의 반 발송함 목록(내용이 있는 달만)을 읽고, 달을 누르면 그 발송함 본문을 읽는다(get-report-letter kind "plan").
// 내용 = 발송함 `가정통신문 안내 메모` + 페이지 본문. 쓰는 중에도 바로 보이고 동기화가 필요 없다.
const PROP_BOX_KIND = "구분"
const PROP_BOX_CLASS = "클래스"
const PROP_BOX_PERIOD = "기간"
const PLAN_LIST_LIMIT = 24
const planMonthOf = (box: any) => String(seoulDay(box?.properties?.[PROP_BOX_PERIOD]?.date?.start) ?? "").slice(0, 7)
const boxMemo = (box: any) => propRich(box, LETTER_NOTICE_MEMO).map((t: any) => t?.plain_text ?? "").join("").trim()

async function classIdOfReg(regId: string): Promise<string> {
	const reg: any = await reportLetterDeps.getPage(regId).catch(() => null)
	return relIds(reg?.properties?.["클래스"])[0] ?? ""
}

// 그 반의 학습계획 발송함(달마다 하나, 같은 달이 둘이면 먼저 만든 것), 최근 달부터.
async function planBoxesOfClass(classId: string): Promise<any[]> {
	const deps = reportLetterDeps
	const boxes = (await deps.queryAllPages(await deps.batchDataSourceId(), {
		and: [
			{ property: PROP_BOX_CLASS, relation: { contains: classId } },
			{ property: PROP_BOX_KIND, select: { equals: KIND_PLAN } },
		],
	})).filter(alive)
	const byMonth = new Map<string, any>()
	for (const b of boxes.slice().sort((a: any, b: any) => String(a?.created_time ?? "").localeCompare(String(b?.created_time ?? "")))) {
		const m = planMonthOf(b)
		if (m && !byMonth.has(m)) byMonth.set(m, b)
	}
	return Array.from(byMonth.values()).sort((a, b) => planMonthOf(b).localeCompare(planMonthOf(a))).slice(0, PLAN_LIST_LIMIT)
}

// 반 화면 목록: 내용(메모나 본문)이 있는 달만, 최근 달부터.
export async function buildPlanList(regId: string): Promise<{ month: string }[]> {
	const classId = await classIdOfReg(regId)
	if (!classId) return []
	const boxes = await planBoxesOfClass(classId)
	const filled = await Promise.all(boxes.map(async (b) => !!boxMemo(b) || await reportLetterDeps.hasBody(String(b.id)).catch(() => false)))
	return boxes.filter((_, i) => filled[i]).map((b) => ({ month: planMonthOf(b) }))
}

export type PlanView = { month: string; label: string; note: string; classBody: unknown[] }

// 그 반 그 달 학습계획 본문. 발송함이 없으면 null.
export async function buildPlanView(regId: string, month: string): Promise<PlanView | null> {
	const classId = await classIdOfReg(regId)
	if (!classId) return null
	const box = (await planBoxesOfClass(classId)).find((b) => planMonthOf(b) === month)
	if (!box) return null
	return { month, label: monthLabel(month), note: boxMemo(box), classBody: publicBody(await reportLetterDeps.body(String(box.id))) }
}
