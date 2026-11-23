// 강사별 관리 앱 계정(강사계정 과제 261123) — 서버 공용.
// - 원장(관리자 비밀번호)은 그대로: adminSecurity.authorizeKey가 먼저 보고, 통과하면 원장이다.
// - 강사 세션은 hada_teacher_command(따로 둔 SQL 함수 · 표)에서만 확인한다. 원장 세션 표에는 강사 세션이 없으므로
//   requireAdminKey만 쓰는 경로(키오스크 · 법정 서류 · 예시 비우기 · 학사일정 가져오기 · 관리자 설정 등)는 강사 세션을 언제나 401로 막는다.
// - 강사 세션을 받는 경로는 TEACHER_ROUTES 넷뿐. 그 안에서도 재무 · 관리자 설정 · 강사 DB 쓰기는 편집허용과 상관없이 막는다(TEACHER_BLOCKED_*).
// - 메뉴 권한 = 노션 메뉴(학원) DB `편집허용`(사람 칸)에 그 강사의 `노션 계정`(강사 DB 사람 칸)이 든 메뉴. 한 곳(노션 메뉴관리)에서 정한다.
import { securityEnabled, securityRpc, SecurityError, sha256, authorizeKey, routeName } from "./adminSecurity.ts"
import { listApp } from "./appCopy.ts"

export const TEACHER_MENU_DB = "메뉴(학원) DB"
export const TEACHER_DB = "강사(학원) DB"
// 재무 · 결제 DB: 강사는 읽기 · 쓰기 모두 못 한다(편집허용과 상관없이).
export const TEACHER_BLOCKED_DBS = new Set([
	"수강료(학원) DB", "결제(학원) DB", "청구서(학원) DB", "청구 항목(학원) DB", "청구 결제(학원) DB", "기타경비(학원) DB",
])
// 강사가 쓸 수 없는 DB(읽기는 됨): 강사 DB(계정 아이디 = 연락처가 들어 있음).
export const TEACHER_NO_WRITE_DBS = new Set([TEACHER_DB, ...TEACHER_BLOCKED_DBS])
// 원장만 메뉴: 편집허용에 들어 있어도 강사에게 열지 않는다(화면과 서버 모두).
export const OWNER_ONLY_MENUS = new Set(["수강료", "청구서", "손익 분석", "결제 · 손익", "법정 서류", "관리자 설정", "메뉴관리"])
// 메뉴 → 그 메뉴 화면이 읽는 DB · 쓰는 DB. 강사 권한의 한 곳(담당 261123 결정): 서버가 이 표로 거르고,
// 앱은 로그인 때 app-api "me"로 이 표에서 계산한 readDbs를 받아 그 DB만 불러온다(앱에 따로 적지 않음).
// - read: 화면이 함께 쓰는 DB 전부(이름 · 관계 표시용 포함). 강사는 편집허용 메뉴들의 read 합만 읽는다.
// - write: 그 화면이 노션에 쓰는 DB(앱 저장 층 appsave.js 묶음 기준). read 안에 있어야 한다(시험이 확인).
// - 어느 메뉴에도 없는 DB와 재무 · 강사 DB 쓰기는 원장만. 메뉴(학원) DB는 누구나 읽음(메뉴 이름 · 노션 주소).
const R = (...n: string[]) => n.map((x) => `${x}(학원) DB`)
const LESSON_READ = R("클래스", "시간표", "시즌", "등록", "학생", "강사", "진도관리", "라이브러리", "루틴", "과목", "영역", "학교", "학년")
export const MENU_DBS: Record<string, { read: string[]; write: string[] }> = {
	"홈": { read: R("시즌", "클래스", "시간표", "등록", "학생", "강사", "일정"), write: [] },
	"일정": { read: R("일정", "시즌", "학교", "학년", "클래스"), write: R("일정", "시즌") },
	"직원": { read: R("강사", "근무", "클래스", "시간표", "시즌"), write: [] },
	"수업": { read: LESSON_READ, write: R("루틴") },
	"보강": { read: LESSON_READ, write: [] },
	"학습기록": { read: LESSON_READ, write: [] },
	"학생": { read: R("학생", "등록", "클래스", "시간표", "시즌", "학교", "학년", "강사", "시험", "시험정보", "성적"), write: R("학생") },
	"학교": { read: R("학교", "학년", "일정", "학생"), write: R("학교", "학년") },
	"시험": { read: R("시험", "시험정보", "성적", "학생", "학교", "학년", "과목", "영역", "등록", "클래스"), write: R("시험", "시험정보", "성적") },
	"클래스": { read: R("클래스", "시간표", "시즌", "등록", "학생", "강사", "진도관리", "라이브러리", "루틴", "과목", "영역", "학교", "학년"), write: R("클래스", "루틴", "진도관리") },
	"등록": { read: R("등록", "학생", "클래스", "시간표", "시즌", "진도관리", "라이브러리", "과목", "영역", "학교", "학년", "강사"), write: R("등록", "학생", "진도관리") },
	"시간표": { read: R("시간표", "클래스", "시즌", "등록", "학생", "강사", "과목", "영역"), write: R("시간표", "시즌") },
	"과목": { read: R("과목", "영역", "라이브러리", "학년"), write: R("과목", "영역") },
	"라이브러리": { read: R("라이브러리", "과목", "영역", "학년"), write: R("라이브러리") },
	"진도": { read: R("진도관리", "라이브러리", "클래스", "학생", "등록", "과목", "영역", "강사"), write: R("진도관리") },
	"정기 보고서": { read: R("보고서", "클래스", "학생", "등록", "진도관리", "알림톡 발송함"), write: [] },
	"수료 보고서": { read: R("보고서", "클래스", "학생", "등록", "진도관리", "알림톡 발송함"), write: [] },
	"가정통신문": { read: R("가정통신문", "클래스", "일정"), write: [] },
	"자료실": { read: R("자료"), write: [] },
	"알림톡 설정": { read: R("알림톡 설정"), write: [] },
}
export const ALWAYS_READ_DBS = new Set([TEACHER_MENU_DB])
export function teacherReadDbs(menus: string[]): Set<string> {
	const out = new Set<string>(ALWAYS_READ_DBS)
	for (const m of menus) for (const db of MENU_DBS[m]?.read ?? []) if (!TEACHER_BLOCKED_DBS.has(db)) out.add(db)
	return out
}
// 강사 세션을 받는 경로와 그 경로에 필요한 메뉴(하나라도 있으면 됨). app-api는 안에서 동작마다 거른다.
export const TEACHER_ROUTES: Record<string, string[] | null> = {
	"app-api": null,
	"class-room": ["수업", "보강", "학습기록"],
	"textbook-api": ["라이브러리"],
	"school-api": ["학교"],
}

