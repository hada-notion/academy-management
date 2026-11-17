// _shared/cartPlan.ts
//
// (v2.6.26) 교재비 [진도교재 담기]를 큐로, 서버는 교재배부 만들기만. 무엇을 담을지는 교재비 수식 "담기 계획"이 계산한다:
//   {"v":1,"r":"등록","items":[{"l":"라이브러리 교재","t":"교재명"}]}
//   = 등록의 진도교재 중 "진행 중"인 교재의 라이브러리 교재 가운데 이 교재비에 아직 배부되지 않은 것.
// 서버가 하던 등록 읽기·진도교재 한 권씩 읽기·라이브러리 교재 한 권씩 읽기(제목)가 없어지고 배부 만들기만 남는다.
// 두 번 만들기 막기: 만들기 전에 이 등록의 교재배부를 한 번 조회해 이미 배부된 라이브러리 교재는 건너뛴다
// (예전 서버 규칙과 같다 — 다른 교재비에 배부된 것도 건너뜀). 버튼을 두 번 눌러도, 큐가 다시 시도해도 한 권씩만.
// (v2.8.0 항목 71, 11/16 사용자) 청구서 한 장 = 한 종류. 담기 계획 항목의 "k"(라이브러리 구분: 교재 / 프로그램)로
// 교재는 "교재비" 청구서, 프로그램은 "재료비" 청구서에 담는다. 누른 청구서가 비어 있거나 같은 종류면 그 장에,
// 아니면 같은 등록의 그 종류 청구서(수식 `구분`)에, 없으면 "등록 이름 + 구분 + 청구서"로 새로 만든다. k가 없으면 예전처럼 누른 장에.
import { anyTitleText, createPage, getPage, mapWithConcurrency, queryAllPages, todaySeoulDate, updatePageProperties } from "./notionClient.ts"
import { LIBRARY_PROP, libraryIds, libraryPropOf } from "./libraryProp.ts"
import { PROP_LAST_ERROR, PROP_SYNCED_AT } from "./constants.ts"
import { CART_STATUS_SPEC, distributeFromCartPage } from "./textbookDistributionTarget.ts"
import { markError } from "./statusTracking.ts"
import { cartConfigRowId } from "./adminShared.ts"

export const CART_PLAN_PROP = "담기 계획"
const DS_DISTRIBUTION = () => Deno.env.get("DATA_SOURCE_TEXTBOOK_DISTRIBUTION_ID")!
const DS_CART = () => Deno.env.get("DATA_SOURCE_TEXTBOOK_CART_ID")!
export const CART_KIND_PROP = "구분"
const cartKindOf = (cart: any): string => String(cart?.properties?.[CART_KIND_PROP]?.formula?.string ?? "").trim()
const cartEmpty = (cart: any): boolean => !(cart?.properties?.["교재배부"]?.relation ?? []).length

export type CartPlan = { reg: string; items: { lib: string; title: string; kind?: string }[] }

const ID = /^[0-9a-f]{32}$/
const cleanId = (v: unknown): string | null => {
	const s = String(v ?? "").replace(/-/g, "").toLowerCase()
	return ID.test(s) ? s : null
}
const key = (id: string) => id.replace(/-/g, "").toLowerCase()

// 수식 값이 아니면(속성이 없거나 JSON이 아니면) null. 형식이 틀리면 Error(만들지 않고 ⚠️ 오류).
export function cartPlanFromText(text: unknown): CartPlan | null {
	if (typeof text !== "string" || !text.trim()) return null
	let raw: any
	try { raw = JSON.parse(text) } catch { return null }
	if (!raw || raw.v !== 1) return null
	const reg = cleanId(raw.r)
	if (!reg) throw new Error("교재비에 연결된 등록이 없습니다.")
	if (!Array.isArray(raw.items)) throw new Error("담기 계획에 items가 없습니다.")
	const items: CartPlan["items"] = []
	for (const it of raw.items) {
		const lib = cleanId(it?.l)
		if (!lib) throw new Error("담기 계획의 라이브러리 교재 값이 올바르지 않습니다.")
		const k = String(it?.k ?? "").trim()
		items.push({ lib, title: String(it?.t ?? "").trim() || `${todaySeoulDate()} 교재 배부`, ...(k ? { kind: k === "프로그램" ? "재료비" : "교재비" } : {}) })
	}
	return { reg, items }
}

export const cartPlanText = (p: any): string => (p?.type === "formula" || p?.formula ? String(p.formula?.string ?? "") : "")

export const cartPlanDeps = {
	getPage,
	createPage,
	queryAllPages,
	update: updatePageProperties,
	libraryProp: libraryPropOf,
	markError: (id: string, message: string) => markError(id, CART_STATUS_SPEC, message),
	legacy: distributeFromCartPage,
	today: todaySeoulDate,
	// 표시용 "알림톡 설정" 관계에 넣을 행 id(항목 80) — 없으면 비워 둔다
	configRow: cartConfigRowId,
}

