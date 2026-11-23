/* 앱 자료 층: app-api(Supabase app_rows = 노션 복사본)를 읽어 시제품 전역 DB 모양으로 바꿔 끼운다(읽기만). 칸 대응 표는 MAPPING.md */

// ---------- 보조 ----------
const APP_DAYS = ["월", "화", "수", "목", "금", "토", "일"] // 시제품 blocks.day = 이 순서의 번호(0 = 월)
// 시즌 색: 노션 옵션(한글) → 시제품 SEA_COLORS 키
const APP_SEA_COLOR = { 초록: "green", 파랑: "blue", 보라: "purple", 분홍: "pink", 주황: "orange", 노랑: "yellow", 빨강: "red", 갈색: "brown", 회색: "gray" }
// 클래스 색: 노션 [색] 옵션 → 시제품 hex(field.js HF.COLORS와 같은 값). [색 코드]가 있으면 그것이 먼저
const APP_CLS_HEX = { 빨강: "#E5484D", 주황: "#F0A35E", 노랑: "#E8C547", 초록: "#5BBF8A", 파랑: "#7FA6D9", 보라: "#B794F6", 분홍: "#E88FB5", 갈색: "#B08D6E", 회색: "#A3A3A3", 기본: "#CFC8BE" }
// 시즌 상태: 노션 [상태] → 시제품 state(확정 = 수업을 만드는 시즌, 초안 = 예정). 끝남도 확정(시제품은 끝난 날로 "종료"를 그림)
const APP_SEASON_STATE = { "준비 중": "초안", "운영 중": "확정", "끝남": "확정" }

function appX(raw, mapped) {
	// 한국 시각 "YYYY-MM-DDTHH:MM": 날짜만이거나 +09:00이면 글자 그대로, 그 밖(Z · 다른 시간대)은 9시간 더해 한국 날짜로(261119 9시간 점검 — 아침 9시 전 수업이 전날로 보이지 않게)
	const kst = (s) => { s = String(s || ""); if (s.length <= 10 || /\+09:?00$/.test(s)) return s.slice(0, 16); const t = Date.parse(s); return Number.isNaN(t) ? s.slice(0, 16) : new Date(t + 9 * 3600000).toISOString().slice(0, 16) }
	const X = {
		// 오늘 = 한국 날짜(PC 시간대와 무관)
		today: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
		// 관계 첫 값(id) 또는 ""
		id1: (v) => (Array.isArray(v) && v.length ? String(v[0]) : ""),
		ids: (v) => (Array.isArray(v) ? v.map(String) : []),
		// 날짜 {start,end} → "YYYY-MM-DD"
		d: (v) => (v && v.start ? kst(v.start).slice(0, 10) : ""),
		dEnd: (v) => (v && v.end ? kst(v.end).slice(0, 10) : ""),
		// 날짜시각 → "YYYY-MM-DDTHH:MM"(시각 없으면 날짜만, 한국 시각)
		dt: (v) => (v && v.start ? kst(v.start) : ""),
		// "HH:mm" → 분(시제품 blocks.start/end). 못 읽으면 null
		min: (s) => { const m = /^\s*(\d{1,2})\s*[:시.]\s*(\d{1,2})?/.exec(String(s || "")); return m ? +m[1] * 60 + +(m[2] || 0) : null },
		num: (v) => (typeof v === "number" && isFinite(v) ? v : (v == null || v === "" ? "" : (isFinite(+v) ? +v : ""))),
		str: (v) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.start || "") : String(v)),
		arr: (v) => (Array.isArray(v) ? v.map((x) => (x == null ? "" : typeof x === "object" ? (x.name ?? x.start ?? "") : String(x))).filter(Boolean) : v ? [String(v)] : []),
		// 다른 DB 원본 행(props) · 이름
		raw: (db, id) => (raw[db] && raw[db].get(id)) || null,
		all: (db) => (raw[db] ? [...raw[db].values()] : []),
		title: (db, id, prop) => { const r = raw[db] && raw[db].get(id); return r ? X.str(r.props[prop]) : "" },
		coll: (name) => mapped[name] || [],
	}
	return X
}

