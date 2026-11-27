// _shared/appOptionColors.ts
//
// (v2.8.0 항목 166, 대표 261127) 관리 앱 선택지 칩 색 = 노션 옵션 색이 원본.
// 앱이 읽는 DB(APP_DBS)마다 데이터 소스 스키마를 읽어 고르기 · 여러 개 고르기 · 상태 칸의 { 선택지 이름: 노션 색 }을 돌려준다.
//   { "<DB 이름>": { "<칸 이름>": { "<선택지>": "<color>" } } }
// - 스키마는 자주 안 바뀌니 함수 메모리에 10분(DB 스키마 캐시 dataSourceSchema도 10분). 앱 [동기화] 때는 fresh로 다시 읽는다.
// - 한 DB를 못 읽으면 그 DB만 빠지고 그 결과는 기억하지 않는다. 소스 찾기부터 실패하면 빈 표 {} — 앱은 고정표(NCOL)로 그린다.
// - 행 값(select.color)은 사본(flattenProps)이 이름만 저장하므로 쓰지 않는다 — 같은 색이 스키마에 있다.

import { APP_DBS, appSources, SKIP_PROPS, type AppDb } from "./appCopy.ts"
import { dataSourceSchema, OPTIONS_CONCURRENCY, type Schema } from "./appSave.ts"
import { mapWithConcurrency } from "./notionClient.ts"

export type OptionColors = Record<string, Record<string, Record<string, string>>>
const COLOR_TYPES = new Set(["select", "multi_select", "status"])

// 스키마 하나 → { 칸 이름: { 선택지: 색 } }(색 있는 고르기 칸만, 비공개 칸 제외)
export function schemaColors(schema: Schema): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {}
	for (const [name, def] of Object.entries(schema ?? {})) {
		if (!def || !COLOR_TYPES.has(def.type) || SKIP_PROPS.has(name)) continue
		if (def.colors && Object.keys(def.colors).length) out[name] = { ...def.colors }
	}
	return out
}

export type OptionColorDeps = {
	sources: () => Promise<Map<AppDb, string[]>>
	schema: (ds: string, fresh: boolean) => Promise<Schema>
	now: () => number
}
const DEFAULT_DEPS: OptionColorDeps = { sources: appSources, schema: dataSourceSchema, now: () => Date.now() }

export const OPTION_COLORS_TTL_MS = 10 * 60 * 1000
let cache: { at: number; value: OptionColors } | null = null
export function clearOptionColorsCache() { cache = null }

export async function optionColors(fresh = false, deps: Partial<OptionColorDeps> = {}): Promise<OptionColors> {
	const D = { ...DEFAULT_DEPS, ...deps }
	if (!fresh && cache && D.now() - cache.at < OPTION_COLORS_TTL_MS) return cache.value
	let sources: Map<AppDb, string[]>
	try { sources = await D.sources() } catch (err) {
		console.error("[option-colors] 소스 찾기 실패:", (err as Error).message)
		return cache?.value ?? {}
	}
	const targets = APP_DBS.flatMap((db) => { const ds = (sources.get(db) ?? [])[0]; return ds ? [{ db, ds }] : [] })
	const got = await mapWithConcurrency(targets, OPTIONS_CONCURRENCY, async (t) => {
		try { return schemaColors(await D.schema(t.ds, fresh)) } catch (err) {
			console.error(`[option-colors] ${t.db} 스키마 읽기 실패:`, (err as Error).message)
			return null
		}
	})
	const value: OptionColors = {}
	targets.forEach((t, i) => { const c = got[i]; if (c && Object.keys(c).length) value[t.db] = c })
	// 하나라도 못 읽었으면 기억하지 않는다(다음 부름에 다시) — 빈 표가 10분 붙어 있지 않게
	if (got.every((c) => c !== null)) cache = { at: D.now(), value }
	return value
}
