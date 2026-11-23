// _shared/bookSources.ts
//
// 라이브러리 교재 정보 출처. 알라딘 OpenAPI가 2026-10-30에 종료되어(v2.5.120) 국립중앙도서관 하나를 쓴다.
//   - 국립중앙도서관 ISBN 서지정보 API: 국내에서 ISBN을 받은 책. 제목·발행처·총서명·쪽수·정가·표지·(일부)목차.
//     키: NL_CERT_KEY(관리 앱 [관리자 설정]에서 넣은 값 먼저, 없으면 함수 Secret — _shared/externalKeys.ts). https://www.nl.go.kr/seoji/SearchApi.do
//   - 국립중앙도서관에 없는 책(수입 원서 등)은 교보문고 주소 가져오기 · 직접 등록으로 넣는다(카카오 책 검색은 v2.8.0 항목 113에서 뺌).
// 키는 학원마다 따로 받는다(원본 키를 나눠 쓰지 않음). 키 값은 로그·응답에 쓰지 않는다.
// 같은 ISBN13은 하나로 합친다.

import { externalKey } from "./externalKeys.ts"

export class BookSourceError extends Error {
	constructor(public status: number, message: string) { super(message) }
}

export const isIsbn13 = (v: unknown): v is string => typeof v === "string" && /^97[89]\d{10}$/.test(v)
export type Book = {
	isbn13: string; title: string; author: string; publisher: string; pubDate: string; price: number | null
	series: string; pages: number | null; altCover: string; toc: string; sources: string[]
}

const digits = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return n > 0 ? n : null }
// 표지 주소는 https만(화면·Notion에서 섞인 콘텐츠로 막히지 않게). http면 https로 바꿔 쓴다.
const httpsUrl = (v: unknown) => { const s = String(v ?? "").trim(); return /^https?:\/\/[^\s]+$/i.test(s) ? s.replace(/^http:/i, "https:") : "" }
const ymd = (v: unknown) => { const s = String(v ?? "").replace(/[^\d]/g, ""); return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "" }

async function getJson(url: string, init: RequestInit, who: string): Promise<any> {
	let res: Response
	try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) }
	catch { throw new BookSourceError(502, `${who}에 연결하지 못했습니다. 잠시 후 다시 시도하세요.`) }
	if (!res.ok) throw new BookSourceError(502, `${who} 응답 오류(${res.status})`)
	try { return await res.json() } catch { throw new BookSourceError(502, `${who} 응답을 읽지 못했습니다.`) }
}

// ---------- 국립중앙도서관 ----------
const NL = "https://www.nl.go.kr/seoji/SearchApi.do"
export function nlBook(d: any): Book | null {
	const isbn13 = String(d?.EA_ISBN ?? "").replace(/[^\d]/g, "")
	if (!isIsbn13(isbn13)) return null
	const vol = String(d.VOL ?? "").trim()
	return {
		isbn13,
		title: [String(d.TITLE ?? "").trim(), vol].filter(Boolean).join(" "),
		author: String(d.AUTHOR ?? "").trim(),
		publisher: String(d.PUBLISHER ?? "").trim(),
		pubDate: ymd(d.PUBLISH_PREDATE),
		price: digits(d.PRE_PRICE) ?? digits(d.REAL_PRICE),
		series: String(d.SERIES_TITLE ?? "").trim(),
		pages: digits(d.PAGE),
		altCover: httpsUrl(d.TITLE_URL),
		toc: String(d.BOOK_TB_CNT ?? "").trim(),
		sources: ["국립중앙도서관"],
	}
}
async function nlSearch(params: Record<string, string>): Promise<Book[]> {
	const key = await externalKey("NL_CERT_KEY")
	if (!key) return []
	const q = new URLSearchParams({ cert_key: key, result_style: "json", page_no: "1", page_size: "20", ...params })
	const data = await getJson(`${NL}?${q}`, {}, "국립중앙도서관")
	if (data?.ERR_CODE || data?.RESULT === "ERROR") throw new BookSourceError(502, `국립중앙도서관 오류: ${String(data.ERR_MESSAGE ?? data.ERR_CODE ?? "").slice(0, 120)}`)
	return ((data?.docs ?? []) as any[]).map(nlBook).filter(Boolean) as Book[]
}

// ---------- 합치기 ----------
export function mergeBooks(lists: Book[][]): Book[] {
	const out = new Map<string, Book>()
	for (const b of lists.flat()) {
		const a = out.get(b.isbn13)
		if (!a) { out.set(b.isbn13, { ...b }); continue }
		for (const k of ["title", "author", "publisher", "pubDate", "series", "altCover", "toc"] as const) if (!a[k] && b[k]) a[k] = b[k]
		if (a.price == null) a.price = b.price
		if (a.pages == null) a.pages = b.pages
		a.sources = [...new Set([...a.sources, ...b.sources])]
	}
	return [...out.values()]
}
async function requireKey() {
	if (!(await externalKey("NL_CERT_KEY")))
		throw new BookSourceError(503, "책 검색 키가 없습니다. 관리 앱 [관리자 설정] > 외부 키에 국립중앙도서관 키(NL_CERT_KEY)를 붙여 넣어 주세요(Supabase Secrets에 넣어도 됩니다).")
}
export async function searchTitle(query: string): Promise<Book[]> {
	await requireKey()
	return mergeBooks([await nlSearch({ title: query })])
}
export async function lookupIsbn(isbn13: string): Promise<Book | null> {
	await requireKey()
	return mergeBooks([await nlSearch({ isbn: isbn13 })]).find((b) => b.isbn13 === isbn13) ?? null
}
