// _shared/reportLetter.ts
//
// (v2.8.0) 학부모 리포트 홈 탭의 가정통신문. 보낸 달 목록만 캐시(student_fields.letters)에 싣고, 본문은 누를 때 읽는다
// (get-report-letter). 그래서 본문·사진을 고쳐도 동기화 없이 바로 보이고, 사진 주소가 만료되지 않는다.
// 학생이 같은 달에 여러 반을 다녀도 한 통으로 보내므로(같은 달 가정통신문), 등록이 아니라 학생·달 단위로 묶는다.
// 내용: 일정(알림톡과 같은 계산) + 전달사항 + 반 공통 본문(반 발송함 페이지 본문) + 학생별 본문(가정통신문 페이지 본문).
import { readPageBodyBlocks } from "./feedBody.ts"
import { getPage, queryAllPages, relIds } from "./notionClient.ts"
import { getRollupText } from "./alimtalkShared.ts"
import { seoulDay } from "./classReportPlan.ts"
import { resolveLetterDataSourceId, studentMonthEvents, studentRegsInMonth } from "./monthlyNotice.ts"
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
	regsInMonth: (studentId: string, month: string) => studentRegsInMonth(studentId, month),
	events: (studentId: string, month: string, regs: any[]) => studentMonthEvents(studentId, month, regs),
	body: readPageBodyBlocks,
}

const alive = (p: any) => !!p && !p.in_trash && !p.archived
const monthOf = (letter: any) => String(seoulDay(letter?.properties?.[PROP_PERIOD]?.date?.start) ?? "").slice(0, 7)

async function sentLettersOfRegs(regIds: string[]): Promise<any[]> {
	const ds = await reportLetterDeps.dataSourceId()
	const lists = await Promise.all(regIds.map((id) => reportLetterDeps.queryAllPages(ds, {
		and: [
			{ property: PROP_REG, relation: { contains: id } },
			{ property: PROP_STATUS, select: { equals: SENT } },
		],
	})))
	return lists.flat().filter(alive)
}

// 캐시에 싣는 목록: 보낸 달만, 최근 달부터. 실패해도 리포트 동기화는 계속한다.
export async function buildLetterList(regIds: string[]): Promise<{ month: string }[]> {
	if (!regIds.length) return []
	try {
		const months = new Set((await sentLettersOfRegs(regIds)).map(monthOf).filter(Boolean))
		return Array.from(months).sort().reverse().slice(0, LIST_LIMIT).map((month) => ({ month }))
	} catch (err) {
		console.warn("[report-letter] 가정통신문 목록 건너뜀:", (err as Error)?.message ?? err)
		return []
	}
}

// 화면에 보내는 본문에는 blockId를 빼고 새로 받은 주소만 남긴다. 파일은 그 주소로 바로 열린다.
function publicBody(blocks: unknown[]): unknown[] {
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

// 같은 내용인지 비교할 값. 파일 주소는 서명이 매번 달라 파일 이름까지만 본다.
export function bodyKey(blocks: unknown[]): string {
	return JSON.stringify(blocks, (name, value) => {
		if (name === "blockId" || name === "spans") return undefined
		if (name === "url" && typeof value === "string") return value.split("?")[0].split("/").pop()
		return value
	})
}

// 반마다 같은 내용을 적었으면 한 번만 보이고, 반 이름을 합친다. 다니는 반 모두가 같으면 반 이름을 쓰지 않는다.
function mergeSame<T>(items: { className: string; key: string; value: T }[], total: number): { className: string; value: T }[] {
	const groups = new Map<string, { names: string[]; value: T }>()
	for (const it of items) {
		const g = groups.get(it.key)
		if (g) g.names.push(it.className)
		else groups.set(it.key, { names: [it.className], value: it.value })
	}
	return Array.from(groups.values()).map((g) => ({ className: g.names.length < total ? g.names.filter(Boolean).join(" · ") : "", value: g.value }))
}

export type LetterView = {
	month: string
	label: string
	classes: string[]
	schedule: { rest: string[]; academy: string[]; school: string[] }
	notes: { className: string; text: string }[]
	commonBodies: { className: string; body: unknown[] }[]
	body: unknown[]
}

// 이 학생의 이 달 가정통신문 한 통. 보낸 장이 없으면 null.
export async function buildLetterView(regIds: string[], studentId: string, month: string): Promise<LetterView | null> {
	const deps = reportLetterDeps
	const mine = (await sentLettersOfRegs(regIds)).filter((l) => monthOf(l) === month)
	if (!mine.length) return null
	const regs = await deps.regsInMonth(studentId, month)
	const className = new Map<string, string>(regs.map((r: any) => [String(r.id), getRollupText(r, "클래스명(등록)").trim()]))
	const classes = Array.from(new Set(Array.from(className.values()).filter(Boolean))).sort()
	const lines = await deps.events(studentId, month, regs)
	const ofSection = (sec: Section) => lines.filter((l) => l.sec === sec).sort((a, b) => a.day.localeCompare(b.day)).map((l) => eventText(l.line))

	// 반 공통 본문은 발송함마다 한 번만, 반 이름순.
	const seenBox = new Set<string>()
	const boxes: { className: string; id: string }[] = []
	for (const l of mine) {
		const boxId = relIds(l?.properties?.[PROP_MAILBOX])[0]
		if (!boxId || seenBox.has(boxId)) continue
		seenBox.add(boxId)
		boxes.push({ className: className.get(String(relIds(l?.properties?.[PROP_REG])[0])) ?? "", id: boxId })
	}
	boxes.sort((a, b) => a.className.localeCompare(b.className))
	const [boxBodies, boxPages, ownBodies] = await Promise.all([
		Promise.all(boxes.map((b) => deps.body(b.id))),
		Promise.all(boxes.map((b) => deps.getPage(b.id).catch(() => null))),
		Promise.all(mine.map((l) => deps.body(String(l.id)))),
	])
	// 전달 사항은 발송함에 적은 글 그대로 보인다(알림톡 글자 수 제한이 없다).
	const memoOf = (page: any) => (page?.properties?.["가정통신문 전달사항"]?.rich_text ?? []).map((t: any) => t?.plain_text ?? "").join("").trim()
	const notes = mergeSame(boxes.map((b, i) => ({ className: b.className, key: memoOf(boxPages[i]), value: memoOf(boxPages[i]) })).filter((n) => n.value), boxes.length)
	const commonBodies = mergeSame(boxes.map((b, i) => ({ className: b.className, key: bodyKey(boxBodies[i]), value: publicBody(boxBodies[i]) })).filter((c) => c.value.length), boxes.length)

	return {
		month,
		label: monthLabel(month),
		classes,
		schedule: { rest: ofSection("휴원"), academy: ofSection("학원"), school: ofSection("학교") },
		notes: notes.map((n) => ({ className: n.className, text: n.value })),
		commonBodies: commonBodies.map((c) => ({ className: c.className, body: c.value })),
		body: publicBody(ownBodies.flat()),
	}
}
