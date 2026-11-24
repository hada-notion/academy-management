// 강사별 관리 앱 계정(강사계정 261123) — 가짜 서버로 흐름 전체를 시험한다(네트워크 · 비밀값 없음).
// 원장 SQL(hada_security_command)과 강사 SQL(hada_teacher_command)은 작은 모형으로 대신한다. 실제 SQL은 tests/teacher-accounts-sql.cjs(PGlite)가
// 같은 경우(켜기 · 같은 번호 · 첫 로그인 · 바꾸기 · 강사별 잠김 · 되돌리기 · 끄기)를 시험한다.
// adminSecurity_test.ts가 이 파일을 불러와 CI(web-checks)에서 함께 돈다.
import { teacherLeft, kstToday, TEACHER_LEFT_MSG, normalizePhone, teacherMenus, teacherMenuAccess, teacherRouteDeny, teacherAppDeny, maskTeacherRows, requireAccess, teacherWriteDbs, teacherReadDbs, MENU_DBS, TEACHER_ROUTES, TEACHER_BLOCKED_DBS } from "./teacherAccess.ts"
import { sha256 } from "./adminSecurity.ts"
import { WRITE_DBS } from "./appSave.ts"
import { APP_DBS } from "./appCopy.ts"
function assert(v: unknown, m = "assertion failed") { if (!v) throw new Error(m) }
const eq = (a: unknown, b: unknown, m = "") => assert(JSON.stringify(a) === JSON.stringify(b), `${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

Deno.env.set("SB_URL", "https://mock.supabase.co"); Deno.env.set("SB_SERVICE_ROLE_KEY", "test-only-service"); Deno.env.set("NOTION_TOKEN", "test-only-notion")
Deno.env.set("ADMIN_SECRET", Deno.env.get("ADMIN_SECRET") ?? "test-only-webhook-key-0123456789abcdef")
const serve0 = Deno.serve; (Deno as any).serve = () => ({})
const { handleAdminSecurity } = await import("../admin-security/index.ts")
const { handleAppApi } = await import("../app-api/index.ts"); (Deno as any).serve = serve0

// ---------- 순수 규칙 ----------
Deno.test("teacher: 휴대폰 번호 맞추기 — 하이픈 · 공백 · +82는 같은 번호, 휴대폰 꼴이 아니면 빈 값", () => {
	eq(["010-1234-5678", "01012345678", "010 1234 5678", "+82 10-1234-5678", "011-123-4567"].map(normalizePhone), ["01012345678", "01012345678", "01012345678", "01012345678", "0111234567"])
	eq(["02-123-4567", "", null, "1234", "010-1234-56789"].map(normalizePhone), ["", "", "", "", ""])
})
const MENU_ROWS = [
	{ props: { "이름": "학생", "편집허용": ["u-a"], "댓글허용": ["u-d"] } }, { props: { "이름": "수업", "편집허용": ["u-a", "u-b"] } },
	{ props: { "이름": "등록(스터디)", "편집허용": ["u-a"] } }, { props: { "이름": "수강료", "편집허용": ["u-a"] } },
	{ props: { "이름": "관리자 설정", "편집허용": ["u-a"] } }, { props: { "이름": "일정", "편집허용": [] } }, { props: { "이름": "시험" } },
	{ props: { "이름": "과목", "편집허용": ["u-c"] } },
]
Deno.test("teacher: 메뉴 = 편집허용에 노션 계정이 든 메뉴만, 재무 · 관리자 설정은 들어 있어도 뺌, 노션 계정이 비면 빈 목록", () => {
	eq(teacherMenus(MENU_ROWS, ["u-a"]).sort(), ["등록", "수업", "학생"])
	eq(teacherMenus(MENU_ROWS, ["u-b"]), ["수업"])
	eq(teacherMenus(MENU_ROWS, []), []); eq(teacherMenus(MENU_ROWS, ["u-z"]), [])
})
Deno.test("teacher: 댓글허용만 = 보이는 메뉴 · 읽기만(편집 메뉴 아님), 편집허용 = 둘 다, 둘 다 있으면 편집", () => {
	eq(teacherMenuAccess(MENU_ROWS, ["u-d"]), { menus: ["학생"], editMenus: [] })
	eq(teacherMenuAccess(MENU_ROWS, ["u-a", "u-d"]).editMenus.sort(), ["등록", "수업", "학생"])
	const t = T(["학생"], [])
	eq(teacherAppDeny(t, { action: "list", db: "학생(학원) DB" }), null)
	eq(teacherAppDeny(t, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: "x", props: { "요청": "링크 재발급" } }] })?.[0], 403) // 단추 요청도 save
	eq(teacherAppDeny(t, { action: "run", name: "sync-copy" })?.[0], 403)
	eq(teacherAppDeny(t, { action: "run", name: "sync-copy", dbs: ["학생(학원) DB"] })?.[0], 403)
	eq(teacherAppDeny(T(["수업"], []), { action: "run", name: "generate-classes" })?.[0], 403)
	// 다른 경로: 읽기 동작만
	const c = T(["수업", "라이브러리", "학교"], [])
	eq(teacherRouteDeny(c, "class-room", { action: "day" }), null); eq(teacherRouteDeny(c, "class-room", { action: "roster" }), null)
	for (const a of ["save-attendance", "update-record", "create-records", "save-routines", "assign-makeup", "update-session", "create-routine-checks"]) eq(teacherRouteDeny(c, "class-room", { action: a })?.[0], 403, a)
	eq(teacherRouteDeny(c, "textbook-api", { action: "search" }), null); eq(teacherRouteDeny(c, "textbook-api", { action: "register" })?.[0], 403)
	eq(teacherRouteDeny(c, "school-api", { action: "search" }), null); eq(teacherRouteDeny(c, "school-api", { action: "link" })?.[0], 403)
	const e = T(["수업"], ["수업"]); eq(teacherRouteDeny(e, "class-room", { action: "save-attendance" }), null)
	eq(teacherRouteDeny({ role: "owner" }, "class-room", { action: "save-attendance" }), null)
})
Deno.test("teacher: 메뉴 → DB 표(한 곳) — 읽기 · 쓰기 DB는 앱 DB 이름, 쓰기는 읽기 안, 재무는 어느 메뉴에도 없음, 메뉴 DB는 늘 읽음", () => {
	for (const [m, { read, write }] of Object.entries(MENU_DBS)) {
		for (const db of [...read, ...write]) assert((APP_DBS as readonly string[]).includes(db), `${m}: ${db}`)
		for (const db of write) assert(read.includes(db), `${m}: 쓰기 ${db}가 읽기에 없음`)
		for (const db of read) assert(!TEACHER_BLOCKED_DBS.has(db), `${m}: 재무 ${db}`)
	}
	const r = teacherReadDbs(["과목"]); assert(r.has("메뉴(학원) DB") && r.has("과목(학원) DB") && !r.has("학생(학원) DB"))
	eq([...teacherReadDbs([])], ["메뉴(학원) DB"])
})
Deno.test("teacher: 쓰기 DB 표는 앱 쓰기 목록 안에만 있고, 재무 · 강사 DB는 어느 메뉴로도 못 씀", () => {
	const all = teacherWriteDbs(["일정", "학생", "학교", "시험", "클래스", "등록", "시간표", "과목", "라이브러리", "진도", "수업", "수강료", "직원"])
	for (const db of all) assert((WRITE_DBS as readonly string[]).includes(db), db)
	for (const db of [...TEACHER_BLOCKED_DBS, "강사(학원) DB"]) assert(!all.has(db), db)
	for (const db of TEACHER_BLOCKED_DBS) assert((APP_DBS as readonly string[]).includes(db), db) // 이름이 바뀌면 여기서 걸린다
})
const T = (menus: string[], editMenus: string[] = menus) => ({ role: "teacher" as const, teacherId: "a".repeat(32), name: "예시강사", notionUsers: ["u-a"], menus, editMenus })
Deno.test("teacher: app-api 동작 거름 — 재무 읽기 · 쓰기 · 결제 · 관리자 설정 · 강사 DB 쓰기 · 권한 없는 메뉴 쓰기는 거절", () => {
	const t = T(["학생", "수업"])
	for (const db of TEACHER_BLOCKED_DBS) {
		eq(teacherAppDeny(t, { action: "list", db })?.[0], 403, db)
		eq(teacherAppDeny(t, { action: "save", changes: [{ op: "update", db, id: "x", props: {} }] })?.[0], 403, db)
		eq(teacherAppDeny(t, { action: "run", name: "sync-copy", dbs: [db] })?.[0], 403, db)
	}
	eq(teacherAppDeny(t, { action: "record-payment" })?.[0], 403)
	eq(teacherAppDeny(t, { action: "admin-status" })?.[0], 403)
	eq(teacherAppDeny(t, { action: "save", changes: [{ op: "update", db: "강사(학원) DB", id: "x", props: {} }] })?.[0], 403)
	eq(teacherAppDeny(t, { action: "save", changes: [{ op: "create", db: "클래스(학원) DB", props: {} }] })?.[0], 403)
	eq(teacherAppDeny(t, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: "x", props: {} }, { op: "create", db: "등록(학원) DB", props: {} }] })?.[0], 403)
	eq(teacherAppDeny(t, { action: "end-preview", id: "x" })?.[0], 403)
	eq(teacherAppDeny(t, { action: "run", name: "generate-classes" }), null) // 수업 메뉴
	eq(teacherAppDeny(T(["학생"]), { action: "run", name: "generate-classes" })?.[0], 403)
	for (const b of [{ action: "me" }, { action: "status" }, { action: "options" }, { action: "changes" }, { action: "list", db: "학생(학원) DB" },
		{ action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: "x", props: {} }] }, { action: "run", name: "sync-copy" }]) eq(teacherAppDeny(t, b), null, JSON.stringify(b))
})
Deno.test("teacher: 강사 DB 줄은 다른 강사의 연락처(= 아이디 · 첫 비밀번호)를 지우고 자기 줄만 그대로", () => {
	const rows = [{ id: "a".repeat(32), props: { "이름": "A", "연락처": "010-1111-2222" } }, { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", props: { "이름": "B", "연락처": "010-3333-4444" } }]
	const out = maskTeacherRows(rows, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	eq(out.map((r) => r.props["연락처"]), ["010-1111-2222", ""]); eq(rows[1].props["연락처"], "010-3333-4444") // 원본은 그대로
})

// ---------- 가짜 서버 흐름 ----------
// 모형: 원장 세션 하나(OWNER), 강사 DB 두 줄(같은 번호 아님) + 같은 번호 두 줄, 메뉴 DB, 노션 계정.
const OWNER = "1".repeat(64), OWNER_HASH = await sha256(OWNER)
const TA = "a".repeat(32), TB = "b".repeat(32), TD1 = "d".repeat(32), TD2 = "e".repeat(32)
const TEACHER_ROWS = [
	{ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", props: { "이름": "예시강사A", "연락처": "010-1234-5678" } },
	{ id: TB, props: { "이름": "예시강사B", "연락처": "010 9999 8888" } },
	{ id: TD1, props: { "이름": "예시강사D1", "연락처": "010-5555-0000" } }, { id: TD2, props: { "이름": "예시강사D2", "연락처": "01055550000" } },
	{ id: "f".repeat(32), props: { "이름": "번호없음", "연락처": "" } },
	{ id: "9".repeat(32), props: { "이름": "예시강사G", "연락처": "010-7777-6666" } },
	{ id: "8".repeat(32), props: { "이름": "예시강사D", "연락처": "010-4444-3333" } },
]
const TG = "9".repeat(32)
const TDV = "8".repeat(32)
const NOTION_USERS: Record<string, string[]> = { [TA]: ["u-a"], [TB]: [], [TG]: ["u-c"], [TDV]: ["u-d"] }
const LEFT: Record<string, string> = {} // 노션 페이지 모형의 퇴사일(261124)
type Acc = { teacher_id: string; phone: string; name: string; password_hash: string; must_change: boolean; enabled: boolean; fails: number; locked: boolean; version: number }
function fakeServer() {
	const accounts = new Map<string, Acc>(), sessions = new Map<string, { teacher_id: string; version: number; users: string[] }>()
	const calls: string[] = []
	const ownerCmd = (a: string, d: any) => {
		if (a === "limit") return { ok: true }
		if (a === "authorize") return { kind: d.candidate === OWNER_HASH ? "session" : "none" }
		if (a === "status") return { initialized: true, password_set: true }
		if (a === "profile") return d.session_hash === OWNER_HASH ? { must_change: false, version: 2, changed_at: "2026-11-01T00:00:00Z", password_hash: "x" } : { error: "다시 로그인해 주세요.", status: 401 }
		// 실제 SQL처럼: 그 밖 동작은 원장 관리자 세션이 아니면 401
		if (d?.session_hash !== OWNER_HASH) return { error: "다시 로그인해 주세요.", status: 401 }
		return { error: "모형에 없는 원장 동작 " + a, status: 400 }
	}
	const teacherCmd = (a: string, d: any) => {
		const byPhone = (p: string) => [...accounts.values()].find((x) => x.phone === p)
		if (a === "list") return { accounts: [...accounts.values()].map((x) => ({ teacher_id: x.teacher_id, phone: x.phone, name: x.name, enabled: x.enabled, must_change: x.must_change, locked: x.locked })) }
		if (a === "enable") {
			const other = byPhone(d.phone); if (other && other.teacher_id !== d.teacher_id) return { error: "같은 번호", status: 409 }
			const x = accounts.get(d.teacher_id)
			if (!x) { accounts.set(d.teacher_id, { teacher_id: d.teacher_id, phone: d.phone, name: d.name, password_hash: d.password_hash, must_change: true, enabled: true, fails: 0, locked: false, version: 1 }); return { ok: true, created: true } }
			x.enabled = true; x.locked = false; x.fails = 0; return { ok: true, created: false }
		}
		if (a === "disable" || a === "reset") {
			const x = accounts.get(d.teacher_id); if (!x) return { error: "없음", status: 404 }
			for (const [k, s] of sessions) if (s.teacher_id === x.teacher_id) sessions.delete(k)
			if (a === "disable") { x.enabled = false; return { ok: true } }
			Object.assign(x, { phone: d.phone, password_hash: d.password_hash, must_change: true, fails: 0, locked: false, version: x.version + 1 }); return { ok: true }
		}
		if (a === "account") {
			const x = byPhone(d.phone); if (!x || !x.enabled) return { found: false }
			if (x.locked) return { error: "로그인 시도가 많아 잠겼어요.", status: 429 }
			return { found: true, teacher_id: x.teacher_id, password_hash: x.password_hash, version: x.version, must_change: x.must_change, name: x.name }
		}
		if (a === "login") {
			const x = accounts.get(d.teacher_id)!
			if (!d.verified) { x.fails++; if (x.fails >= 5) x.locked = true; return { error: "아이디 또는 비밀번호가 올바르지 않아요.", status: 401 } }
			sessions.set(d.token_hash, { teacher_id: x.teacher_id, version: x.version, users: d.notion_users }); x.fails = 0; return { ok: true }
		}
		if (a === "logout") { sessions.delete(d.session_hash); return { ok: true } }
		const s = sessions.get(d.session_hash), x = s && accounts.get(s.teacher_id)
		if (!s || !x || !x.enabled || s.version !== x.version) return { error: "다시 로그인해 주세요.", status: 401 }
		if (a === "session") return { kind: "teacher", teacher_id: x.teacher_id, name: x.name, phone: x.phone, must_change: x.must_change, password_hash: x.password_hash, version: x.version, notion_users: s.users }
		if (a === "change") {
			x.password_hash = d.password_hash; x.must_change = false; x.version++
			for (const [k, v] of sessions) if (v.teacher_id === x.teacher_id) sessions.delete(k)
			return { ok: true, changed_at: "2026-11-24T00:00:00Z" }
		}
		return { error: "모형에 없는 강사 동작 " + a, status: 400 }
	}
	const fetchFake = (async (input: any, init: any) => {
		const url = String(input instanceof Request ? input.url : input), j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } })
		const b = init?.body ? JSON.parse(init.body) : {}
		if (url.endsWith("/rpc/hada_security_command")) { calls.push("owner:" + b.p_action); return j(ownerCmd(b.p_action, b.p_data)) }
		if (url.endsWith("/rpc/hada_teacher_command")) { calls.push("teacher:" + b.p_action); return j(teacherCmd(b.p_action, b.p_data)) }
		if (url.includes("/rest/v1/app_rows")) {
			const db = decodeURIComponent((/db=eq\.([^&]+)/.exec(url) || [])[1] || "")
			return j(db === "메뉴(학원) DB" ? MENU_ROWS.map((r, i) => ({ id: String(i), ...r })) : db === "강사(학원) DB" ? TEACHER_ROWS : [])
		}
		const page = /api\.notion\.com\/v1\/pages\/([0-9a-f-]+)/.exec(url)
		if (page) { const id = page[1].replace(/-/g, ""); return j({ object: "page", id, properties: { "노션 계정": { type: "people", people: (NOTION_USERS[id] ?? []).map((u) => ({ id: u })) }, "퇴사일": { type: "date", date: LEFT[id] ? { start: LEFT[id], end: null } : null } } }) }
		return j({ error: "모형에 없는 주소 " + url }, 404)
	}) as typeof fetch
	return { accounts, sessions, calls, fetchFake }
}
async function withServer(run: (srv: ReturnType<typeof fakeServer>) => Promise<void>) {
	const srv = fakeServer(), old = globalThis.fetch, en0 = Deno.env.get("ADMIN_SECURITY_ENABLED"), or0 = Deno.env.get("ADMIN_ALLOWED_ORIGINS")
	globalThis.fetch = srv.fetchFake; Deno.env.set("ADMIN_SECURITY_ENABLED", "true"); Deno.env.delete("ADMIN_ALLOWED_ORIGINS")
	try { await run(srv) } finally {
		globalThis.fetch = old
		if (en0 === undefined) Deno.env.delete("ADMIN_SECURITY_ENABLED"); else Deno.env.set("ADMIN_SECURITY_ENABLED", en0)
		if (or0 !== undefined) Deno.env.set("ADMIN_ALLOWED_ORIGINS", or0)
	}
}
const sec = async (body: unknown, key = "") => {
	const res = await handleAdminSecurity(new Request("https://mock.supabase.co/functions/v1/admin-security", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": key }, body: JSON.stringify(body) }))
	return { status: res.status, body: await res.json() }
}
const login = (phone: string, pw: string) => sec({ action: "teacher-login", phone, password: pw })
const change = (cur: string, nw: string, key: string) => sec({ action: "teacher-change", current_password: cur, new_password: nw }, key)
const route = (r: string, key: string) => new Request(`https://mock.supabase.co/functions/v1/${r}`, { method: "POST", headers: { "x-admin-key": key } })
const access = (r: string, key: string) => requireAccess(route(r, key), {}, "")

Deno.test("teacher 흐름: 원장이 켠 강사만 → 첫 로그인(번호) → 바꾸기 전엔 모두 거절 → 바꾸기 → 편집허용 메뉴만 → 재무 · 설정 거절", () => withServer(async (srv) => {
	// 원장 화면: 목록에 같은 번호 표시, 번호 없음 · 같은 번호는 켜기 거절
	const st = await sec({ action: "teachers-status" }, OWNER)
	eq(st.status, 200); eq(st.body.teachers.filter((t: any) => t.duplicate).map((t: any) => t.name), ["예시강사D1", "예시강사D2"])
	eq(st.body.teachers[0].teacher_id, TA); eq(st.body.teachers[0].phone, "01012345678")
	eq((await sec({ action: "teacher-enable", teacher_id: TD1 }, OWNER)).status, 409)
	eq((await sec({ action: "teacher-enable", teacher_id: "f".repeat(32) }, OWNER)).status, 400)
	// 켜기 전: 번호 · 첫 비밀번호로 로그인 안 됨(없는 번호와 같은 말)
	const before = await login("010-1234-5678", "010-1234-5678")
	eq(before.status, 401)
	// 강사 세션 · 세션 없음으로 원장 관리 동작은 거절
	eq((await sec({ action: "teacher-enable", teacher_id: TA })).status, 401)
	eq((await sec({ action: "teacher-enable", teacher_id: TA }, OWNER)).status, 200)
	eq(srv.accounts.get(TA)!.phone, "01012345678")
	// 첫 로그인: 아이디 · 첫 비밀번호 모두 하이픈이 있든 없든 같은 번호. 다른 번호는 거절
	eq((await login("01012345678", "010-1234-5679")).status, 401)
	eq((await login("01012345678", "010-1234-5678")).body.must_change, true)
	const first = await login("010-1234-5678", "01012345678")
	eq([first.status, first.body.must_change, first.body.role], [200, true, "teacher"])
	const s1 = first.body.session as string
	// 바꾸기 전: 강사를 받는 경로 4곳 모두 거절, 원장 경로도 거절
	for (const r of Object.keys(TEACHER_ROUTES)) eq(((await access(r, s1)) as Response).status, 401, r)
	for (const a of ["profile", "keys-status", "webhook-status", "teachers-status"]) eq((await sec({ action: a }, s1)).status, 401, a)
	eq((await sec({ action: "teacher-profile" }, s1)).body.must_change, true)
	// 비밀번호 바꾸기: 번호와 같은 값 · 짧은 값 · 현재 비밀번호 틀림 거절
	eq((await change("01012345678", "010-1234-5678", s1)).status, 400)
	eq((await change("01012345678", "short", s1)).status, 400)
	eq((await change("wrong-pass", "teacher-pass-1", s1)).status, 401)
	eq((await change("01012345678", "teacher-pass-1", s1)).status, 200)
	eq(srv.sessions.size, 0) // 바꾸면 그 세션도 끊김
	eq((await login("01012345678", "01012345678")).status, 401) // 첫 비밀번호는 더 안 됨
	const again = await login("01012345678", "teacher-pass-1")
	eq([again.status, again.body.must_change], [200, false])
	const s2 = again.body.session as string
	// 편집허용 메뉴만: A = 학생 · 수업 · 등록(수강료 · 관리자 설정은 들어 있어도 빠짐)
	const a = await access("app-api", s2)
	assert(!(a instanceof Response)); eq((a as any).menus.sort(), ["등록", "수업", "학생"])
	assert(!((await access("class-room", s2)) instanceof Response))               // 수업 메뉴
	eq(((await access("textbook-api", s2)) as Response).status, 403)                // 라이브러리 메뉴 없음
	eq(((await access("school-api", s2)) as Response).status, 403)                  // 학교 메뉴 없음
	// 강사를 받지 않는 브라우저 경로 · 원장 관리자 설정은 모두 거절
	for (const r of ["list-students", "kiosk-checkin", "get-legal-document-data", "clear-example-data", "sync-school-calendar", "generate-classes", "send-report"]) eq(((await access(r, s2)) as Response).status, 401, r)
	for (const act of ["profile", "keys-status", "key-set", "webhook-status", "webhook-links", "root-title", "teachers-status", "teacher-enable", "teacher-reset", "change"]) eq((await sec({ action: act, teacher_id: TA }, s2)).status, 401, act)
	// 재무 · 설정 동작(app-api 안 거름)
	for (const db of TEACHER_BLOCKED_DBS) eq(teacherAppDeny(a as any, { action: "list", db })?.[0], 403, db)
	// 원장은 그대로 전부
	eq(await access("app-api", OWNER), { role: "owner" }); eq(await access("clear-example-data", OWNER), { role: "owner" })
}))

Deno.test("teacher 흐름: 편집허용 · 댓글허용 어디에도 없으면 번호 · 비밀번호가 맞아도 로그인 거절(세션 없음 · 잠금 셈 안 함) · 다섯 번 틀리면 그 강사만 잠김 · 되돌리기 · 끄면 바로 끊김", () => withServer(async (srv) => {
	eq((await sec({ action: "teacher-enable", teacher_id: TA }, OWNER)).status, 200)
	eq((await sec({ action: "teacher-enable", teacher_id: TB }, OWNER)).status, 200)
	// B: 노션 계정 없음 = 어느 메뉴에도 없음 → 첫 비밀번호가 맞아도 403 + 안내, 세션 없음, 잠금 셈 0
	for (let i = 0; i < 6; i++) {
		const r = await login("01099998888", "01099998888")
		eq(r.status, 403); assert(/메뉴관리 권한을 요청/.test(r.body.error)); assert(!r.body.session)
	}
	eq(srv.sessions.size, 0); eq(srv.accounts.get(TB)!.fails, 0); eq(srv.accounts.get(TB)!.locked, false)
	eq((await login("01099998888", "wrong-pass")).status, 401) // 틀린 비밀번호는 그대로 401(메뉴 여부를 알려 주지 않음)
	// 원장 [앱 계정]: 메뉴 권한 수
	const stB = (await sec({ action: "teachers-status" }, OWNER)).body.teachers
	eq(stB.find((t: any) => t.teacher_id === TB).menu, { menus: 0, edit: 0 }); eq(stB.find((t: any) => t.teacher_id === TA).menu, { menus: 3, edit: 3 })
	// G(과목 편집): 로그인 됨
	const g = await teacherKey(TG, "01077776666", "teacher-pass-g")
	// A: 다섯 번 틀림 → A만 잠김(429), G · 원장은 그대로
	for (let i = 0; i < 5; i++) eq((await login("01012345678", "nope-" + i)).status, 401)
	eq((await login("01012345678", "01012345678")).status, 429)
	assert(!((await access("app-api", g)) instanceof Response))
	eq(await access("app-api", OWNER), { role: "owner" })
	assert(!srv.calls.some((c) => c === "owner:login")) // 강사 틀림은 원장 잠김 셈에 들어가지 않는다
	// 원장: 되돌리기 → 잠김 풀림 · 다시 첫 비밀번호(must_change)
	const st = (await sec({ action: "teachers-status" }, OWNER)).body.teachers.find((t: any) => t.teacher_id === TA)
	eq([st.account.enabled, st.account.locked], [true, true])
	eq((await sec({ action: "teacher-reset", teacher_id: TA }, OWNER)).status, 200)
	const r = await login("01012345678", "01012345678")
	eq([r.status, r.body.must_change], [200, true])
	// 끄기: G 세션 바로 끊김 · 로그인 안 됨
	eq((await sec({ action: "teacher-disable", teacher_id: TG }, OWNER)).status, 200)
	eq(((await access("app-api", g)) as Response).status, 401)
	eq((await login("01077776666", "teacher-pass-g")).status, 401)
	// 로그아웃
	await sec({ action: "teacher-logout" }, r.body.session); eq(srv.sessions.has(await sha256(r.body.session)), false)
}))

// ---------- app-api 경로째(담당 261123: 읽기도 메뉴별로 서버에서 막기) ----------
const STU = "5".repeat(32), SUBJ = "6".repeat(32)
const OPTIONS = { "학생(학원) DB": { "학생과의 관계": ["어머니", "아버지"], "문의 경로": ["지인"] }, "과목(학원) DB": { "교습과정": ["보습"] }, "영역(학원) DB": { "교습과정": ["보습"] }, "강사(학원) DB": { "직책": ["강사"] }, "수강료(학원) DB": { "결제 수단": ["카드"] } }
function appDeps(log: string[]) {
	return {
		listApp: async (db: string) => { log.push("list:" + db); return db === "강사(학원) DB" ? TEACHER_ROWS : db === "학생(학원) DB" ? [{ id: STU, props: { "이름": "예시학생", "보호자 연락처": "010-0000-0000" } }] : [{ id: SUBJ, props: { "이름": "예시" } }] },
		writeOptions: async () => JSON.parse(JSON.stringify(OPTIONS)),
		saveChanges: async (cs: any[]) => { log.push("save:" + cs.map((c) => c.db).join(",")); return cs.map(() => ({ ok: true })) },
		statusApp: async () => APP_DBS.map((db) => ({ db, rows: 1, cursor: null })),
		appChanges: async (_s: string | null, dbs: string[]) => { log.push("changes:" + dbs.join(",")); return { ok: true as const, now: "x", rows: [], gone: [], crAt: null } },
		lastSyncedAt: async () => null, rootTitle: async () => "예시", warmSources: () => {}, healthOf: async () => null,
		syncCopy: async (dbs?: string[]) => { log.push("sync:" + (dbs ?? ["(전체)"]).join(",")); return { dbs: dbs ?? [] } },
	} as any
}
const api = async (key: string, body: unknown, log: string[]) => {
	const res = await handleAppApi(new Request("https://mock.supabase.co/functions/v1/app-api", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": key }, body: JSON.stringify(body) }), appDeps(log))
	return { status: res.status, body: await res.json() }
}
async function teacherKey(id: string, phone: string, pw: string) {
	eq((await sec({ action: "teacher-enable", teacher_id: id }, OWNER)).status, 200)
	const s1 = (await login(phone, phone)).body.session
	eq((await change(phone, pw, s1)).status, 200)
	return (await login(phone, pw)).body.session as string
}
Deno.test("teacher app-api: 권한 없는 메뉴의 DB는 읽기 · 고르기 목록 · 저장 · 동기화 · 바뀐 줄 모두 거절, 권한 있는 메뉴는 그대로, 원장은 전부", () => withServer(async () => {
	const log: string[] = []
	// G: 과목 메뉴만 → 학생 DB(연락처) 못 읽음
	const g = await teacherKey(TG, "01077776666", "teacher-pass-g")
	const me = await api(g, { action: "me" }, log)
	eq(me.body.role, "teacher"); eq(me.body.menus, ["과목"]); eq(me.body.readDbs.sort(), ["과목(학원) DB", "라이브러리(학원) DB", "메뉴(학원) DB", "영역(학원) DB", "학년(학원) DB"])
	for (const db of ["학생(학원) DB", "등록(학원) DB", "일정(학원) DB", "보고서(학원) DB", "근무(학원) DB", "강사(학원) DB", "수강료(학원) DB", "자료(학원) DB"]) {
		const r = await api(g, { action: "list", db }, log); eq(r.status, 403, db)
	}
	assert(!log.some((x) => x === "list:학생(학원) DB"), "거절된 DB는 사본을 읽지도 않음")
	eq((await api(g, { action: "list", db: "과목(학원) DB" }, log)).status, 200)
	eq((await api(g, { action: "list", db: "메뉴(학원) DB" }, log)).status, 200)
	const opt = await api(g, { action: "options" }, log)
	eq(Object.keys(opt.body.dbs).sort(), ["과목(학원) DB", "영역(학원) DB"]); eq(opt.body.dbs["과목(학원) DB"]["교습과정"], ["보습"]) // 그 화면 고르기 목록은 그대로
	eq((await api(g, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: STU, props: { "이름": "x" } }] }, log)).status, 403)
	eq((await api(g, { action: "save", changes: [{ op: "delete", db: "학생(학원) DB", id: STU }] }, log)).status, 403)
	eq((await api(g, { action: "save", changes: [{ op: "update", db: "과목(학원) DB", id: SUBJ, props: { "이름": "x" } }] }, log)).status, 200)
	eq((await api(g, { action: "run", name: "sync-copy", dbs: ["학생(학원) DB"] }, log)).status, 403)
	await api(g, { action: "run", name: "sync-copy" }, log); assert(log.some((x) => x.startsWith("sync:") && !x.includes("학생") && x.includes("과목")), "동기화는 읽기 DB만")
	await api(g, { action: "changes", since: "2026-11-23T00:00:00Z", dbs: ["학생(학원) DB", "과목(학원) DB"] }, log); eq(log.filter((x) => x.startsWith("changes:")).pop(), "changes:과목(학원) DB")
	const st = await api(g, { action: "status" }, log); assert(st.body.dbs.every((d: any) => me.body.readDbs.includes(d.db)), "상태도 읽기 DB만")
	for (const b of [{ action: "admin-status" }, { action: "record-payment", requestId: "r", tuitionId: STU }, { action: "end-preview", id: STU }, { action: "run", name: "generate-classes" }]) eq((await api(g, b, log)).status, 403, JSON.stringify(b))
	// A: 학생 · 수업 · 등록 → 학생 읽기 · 학생 고르기 목록 · 학생 저장 됨, 강사 줄의 다른 강사 연락처는 지움
	const a = await teacherKey(TA, "01012345678", "teacher-pass-a")
	eq((await api(a, { action: "list", db: "학생(학원) DB" }, log)).status, 200)
	const optA = await api(a, { action: "options" }, log)
	eq(optA.body.dbs["학생(학원) DB"]["학생과의 관계"], ["어머니", "아버지"]); assert(!optA.body.dbs["수강료(학원) DB"] && !!optA.body.dbs["강사(학원) DB"] && !!optA.body.dbs["과목(학원) DB"], "수업 · 등록 화면이 읽는 과목 · 강사 목록은 그대로, 재무는 없음")
	eq((await api(a, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: STU, props: { "이름": "x" } }] }, log)).status, 200)
	eq((await api(a, { action: "save", changes: [{ op: "update", db: "과목(학원) DB", id: SUBJ, props: { "이름": "x" } }] }, log)).status, 403)
	const tl = (await api(a, { action: "list", db: "강사(학원) DB" }, log)).body.rows
	eq(tl.map((r: any) => r.props["연락처"]).filter(Boolean), ["010-1234-5678"])
	// 원장: 전부(재무 포함), 고르기 목록 전부
	eq((await api(OWNER, { action: "list", db: "수강료(학원) DB" }, log)).status, 200)
	eq(Object.keys((await api(OWNER, { action: "options" }, log)).body.dbs).length, Object.keys(OPTIONS).length)
	eq((await api(OWNER, { action: "me" }, log)).body, { ok: true, role: "owner" })
	// 세션 없음 · 첫 비밀번호 세션은 401
	eq((await api("", { action: "list", db: "과목(학원) DB" }, log)).status, 401)
}))

