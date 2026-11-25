// _shared/reportLetter.ts
//
// (v2.8.0) 학부모 리포트의 가정통신문. 보낸 달 목록만 캐시(student_fields.letters)에 싣고, 본문은 누를 때 읽는다
// (get-report-letter). 그래서 본문·사진을 고쳐도 동기화 없이 바로 보이고, 사진 주소가 만료되지 않는다.
// (v2.8.0 항목 147, 261125 대표) 학생당 한 장: 리포트 첫 화면 일정 아래에서 달마다 한 줄. 반별 전달사항은 반 이름 머리글로.
// 내용: 일정(알림톡과 같은 계산, 다니는 반 전부) + 반별 전달사항 + 안내(발송함 페이지 본문) + 학생별 본문(가정통신문 페이지 본문).
import { readPageBodyBlocks } from "./feedBody.ts"
import { LETTER_NOTICE_MEMO, propRich } from "./propAlias.ts"
import { getPage, queryAllPages, relIds } from "./notionClient.ts"
import { seoulDay } from "./classReportPlan.ts"
import { classNotesOf, parseSentNote, PROP_LETTER_SENT_NOTE, resolveLetterDataSourceId, studentMonthEvents, studentRegsInMonth } from "./monthlyNotice.ts"
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
	classNotes: (letter: any, regs: any[]) => classNotesOf(letter, regs),
}

const alive = (p: any) => !!p && !p.in_trash && !p.archived
const monthOf = (letter: any) => String(seoulDay(letter?.properties?.[PROP_PERIOD]?.date?.start) ?? "").slice(0, 7)

async function sentLettersOfReg(ds: string, regId: string): Promise<any[]> {
	const pages = await reportLetterDeps.queryAllPages(ds, {
		and: [
			{ property: PROP_REG, relation: { contains: regId } },
			{ property: PROP_STATUS, select: { equals: SENT } },
		],
	})
	return pages.filter(alive)
}

// 캐시에 싣는 목록: 보낸 달, 최근 달부터. (v2.8.0 항목 147) 학생당 한 장이라 같은 달은 한 줄(registrationId = 그 장이 걸린 등록 하나).
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
	// (v2.8.0 항목 147) 반별 전달사항(반 이름순). 보낸 때 박아 둔 것 + 보낸 뒤 더해진 반은 지금 클래스 칸.
	notes: { name: string; text: string }[]
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
	const sent = parseSentNote(propRich(letter, [PROP_LETTER_SENT_NOTE]).map((t: any) => t?.plain_text ?? "").join(""))
	const later = (await deps.classNotes(letter, regs)).filter((n) => !sent.some((s) => s.name === n.name))
	const notes = [...sent, ...later.map((n) => ({ name: n.name, text: n.text }))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	// 반별 전달사항이 없으면 발송함 메모(전 반 공통 안내).
	const boxNote = propRich(box as any, LETTER_NOTICE_MEMO).map((t: any) => t?.plain_text ?? "").join("").trim()
	return {
		month,
		label: monthLabel(month),
		schedule: { rest: ofSection("휴원"), academy: ofSection("학원"), school: ofSection("학교") },
		note: notes.length ? notes.map((n) => (notes.length > 1 ? `${n.name}\n${n.text}` : n.text)).join("\n\n") : boxNote,
		notes,
		classBody: publicBody(classBody),
		studentBody: publicBody(studentBody),
	}
}
