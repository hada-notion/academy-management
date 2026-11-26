// _shared/registrationIcons.ts
//
// (v2.8.0 항목 155, 261126) 클래스 한 개의 등록 페이지 아이콘을 그 반 색의 "채운 사람 모양" PNG로 맞춘다.
//   클래스 페이지의 색(색 코드 > 색 이름) → 그 클래스에 연결된 등록(학원) DB 행 전부(휴지통 제외, 수강상태 무관) → 사람 모양 아이콘.
// 색이 정해지지 않았으면 아무것도 하지 않고 안내만 돌려준다. 클래스 버튼 [등록 아이콘 맞추기](동작 class-reg-icons)와
// 관리 앱의 클래스 색 저장(백그라운드)이 함께 쓴다.
import { getPage, queryAllPages } from "./notionClient.ts"
import { DS_REGISTRATION, PROP_CLASS } from "./constants.ts"
import { classIconHex, setColorIcon, setColorIconMany } from "./classIcon.ts"

type Page = Record<string, any>

export const NO_CLASS_COLOR = "클래스 색이 정해지지 않았어요. 클래스의 색(또는 색 코드)을 정한 뒤 다시 눌러 주세요"

export const registrationIconDeps = {
	getPage: (id: string) => getPage(id) as Promise<Page>,
	// 이 클래스에 연결된 등록 전부(휴지통은 쿼리가 빼 준다). 수강상태로 거르지 않는다.
	registrationsOfClass: async (classId: string): Promise<string[]> =>
		(await queryAllPages(DS_REGISTRATION, { property: PROP_CLASS, relation: { contains: classId } })).map((p: Page) => String(p.id)),
	setIcons: (ids: string[], hex: string) => setColorIconMany(ids, hex, "user"),
	setIcon: (id: string, hex: string) => setColorIcon(id, hex, "user"),
}

const text = (p: any): string => {
	const rich = Array.isArray(p?.rich_text) ? p.rich_text : Array.isArray(p?.title) ? p.title : []
	return rich.map((t: any) => t?.plain_text ?? t?.text?.content ?? "").join("")
}

// 클래스 페이지(노션 모양)에서 색 hex를 뽑는다. 앱이 저장한 값(문자열)과 같은 규칙(classIconHex).
export function classPageHex(page: Page): string | null {
	const props = page?.properties ?? {}
	return classIconHex({ "색 코드": text(props["색 코드"]), 색: props["색"]?.select?.name ?? "" })
}

export type RegistrationIconResult = { ok: boolean; count: number; message: string }

// hex를 이미 알면(앱 저장) 넘기고, 아니면 클래스 페이지에서 읽는다.
export async function setRegistrationIconsForClass(classId: string, knownHex?: string | null): Promise<RegistrationIconResult> {
	const d = registrationIconDeps
	const hex = knownHex ?? classPageHex(await d.getPage(classId))
	if (!hex) return { ok: false, count: 0, message: NO_CLASS_COLOR }
	const ids = Array.from(new Set(await d.registrationsOfClass(classId)))
	if (!ids.length) return { ok: true, count: 0, message: "이 클래스에 연결된 등록이 없어요" }
	const r = await d.setIcons(ids, hex)
	if (r.failed.length) return { ok: false, count: r.done, message: `등록 ${r.done}개 아이콘을 맞췄고 ${r.failed.length}개는 실패했어요. 다시 눌러 주세요` }
	return { ok: true, count: r.done, message: `등록 ${r.done}개 아이콘을 맞췄어요` }
}

// (v2.8.0 항목 156, 261126) 등록 한 줄: 그 `클래스` 관계의 첫 클래스 색으로 이 등록의 아이콘만 사람 모양으로. 등록 [페이지가 추가되면]·
// [클래스가 바뀌면] 자동화(동작 reg-icon)가 부른다. 클래스나 색이 없으면 아무것도 바꾸지 않고 실패가 아닌 안내만(자동화가 매번 실패 줄을 남기지 않게).
export const NO_CLASS_FOR_REG = "연결된 클래스가 없어 아이콘을 그대로 뒀어요"
export const NO_COLOR_FOR_REG = "반 색이 없어 아이콘을 그대로 뒀어요"

export async function setRegistrationIconForRegistration(regId: string): Promise<RegistrationIconResult> {
	const d = registrationIconDeps
	const reg = await d.getPage(regId)
	const rel = reg?.properties?.[PROP_CLASS]?.relation
	const classId = Array.isArray(rel) && rel[0]?.id ? String(rel[0].id) : ""
	if (!classId) return { ok: true, count: 0, message: NO_CLASS_FOR_REG }
	const hex = classPageHex(await d.getPage(classId))
	if (!hex) return { ok: true, count: 0, message: NO_COLOR_FOR_REG }
	try {
		await d.setIcon(regId, hex)
	} catch (err) {
		console.warn("[registrationIcons] 등록 아이콘 실패:", regId, (err as Error).message)
		return { ok: false, count: 0, message: "등록 아이콘을 붙이지 못했어요. 다시 시도해 주세요" }
	}
	return { ok: true, count: 1, message: "등록 아이콘을 맞췄어요" }
}
