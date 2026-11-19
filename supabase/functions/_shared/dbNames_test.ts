// 관 꼬리표 이름(v2.8.0 항목 102) 단위 시험: 이름 정규화 · 검색 결과 모으기 · 앱 DB 고르기 · 메뉴 DB 고르기. 가짜 검색 결과만(Notion 호출 없음).
import { normalizeBareDbTitle, normalizeDbName } from "./dbNames.ts"
import { addSource, isAppDb, pickSources } from "./appCopy.ts"
import { pickMenuDataSourceId } from "./menuDataSource.ts"
function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }
const ds = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ object: "data_source", id, title: [{ plain_text: title }], ...extra })

Deno.test("관 꼬리표: 이름 끝 괄호 안 글자는 (학원)으로, 이미 (학원)이거나 괄호가 없으면 그대로", () => {
	eq(normalizeDbName("학생(스터디) DB"), "학생(학원) DB")
	eq(normalizeDbName("알림톡 발송함(스타트) DB"), "알림톡 발송함(학원) DB")
	eq(normalizeDbName("청구 항목(관 2) DB"), "청구 항목(학원) DB")
	eq(normalizeDbName("학생(학원) DB"), "학생(학원) DB")
	eq(normalizeDbName("학생 DB"), "학생 DB")
	eq(normalizeDbName("메뉴(학원) DB 사본"), "메뉴(학원) DB 사본") // DB 뒤에 글자가 더 있으면 다른 이름
	eq(normalizeDbName("패치·이슈 관리 DB"), "패치·이슈 관리 DB")
	eq(normalizeDbName(""), "")
	eq(normalizeBareDbTitle("학생(스터디)"), "학생(학원)")
	eq(normalizeBareDbTitle("학생(학원)"), "학생(학원)")
	eq(normalizeBareDbTitle("학생"), "학생")
})

Deno.test("관 꼬리표: 검색 결과를 이름으로 모을 때 (학원) · 꼬리표 이름이 같은 이름으로 모이고, 앱 DB로 알아본다", () => {
	const found = new Map<string, string[]>()
	for (const r of [ds("a", "학생(스터디) DB"), ds("b", "등록(스터디) DB"), ds("c", "시간표(학원) DB"), ds("t", "학생(스터디) DB", { in_trash: true }), ds("x", "패치·이슈 관리 DB")]) addSource(found, r)
	eq([...found.keys()].sort(), ["등록(학원) DB", "패치·이슈 관리 DB", "시간표(학원) DB", "학생(학원) DB"].sort())
	eq(found.get("학생(학원) DB"), ["a"]) // 휴지통은 뺌
	eq(isAppDb("학생(학원) DB"), true)
	const picked = pickSources(found)
	eq([...picked.keys()].sort(), ["등록(학원) DB", "시간표(학원) DB", "학생(학원) DB"].sort()) // 앱 DB만
})

Deno.test("관 꼬리표: 같은 이름이 두 관에 있으면 id가 둘 다 모여 resolveSources가 좁힐 수 있다", () => {
	const found = new Map<string, string[]>()
	for (const r of [ds("s1", "학생(스터디) DB"), ds("s2", "학생(스타트) DB"), ds("e1", "등록(스터디) DB")]) addSource(found, r)
	eq(found.get("학생(학원) DB"), ["s1", "s2"])
	eq(pickSources(found).get("학생(학원) DB"), ["s1", "s2"])
	eq(pickSources(found).get("등록(학원) DB"), ["e1"])
})

Deno.test("관 꼬리표: 메뉴 DB — 꼬리표 이름 하나면 고르고, 두 관이 같이 보이면 건너뛴다(Secret으로 정함)", () => {
	eq(pickMenuDataSourceId([ds("m1", "메뉴(스터디) DB")]), "m1")
	eq(pickMenuDataSourceId([ds("m1", "메뉴(학원) DB")]), "m1")
	eq(pickMenuDataSourceId([ds("m1", "메뉴(스터디) DB"), ds("m2", "메뉴(스타트) DB")]), null)
	eq(pickMenuDataSourceId([ds("m1", "메뉴(스터디) DB 사본")]), null)
})
