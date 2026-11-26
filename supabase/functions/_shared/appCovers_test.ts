// appCovers 단위 시험(v2.8.0 항목 157): 라이브러리 북커버(올린 파일) 지금 주소 채우기.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { freshBookCovers } from "./appCovers.ts"

const page = (url: string) => ({ properties: { "북커버": { files: [{ name: "c", file: { url } }] } } })
const row = (id: string, files: unknown[]) => ({ id, props: { "교재명": id, "북커버": files as { name: string; url: string }[] } })

Deno.test("올린 파일 표지는 지금 주소로 채우고 외부 주소·표지 없음은 건드리지 않는다", async () => {
	const asked: string[] = []
	const rows = [
		row("up", [{ name: "c", url: "", file: true }]),
		row("old", [{ name: "c", url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/x.png?X-Amz-Expires=3600" }]),
		row("ext", [{ name: "c", url: "https://contents.kyobobook.co.kr/x.jpg" }]),
		row("none", []),
	]
	const out = await freshBookCovers(rows, "라이브러리(학원) DB", (id) => { asked.push(id); return Promise.resolve(page("https://fresh/" + id)) })
	assertEquals(asked.sort(), ["old", "up"])
	assertEquals(out[0].props["북커버"][0].url, "https://fresh/up")
	assertEquals(out[1].props["북커버"][0].url, "https://fresh/old")
	assertEquals(out[2], rows[2])
	assertEquals(out[3], rows[3])
})

Deno.test("다른 DB는 노션을 부르지 않고, db를 안 주면 줄의 db로 보고, 읽기 실패는 빈 주소", async () => {
	let n = 0
	const f = () => { n++; return Promise.reject(new Error("x")) }
	const r = { ...row("a", [{ name: "c", url: "", file: true }]), db: "학생(학원) DB" }
	assertEquals((await freshBookCovers([r], "학생(학원) DB", f))[0], r)
	assertEquals((await freshBookCovers([r], undefined, f))[0], r)
	assertEquals(n, 0)
	const l = { ...r, db: "라이브러리(학원) DB" }
	assertEquals((await freshBookCovers([l], undefined, f))[0].props["북커버"][0].url, "")
	assertEquals(n, 1)
})