Deno.test("teacher app-api: 댓글허용만인 메뉴 — 읽기 · 고르기 목록은 되고 저장 · 단추 요청 · 동기화 · 수업 생성은 403, me에 읽기/쓰기 DB가 따로", () => withServer(async () => {
	const log: string[] = []
	const d = await teacherKey(TDV, "01044443333", "teacher-pass-d")
	const me = (await api(d, { action: "me" }, log)).body
	eq([me.menus, me.editMenus, me.writeDbs], [["학생"], [], []]); assert(me.readDbs.includes("학생(학원) DB"))
	eq((await api(d, { action: "list", db: "학생(학원) DB" }, log)).status, 200)
	eq((await api(d, { action: "options" }, log)).body.dbs["학생(학원) DB"]["학생과의 관계"], ["어머니", "아버지"])
	const sv = await api(d, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: STU, props: { "이름": "x" } }] }, log)
	eq(sv.status, 403); assert(/보기만/.test(sv.body.error)); assert(!log.some((x) => x.startsWith("save:")), "저장 함수를 부르지도 않음")
	eq((await api(d, { action: "save", changes: [{ op: "update", db: "학생(학원) DB", id: STU, props: { "요청": "링크 재발급" } }] }, log)).status, 403)
	eq((await api(d, { action: "run", name: "sync-copy" }, log)).status, 403)
	eq((await api(d, { action: "run", name: "sync-copy", dbs: ["학생(학원) DB"] }, log)).status, 403)
	eq((await api(d, { action: "run", name: "generate-classes" }, log)).status, 403)
	await api(d, { action: "changes", since: "2026-11-23T00:00:00Z", dbs: ["학생(학원) DB"] }, log); eq(log.filter((x) => x.startsWith("changes:")).pop(), "changes:학생(학원) DB") // 바뀐 줄 받기(읽기)는 됨
	// 편집허용 강사 A의 동기화는 쓰기 DB만
	const a = await teacherKey(TA, "01012345678", "teacher-pass-a")
	await api(a, { action: "run", name: "sync-copy" }, log); const sy = log.filter((x) => x.startsWith("sync:")).pop()!
	assert(sy.includes("학생(학원) DB") && !sy.includes("과목(학원) DB"), sy)
}))

