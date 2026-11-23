import { assertEquals, assertRejects } from "jsr:@std/assert@1"
import { endBasis, endNote, endRegistration, EndPartialError, isTargetSession, kstDateOf, previewEnd, type EndDeps } from "./registrationEnd.ts"

const REG = "aaaaaaaa-0000-0000-0000-000000000001"
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002"
const reg = (end: string | null, tt: string[] = ["tt1"]) => ({
	id: REG,
	properties: {
		"종료일": { type: "date", date: end ? { start: end } : null },
		"시간표": { type: "relation", relation: tt.map((id) => ({ id })) },
	},
})
const session = (id: string, start: string, kind = "정규", regs = [REG.replace(/-/g, ""), OTHER]) => ({
	id,
	properties: {
		"수업일시": { type: "date", date: { start } },
		"수업 구분": { type: "select", select: kind ? { name: kind } : null },
		"등록": { type: "relation", relation: regs.map((r) => ({ id: r })) },
	},
})

function fakeDeps(sessions: any[], opts: { failPatch?: Set<string>; today?: string } = {}) {
	const patches: [string, Record<string, unknown>][] = []
	const deps: EndDeps = {
		today: () => opts.today ?? "2026-11-23",
		sessionsFrom: async () => sessions,
		relationAll: async (p, prop) => (p.properties[prop]?.relation ?? []).map((r: any) => r.id),
		patch: async (id, props) => {
			if (opts.failPatch?.has(id)) throw new Error("Notion 500")
			patches.push([id, props])
			// 고친 수업은 가짜 자료에도 반영(두 번째 요청 시험)
			const s = sessions.find((x) => x.id === id)
			if (s && props["등록"]) s.properties["등록"] = props["등록"]
		},
		log: () => {},
	}
	return { deps, patches }
}

Deno.test("kstDateOf: 날짜만 · 시각 있음(한국 시간으로)", () => {
	assertEquals(kstDateOf("2026-11-30"), "2026-11-30")
	assertEquals(kstDateOf("2026-11-30T15:30:00.000Z"), "2026-12-01") // 한국 12/1 00:30
	assertEquals(kstDateOf("2026-11-30T23:00:00.000+09:00"), "2026-11-30")
	assertEquals(kstDateOf(null), "")
})

Deno.test("종료기준: 종료일, 비면 오늘", () => {
	assertEquals(endBasis(reg("2026-11-30"), "2026-11-23"), "2026-11-30")
	assertEquals(endBasis(reg(null), "2026-11-23"), "2026-11-23")
})

Deno.test("대상수업: 종료기준 다음 날부터 · 보강 빼고 · 당일은 그대로", () => {
	const basis = "2026-11-30"
	assertEquals(isTargetSession(session("a", "2026-11-30T19:00:00.000+09:00"), basis), false) // 종료일 당일 수업은 남김
	assertEquals(isTargetSession(session("b", "2026-12-01T00:00:00.000+09:00"), basis), true)
	assertEquals(isTargetSession(session("c", "2026-12-03T19:00:00.000+09:00", "보강"), basis), false)
	assertEquals(isTargetSession(session("d", "2026-12-03T19:00:00.000+09:00", ""), basis), true) // 구분 비면 정규
	assertEquals(isTargetSession(session("e", "2026-11-20T19:00:00.000+09:00"), basis), false) // 지난 수업
})

