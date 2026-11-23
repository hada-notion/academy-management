// 관리 앱 열린 화면 자동 갱신(261123) — app-api { action: "changes", since, dbs }.
// 앱이 Realtime 신호(DB 이름 · 줄 수만, 마이그레이션 20261123050000)를 받거나 60초 따라잡기 때 부른다.
// since 뒤에 사본에 쓰인 줄(app_rows.synced_at)과 사본에서 지운 줄(app_row_gone)을 돌려준다. 노션은 부르지 않는다.
//   - 시계가 함수마다 조금 다를 수 있어 since보다 OVERLAP_MS 앞부터 읽는다(앱이 같은 값은 건너뜀 — 겹쳐 읽어도 화면은 그대로).
//   - 줄이 LIMIT보다 많으면 many: true만 돌려준다 → 앱이 전체를 다시 받는다(대량 편집 · 처음 채우기).
//   - crAt = 수업 사본(cr_*)이 마지막으로 바뀐 시각(앱 수업 화면이 신호를 놓쳤을 때 다시 받을지 정함).
import { fetchSupabaseWithRetry } from "./reportCacheShared.ts"
import { isAppDb } from "./appCopy.ts"

export const CHANGES_OVERLAP_MS = 15_000
export const CHANGES_LIMIT = 500
const CR_TABLES = ["cr_sessions", "cr_attendance", "cr_records", "cr_activities"] as const

const SB_URL = () => Deno.env.get("SB_URL") ?? ""
const SB_KEY = () => Deno.env.get("SB_SERVICE_ROLE_KEY") ?? ""
function sbHeaders(): Record<string, string> {
	if (!SB_URL() || !SB_KEY()) throw new Error("SB_URL / SB_SERVICE_ROLE_KEY Secrets가 설정되어 있지 않습니다.")
	return { apikey: SB_KEY(), Authorization: `Bearer ${SB_KEY()}`, "Content-Type": "application/json" }
}

export class ChangesInputError extends Error {}

// 입력 확인(시험용으로 따로): since = ISO 또는 null, dbs = 앱 DB 이름 1~40개.
export function checkChangesInput(body: any): { since: string | null; dbs: string[] } {
	const since = body?.since ?? null
	if (since !== null && (typeof since !== "string" || since.length > 40 || Number.isNaN(Date.parse(since)))) throw new ChangesInputError("since 형식이 올바르지 않습니다.")
	const dbs = body?.dbs
	if (!Array.isArray(dbs) || !dbs.length || dbs.length > 40 || !dbs.every(isAppDb)) throw new ChangesInputError("dbs는 앱 DB 이름 목록(1~40개)이어야 합니다.")
	return { since, dbs: [...new Set(dbs as string[])] }
}

// PostgREST in.(…) 값: 큰따옴표로 감싸고 안의 따옴표 · 역슬래시를 막는다(DB 이름에 괄호 · 공백이 있다).
export const inList = (vals: string[]) => `(${vals.map((v) => `"${v.replace(/["\\]/g, (c) => "\\" + c)}"`).join(",")})`
export const fromIso = (since: string) => new Date(Date.parse(since) - CHANGES_OVERLAP_MS).toISOString()

export type ChangesResult = { ok: true; now: string; rows: Record<string, unknown>[]; gone: { id: string; db: string }[]; crAt: string | null; many?: true }

async function getJson(path: string): Promise<any[]> {
	const res = await fetchSupabaseWithRetry(`${SB_URL()}/rest/v1/${path}`, { headers: sbHeaders() })
	if (!res.ok) throw new Error(`사본 읽기 실패: ${res.status} ${await res.text()}`)
	return await res.json()
}

async function crLatest(): Promise<string | null> {
	const tops = await Promise.all(CR_TABLES.map((t) => getJson(`${t}?select=synced_at&order=synced_at.desc&limit=1`).catch(() => [])))
	const at = tops.map((r) => r[0]?.synced_at).filter(Boolean).sort()
	return at.length ? at[at.length - 1] : null
}

export async function appChanges(since: string | null, dbs: string[]): Promise<ChangesResult> {
	const now = new Date().toISOString()
	const crAt = await crLatest()
	if (!since) return { ok: true, now, rows: [], gone: [], crAt } // 처음 = 기준 시각만
	const from = encodeURIComponent(fromIso(since)), dbIn = encodeURIComponent(inList(dbs))
	const [rows, gone] = await Promise.all([
		getJson(`app_rows?select=id,db,props,notion_created_at,notion_edited_at,url,icon,synced_at&db=in.${dbIn}&synced_at=gt.${from}&order=synced_at&limit=${CHANGES_LIMIT + 1}`),
		getJson(`app_row_gone?select=id,db&db=in.${dbIn}&at=gt.${from}&order=at&limit=${CHANGES_LIMIT + 1}`),
	])
	if (rows.length > CHANGES_LIMIT || gone.length > CHANGES_LIMIT) return { ok: true, now, rows: [], gone: [], crAt, many: true }
	return { ok: true, now, rows, gone, crAt }
}