export async function processCartPlanQueueItem(payload: { cartId: string; plan?: string | null }): Promise<void> {
	const deps = cartPlanDeps
	const cartId = payload.cartId
	let plan: CartPlan | null
	try {
		let text = payload.plan ?? ""
		if (!text || !cartPlanFromText(text)) {
			// 본문에 값이 없거나 읽을 수 없으면 교재비를 한 번 읽어 수식 값을 다시 받는다.
			const cart = await deps.getPage(cartId)
			if (cart?.archived || cart?.in_trash) return
			text = cartPlanText(cart?.properties?.[CART_PLAN_PROP])
		}
		plan = cartPlanFromText(text)
	} catch (err) {
		await deps.markError(cartId, (err as Error).message).catch(() => {})
		return
	}
	// 수식을 아직 안 넣은 운영 → 예전 방식(서버가 등록·진도교재를 읽어 담는다).
	if (!plan) {
		try {
			await deps.legacy(cartId)
			await deps.update(cartId, { [CART_STATUS_SPEC.statusProp]: { select: { name: "✅ 완료" } }, [PROP_LAST_ERROR]: { rich_text: [] } })
		} catch (err) {
			await deps.markError(cartId, (err as Error).message).catch(() => {})
			throw err
		}
		return
	}

	try {
		let made = 0
		if (plan.items.length) {
			const existing = await deps.queryAllPages(DS_DISTRIBUTION(), { property: "등록", relation: { contains: plan.reg } })
			const billed = new Set(existing.flatMap((d: any) => libraryIds(d)).map(key))
			const todo = plan.items.filter((it) => !billed.has(it.lib))
			if (todo.length) {
				const libProp = await deps.libraryProp(DS_DISTRIBUTION()).catch(() => LIBRARY_PROP)
				const targets = await cartTargets(cartId, plan.reg, todo)
				await mapWithConcurrency(todo, 3, (it) => deps.createPage(DS_DISTRIBUTION(), {
					이름: { title: [{ text: { content: it.title } }] },
					등록: { relation: [{ id: plan!.reg }] },
					[libProp]: { relation: [{ id: it.lib }] },
					배부일: { date: { start: deps.today() } },
					교재비: { relation: [{ id: targets.get(it.kind ?? "") ?? cartId }] },
				}))
				made = todo.length
			}
		}
		await deps.update(cartId, {
			[CART_STATUS_SPEC.statusProp]: { select: { name: "✅ 완료" } },
			[PROP_LAST_ERROR]: { rich_text: [] },
			[PROP_SYNCED_AT]: { date: { start: new Date().toISOString() } },
		})
		console.log(`[cart-plan] ${cartId}: 배부 ${made}권, 계획 ${plan.items.length}권`)
	} catch (err) {
		// 큐가 다시 시도한다. 다시 할 때도 위 조회로 이미 만든 교재는 건너뛴다.
		await deps.markError(cartId, (err as Error).message).catch(() => {})
		throw err
	}
}

// 종류(교재비 / 재료비)마다 담을 청구서 id. k가 없는 항목("")은 누른 장.
export async function cartTargets(cartId: string, regId: string, items: { kind?: string }[]): Promise<Map<string, string>> {
	const deps = cartPlanDeps
	const out = new Map<string, string>([["", cartId]])
	const kinds = [...new Set(items.map((it) => it.kind).filter((k): k is string => !!k))].sort() // 교재비 → 재료비
	if (!kinds.length) return out
	const cart = await deps.getPage(cartId)
	let own = cartEmpty(cart) ? "" : cartKindOf(cart) || "교재비"
	let others: any[] | null = null
	for (const kind of kinds) {
		if (!own) own = kind
		if (own === kind) { out.set(kind, cartId); continue }
		others ??= (await deps.queryAllPages(DS_CART(), { property: "등록", relation: { contains: regId } }))
			.filter((p: any) => !p?.archived && !p?.in_trash && key(p.id) !== key(cartId))
		const hit = others.find((p) => !cartEmpty(p) && cartKindOf(p) === kind)
		if (hit) { out.set(kind, hit.id); continue }
		const reg = await deps.getPage(regId).catch(() => null)
		const regTitle = (reg ? anyTitleText(reg) : "").trim() || "학생"
		const configRow = await deps.configRow(kind).catch(() => null)
		const made = await deps.createPage(DS_CART(), {
			이름: { title: [{ text: { content: `${regTitle} ${kind} 청구서` } }] },
			등록: { relation: [{ id: regId }] },
			...(configRow ? { "알림톡 설정": { relation: [{ id: configRow }] } } : {}),
		})
		out.set(kind, made.id)
	}
	return out
}
