import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { appChanges, checkChangesInput, ChangesInputError, CHANGES_LIMIT, fromIso, inList } from "./appChanges.ts"

Deno.test("changes 입력: since ISO|null, dbs는 앱 DB만", () => {
	assertEquals(checkChangesInput({ since: null, dbs: ["학생(학원) DB", "학생(학원) DB"] }), { since: null, dbs: ["학생(학원) DB"] })
	assertThrows(() => checkChangesInput({ since: "어제", dbs: ["학생(학원) DB"] }), ChangesInputError)
	assertThrows(() => checkChangesInput({ since: null, dbs: [] }), ChangesInputError)
	assertThrows(() => checkChangesInput({ since: null, dbs: ["수업(학원) DB"] }), ChangesInputError) // 수업은 cr_* 사본
	assertThrows(() => checkChangesInput({ since: null }), ChangesInputError)
})

Deno.test("in 목록은 따옴표로 감싸고 15초 겹쳐 읽는다", () => {
	assertEquals(inList(["학생(학원) DB", 'a"b']), '("학생(학원) DB","a\\"b")')
	assertEquals(fromIso("2026-11-23T03:00:15.000Z"), "2026-11-23T03:00:00.000Z")
})

function withFetch(fn: (url: string) => unknown[], body: () => Promise<void>) {
	const f0 = globalThis.fetch
	Deno.env.set("SB_URL", "https://example.test"); Deno.env.set("SB_SERVICE_ROLE_KEY", "test-only")
	const seen: string[] = []
	globalThis.fetch = ((u: string) => { seen.push(decodeURIComponent(String(u))); return Promise.resolve(new Response(JSON.stringify(fn(decodeURIComponent(String(u)))), { status: 200 })) }) as typeof fetch
	return body().finally(() => { globalThis.fetch = f0 }).then(() => seen)
}

Deno.test("changes: since 없으면 기준 시각만, 있으면 바뀐 줄 · 지운 줄 · 수업 사본 시각", async () => {
	let out: any
	const seen = await withFetch((u) => u.includes("cr_attendance") ? [{ synced_at: "2026-11-23T03:00:09Z" }] : u.includes("cr_") ? [{ synced_at: "2026-11-23T02:00:00Z" }] : [], async () => { out = await appChanges(null, ["학생(학원) DB"]) })
	assertEquals([out.rows, out.gone, out.crAt], [[], [], "2026-11-23T03:00:09Z"])
	assertEquals(seen.some((u) => u.includes("app_rows")), false)
	const seen2 = await withFetch((u) => u.includes("app_rows?") ? [{ id: "a", db: "학생(학원) DB", props: {} }] : u.includes("app_row_gone") ? [{ id: "b", db: "학생(학원) DB" }] : [], async () => { out = await appChanges("2026-11-23T03:00:15.000Z", ["학생(학원) DB"]) })
	assertEquals([out.rows.length, out.gone, out.many], [1, [{ id: "b", db: "학생(학원) DB" }], undefined])
	const q = seen2.find((u) => u.includes("app_rows?"))!
	assertEquals(q.includes('db=in.("학생(학원) DB")') && q.includes("synced_at=gt.2026-11-23T03:00:00.000Z"), true)
})

Deno.test("changes: 너무 많으면 many(앱이 전체 다시 받기)", async () => {
	let out: any
	await withFetch((u) => u.includes("app_rows?") ? Array.from({ length: CHANGES_LIMIT + 1 }, (_, i) => ({ id: String(i) })) : [], async () => { out = await appChanges("2026-11-23T03:00:15.000Z", ["학생(학원) DB"]) })
	assertEquals([out.many, out.rows.length], [true, 0])
})
