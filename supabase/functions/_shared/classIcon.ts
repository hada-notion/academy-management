// 클래스 색 -> 그 색 동그라미 PNG를 Notion 파일 업로드로 올려 클래스 페이지 아이콘으로 지정한다(앱 저장 뒤 한 번, 실패해도 저장 결과는 그대로).
import { NOTION_API } from "./constants.ts"
import { fetchWithRetry, notionHeaders } from "./notionClient.ts"
import { colorCirclePng, parseHex } from "./colorCirclePng.ts"

// 기본 10색(앱 appdata.js APP_CLS_HEX와 같음)
export const CLASS_COLOR_HEX: Record<string, string> = { 빨강: "E5484D", 주황: "F0A35E", 노랑: "E8C547", 초록: "5BBF8A", 파랑: "7FA6D9", 보라: "B794F6", 분홍: "E88FB5", 갈색: "B08D6E", 회색: "A3A3A3", 기본: "CFC8BE" }

// 저장한 클래스 값에서 색 hex(# 없이 대문자)를 뽑는다. 색 코드(기타)가 있으면 그것, 없으면 색 이름. 색을 건드리지 않았으면 null.
export function classIconHex(props: Record<string, unknown>): string | null {
	const code = String(props["색 코드"] ?? "").trim().replace(/^#/, "").toUpperCase()
	if (/^[0-9A-F]{6}$/.test(code)) return code
	const name = String(props["색"] ?? "").trim()
	return Object.prototype.hasOwnProperty.call(CLASS_COLOR_HEX, name) ? CLASS_COLOR_HEX[name] : null
}

async function ok(res: Response, what: string): Promise<Response> {
	if (!res.ok) throw new Error(`${what} 실패: ${res.status} ${(await res.text()).slice(0, 200)}`)
	return res
}

// 1) POST /file_uploads  2) POST /file_uploads/{id}/send(multipart)  3) PATCH /pages/{id} icon
export async function setClassColorIcon(pageId: string, hex: string): Promise<void> {
	const code = hex.replace(/^#/, "").toUpperCase()
	parseHex(code)
	const png = await colorCirclePng(code)
	const name = `class-color-${code}.png`
	const { "Content-Type": _json, ...bare } = notionHeaders()
	const created = await ok(await fetchWithRetry(`${NOTION_API}/file_uploads`, {
		method: "POST", headers: notionHeaders(), body: JSON.stringify({ mode: "single_part", filename: name, content_type: "image/png" }),
	}, 5, { retryAmbiguous: false }), "파일 업로드 만들기")
	const { id } = await created.json()
	const form = new FormData()
	form.append("file", new Blob([png], { type: "image/png" }), name)
	await ok(await fetchWithRetry(`${NOTION_API}/file_uploads/${id}/send`, { method: "POST", headers: bare, body: form }), "파일 보내기")
	await ok(await fetchWithRetry(`${NOTION_API}/pages/${pageId}`, {
		method: "PATCH", headers: notionHeaders(), body: JSON.stringify({ icon: { type: "file_upload", file_upload: { id } } }),
	}), "페이지 아이콘 지정")
}
