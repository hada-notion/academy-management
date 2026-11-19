// (v2.8.0 항목 100) 429 대기 상한: 상한보다 긴 Retry-After는 기다리지 않고 429를 돌려주고, 상한 안이면 기다려 다시 보낸다. 네트워크 없음.
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { fetchWithRetry } = await import("./notionClient.ts")
const assert = (v: unknown, m = "assertion failed") => { if (!v) throw new Error(m) }

async function withFetch(replies: Response[], run: (calls: () => number) => Promise<void>) {
	const saved = globalThis.fetch
	let n = 0
	globalThis.fetch = (() => Promise.resolve(replies[Math.min(n++, replies.length - 1)].clone())) as typeof fetch
	try { await run(() => n) } finally { globalThis.fetch = saved }
}
const r429 = (sec: number) => new Response("{}", { status: 429, headers: { "Retry-After": String(sec) } })

Deno.test("429 대기 상한: Retry-After 51초는 상한 15초보다 길어 기다리지 않고 429를 바로 돌려줌(한 번만 보냄)", () =>
	withFetch([r429(51), new Response("{}", { status: 200 })], async (calls) => {
		const t0 = Date.now()
		const res = await fetchWithRetry("https://api.notion.com/v1/search", {}, 5, { maxWaitMs: 15_000 })
		assert(res.status === 429 && calls() === 1, "returned the 429 at once: " + calls())
		assert(Date.now() - t0 < 1000, "did not wait")
	}))

Deno.test("429 대기 상한: 상한 안(Retry-After 0초)이면 기다려 다시 보내고 성공", () =>
	withFetch([r429(0), new Response("{}", { status: 200 })], async (calls) => {
		const res = await fetchWithRetry("https://api.notion.com/v1/search", {}, 5, { maxWaitMs: 15_000 })
		assert(res.status === 200 && calls() === 2)
	}))

Deno.test("상한을 안 주면 전과 같다: 429를 기다려 다시 보냄(저장 본 경로·큐 작업 그대로)", () =>
	withFetch([r429(0), new Response("{}", { status: 200 })], async (calls) => {
		const res = await fetchWithRetry("https://api.notion.com/v1/pages", {})
		assert(res.status === 200 && calls() === 2)
	}))
