// 색 동그라미 PNG · 클래스 아이콘 업로드 단위 시험. Notion은 모두 가짜 응답.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
for (const [k, v] of Object.entries({ NOTION_TOKEN: "test-only", SB_URL: "https://mock.supabase", SB_SERVICE_ROLE_KEY: "test-only" })) Deno.env.set(k, v)
const { colorCirclePng, crc32 } = await import("./colorCirclePng.ts")
const { classIconHex, setClassColorIcon } = await import("./classIcon.ts")

async function decode(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset)
  const w = v.getUint32(16), h = v.getUint32(20)
  let at = 8
  const idat: Uint8Array[] = []
  while (at < png.length) {
    const len = v.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    assertEquals(v.getUint32(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len))) // 청크마다 CRC 맞음
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer())
  const px = (x: number, y: number) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)]
  return { w, h, px }
}

Deno.test("PNG: 시그니처 · 256x256 · 가운데 = 입력색 · 모서리 투명", async () => {
  const png = await colorCirclePng("#E5484D")
  assertEquals([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const d = await decode(png)
  assertEquals([d.w, d.h], [256, 256])
  assertEquals(d.px(128, 128), [0xE5, 0x48, 0x4D, 255])
  assertEquals(d.px(0, 0)[3], 0)
  assertEquals(d.px(255, 255)[3], 0)
  assertEquals(d.px(128, 128 - 111)[3], 255) // 반지름 안쪽
  assertEquals(d.px(128, 128 - 114)[3], 0) // 반지름 바깥
})

Deno.test("classIconHex: 색 코드 우선, 10색 이름, 색 안 건드림 -> null", () => {
  assertEquals(classIconHex({ 색: "빨강", "색 코드": "" }), "E5484D")
  assertEquals(classIconHex({ 색: "파랑", "색 코드": "#12ab34" }), "12AB34")
  assertEquals(classIconHex({ "색 코드": "ff00aa" }), "FF00AA")
  assertEquals(classIconHex({ 클래스명: "예시" }), null)
  assertEquals(classIconHex({ 색: "없는색" }), null)
})

Deno.test("업로드 3단계: file_uploads -> send(multipart) -> 페이지 icon, 순서 · 본문", async () => {
  const seen: { url: string; method: string; body: unknown; ct: string | null }[] = []
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input), h = new Headers(init?.headers)
    seen.push({ url, method: init?.method ?? "GET", body: init?.body, ct: h.get("Content-Type") })
    return new Response(JSON.stringify({ id: "up-1" }), { status: 200, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  await setClassColorIcon("page-1", "#5BBF8A")
  assertEquals(seen.map((s) => [s.method, s.url.replace(/^.*\/v1/, "")]), [["POST", "/file_uploads"], ["POST", "/file_uploads/up-1/send"], ["PATCH", "/pages/page-1"]])
  assertEquals(JSON.parse(seen[0].body as string), { mode: "single_part", filename: "class-color-5BBF8A.png", content_type: "image/png" })
  const form = seen[1].body as FormData
  assertEquals(seen[1].ct, null) // multipart 경계는 fetch가 붙임
  const f = form.get("file") as File
  assertEquals([f.name, f.type], ["class-color-5BBF8A.png", "image/png"])
  assertEquals((await decode(new Uint8Array(await f.arrayBuffer()))).px(128, 128), [0x5B, 0xBF, 0x8A, 255])
  assertEquals(JSON.parse(seen[2].body as string), { icon: { type: "file_upload", file_upload: { id: "up-1" } } })
})
