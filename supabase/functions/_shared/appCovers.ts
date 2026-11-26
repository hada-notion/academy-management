// _shared/appCovers.ts
// 관리 앱 라이브러리 교재의 북커버(v2.8.0 항목 157). Notion에 올린 표지 파일 주소는 약 1시간 뒤 만료되므로
// 사본(app_rows)에는 저장하지 않고(appCopy.flatValue: 올린 파일은 url "" + file: true), 앱이 읽을 때 Notion에서 지금 주소를 받아 채운다.
// 옛 사본에는 만료된 주소가 그대로 남아 있을 수 있어 Notion 호스팅 주소(S3 · notion)도 같은 방식으로 다시 받는다.
import { getPage, mapWithConcurrency } from "./notionClient.ts"

export const LIBRARY_DB = "라이브러리(학원) DB"
const COVER_PROP = "북커버"
type CoverFile = { name?: string; url?: string; file?: boolean }
// deno-lint-ignore no-explicit-any
type AppRow = Record<string, any>

const hosted = (f: CoverFile | undefined) => !!f && (f.file === true || /amazonaws\.com|notion\.so|notion-static\.com/i.test(String(f.url ?? "")))

// db를 주면 그 DB의 줄만, 안 주면 줄마다 r.db로 본다(changes).
export async function freshBookCovers<T extends AppRow>(
	rows: T[],
	db?: string,
	// deno-lint-ignore no-explicit-any
	fetchPage: (id: string) => Promise<any> = getPage,
): Promise<T[]> {
	const need = rows.filter((r) => (db ?? r?.db) === LIBRARY_DB && hosted(r?.props?.[COVER_PROP]?.[0]))
	if (!need.length) return rows
	const urls = new Map<string, string>()
	await mapWithConcurrency(need, 4, async (r: T) => {
		try {
			const f = (await fetchPage(String(r.id))).properties?.[COVER_PROP]?.files?.[0]
			urls.set(String(r.id), String(f?.file?.url ?? f?.external?.url ?? ""))
		} catch { urls.set(String(r.id), "") }
	})
	return rows.map((r) => urls.has(String(r.id)) ? { ...r, props: { ...r.props, [COVER_PROP]: [{ name: r.props[COVER_PROP][0]?.name ?? "", url: urls.get(String(r.id)) }] } } : r)
}
