// 색 동그라미 PNG(256x256, 투명 배경, 반지름 112) — 클래스 페이지 아이콘용. 외부 라이브러리 없이 Deno 내장(CompressionStream)만 쓴다.
export const CIRCLE_SIZE = 256
export const CIRCLE_RADIUS = 112

const CRC_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
	return t
})()
export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

export function parseHex(hex: string): [number, number, number] {
	const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim())
	if (!m) throw new Error("색 코드는 RRGGBB 여섯 자리여야 해요.")
	const n = parseInt(m[1], 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"))
	return new Uint8Array(await new Response(stream).arrayBuffer())
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer)
	v.setUint32(0, data.length)
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
	out.set(data, 8)
	v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
	return out
}

// RGBA 픽셀(S*S*4바이트)을 8비트 RGBA PNG로 인코딩한다. 색 동그라미·사람 모양 아이콘이 함께 쓴다.
export async function encodePng(S: number, rgba: Uint8Array): Promise<Uint8Array> {
	const raw = new Uint8Array((S * 4 + 1) * S) // 줄마다 필터 바이트 0 + RGBA
	for (let y = 0; y < S; y++) raw.set(rgba.subarray(y * S * 4, (y + 1) * S * 4), y * (S * 4 + 1) + 1)
	const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer)
	v.setUint32(0, S); v.setUint32(4, S); ihdr[8] = 8; ihdr[9] = 6 // 8비트 RGBA
	const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await zlib(raw)), chunk("IEND", new Uint8Array())]
	const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let at = 0
	for (const p of parts) { png.set(p, at); at += p.length }
	return png
}

export async function colorCirclePng(hex: string): Promise<Uint8Array> {
	const [r, g, b] = parseHex(hex), S = CIRCLE_SIZE, c = (S - 1) / 2
	const rgba = new Uint8Array(S * S * 4)
	for (let y = 0; y < S; y++) {
		for (let x = 0; x < S; x++) {
			const a = Math.max(0, Math.min(1, CIRCLE_RADIUS + 0.5 - Math.hypot(x - c, y - c))) // 가장자리 1픽셀 부드럽게
			rgba.set([r, g, b, Math.round(a * 255)], (y * S + x) * 4)
		}
	}
	return await encodePng(S, rgba)
}
