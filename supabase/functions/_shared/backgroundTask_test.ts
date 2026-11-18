// (v2.8.0 항목 95) 웹훅은 바로 202, 기다리라고 하면 결과까지. 네트워크 없음.
import { respondNowOrAwait } from "./backgroundTask.ts"
const assert = (v: unknown, m = "assertion failed") => { if (!v) throw new Error(m) }

Deno.test("respondNowOrAwait: 기다리지 않으면 일이 끝나기 전에 202, 일은 뒤에서 끝까지", async () => {
	const bg: Promise<unknown>[] = []
	;(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { bg.push(p) } }
	let release!: () => void, done = false
	const gate = new Promise<void>((r) => { release = r })
	try {
		const res = await respondNowOrAwait(false, async () => { await gate; done = true; return { synced: 57 } }, "test:", { pageId: "p1" })
		assert(res.status === 202 && !done, "answered before the work finished")
		const body = await res.json()
		assert(body.accepted === true && body.pageId === "p1")
		release(); await Promise.all(bg)
		assert(done, "work finished in the background")
	} finally { delete (globalThis as any).EdgeRuntime }
})

Deno.test("respondNowOrAwait: 기다리면 결과를 200으로, 실패는 위로 던진다", async () => {
	const res = await respondNowOrAwait(true, async () => ({ synced: 3, registrationIds: ["a", "b", "c"] }), "test:", {}, { "X-Test": "1" })
	assert(res.status === 200 && res.headers.get("X-Test") === "1")
	assert((await res.json()).synced === 3)
	let threw = false
	try { await respondNowOrAwait(true, async () => { throw new Error("boom") }, "test:") } catch { threw = true }
	assert(threw, "wait mode surfaces the error to the caller (500 path)")
})

Deno.test("respondNowOrAwait: 뒤 일이 실패해도 202 응답은 그대로(로그만)", async () => {
	const bg: Promise<unknown>[] = []
	;(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { bg.push(p) } }
	try {
		const res = await respondNowOrAwait(false, async () => { throw new Error("boom") }, "test:")
		assert(res.status === 202)
		await Promise.all(bg) // runInBackground가 잡아 로그로 남김(던지지 않음)
	} finally { delete (globalThis as any).EdgeRuntime }
})
