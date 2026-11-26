// 채운 사람 모양 PNG(256x256, 투명 배경) — 등록 페이지 아이콘용. Feather `user`(MIT)를 24 뷰박스에서 채운 모양:
//   머리 = 원 중심 (12,7) 반지름 5(원래 반지름 4 + 선 두께 2의 절반),
//   몸 = x 3~21, y 14~22 둥근 사각형(위 모서리 반지름 5, 아래 반지름 1).
// 거리 함수로 그리고 가장자리 1픽셀 안팎만 부드럽게 한다.
import { encodePng, parseHex } from "./colorCirclePng.ts"

export const USER_ICON_SIZE = 256
const K = USER_ICON_SIZE / 24 // 24 -> 256 비례

// 부호 있는 거리(바깥이 +): 원
const sdCircle = (px: number, py: number, cx: number, cy: number, r: number) => Math.hypot(px - cx, py - cy) - r
// 모서리마다 반지름이 다른(위 · 아래) 둥근 사각형
function sdRoundBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, rTop: number, rBottom: number) {
	const r = py < cy ? rTop : rBottom
	const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r)
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

export async function userIconPng(hex: string): Promise<Uint8Array> {
	const [r, g, b] = parseHex(hex), S = USER_ICON_SIZE
	const rgba = new Uint8Array(S * S * 4)
	for (let y = 0; y < S; y++) {
		for (let x = 0; x < S; x++) {
			const px = x + 0.5, py = y + 0.5
			const d = Math.min(
				sdCircle(px, py, 12 * K, 7 * K, 5 * K),
				sdRoundBox(px, py, 12 * K, 18 * K, 9 * K, 4 * K, 5 * K, 1 * K),
			)
			const a = Math.max(0, Math.min(1, 0.5 - d))
			rgba.set([r, g, b, Math.round(a * 255)], (y * S + x) * 4)
		}
	}
	return await encodePng(S, rgba)
}
