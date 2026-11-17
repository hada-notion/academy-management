// _shared/classEtcCharge.ts
//
// (v2.8.0 항목 72, 11/16 사용자) 클래스 [기타경비 청구] → sync-textbook-distribution/class-etc/queue → 큐 "class-etc".
// 클래스 `기타경비`(옛 이름 `기타경비(매달)`)에 붙인 기타경비 중 받는 방식이 "한 번"인 것을, 그 반을 지금 다니는 등록마다
// 청구서 한 장("YY.MM 등록 이름 + 기타경비 항목 + 청구서", 예: 26.12 홍재원 고1 수학 모의고사비 청구서)과 청구 항목 한 줄로 만든다.
// 청구서 한 장 = 한 종류(항목 71). 같은 달 · 같은 등록 · 같은 기타경비 줄이 이미 있으면 건너뛰어 두 번 눌러도 한 번만.
// 금액은 청구 항목 `교재비 금액` 수식이 기타경비 `신고 금액`을 쓴다(수기입력이 비면). 안내는 청구서 [안내문 전송] — 템플릿 "기타경비 안내".
import { anyTitleText, createPage, getPage, mapWithConcurrency, queryAllPages, relIds, todaySeoulDate, updatePageProperties } from "./notionClient.ts"
import { PROP_LAST_ERROR } from "./constants.ts"
import { cartConfigRowId } from "./adminShared.ts"

const DS_REGISTRATION = () => Deno.env.get("DATA_SOURCE_REGISTRATION_ID")!
const DS_CART = () => Deno.env.get("DATA_SOURCE_TEXTBOOK_CART_ID")!
const DS_LINE = () => Deno.env.get("DATA_SOURCE_TEXTBOOK_DISTRIBUTION_ID")!
// 클래스 → 기타경비 관계(11/16 `기타경비(매달)` → `기타경비`로 이름을 바꿈 — 둘 다 읽는다)
export const CLASS_ETC_PROPS = ["기타경비", "기타경비(매달)"]
export const ETC_ONCE = "한 번"

export const classEtcDeps = {
	getPage,
	queryAllPages,
	createPage,
	update: updatePageProperties,
	today: todaySeoulDate,
	// 표시용 "알림톡 설정" 관계에 넣을 행 id(항목 80) — 없으면 비워 둔다
	configRow: cartConfigRowId,
}

const key = (id: string) => String(id ?? "").replace(/-/g, "").toLowerCase()
const sel = (page: any, name: string): string => String(page?.properties?.[name]?.select?.name ?? "").trim()
const dateStart = (page: any, name: string): string => String(page?.properties?.[name]?.date?.start ?? "").slice(0, 10)
const alive = (p: any) => !!p && !p.archived && !p.in_trash

// 오늘 이 반을 다니는 등록: 등록일이 오늘이거나 앞이고, 종료일이 비었거나 오늘이거나 뒤.
export function activeToday(reg: any, today: string): boolean {
	const start = dateStart(reg, "등록일"), end = dateStart(reg, "종료일")
	return alive(reg) && (!start || start <= today) && (!end || end >= today)
}

export async function processClassEtcChargeQueueItem(payload: { classId: string }): Promise<void> {
	const d = classEtcDeps
	const classId = payload.classId
	// 사람이 고칠 일(붙인 것 없음 · 다니는 학생 없음)은 마지막 오류에 남기고 끝(큐가 다시 시도하지 않게).
	const fail = (m: string) => d.update(classId, { [PROP_LAST_ERROR]: { rich_text: [{ text: { content: `[기타경비 청구] ${m}`.slice(0, 1900) } }] } }).catch(() => {})
	try {
		const cls = await d.getPage(classId)
		if (!alive(cls)) return
		const etcIds = [...new Set(CLASS_ETC_PROPS.flatMap((n) => relIds(cls?.properties?.[n])).map(key))]
		const etcs = (await Promise.all(etcIds.map((id) => d.getPage(id).catch(() => null)))).filter((e) => alive(e) && sel(e, "받는 방식") === ETC_ONCE)
		if (!etcs.length) return void await fail("이 반에 붙인 기타경비 중 받는 방식이 '한 번'인 것이 없습니다.")
		const today = d.today(), monthStart = `${today.slice(0, 7)}-01`, yymm = `${today.slice(2, 4)}.${today.slice(5, 7)}`
		const regs = (await d.queryAllPages(DS_REGISTRATION(), { property: "클래스", relation: { contains: classId } })).filter((r: any) => activeToday(r, today))
		if (!regs.length) return void await fail("오늘 이 반을 다니는 학생이 없습니다.")
		let made = 0
		await mapWithConcurrency(regs, 2, async (reg: any) => {
			const regTitle = anyTitleText(reg).trim() || "학생"
			const lines = await d.queryAllPages(DS_LINE(), { property: "등록", relation: { contains: reg.id } })
			const carts = await d.queryAllPages(DS_CART(), { property: "등록", relation: { contains: reg.id } })
			for (const etc of etcs) {
				const already = lines.some((l: any) => alive(l) && dateStart(l, "청구 월") === monthStart && relIds(l?.properties?.["기타경비"]).some((x: string) => key(x) === key(etc.id)))
				if (already) continue
				const item = sel(etc, "기타경비 항목") || "기타경비"
				const title = `${yymm} ${regTitle} ${item} 청구서`
				let cart = carts.find((c: any) => alive(c) && anyTitleText(c).trim() === title)
				if (!cart) {
					const configRow = await d.configRow("기타경비").catch(() => null)
					cart = await d.createPage(DS_CART(), { 이름: { title: [{ text: { content: title } }] }, 등록: { relation: [{ id: reg.id }] }, ...(configRow ? { "알림톡 설정": { relation: [{ id: configRow }] } } : {}) })
					carts.push(cart)
				}
				await d.createPage(DS_LINE(), {
					이름: { title: [{ text: { content: anyTitleText(etc).trim() || item } }] },
					등록: { relation: [{ id: reg.id }] },
					기타경비: { relation: [{ id: etc.id }] },
					종류: { select: { name: "기타경비" } },
					"기타경비 항목": { select: { name: item } },
					"청구 월": { date: { start: monthStart } },
					배부일: { date: { start: today } },
					교재비: { relation: [{ id: cart.id }] },
				})
				made++
			}
		})
		await d.update(classId, { [PROP_LAST_ERROR]: { rich_text: [] } }).catch(() => {})
		console.log(`[class-etc] ${classId}: 등록 ${regs.length} · 기타경비 ${etcs.length} · 새 줄 ${made}`)
	} catch (err) {
		await fail((err as Error).message)
		throw err
	}
}
