// 사람 모양 PNG · 여러 페이지 아이콘 붙이기(재사용 실패 시 다시 올림) 단위 시험. Notion은 모두 가짜 응답.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { colorCirclePng, crc32 } = await import("./colorCirclePng.ts")
const { userIconPng } = await import("./userIconPng.ts")
const { setColorIcon, setColorIconMany } = await import("./classIcon.ts")

async function decode(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset)
  const w = v.getUint32(16), h = v.getUint32(20)
  let at = 8
  const idat: Uint8Array[] = []
  while (at < png.length) {
    const len = v.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    assertEquals(v.getUint32(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)))
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer())
  const px = (x: number, y: number) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)]
  return { w, h, px }
}

Deno.test("사람 모양 PNG: 256x256 · 모서리 투명 · 머리·몸 가운데 색 · 머리와 몸 사이 투명", async () => {
  const d = await decode(await userIconPng("#7FA6D9"))
  assertEquals([d.w, d.h], [256, 256])
  assertEquals(d.px(0, 0)[3], 0)
  assertEquals(d.px(255, 255)[3], 0)
  assertEquals(d.px(128, 75), [0x7F, 0xA6, 0xD9, 255]) // 머리 가운데(12,7 -> 128,75)
  assertEquals(d.px(128, 192), [0x7F, 0xA6, 0xD9, 255]) // 몸 가운데(12,18)
  assertEquals(d.px(128, 140)[3], 0) // 머리 아래(~y128)와 몸 위(~y149) 사이
  assertEquals(d.px(128, 5)[3], 0) // 머리 위
  assertEquals(d.px(10, 192)[3], 0) // 몸 왼쪽 바깥(x < 3*10.67)
  assertEquals(d.px(40, 192)[3], 255) // 몸 안쪽
  assertEquals(d.px(34, 152)[3], 0) // 몸 위 왼쪽 모서리는 둥글게 비어 있음
  assertEquals((await decode(await colorCirclePng("#7FA6D9"))).px(128, 140)[3], 255) // 동그라미는 그대로(꽉 참)
})

type Call = { url: string; method: string; body: unknown }
function fakeNotion(failAttachOf: Set<string> = new Set()) {
  const calls: Call[] = []
  let n = 0
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET"
    calls.push({ url, method, body: init?.body })
    if (url.endsWith("/file_uploads") && method === "POST") return new Response(JSON.stringify({ id: `up-${++n}` }), { status: 200 })
    if (method === "PATCH") {
      const id = JSON.parse(init!.body as string).icon.file_upload.id
      if (failAttachOf.has(id)) return new Response("already used", { status: 400 })
    }
    return new Response("{}", { status: 200 })
  }) as typeof fetch
  return calls
}
const path = (c: Call) => `${c.method} ${c.url.replace(/^.*\/v1/, "")}`

Deno.test("setColorIcon user: 파일 이름 reg-color-HEX.png", async () => {
  const calls = fakeNotion()
  await setColorIcon("p1", "#5BBF8A", "user")
  assertEquals(JSON.parse(calls[0].body as string).filename, "reg-color-5BBF8A.png")
})

Deno.test("여러 페이지: 업로드 한 번, 같은 file_upload id를 붙인다", async () => {
  const calls = fakeNotion()
  const r = await setColorIconMany(["a", "b", "c"], "5BBF8A", "user")
  assertEquals(r, { done: 3, failed: [] })
  assertEquals(calls.map(path), ["POST /file_uploads", "POST /file_uploads/up-1/send", "PATCH /pages/a", "PATCH /pages/b", "PATCH /pages/c"])
})

Deno.test("재사용이 막혀 PATCH가 실패하면 그 페이지만 다시 올려 붙인다", async () => {
  const calls = fakeNotion(new Set(["up-1"])) // 처음 올린 id는 붙이기 실패
  const r = await setColorIconMany(["a", "b"], "5BBF8A", "user")
  assertEquals(r, { done: 2, failed: [] })
  const patches = calls.filter((c) => c.method === "PATCH").map((c) => [c.url.replace(/^.*\/pages\//, ""), JSON.parse(c.body as string).icon.file_upload.id])
  // a: up-1 실패 -> 새로 올린 up-2 / b: 같은 up-1을 다시 시도하지 않고 새로 올린 up-3
  assertEquals(patches, [["a", "up-1"], ["a", "up-2"], ["b", "up-3"]])
})

Deno.test("다시 올려도 실패하면 그 페이지만 실패로 세고 나머지는 계속", async () => {
  const calls = fakeNotion(new Set(["up-1", "up-2"]))
  const r = await setColorIconMany(["a", "b"], "5BBF8A", "user")
  assertEquals(r, { done: 1, failed: ["a"] })
  assertEquals(calls.some((c) => path(c) === "PATCH /pages/b"), true)
})
