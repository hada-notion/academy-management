// _shared/externalKeyCheck.ts — 외부 키 연결 확인(v2.8.0, 261123 키 자동 등록).
//
// 키 저장 뒤 · 관리자 설정을 열 때(10분 안 결과는 다시 씀 — admin-security) 그 키로 가벼운 시험 호출 한 번: 'ok'(연결됨) · 'wrong'(키가 틀림) · 'unknown'(확인 못 함 — 연결 실패 · 시간 초과 · 모르는 응답).
//   나이스: 학교 기본정보 1건(키가 틀리면 RESULT.CODE "ERROR-290").
//   국립중앙도서관: ISBN 한 권(키가 틀리면 RESULT "ERROR" + ERR_CODE "010"·"011").
// 상대 서버의 오류 글은 어디에도 옮기지 않는다.
// 나이스 · 도서관은 주소에 키가 들어가므로 fetch 오류 글(주소가 들어갈 수 있음)도 쓰지 않는다.

import type { ExternalKeyName } from "./externalKeys.ts"

export type KeyTest = "ok" | "wrong" | "unknown"
const SAMPLE_ISBN = "9788932473901" // 시험용 책 한 권(어느 키로도 같은 결과 — 값은 결과에 쓰지 않음)

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
	const text = await res.text().catch(() => "")
	let body: any = null
	try { body = JSON.parse(text) } catch { /* 모르는 응답 */ }
	return { status: res.status, body }
}

export async function testExternalKey(name: ExternalKeyName, key: string): Promise<KeyTest> {
	if (!key) return "unknown"
	try {
		if (name === "NEIS_API_KEY") {
			const q = new URLSearchParams({ KEY: key, Type: "json", pIndex: "1", pSize: "1" })
			const { body } = await getJson(`https://open.neis.go.kr/hub/schoolInfo?${q}`)
			const code = body?.RESULT?.CODE
			if (code === "ERROR-290") return "wrong"
			const head = Array.isArray(body?.schoolInfo) ? body.schoolInfo.find((x: any) => x.head)?.head : null
			if (Array.isArray(head) && head.find((x: any) => x.RESULT)?.RESULT?.CODE === "INFO-000") return "ok"
			return "unknown"
		}
		if (name === "NL_CERT_KEY") {
			const q = new URLSearchParams({ cert_key: key, result_style: "json", page_no: "1", page_size: "1", isbn: SAMPLE_ISBN })
			const { status, body } = await getJson(`https://www.nl.go.kr/seoji/SearchApi.do?${q}`)
			if (status !== 200 || !body) return "unknown"
			if (body.RESULT === "ERROR" || body.ERR_CODE) return ["010", "011"].includes(String(body.ERR_CODE)) ? "wrong" : "unknown"
			return Array.isArray(body.docs) ? "ok" : "unknown"
		}
	} catch (e) {
		console.warn("[externalKeyCheck] 연결 확인 실패:", name, (e as Error)?.name ?? "error")
	}
	return "unknown"
}
