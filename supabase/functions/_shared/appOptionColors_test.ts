// appOptionColors 단위 시험(v2.8.0 항목 166): 노션 스키마 → 선택지 색표, 10분 기억 · fresh, 실패 시 빈 표.
// Notion은 가짜(손잡이 바꿔 끼우기). 실제 키 · 데이터 없음.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { schemaColors, optionColors, clearOptionColorsCache, OPTION_COLORS_TTL_MS } = await import("./appOptionColors.ts")
const { optionColorMap } = await import("./appSave.ts")

const LIB_SCHEMA = {
	교재명: { type: "title" },
	"교재 유형": { type: "multi_select", options: ["독해", "내신"], colors: { 독해: "green", 내신: "orange" } },
	출판사: { type: "select", options: ["예시출판"], colors: { 예시출판: "red" } },
	진행: { type: "status", options: ["완료"], colors: { 완료: "green" } },
	가격: { type: "number" },
	"웹훅 정보": { type: "select", options: ["x"], colors: { x: "blue" } }, // 비공개 칸은 빠짐
	빈칸: { type: "select", options: [], colors: {} },
}

Deno.test("옵션 목록 → 색: 색이 없으면 default, 이름 없는 것은 뺌", () => {
	assertEquals(optionColorMap([{ name: "독해", color: "green" }, { name: "내신" }, { color: "red" }, { name: "" }]), { 독해: "green", 내신: "default" })
})

Deno.test("스키마 → 색표: 고르기 · 여러 개 고르기 · 상태만, 비공개 · 빈 칸 제외", () => {
	assertEquals(schemaColors(LIB_SCHEMA as any), { "교재 유형": { 독해: "green", 내신: "orange" }, 출판사: { 예시출판: "red" }, 진행: { 완료: "green" } })
})

function fakeDeps(state: { now: number; reads: string[]; fail?: Set<string>; srcFail?: boolean }) {
	return {
		sources: async () => {
			if (state.srcFail) throw new Error("검색 실패")
			return new Map<any, string[]>([["라이브러리(학원) DB", ["ds-lib"]], ["강사(학원) DB", ["ds-t"]]])
		},
		schema: async (ds: string, fresh: boolean) => {
			state.reads.push(ds + (fresh ? "!" : ""))
			if (state.fail?.has(ds)) throw new Error("읽기 실패")
			return (ds === "ds-lib" ? LIB_SCHEMA : { 직책: { type: "select", options: ["강사"], colors: { 강사: "blue" } } }) as any
		},
		now: () => state.now,
	}
}

Deno.test("DB마다 색표, 10분 기억 · 지나면 다시 · fresh면 바로 다시", async () => {
	clearOptionColorsCache()
	const st = { now: 1_000, reads: [] as string[] }
	const a = await optionColors(false, fakeDeps(st))
	assertEquals(a["라이브러리(학원) DB"]["교재 유형"], { 독해: "green", 내신: "orange" })
	assertEquals(a["강사(학원) DB"], { 직책: { 강사: "blue" } })
	assertEquals(st.reads.sort(), ["ds-lib", "ds-t"])
	st.now += OPTION_COLORS_TTL_MS - 1
	await optionColors(false, fakeDeps(st))
	assertEquals(st.reads.length, 2) // 기억
	await optionColors(true, fakeDeps(st))
	assertEquals(st.reads.slice(2).sort(), ["ds-lib!", "ds-t!"]) // [동기화]: 스키마 캐시도 건너뜀
	st.now += OPTION_COLORS_TTL_MS + 1
	await optionColors(false, fakeDeps(st))
	assertEquals(st.reads.length, 6)
})

Deno.test("한 DB 실패면 그 DB만 빠지고 기억하지 않음, 소스 찾기 실패면 빈 표", async () => {
	clearOptionColorsCache()
	const st = { now: 5_000, reads: [] as string[], fail: new Set(["ds-t"]) }
	const a = await optionColors(false, fakeDeps(st))
	assertEquals(Object.keys(a), ["라이브러리(학원) DB"])
	await optionColors(false, fakeDeps(st))
	assertEquals(st.reads.length, 4) // 실패가 있었으니 다시 읽음
	clearOptionColorsCache()
	assertEquals(await optionColors(false, fakeDeps({ now: 0, reads: [], srcFail: true })), {})
})