// ---------- 컬렉션 대응 ----------
// row(r, X): r = app-api 한 줄 {id, props, url, icon, ...}, p = r.props(노션 속성 이름 그대로)
const APPMAP = {
	seasons: {
		db: "시즌(학원) DB",
		row: (r, X, p = r.props) => ({
			id: r.id, name: X.str(p["이름"]), start: X.d(p["기간"]), end: X.dEnd(p["기간"]) || X.d(p["기간"]),
			// 상태 = 노션 수식 글(261118부터 날짜로 계산) 또는 옛 고르기 값 — 앞 기호 · 빈칸을 떼고 세 이름에 맞춤(화면은 seaAuto로 날짜 계산값을 다시 씌움)
			state: APP_SEASON_STATE[X.str(p["상태"]).replace(/^[^\p{L}]+/u, "").trim()] || "초안", color: APP_SEA_COLOR[p["색"]] || "",
		}),
	},
	teachers: {
		db: "강사(학원) DB",
		row: (r, X, p = r.props) => ({
			id: r.id, name: X.str(p["이름"]), role: X.str(p["직책"]), phone: X.str(p["연락처"]),
			days: APP_DAYS.filter((d) => X.arr(p["출근 요일"]).includes(d)).join(","),
		}),
	},
	areas: {
		db: "영역(학원) DB",
		row: (r, X, p = r.props) => {
			const name = X.str(p["이름"])
			return { id: r.id, name, course: X.str(p["교습과정"]), _was: name, state: "saved", _order: X.num(p["순서"]), _on: p["사용"] !== false }
		},
		sort: (a, b) => (+a._order || 999) - (+b._order || 999),
	},
	glevels: {
		db: "학년(학원) DB",
		row: (r, X, p = r.props) => ({ id: r.id, name: X.str(p["이름"]), on: !!p["사용"], state: "saved", _order: X.num(p["순서"]), _kind: X.str(p["학교구분"]) }),
		sort: (a, b) => (+a._order || 999) - (+b._order || 999),
	},
	schools: {
		db: "학교(학원) DB",
		row: (r, X, p = r.props) => ({
			id: r.id, name: X.str(p["이름"]), kind: X.str(p["학교 구분"]), addr: X.str(p["주소"]),
			code: !!X.str(p["학교 코드"]), sync: X.d(p["학사일정 마지막 동기화"]), state: "saved",
			// 학사일정 기간(날짜 범위, 2.8) → nfrom·nto(화면 학교 창 두 날짜 칸 이름 그대로, 최종 261118). 칸이 없거나 비면 "" = 학년도 전체
			nfrom: X.d(p["학사일정 기간"]), nto: X.dEnd(p["학사일정 기간"]) || X.d(p["학사일정 기간"]),
		}),
	},
	// 클래스 루틴(261119, 화면 594판 클래스 창 [루틴] 탭): 노션 루틴(학원) DB — 이름 · 클래스 · 순서 · 설명 · 쉬기. 서버 사본에 DB가 들어온 뒤 켬(APP_RT_ON)
	routines: {
		db: "루틴(학원) DB",
		row: (r, X, p = r.props) => ({ id: r.id, classId: X.id1(p["클래스"]), name: X.str(p["이름"]), desc: X.str(p["설명"]), ord: X.num(p["순서"]), rest: !!p["쉬기"], state: "saved" }),
	},
	subjects: {
		db: "과목(학원) DB",
		row: (r, X, p = r.props) => ({
			id: r.id, name: X.str(p["이름"]), emoji: X.str(p["이모지"]) || r.icon || "",
			area: X.title("영역(학원) DB", X.id1(p["영역"]), "이름"),
			grades: X.ids(p["학년"]).map((id) => X.title("학년(학원) DB", id, "이름")).filter(Boolean),
			memo: X.str(p["비고"]), state: "saved",
		}),
	},
	books: {
		db: "라이브러리(학원) DB",
		row: (r, X, p = r.props) => {
			const kind = X.str(p["구분"]) || "교재"
			return {
				id: r.id, name: X.str(p["교재명"]), subjectId: X.id1(p["과목"]), kind,
				series: X.str(p["시리즈"]), types: X.arr(p["교재 유형"]), curr: X.str(p["교육과정"]), pub: X.str(p["출판사"]),
				total: X.num(p["전체 분량"]), unit: X.str(p["진도 단위"]) || (kind === "프로그램" ? "-차시" : "P.-"),
				price: X.num(p["가격"]), using: !!p["사용중"], isbn: X.str(p["ISBN13"]), etcItem: X.str(p["기타경비 항목"]),
				state: "saved", // units(단원)는 lib_* 복사본(다음 단계) — 여기선 비움
			}
		},
	},
	classes: {
		db: "클래스(학원) DB",
		row: (r, X, p = r.props) => {
			return {
				id: r.id, name: X.str(p["클래스명"]), short: X.str(p["약칭"]),
				subject: X.title("영역(학원) DB", X.id1(p["영역"]), "이름"),
				teacherId: X.id1(p["담당강사"]), fee: X.num(p["수강료"]) || 0, qty: X.num(p["월간 수업 총량"]),
				unit: X.str(p["단위"]) || "횟수", kind: X.str(p["클래스 유형"]) || "정규", arts: X.str(p["클래스 구분"]) || "교과",
				open: X.d(p["개강일"]), close: X.d(p["종강일"]),
				hex: (/^#[0-9a-f]{6}$/i.test(X.str(p["색 코드"])) ? X.str(p["색 코드"]).toUpperCase() : "") || APP_CLS_HEX[p["색"]] || "",
				course: X.str(p["신고 교습과정명"]), etcIds: X.ids(p["기타경비"]),
				_emoji: X.str(p["이모지"]) || r.icon || "",
			}
		},
	},
	students: {
		db: "학생(학원) DB",
		row: (r, X, p = r.props) => ({
			id: r.id, name: X.str(p["학생이름"]),
			school: X.title("학교(학원) DB", X.id1(p["학교"]), "이름"), grade: X.title("학년(학원) DB", X.id1(p["학년"]), "이름"),
			mom: X.str(p["어머니 연락처"]), dad: X.str(p["아버지 연락처"]), sp: X.str(p["학생 연락처"]),
			gp: X.str(p["기타 보호자 연락처"]), gprel: X.str(p["학생과의 관계"]),
			pre: X.str(p["우선 연락 대상"]), hold: !!p["등록 보류"], memo: X.str(p["메모(내부용)"]),
			inq: X.dt(p["문의일"]), route: X.str(p["문의 경로"]), hope: X.d(p["희망 시작일"]), consent: !!p["개인정보 동의"],
			birth: X.d(p["생년월일"]), gender: X.str(p["성별"]), addr: X.str(p["주소"]),
			sib: X.ids(p["형제/자매"]), _no: X.num(p["등록번호"]),
		}),
	},
	enrolls: {
		db: "등록(학원) DB",
		row: (r, X, p = r.props) => {
			const end = X.d(p["종료일"])
			// 등록 카드 [교재] = 이 등록의 개별 진도교재 중 진행 중·다음 교재의 라이브러리 이름
			const books = X.ids(p["진도교재"]).map((id) => X.raw("진도관리(학원) DB", id)).filter(Boolean)
				.filter((g) => ["진행 중", "다음 교재"].includes(g.props["진행상태"]))
				.map((g) => X.title("라이브러리(학원) DB", X.id1(g.props["라이브러리"]), "교재명")).filter(Boolean)
			const adj = X.num(p["수강료 조정"])
			return {
				id: r.id, studentId: X.id1(p["학생정보"]), classId: X.id1(p["클래스"]),
				start: X.d(p["등록일"]), end, ended: !!end && end < X.today,
				discount: adj === "" ? 0 : -adj, // 시제품 discount = 깎는 금액(양수). 노션 수강료 조정 = 더하는 금액(음수면 할인)
				note: X.str(p["등록 안내 메모"]), memo: X.str(p["메모(내부용)"]),
				ttGuided: X.str(p["안내한 시간표"]), ttGuidedAt: "", books: [...new Set(books)], state: "saved",
			}
		},
	},
	blocks: {
		db: "시간표(학원) DB",
		row: (r, X, p = r.props) => {
			// 명단 = 시간표.등록 ∪ (등록.시간표에 이 시간표가 있는 등록). 25개 넘는 반(#more)도 반대편으로 채운다
			const regs = new Set(X.ids(p["등록"]))
			X.all("등록(학원) DB").forEach((e) => { if (X.ids(e.props["시간표"]).includes(r.id)) regs.add(e.id) })
			const per = p["적용 기간"]
			const o = {
				id: r.id, seasonId: X.id1(p["시즌"]), classId: X.id1(p["클래스"]),
				day: APP_DAYS.indexOf(X.str(p["요일"])), start: X.min(p["등원시간(HH:mm)"]), end: X.min(p["하원시간(HH:mm)"]),
				regs: [...regs], mode: p["수업 방식"] === "개별 수업" ? "individual" : "group", state: "saved",
				lessons: X.ids(p["수업"]).length > 0 || !!p["수업#more"],
				_lessonIds: X.ids(p["수업"]), // 이 시간표에 이어진 노션 수업 id(관계는 25개까지 온다) — 수업 ↔ 시간표를 정확히 잇는 데 쓴다(livelesson.js)
			}
			// 기간(대표 261118 "시작일 종료일 2개로"): 새 칸 `시작일` · `종료일`에 값이 하나라도 있으면 그 둘만, 둘 다 비면 옛 `적용 기간`
			const s1 = X.d(p["시작일"]), e1 = X.d(p["종료일"])
			if (s1 || e1) { if (s1) o.from = s1; if (e1) o.to = e1 }
			else { if (X.d(per)) o.from = X.d(per); if (X.dEnd(per)) o.to = X.dEnd(per) }
			// 처리 상태(261118, 담당): 실시간 처리 상태 · 마지막 오류 · 최근 수업(칸이 없으면 "")
			o.busy = X.str(p["실시간 처리 상태"]); o.error = X.str(p["마지막 오류"]); o.recent = X.d(p["최근 수업"]) || X.str(p["최근 수업"])
			return o
		},
	},
	progress: {
		db: "진도관리(학원) DB",
		row: (r, X, p = r.props) => {
			const solo = p["진도방식"] === "개별 진도"
			const en = X.raw("등록(학원) DB", X.id1(p["등록"]))
			const tpl = X.raw("진도관리(학원) DB", X.id1(p["반별교재"]))
			// 개별 줄은 노션 [클래스]가 비어 있다(서버 규칙) → 등록의 클래스, 없으면 반 교재의 클래스
			const cls = X.id1(p["클래스"]) || (solo ? (en ? X.id1(en.props["클래스"]) : "") || (tpl ? X.id1(tpl.props["클래스"]) : "") : "")
			const pv = p["진행도"]
			let pct = ""
			if (typeof pv === "number") pct = Math.round(pv <= 1 ? pv * 100 : pv)
			else if (pv) { const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(pv)); if (m) pct = Math.round(+m[1]) }
			return {
				id: r.id, bookId: X.id1(p["라이브러리"]), classId: cls,
				mode: solo ? "개별" : "그룹", studentId: solo && en ? X.id1(en.props["학생정보"]) : "",
				stat: X.str(p["진행상태"]) || "다음 교재", range: X.str(p["최근 학습 범위"]), pct,
				done: X.d(p["수료일"]), topic: X.str(p["주제"]), state: "saved",
				_enrollId: X.id1(p["등록"]), _tplId: X.id1(p["반별교재"]),
			}
		},
	},
}
// 루틴(학원) DB를 서버 사본 · 저장 층이 받기 전에는 읽지 않음(app-api가 모르는 DB면 불러오기 전체가 실패) — 노션서버 배포 뒤 true(appsave.js APPS_RT_ON과 함께)
const APP_RT_ON = true /* 노션서버 PR #478(4db5fc9) 원본 배포 — app-api list 루틴(학원) DB */
if (!APP_RT_ON) delete APPMAP.routines
// 이번 범위 밖(다음 출시) · 노션 대응 없음 → 빈 배열(MAPPING.md)
const APP_EMPTY = ["events", "reports", "tuition", "bookfees", "letters", "tests", "exams", "costs", "alims", "grades", "charges", "etcs", "files", "recs", "anotes", "series", "mk"]