Deno.test("teacher: 첫 로그인 뒤에도 비밀번호 바꾸기 — 현재 비밀번호 확인, 자기 번호만 돌려줌, 바꾸면 옛 비밀번호 · 옛 세션 끊김", () => withServer(async (srv) => {
	const s = await teacherKey(TA, "01012345678", "teacher-pass-a")
	eq((await change("wrong-pass-0", "teacher-pass-a2", s)).status, 401)
	const r = await change("teacher-pass-a", "teacher-pass-a2", s)
	eq([r.status, r.body.phone], [200, "01012345678"])
	eq(((await access("app-api", s)) as Response).status, 401)
	eq((await login("01012345678", "teacher-pass-a")).status, 401)
	eq((await login("01012345678", "teacher-pass-a2")).status, 200)
	eq((await change("teacher-pass-a2", "x", "")).status, 401) // 세션 없이는 못 바꿈
	eq(srv.accounts.get(TA)!.must_change, false)
}))

Deno.test("퇴사 강사(261124): 퇴사일 당일까지 재직, 다음 날부터 로그인 거절 · 로그인해 둔 세션도 끊김", () => withServer(async (srv) => {
	// 규칙: 노션 수식 `재직 상태`와 같음 — 날짜 · 앱 사본 · 노션 날짜 모양 모두
	eq([teacherLeft("2026-11-23", "2026-11-24"), teacherLeft("2026-11-24", "2026-11-24"), teacherLeft({ start: "2026-11-25" }, "2026-11-24"), teacherLeft({ start: "2026-11-01", end: null }, "2026-11-24"), teacherLeft(null), teacherLeft(""), teacherLeft("엉뚱")], [true, false, false, true, false, false, false])
	eq(kstToday(Date.UTC(2026, 10, 23, 15, 30)), "2026-11-24") // 한국 0시 30분 = 그날
	eq((await sec({ action: "teacher-enable", teacher_id: TA }, OWNER)).status, 200)
	const s1 = (await login("01012345678", "01012345678")).body.session as string
	eq((await change("01012345678", "teacher-pass-1", s1)).status, 200)
	const s2 = (await login("01012345678", "teacher-pass-1")).body.session as string
	assert(!((await access("app-api", s2)) instanceof Response)) // 재직: 들어감
	const row = TEACHER_ROWS[0] as { props: Record<string, unknown> }
	try {
		row.props["퇴사일"] = { start: kstToday(), end: null } // 오늘 퇴사 = 오늘까지 재직
		assert(!((await access("app-api", s2)) instanceof Response))
		row.props["퇴사일"] = { start: "2000-01-01", end: null }; LEFT[TA] = "2000-01-01"
		eq(((await access("app-api", s2)) as Response).status, 401) // 로그인해 둔 세션도 다음 요청부터 거절
		const again = await login("01012345678", "teacher-pass-1")
		eq([again.status, again.body.error], [403, TEACHER_LEFT_MSG]) // 번호 · 비밀번호가 맞아도 세션 안 만듦
		eq(srv.accounts.get(TA)!.fails, 0) // 틀린 비밀번호가 아니므로 잠금 횟수에 안 넣음
		delete row.props["퇴사일"]; delete LEFT[TA]
		eq((await login("01012345678", "teacher-pass-1")).status, 200) // 퇴사일을 지우면 다시 됨
	} finally { delete row.props["퇴사일"]; delete LEFT[TA] }
}))
