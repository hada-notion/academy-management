// _shared/externalKeys.ts — 외부 키 읽기 한 곳(v2.8.0, 261123 키 자동 등록).
//
// 학원이 받은 외부 키(나이스 NEIS_API_KEY · 국립중앙도서관 NL_CERT_KEY — 카카오는 v2.8.0 항목 113에서 뺌)는
//   1) 관리 앱 [관리자 설정]에서 넣은 값(Supabase Vault, SQL hada_external_key 'read') 먼저,
//   2) 없으면 지금처럼 함수 Secret(환경 변수).
// 키를 쓰는 코드는 모두 externalKey()로 읽는다. 값은 로그 · 응답 · 오류 글에 쓰지 않는다.
// 잠깐 캐시: 같은 함수 인스턴스 안에서 CACHE_MS(5초) 동안만 다시 쓴다 — 한 요청 안에서 두 번 읽지 않게.
//   저장 직후 다른 함수의 다음 요청(5초 뒤)부터 새 키. 저장 · 지우기를 받은 admin-security는 바로 비운다(forgetExternalKeys).
// Vault를 읽지 못하면(서버 설정 없음 · 연결 실패 · 이 판 마이그레이션 전) 조용히 Secret으로 간다(기존 학원 그대로 동작).

export const EXTERNAL_KEYS = ["NEIS_API_KEY", "NL_CERT_KEY"] as const
export type ExternalKeyName = typeof EXTERNAL_KEYS[number]
export const isExternalKeyName = (v: unknown): v is ExternalKeyName => typeof v === "string" && (EXTERNAL_KEYS as readonly string[]).includes(v)

export const CACHE_MS = 5000
let cache: { at: number; keys: Record<string, string> } | null = null
let pending: Promise<Record<string, string>> | null = null
let generation = 0 // 저장 · 삭제 뒤 비우면 올라간다 — 그 전에 시작한 읽기 결과는 캐시에 넣지 않는다

export function forgetExternalKeys(): void { cache = null; pending = null; generation++ }

// SQL hada_external_key(서비스 역할 전용)를 부른다. 실패 글에는 요청 · 응답 값을 넣지 않는다.
export async function externalKeyRpc(action: string, data: Record<string, unknown> = {}): Promise<any> {
	const base = Deno.env.get("SB_URL"), key = Deno.env.get("SB_SERVICE_ROLE_KEY")
	if (!base || !key) throw new Error("external key store not configured")
	const res = await fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/hada_external_key`, {
		method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
		body: JSON.stringify({ p_action: action, p_data: data }), signal: AbortSignal.timeout(8000),
	})
	if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`external key store ${action} failed ${res.status}`) }
	const result = await res.json()
	if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("external key store bad response")
	if (result.error) { const e = new Error(String(result.error)) as Error & { status?: number }; e.status = Number(result.status) || 400; throw e }
	return result
}

async function vaultKeys(): Promise<Record<string, string>> {
	if (!Deno.env.get("SB_URL") || !Deno.env.get("SB_SERVICE_ROLE_KEY")) return {}
	try {
		const r = await externalKeyRpc("read")
		const out: Record<string, string> = {}
		for (const n of EXTERNAL_KEYS) { const v = r.keys?.[n]; if (typeof v === "string" && v) out[n] = v }
		return out
	} catch (e) {
		// 값이 없는 글만(상태 코드 · 동작 이름). 표가 아직 없는 서버(마이그레이션 전)도 여기로 와서 Secret을 쓴다.
		console.warn("[externalKeys] Vault 키를 읽지 못해 함수 Secret을 씁니다:", (e as Error)?.message?.slice(0, 80))
		return {}
	}
}

// 키 하나: Vault 먼저, 없으면 함수 Secret, 둘 다 없으면 "".
export async function externalKey(name: ExternalKeyName): Promise<string> {
	const now = Date.now()
	if (!cache || now - cache.at > CACHE_MS) {
		const gen = generation
		if (!pending) { const p: Promise<Record<string, string>> = vaultKeys().finally(() => { if (pending === p) pending = null }); pending = p }
		const keys = await pending
		if (gen !== generation) return externalKey(name) // 읽는 사이 저장 · 삭제가 있었으면 다시 읽는다
		cache = { at: Date.now(), keys }
		return keys[name] || Deno.env.get(name) || ""
	}
	return cache.keys[name] || Deno.env.get(name) || ""
}

// 어디서 오는 키인지(값 없이): 'app'(관리 앱에서 넣음) · 'secret'(함수 Secret) · ''(없음).
export async function externalKeySource(name: ExternalKeyName): Promise<"app" | "secret" | ""> {
	await externalKey(name)
	if (cache?.keys[name]) return "app"
	return Deno.env.get(name) ? "secret" : ""
}