Deno.test("종료 처리: 등록 종료일 · 시간표 먼저, 앞으로 수업만 명단에서 빼고 출석 조정 ⚪ 대기", async () => {
	const ss = [
		session("past", "2026-11-28T19:00:00.000+09:00"),
		session("day", "2026-11-30T19:00:00.000+09:00"),
		session("f1", "2026-12-02T19:00:00.000+09:00"),
		session("mk", "2026-12-03T19:00:00.000+09:00", "보강"),
		session("f2", "2026-12-04T19:00:00.000+09:00"),
	]
	const { deps, patches } = fakeDeps(ss)
	const r = await endRegistration(reg(null), { ...deps, today: () => "2026-11-30" })
	assertEquals(r.basis, "2026-11-30")
	assertEquals(r.removed, ["f1", "f2"])
	assertEquals(patches[0], [REG, { "종료일": { date: { start: "2026-11-30" } }, "시간표": { relation: [] } }])
	assertEquals(patches.slice(1).map((p) => p[0]), ["f1", "f2"])
	assertEquals(patches[1][1], { "등록": { relation: [{ id: OTHER }] }, "출석 조정 상태": { select: { name: "⚪ 대기" } } })
	assertEquals(endNote(r, { unlinked: [1], deleted: [] }), "종료일 2026-11-30 · 앞으로 수업 2개에서 뺌 · 시작 안 한 교재 1개 정리")
})

Deno.test("두 번 눌러도 한 번: 두 번째는 아무것도 쓰지 않음(노션 버튼이 먼저 한 경우도 같음)", async () => {
	const ss = [session("f1", "2026-12-02T19:00:00.000+09:00")]
	const { deps, patches } = fakeDeps(ss)
	await endRegistration(reg("2026-11-30"), deps)
	const n = patches.length
	const r2 = await endRegistration(reg("2026-11-30", []), deps)
	assertEquals(patches.length, n)
	assertEquals(r2.removed, [])
	assertEquals(r2.registrationUpdated, false)
	assertEquals(endNote(r2), "종료일 2026-11-30 · 뺄 앞으로 수업 없음")
})

Deno.test("일부 실패: 오류로 알리고(고친 수 · 못 고친 수), 다시 누르면 남은 것만", async () => {
	const ss = [session("f1", "2026-12-02T19:00:00.000+09:00"), session("f2", "2026-12-04T19:00:00.000+09:00")]
	const fail = new Set(["f2"])
	const { deps, patches } = fakeDeps(ss, { failPatch: fail })
	const err = await assertRejects(() => endRegistration(reg("2026-11-30"), deps), EndPartialError)
	assertEquals((err as EndPartialError).result.failed, ["f2"])
	assertEquals((err as EndPartialError).message.includes("2개 중 1개"), true)
	fail.clear()
	const r = await endRegistration(reg("2026-11-30", []), deps)
	assertEquals(r.removed, ["f2"])
	assertEquals(patches.filter((p) => p[0] === "f1").length, 1)
})

Deno.test("다른 날짜 종료일: 종료일을 그대로 두고 그 다음 날부터", async () => {
	const ss = [session("a", "2026-12-10T19:00:00.000+09:00"), session("b", "2026-12-16T19:00:00.000+09:00")]
	const { deps, patches } = fakeDeps(ss)
	const r = await endRegistration(reg("2026-12-15", []), deps)
	assertEquals(r.removed, ["b"])
	assertEquals(r.registrationUpdated, false)
	assertEquals(patches.length, 1)
})

Deno.test("미리보기: 고른 종료일 기준으로 빠질 수업 날짜(쓰기 없음) — 실제 처리와 같은 거름", async () => {
	const ss = [session("a", "2026-12-10T19:00:00.000+09:00"), session("mk", "2026-12-11T19:00:00.000+09:00", "보강"), session("b", "2026-12-16T19:00:00.000+09:00")]
	const { deps, patches } = fakeDeps(ss)
	assertEquals(await previewEnd(reg(null), deps, "2026-12-09"), { basis: "2026-12-09", dates: ["2026-12-10", "2026-12-16"] })
	assertEquals(await previewEnd(reg("2026-12-12"), deps), { basis: "2026-12-12", dates: ["2026-12-16"] })
	assertEquals(await previewEnd(reg(null), deps, "잘못"), { basis: "2026-11-23", dates: ["2026-12-10", "2026-12-16"] })
	assertEquals(patches.length, 0)
	const r = await endRegistration(reg("2026-12-09"), deps)
	assertEquals(r.removed, ["a", "b"])
})
