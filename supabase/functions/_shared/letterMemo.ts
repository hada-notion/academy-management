// _shared/letterMemo.ts
//
// (v2.8.0 항목 148) 가정통신문 "그 달 발송함 하나 → 학생당 한 장"의 페이지 기억(표 letter_month_pages).
// 노션 조회가 방금 만든 페이지를 늦게 잡아 같은 달 발송함·같은 학생 장이 둘 생기는 것을 막는다.
// 표를 쓸 수 없으면(Secret 없음·일시 장애) null을 돌려주고 호출하는 쪽은 노션 조회로 이어 간다.
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"

export type MemoKind = "box" | "student" | "late"

const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
const headers = () => ({ apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json" })
const enc = encodeURIComponent

export const letterMemo = {
	async get(month: string, kind: MemoKind, key = ""): Promise<string | null> {
		if (!SB_URL() || !SB_KEY()) return null
		try {
			const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/letter_month_pages?select=page_id&month=eq.${enc(month)}&kind=eq.${kind}&key=eq.${enc(key)}`, { headers: headers() })
			if (!res.ok) return null
			const rows = await res.json()
			return rows?.[0]?.page_id ?? null
		} catch {
			return null
		}
	},
	// 적는다. replace면 이미 있는 줄(지운 페이지를 가리키던 것)을 바꾼다.
	async put(month: string, kind: MemoKind, key: string, pageId: string, replace = false): Promise<void> {
		if (!SB_URL() || !SB_KEY()) return
		try {
			const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/letter_month_pages?on_conflict=month,kind,key`, {
				method: "POST",
				headers: { ...headers(), Prefer: `resolution=${replace ? "merge" : "ignore"}-duplicates,return=minimal` },
				body: JSON.stringify({ month, kind, key, page_id: pageId }),
			})
			if (!res.ok) console.warn("[letterMemo] 적기 실패:", res.status, await res.text())
		} catch (err) {
			console.warn("[letterMemo] 적기 실패:", (err as Error).message)
		}
	},
	async count(month: string, kind: MemoKind): Promise<number> {
		if (!SB_URL() || !SB_KEY()) return 0
		try {
			const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/letter_month_pages?select=key&month=eq.${enc(month)}&kind=eq.${kind}`, { headers: headers() })
			if (!res.ok) return 0
			return ((await res.json()) ?? []).length
		} catch {
			return 0
		}
	},
}