// ---------- 불러오기 ----------
// app-api 호출 한 곳(261119, 노션서버 항목 100): Notion 한도(429)로 서버가 15초 넘게 기다릴 일이면 HTTP 503 { error, busy: true, retryAfterSec }로 끊는다.
// 그 응답이면 안내 띠("노션이 바빠요 · n초 뒤 다시 받아요")를 띄우고 retryAfterSec(없으면 5초, 1~15초) 뒤 같은 요청을 한 번만 다시 보낸다 — 저장도 노션에 쓰기 전 단계에서 끊으니 중복 없음.
// 두 번째도 바쁘면 그 응답을 그대로 돌려줘 호출한 쪽이 서버 메시지로 오류를 낸다. { res, body }(body는 JSON이 아니면 null).
async function appPostJson(url, init) {
	for (let n = 0; ; n++) {
		const res = await fetch(url, init)
		let body = null
		try { body = await res.json() } catch (_) { /* 호출한 쪽이 던짐 */ }
		const busy = res.status === 503 || !!(body && body.busy === true)
		if (!busy || n >= 1) { if (n >= 1 && typeof window !== "undefined" && typeof window.liveBusy === "function") window.liveBusy(""); return { res, body } }
		const sec = Math.min(15, Math.max(1, +(body && body.retryAfterSec) || 5))
		if (typeof window !== "undefined" && typeof window.liveBusy === "function") window.liveBusy(`노션이 바빠요 · ${sec}초 뒤 다시 받아요`)
		await new Promise((ok) => setTimeout(ok, sec * 1000))
	}
}
async function appList({ url, anonKey, session }, db) {
	const { res, body } = await appPostJson(String(url).replace(/\/+$/, "") + "/functions/v1/app-api", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-admin-key": session, Authorization: "Bearer " + anonKey, apikey: anonKey },
		body: JSON.stringify({ action: "list", db }),
	})
	if (!res.ok || !body || !Array.isArray(body.rows)) throw new Error(`${db} 읽기 실패 (${res.status}${body && body.error ? " · " + body.error : ""})`)
	return body.rows
}
// DB 여러 개를 동시에(기본 6개씩) 받는다(261119 첫 로드 10초 → 순차 받기 28번이 원인). 결과는 요청한 순서 그대로 { "<DB 제목>": Map }.
// 하나라도 실패하면 새로 시작하지 않고, 이미 받는 중인 것이 끝나면 요청 순서가 가장 앞인 실패를 던진다(순차 받기와 같은 메시지).
async function appListMany(cfg, dbs, limit = 6) {
	const res = new Array(dbs.length), errs = new Array(dbs.length)
	let next = 0, stop = false
	const worker = async () => {
		while (!stop) {
			const i = next++
			if (i >= dbs.length) return
			try { res[i] = new Map((await appList(cfg, dbs[i])).map((r) => [r.id, r])) } catch (e) { errs[i] = e; stop = true }
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, dbs.length)) }, worker))
	const bad = errs.findIndex((e) => e)
	if (bad >= 0) throw errs[bad]
	const raw = {}
	dbs.forEach((db, i) => { raw[db] = res[i] })
	return raw
}
// 모든 DB를 먼저 받고(같은 db는 한 번) 컬렉션 순서대로 바꾼다. target 없으면 시제품 전역 DB에 끼운다.
async function appLoad({ url, anonKey, session, target }) {
	const out = target || (typeof DB !== "undefined" ? DB : null)
	if (!out) throw new Error("DB 객체가 없습니다")
	const dbs = [...new Set(Object.keys(APPMAP).map((coll) => APPMAP[coll].db))]
	const raw = await appListMany({ url, anonKey, session }, dbs)
	if (typeof window !== "undefined" && !target) window.APP_RAW = { raw, view: false } // 열린 화면 자동 갱신(liverefresh.js)이 바뀐 줄만 끼워 다시 계산
	return appApply(raw, out)
}
// raw = { "<DB 제목>": Map(id → app-api 줄) } → out[coll]. 검사(check.cjs)도 이 함수를 쓴다.
function appApply(raw, out) {
	const mapped = {}
	const X = appX(raw, mapped)
	for (const [coll, m] of Object.entries(APPMAP)) {
		const rows = raw[m.db] ? [...raw[m.db].values()] : []
		// _edited = 노션에서 마지막으로 고친 시각(저장할 때 그사이 노션에서 바뀌었는지 확인)
		const list = rows.map((r) => Object.assign(m.row({ ...r, props: r.props || {} }, X), { _edited: r.notion_edited_at || "", _url: r.url || "" })) // _url = 그 줄의 노션 페이지 주소(서버 사본 app_rows.url) — 줄 창 [N]이 엶
		if (m.sort) list.sort(m.sort)
		mapped[coll] = list
		out[coll] = list
	}
	APP_EMPTY.forEach((k) => { out[k] = [] })
	// 노션 시간표는 시즌이 비어도 된다(시즌은 쓰는 학원만). 앱 시간표 화면은 시즌 하나를 골라 보므로, 시즌 없는 시간표는
	// 앱 안에서만 쓰는 "시즌 없음" 묶음에 둔다(노션에 쓰지 않음, _virtual). 시즌이 하나도 없어도 화면이 열린다.
	const blocks = out.blocks || [], seasons = out.seasons || (out.seasons = [])
	if (blocks.some((b) => !b.seasonId || !seasons.some((s) => s.id === b.seasonId)) || !seasons.length) {
		const today = appX({}, {}).today, y = today.slice(0, 4)
		seasons.push({ id: "_none", name: "시즌 없음", start: `${+y - 1}-01-01`, end: `${+y + 1}-12-31`, state: "확정", color: "", _virtual: true })
		blocks.forEach((b) => { if (!b.seasonId || !seasons.some((s) => s.id === b.seasonId)) b.seasonId = "_none" })
	}
	appFixLinks(out)
	return out
}
// 실제 노션 자료에는 끊긴 연결이 있을 수 있다(담당강사 없는 반, 학생 · 반이 휴지통에 간 등록, 반 없는 시간표, 교재 없는 진도).
// 앱 화면은 연결된 줄이 꼭 있다고 보고 그리므로 여기서 한 번 맞춘다:
//   - 담당강사가 없는 반 → 앱 전용 "담당 없음"(_virtual, 노션에 쓰지 않음 — 저장 층은 _로 시작하는 id를 빼고 보낸다)
//   - 학생 · 반을 못 찾는 등록, 반을 못 찾는 시간표, 반 · 교재를 못 찾는 진도 → 화면에서 빼고 out._broken에 적어 둔다(노션은 그대로)
//   - 시간표 명단 · 형제 연결에서 없는 줄 id는 뺀다
function appFixLinks(out) {
	const has = (coll) => new Set((out[coll] || []).map((x) => x.id))
	const tIds = has("teachers")
	if ((out.classes || []).some((c) => !tIds.has(c.teacherId))) {
		;(out.teachers = out.teachers || []).push({ id: "_noteacher", name: "담당 없음", role: "", phone: "", days: "", _virtual: true })
		out.classes.forEach((c) => { if (!tIds.has(c.teacherId)) c.teacherId = "_noteacher" })
	}
	const broken = []
	const keep = (coll, ok, why) => { out[coll] = (out[coll] || []).filter((r) => { if (ok(r)) return true; broken.push({ coll, id: r.id, why }); return false }) }
	const cIds = has("classes"), sIds = has("students"), bIds = has("books")
	keep("enrolls", (e) => sIds.has(e.studentId) && cIds.has(e.classId), "학생 또는 클래스 연결 없음")
	keep("blocks", (b) => cIds.has(b.classId), "클래스 연결 없음")
	keep("progress", (p) => cIds.has(p.classId) && bIds.has(p.bookId), "클래스 또는 교재 연결 없음")
	const eIds = has("enrolls")
	;(out.blocks || []).forEach((b) => { b.regs = (b.regs || []).filter((id) => eIds.has(id)) })
	;(out.students || []).forEach((s) => { if (Array.isArray(s.sib)) s.sib = s.sib.filter((id) => sIds.has(id)) })
	;(out.progress || []).forEach((p) => { if (p.studentId && !sIds.has(p.studentId)) p.studentId = "" })
	out._broken = broken
	return out
}

if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { APPMAP, APP_EMPTY, appLoad, appListMany, appPostJson, appApply, appX }