export type Access =
	| { role: "owner" }
	| { role: "teacher"; teacherId: string; name: string; notionUsers: string[]; menus: string[] }

export async function teacherRpc(action: string, data: Record<string, unknown> = {}): Promise<any> {
	const base = Deno.env.get("SB_URL"), key = Deno.env.get("SB_SERVICE_ROLE_KEY")
	if (!base || !key) throw new SecurityError(503, "관리자 인증 서버 설정이 필요합니다.")
	const res = await fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/hada_teacher_command`, {
		method: "POST", headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
		body: JSON.stringify({ p_action: action, p_data: data }), signal: AbortSignal.timeout(15000),
	})
	if (!res.ok) {
		console.error("hada_teacher_command failed", action, res.status, (await res.text().catch(() => "")).slice(0, 300))
		throw new SecurityError(503, "강사 계정 저장소에 연결하지 못했습니다. 업데이트(마이그레이션)가 적용됐는지 확인해 주세요.")
	}
	const result = await res.json()
	if (!result || typeof result !== "object" || Array.isArray(result)) throw new SecurityError(503, "강사 계정 응답 형식이 올바르지 않습니다.")
	if (result.error) throw new SecurityError(result.status ?? 400, result.error)
	return result
}

// 010-1234-5678 · 010 1234 5678 · +82 10-1234-5678 → 01012345678. 휴대폰 번호 꼴(01x + 7~8자리)이 아니면 "".
export function normalizePhone(raw: unknown): string {
	let d = String(raw ?? "").replace(/[^0-9+]/g, "")
	if (d.startsWith("+82")) d = "0" + d.slice(3)
	d = d.replace(/\D/g, "")
	return /^01[016789][0-9]{7,8}$/.test(d) ? d : ""
}

// 메뉴 줄(app_rows) → 이 강사가 열 수 있는 메뉴 이름. 이름 = `이름` 칸, 끝의 관 꼬리표("등록(스터디)")는 뗀다.
export function teacherMenus(menuRows: { props?: Record<string, unknown> }[], notionUsers: string[]): string[] {
	const mine = new Set(notionUsers.filter(Boolean))
	if (!mine.size) return []
	const out = new Set<string>()
	for (const r of menuRows) {
		const p = r.props ?? {}
		const allow = Array.isArray(p["편집허용"]) ? (p["편집허용"] as unknown[]).map(String) : []
		if (!allow.some((u) => mine.has(u))) continue
		const name = String(p["이름"] ?? "").trim().replace(/\s*\([^()]*\)\s*$/, "")
		if (name && !OWNER_ONLY_MENUS.has(name)) out.add(name)
	}
	return [...out]
}
export function teacherWriteDbs(menus: string[]): Set<string> {
	const out = new Set<string>()
	for (const m of menus) for (const db of MENU_DBS[m]?.write ?? []) if (!TEACHER_NO_WRITE_DBS.has(db)) out.add(db)
	return out
}
// 강사가 읽는 강사 DB 줄: 다른 강사의 연락처(= 그 강사의 아이디 · 첫 비밀번호)는 지운다. 자기 줄은 그대로.
export function maskTeacherRows<T extends { id?: unknown; props?: Record<string, unknown> }>(rows: T[], teacherId: string): T[] {
	const self = teacherId.replace(/-/g, "")
	return rows.map((r) => String(r.id ?? "").replace(/-/g, "") === self ? r : { ...r, props: { ...(r.props ?? {}), "연락처": "" } })
}

export async function teacherSession(provided: string): Promise<Access | null> {
	if (!/^[0-9a-f]{64}$/.test(provided)) return null
	let s: any
	try { s = await teacherRpc("session", { session_hash: await sha256(provided) }) } catch (e) {
		if (e instanceof SecurityError && e.status < 500) return null
		throw e
	}
	if (s?.kind !== "teacher" || s.must_change) return null // 첫 비밀번호 상태 = 비밀번호 바꾸기(admin-security) 밖은 모두 거절
	const notionUsers = Array.isArray(s.notion_users) ? s.notion_users.map(String) : []
	const menus = teacherMenus(await listApp(TEACHER_MENU_DB as any), notionUsers)
	return { role: "teacher", teacherId: String(s.teacher_id), name: String(s.name ?? ""), notionUsers, menus }
}

const deny = (status: number, error: string, cors: Record<string, string>) =>
	new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } })
// 원장 먼저(그대로), 아니면 이 경로가 강사를 받는 경로일 때만 강사 세션을 본다.
export async function requireAccess(req: Request, cors: Record<string, string>, legacyKey = ""): Promise<Access | Response> {
	const provided = req.headers.get("x-admin-key") ?? ""
	if (await authorizeKey(req, provided, legacyKey)) return { role: "owner" }
	const route = routeName(req)
	if (securityEnabled() && route in TEACHER_ROUTES) {
		const t = await teacherSession(provided).catch((e) => { console.error("[teacherAccess]", (e as Error).message); return null })
		if (t && t.role === "teacher") {
			const need = TEACHER_ROUTES[route]
			if (need && !need.some((m) => t.menus.includes(m))) return deny(403, "이 메뉴 권한이 없어요 — 원장에게 메뉴 권한을 요청하세요.", cors)
			return t
		}
	}
	return deny(401, "인증 실패", cors)
}

// app-api 동작마다 강사 거름. 거절이면 [status, 말], 통과면 null. 원장은 부르지 않는다.
export function teacherAppDeny(t: Extract<Access, { role: "teacher" }>, body: any): [number, string] | null {
	const a = body?.action
	const fin = "재무 · 결제는 원장만 볼 수 있어요."
	const read = teacherReadDbs(t.menus)
	const noMenu = (db: string) => `${String(db).replace(/\(학원\) DB$/, "")} 메뉴 권한이 없어요 — 원장에게 메뉴 권한을 요청하세요.`
	if (a === "me" || a === "status" || a === "options" || a === "changes") return null // 응답을 읽기 DB로 거른다(app-api)
	if (a === "list") return TEACHER_BLOCKED_DBS.has(body.db) ? [403, fin] : read.has(body.db) ? null : [403, noMenu(body.db)]
	if (a === "admin-status") return [403, "관리자 설정은 원장만 볼 수 있어요."]
	if (a === "record-payment") return [403, fin]
	if (a === "end-preview") return t.menus.includes("등록") ? null : [403, "등록 메뉴 권한이 없어요 — 원장에게 메뉴 권한을 요청하세요."]
	if (a === "run") {
		if (body.name === "sync-copy") {
			if (!Array.isArray(body.dbs)) return null // dbs 없이 = app-api가 읽기 DB로 채움
			const bad = body.dbs.find((d: string) => !read.has(d))
			return bad ? [403, TEACHER_BLOCKED_DBS.has(bad) ? fin : noMenu(bad)] : null
		}
		if (body.name === "generate-classes") return t.menus.some((m) => m === "수업" || m === "시간표") ? null : [403, "수업 생성 권한이 없어요 — 원장에게 메뉴 권한을 요청하세요."]
		return null
	}
	if (a === "save") {
		const ok = teacherWriteDbs(t.menus)
		const list = Array.isArray(body.changes) ? body.changes : []
		for (const c of list) {
			const db = String(c?.db ?? "")
			if (TEACHER_BLOCKED_DBS.has(db)) return [403, fin]
			if (db === TEACHER_DB) return [403, "강사 정보는 원장만 고칠 수 있어요."]
			if (!ok.has(db)) return [403, noMenu(db)]
		}
		return null
	}
	return null
}
