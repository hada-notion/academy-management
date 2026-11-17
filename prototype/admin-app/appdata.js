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
	const pad = (n) => String(n).padStart(2, "0")
	const now = new Date()
	const X = {
		today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		// 관계 첫 값(id) 또는 ""
		id1: (v) => (Array.isArray(v) && v.length ? String(v[0]) : ""),
		ids: (v) => (Array.isArray(v) ? v.map(String) : []),
		// 날짜 {start,end} → "YYYY-MM-DD"
		d: (v) => (v && v.start ? String(v.start).slice(0, 10) : ""),
		dEnd: (v) => (v && v.end ? String(v.end).slice(0, 10) : ""),
		// 날짜시각 → "YYYY-MM-DDTHH:MM"(시각 없으면 날짜만)
		dt: (v) => { const s = v && v.start ? String(v.start) : ""; return s.length > 10 ? s.slice(0, 16) : s },
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
			state: APP_SEASON_STATE[p["상태"]] || "초안", color: APP_SEA_COLOR[p["색"]] || "",
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
		}),
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
			const run = p["운영 기간"]
			return {
				id: r.id, name: X.str(p["클래스명"]), short: X.str(p["약칭"]),
				subject: X.title("영역(학원) DB", X.id1(p["영역"]), "이름"),
				teacherId: X.id1(p["담당강사"]), fee: X.num(p["수강료"]) || 0, qty: X.num(p["월간 수업 총량"]),
				unit: X.str(p["단위"]) || "횟수", kind: X.str(p["클래스 유형"]) || "정규", arts: X.str(p["클래스 구분"]) || "교과",
				open: X.d(p["개강일"]) || X.d(run), close: X.d(p["종강일"]) || X.dEnd(run),
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
			}
			if (X.d(per)) o.from = X.d(per)
			if (X.dEnd(per)) o.to = X.dEnd(per)
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
// 이번 범위 밖(다음 출시) · 노션 대응 없음 → 빈 배열(MAPPING.md)
const APP_EMPTY = ["events", "reports", "tuition", "bookfees", "letters", "exams", "costs", "alims", "grades", "charges", "etcs", "files", "recs", "anotes", "series", "mk"]

// ---------- 불러오기 ----------
async function appList({ url, anonKey, session }, db) {
	const res = await fetch(String(url).replace(/\/+$/, "") + "/functions/v1/app-api", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-admin-key": session, Authorization: "Bearer " + anonKey, apikey: anonKey },
		body: JSON.stringify({ action: "list", db }),
	})
	let body = null
	try { body = await res.json() } catch (_) { /* 아래에서 던짐 */ }
	if (!res.ok || !body || !Array.isArray(body.rows)) throw new Error(`${db} 읽기 실패 (${res.status}${body && body.error ? " · " + body.error : ""})`)
	return body.rows
}
// 모든 DB를 먼저 받고(같은 db는 한 번) 컬렉션 순서대로 바꾼다. target 없으면 시제품 전역 DB에 끼운다.
async function appLoad({ url, anonKey, session, target }) {
	const out = target || (typeof DB !== "undefined" ? DB : null)
	if (!out) throw new Error("DB 객체가 없습니다")
	const raw = {}
	for (const coll of Object.keys(APPMAP)) {
		const db = APPMAP[coll].db
		if (raw[db]) continue
		raw[db] = new Map((await appList({ url, anonKey, session }, db)).map((r) => [r.id, r]))
	}
	return appApply(raw, out)
}
// raw = { "<DB 제목>": Map(id → app-api 줄) } → out[coll]. 검사(check.cjs)도 이 함수를 쓴다.
function appApply(raw, out) {
	const mapped = {}
	const X = appX(raw, mapped)
	for (const [coll, m] of Object.entries(APPMAP)) {
		const rows = raw[m.db] ? [...raw[m.db].values()] : []
		// _edited = 노션에서 마지막으로 고친 시각(저장할 때 그사이 노션에서 바뀌었는지 확인)
		const list = rows.map((r) => Object.assign(m.row({ ...r, props: r.props || {} }, X), { _edited: r.notion_edited_at || "" }))
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
	return out
}

if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { APPMAP, APP_EMPTY, appLoad, appApply, appX }
