/* 앱 저장 층: 시제품 전역 DB에서 새 줄·고친 줄을 모아 노션 속성 값으로 바꿔 app-api save로 보낸다(appdata.js APPMAP의 역방향). 칸 대응은 앱자료-칸대응.md */

// ---------- 보조(appdata.js가 먼저 불려 있으면 그 표를 그대로 쓴다 — 한 곳에서 정함) ----------
const APPS_DAYS = typeof APP_DAYS !== "undefined" ? APP_DAYS : ["월", "화", "수", "목", "금", "토", "일"]
const APPS_SEA_COLOR_IN = typeof APP_SEA_COLOR !== "undefined" ? APP_SEA_COLOR : { 초록: "green", 파랑: "blue", 보라: "purple", 분홍: "pink", 주황: "orange", 노랑: "yellow", 빨강: "red", 갈색: "brown", 회색: "gray" }
const APPS_SEA_COLOR = Object.fromEntries(Object.entries(APPS_SEA_COLOR_IN).map(([ko, en]) => [en, ko])) // 영문 키 → 노션 옵션
const APPS_CLS_HEX = typeof APP_CLS_HEX !== "undefined" ? APP_CLS_HEX : { 빨강: "#E5484D", 주황: "#F0A35E", 노랑: "#E8C547", 초록: "#5BBF8A", 파랑: "#7FA6D9", 보라: "#B794F6", 분홍: "#E88FB5", 갈색: "#B08D6E", 회색: "#A3A3A3", 기본: "#CFC8BE" }
const APPS_PRE = ["어머니", "아버지", "기타 보호자"] // 학생 [우선 연락 대상] 노션 선택지("학생"은 없음)
// 시즌 색: 노션 9색에 있는 것만(기본 등 그 밖은 빈 값)
const appsSeaColor = (k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(APPS_SEA_COLOR, k) ? APPS_SEA_COLOR[k] : Object.values(APPS_SEA_COLOR).includes(k) ? k : "")
// 관계 대상이 먼저 오는 순서
// 일정 세부 구분 · 기록(내부용) 저장 — 서버가 받음(노션서버 PR #459) + 원본에 칸 있음(노션완성 261118). 운영 학원은 이 칸을 넣은 뒤에 이 판을 적용
const APPS_EV_MORE = true
// 시간표 기간을 새 두 칸(`시작일` · `종료일`)으로 쓰기 — 서버 받음(노션서버 PR #463) + 원본에 칸 있음(노션완성 261118, 32줄 옮김). 운영 학원은 이 칸을 넣고 옮긴 뒤 이 판을 적용
const APPS_BLOCK_2DATE = true
const APPS_ORDER = ["areas", "glevels", "schools", "subjects", "teachers", "seasons", "books", "classes", "routines", "students", "enrolls", "blocks", "progress", "events", "tests", "exams", "grades"]
// 루틴 저장: 서버 저장 층이 루틴(학원) DB를 받은 뒤 true(appdata.js APP_RT_ON과 함께)
const APPS_RT_ON = true /* 노션서버 PR #478 — save create/update, 칸 5개만(그 밖은 400), 지우기 안 엶 */
const APPS_MAX = 60 // app-api 한 요청 줄 수
// 마지막으로 노션과 같았던 값(id → 노션 속성 값). 고친 줄은 이것과 다른 칸만 보낸다(읽을 때 뭉개진 칸을 덮어쓰지 않게)
const APPS_BASE = new Map()

const appsIsId = (s) => typeof s === "string" && s.length <= 36 && /^[0-9a-f]{32}$/i.test(s.replace(/-/g, ""))
const appsDirty = (coll, row) => (coll === "seasons" ? !!row.dirty : row.state === "draft")

function appSaveX(DB, warn) {
	const say = (m) => { if (warn) warn.push(m) }
	const X = {
		// 노션 칸이 글일 수도 고르기(선택)일 수도 있는 값(524판 — 학생 "학생과의 관계"가 글 → 선택으로 바뀐다). 앱은 어느 형식이든 글자 하나로 보내고
		// 서버가 노션 칸 형식을 보고 글 · 선택으로 쓴다. 다만 선택일 때 선택지에 없는 값은 서버가 그 줄을 통째로 거절하므로(새 선택지를 만들지 않음),
		// 노션 선택지 목록을 받았으면(live.js liveOptions → window.LIVE_SEL) 없는 값은 그 칸만 빼고 알린다. 목록이 없으면(= 글 칸) 그대로 보낸다.
		opt: (prop, v, who) => { const s = X.str(v); const list = typeof globalThis !== "undefined" && globalThis.LIVE_SEL && globalThis.LIVE_SEL[prop]; if (s && Array.isArray(list) && list.length && !list.includes(s)) { say(`${who || ""} ${prop} '${s}'은(는) 노션 선택지에 없어 보내지 않았어요 — 노션에서 선택지를 먼저 만들어요`.trim()); return undefined } return s },
		// 관계 값: 노션 id는 그대로, 저장 전 새 줄 id는 "tmp:<id>", 앱 전용(_none 등)·빈 값은 뺀다
		ref: (id) => (!id || String(id).startsWith("_") ? null : appsIsId(id) ? String(id) : "tmp:" + id),
		rel: (id) => { const v = X.ref(id); return v ? [v] : [] },
		rels: (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(X.ref).filter(Boolean))],
		// 이름 → 그 컬렉션 줄의 관계 값. 이름이 비면 [], 못 찾으면 undefined(그 칸은 보내지 않음)
		byName: (coll, name, what) => {
			if (!name) return []
			const r = (DB[coll] || []).find((x) => !x.del && x.name === name)
			if (!r) { say(`${what}: '${name}'을(를) ${coll}에서 찾지 못해 그 칸은 보내지 않았어요`); return undefined }
			return X.rel(r.id)
		},
		// 여러 이름 → 관계 값. 없는 이름이 하나라도 섞이면 그 칸은 통째로 보내지 않음(undefined) — 찾은 것만 보내면 노션 관계가 말없이 줄어든다(담당 261118)
		byNames: (coll, names, what) => {
			const out = []
			let miss = false
			for (const n of Array.isArray(names) ? names : []) { const v = X.byName(coll, n, what); if (v) out.push(...v); else miss = true }
			return miss ? undefined : [...new Set(out)]
		},
		str: (v) => (v == null ? "" : String(v)),
		// 제목(title) 만들기: 그 줄 · 그 줄의 이름 · 빈 조각을 뺀 이어 붙이기(다 비면 undefined = 보내지 않음)
		row: (coll, id) => (id ? (DB[coll] || []).find((x) => x && x.id === id) || null : null),
		nameOf: (coll, id) => { const r = X.row(coll, id); return r ? X.str(r.name).trim() : "" },
		join: (sep, ...parts) => parts.filter(Boolean).join(sep) || undefined,
		enrollName: (e) => (e ? X.join(" ", X.nameOf("students", e.studentId), X.nameOf("classes", e.classId)) : undefined), // 등록 이름 = "학생 반"
		// 학생 [우선 연락 대상]: 노션 선택지에 없는 값(예: 학생)은 보내지 않고 알린다
		pre: (v, who) => {
			const s = X.str(v)
			if (!s || APPS_PRE.includes(s)) return s
			say(`학생 ${who || ""}: 우선 연락 대상 '${s}'은(는) 노션 선택지(${APPS_PRE.join(" · ")})에 없어 그 칸은 보내지 않았어요`)
			return undefined
		},
		num: (v) => (v === "" || v == null || !isFinite(+v) ? null : +v),
		d: (v) => (v ? String(v).slice(0, 10) : null),
		// "YYYY-MM-DDTHH:MM" → 시각이 있으면 한국 시각(+09:00)
		dt: (v) => { const s = X.str(v); return !s ? null : s.length > 10 ? s.slice(0, 16).replace(" ", "T") + ":00+09:00" : s },
		range: (a, b) => (a ? { start: String(a).slice(0, 10), end: b && b !== a ? String(b).slice(0, 10) : null } : null),
		hhmm: (m) => (typeof m === "number" && isFinite(m) ? String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") : ""),
		// 클래스 색: 10색이면 [색]=이름·[색 코드] 비움, 아니면 [색 코드]=#RRGGBB + [색]=가장 가까운 이름
		color: (hex) => {
			const h = X.str(hex).toUpperCase()
			if (!/^#[0-9A-F]{6}$/.test(h)) return { name: "", code: "" }
			const rgb = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
			let best = "", gap = Infinity
			for (const [name, v] of Object.entries(APPS_CLS_HEX)) {
				if (v.toUpperCase() === h) return { name, code: "" }
				const a = rgb(h), b = rgb(v.toUpperCase()), g = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
				if (g < gap) { gap = g; best = name }
			}
			return { name: best, code: h }
		},
		// 개별 진도: 학생 + 클래스 → 등록 id(앞서 읽은 등록이 맞으면 그것, 아니면 끝나지 않은 등록 먼저)
		enrollOf: (studentId, classId, pref) => {
			const L = (DB.enrolls || []).filter((e) => !e.del && e.studentId === studentId && e.classId === classId)
			const e = L.find((x) => x.id === pref) || L.find((x) => !x.end && !x.ended) || L[0]
			return e ? e.id : ""
		},
		_db: DB,
		today: (() => { const n = new Date(), p = (v) => String(v).padStart(2, "0"); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}` })(),
		// 시간표 적용 기간: 시작이 있으면 그대로. 끝만 있으면(노션 날짜는 시작이 꼭 있어야 함) 시작을 시즌 시작일 → 클래스 개강일로 채운다.
		// 둘 다 없으면 보내지 않고 알린다(끝나는 날이 노션에 안 들어가면 그 시간표로 수업이 계속 만들어지므로).
		period: (r) => {
			const f = X.periodFrom(r)
			if (f === undefined) return undefined
			return f ? X.range(f, r.to) : null
		},
		// 시작일: 있으면 그대로, 끝만 있으면 시즌 시작일 → 클래스 개강일. 둘 다 없으면 null(비움), 시작을 알 수 없으면 undefined(보내지 않고 알림)
		periodFrom: (r) => {
			if (r.from) return r.from
			if (!r.to) return null
			const sea = X.row("seasons", r.seasonId), cls = X.row("classes", r.classId)
			const from = (sea && !sea._virtual && sea.start) || (cls && cls.open) || ""
			if (from && String(from).slice(0, 10) <= String(r.to).slice(0, 10)) return from
			say(`시간표 ${X.nameOf("classes", r.classId)}: 끝나는 날(${r.to})만 있고 시작일을 알 수 없어 기간을 보내지 않았어요 — 시작일을 넣어요`)
			return undefined
		},
		// 개별 진도 줄의 반 교재(같은 클래스·같은 교재의 그룹 줄)
		tplOf: (row) => {
			if (row._tplId) return row._tplId
			const g = (DB.progress || []).find((x) => !x.del && x !== row && !x.studentId && x.classId === row.classId && x.bookId === row.bookId)
			return g ? g.id : ""
		},
	}
	return X
}
const DB_OF = (X) => X._db || {}
// 학생 · 엑셀에서 적은 학교 이름이 학교 묶음에 없으면 학교 줄을 먼저 만든다(새 줄 → 노션 학교 DB에 생기고 학생이 그 줄에 이어짐)
function appsEnsureSchools(DB) {
	const have = new Set((DB.schools || []).filter((x) => !x.del).map((x) => x.name))
	for (const s of DB.students || []) {
		const name = s && !s.del ? String(s.school || "").trim() : ""
		if (!name || have.has(name)) continue
		if (!(!appsIsId(s.id) || appsDirty("students", s))) continue // 고치지 않은 줄은 건드리지 않는다
		;(DB.schools = DB.schools || []).push({ id: "sch" + Math.random().toString(36).slice(2, 8), name, kind: "", addr: "", state: "draft" })
		have.add(name)
	}
}
// 값이 정해진 칸만 넣는다(undefined = 보내지 않음)
const appsPut = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o }

// 시간표 제목: "반이름 (요일) HH:mm~HH:mm". 반을 모르면 보내지 않음
function appsBlockName(r, X) {
	const cls = X.nameOf("classes", r.classId), day = APPS_DAYS[r.day] || "", s = X.hhmm(r.start), e = X.hhmm(r.end)
	return cls ? [cls, day && `(${day})`, (s || e) && `${s}~${e}`].filter(Boolean).join(" ") : undefined
}
// 서버가 줄을 거절한 이유를 사람이 알 수 있는 안내로("선택지에 없음: 칸 = 값")
function appsFailText(coll, error) {
	const m = /^선택지에 없음:\s*(.+?)\s*=\s*(.*)$/.exec(String(error || ""))
	if (!m) return error
	const db = String((APPSAVE[coll] && APPSAVE[coll].db) || "").replace("(학원)", "")
	return `노션 ${db}의 [${m[1]}] 선택지에 '${m[2]}'이(가) 없어요 — 노션에서 선택지를 먼저 만들거나 있는 것으로 골라요`
}

// ---------- 컬렉션 대응(시제품 줄 → 노션 속성) ----------
const APPSAVE = {
	areas: {
		db: "영역(학원) DB",
		props: (r, X) => appsPut({
			"이름": X.str(r.name), "교습과정": X.str(r.course),
			"순서": r._order === undefined ? undefined : X.num(r._order), "사용": r._on === undefined ? undefined : !!r._on,
		}),
	},
	glevels: {
		db: "학년(학원) DB",
		props: (r, X) => appsPut({
			"이름": X.str(r.name), "사용": !!r.on,
			"순서": r._order === undefined ? undefined : X.num(r._order), "학교구분": r._kind === undefined ? undefined : X.str(r._kind),
		}),
	},
	schools: {
		db: "학교(학원) DB",
		props: (r, X) => ({ "이름": X.str(r.name), "학교 구분": X.str(r.kind), "주소": X.str(r.addr) }),
	},
	// 클래스 루틴(261119): 이름 · 클래스 · 순서 · 설명 · 쉬기만. 지우기는 다른 묶음처럼 보내지 않음(노션에서 직접)
	routines: {
		db: "루틴(학원) DB",
		props: (r, X) => ({ "이름": X.str(r.name), "클래스": X.rel(r.classId), "순서": X.num(r.ord), "설명": X.str(r.desc), "쉬기": !!r.rest }),
	},
	subjects: {
		db: "과목(학원) DB",
		props: (r, X) => appsPut({
			"이름": X.str(r.name), "이모지": X.str(r.emoji),
			"영역": X.byName("areas", r.area, "과목 영역"), "학년": X.byNames("glevels", r.grades, "과목 학년"), "비고": X.str(r.memo),
		}),
	},
	teachers: {
		db: "강사(학원) DB",
		props: (r, X) => ({
			"이름": X.str(r.name), "직책": X.str(r.role), "연락처": X.str(r.phone),
			"출근 요일": APPS_DAYS.filter((d) => X.str(r.days).split(",").map((s) => s.trim()).includes(d)),
			"입사일": X.range(r.hire), "퇴사일": X.range(r.quit), // 261124: 재직 상태(수식)는 보내지 않음 · 바뀐 칸만 감
		}),
	},
	seasons: {
		db: "시즌(학원) DB",
		props: (r, X) => ({
			// `상태`는 보내지 않음(261118 대표 "시즌 상태 수식으로" — 노션이 기간에서 계산, 읽기만 appdata.js APP_SEASON_STATE)
			"이름": X.str(r.name), "기간": X.range(r.start, r.end), "색": appsSeaColor(r.color),
		}),
	},
	books: {
		db: "라이브러리(학원) DB",
		props: (r, X) => ({
			"교재명": X.str(r.name), "과목": X.rel(r.subjectId), "구분": X.str(r.kind),
			"시리즈": X.str(r.series), "교재 유형": Array.isArray(r.types) ? r.types.map(String).filter(Boolean) : [], "교육과정": X.str(r.curr), "출판사": X.str(r.pub),
			"전체 분량": X.num(r.total), "진도 단위": X.str(r.unit), "가격": X.num(r.price), "사용중": !!r.using,
			"ISBN13": X.str(r.isbn), "기타경비 항목": X.str(r.etcItem),
		}),
	},
	classes: {
		db: "클래스(학원) DB",
		props: (r, X) => {
			const c = X.color(r.hex)
			return appsPut({
				"클래스명": X.str(r.name), "약칭": X.str(r.short), "영역": X.byName("areas", r.subject, "클래스 영역"),
				"담당강사": X.rel(r.teacherId), "수강료": X.num(r.fee), "월간 수업 총량": X.num(r.qty),
				"단위": X.str(r.unit), "클래스 유형": X.str(r.kind), "클래스 구분": X.str(r.arts),
				"개강일": X.d(r.open), "종강일": X.d(r.close), // 운영 기간은 쓰지 않는다
				"색": c.name, "색 코드": c.code, "신고 교습과정명": X.str(r.course), "기타경비": X.rels(r.etcIds),
				"이모지": r._emoji === undefined ? undefined : X.str(r._emoji),
			})
		},
	},
	students: {
		db: "학생(학원) DB",
		props: (r, X) => appsPut({
			"학생이름": X.str(r.name),
			"학교": X.byName("schools", r.school, "학생 학교"), "학년": X.byName("glevels", r.grade, "학생 학년"),
			"어머니 연락처": X.str(r.mom), "아버지 연락처": X.str(r.dad), "학생 연락처": X.str(r.sp),
			"기타 보호자 연락처": X.str(r.gp), "학생과의 관계": X.opt("학생과의 관계", r.gprel, r.name),
			"우선 연락 대상": X.pre(r.pre, r.name), "등록 보류": !!r.hold, "메모(내부용)": X.str(r.memo),
			/* 개인정보 동의는 보내지 않는다: 노션 학생 DB 자동화가 "페이지 추가 + 개인정보 동의 ☑"에서 접수 안내 알림톡을 보낸다 — 체크는 노션에서 */
			"문의일": X.dt(r.inq), "문의 경로": X.str(r.route), "희망 시작일": X.d(r.hope),
			"생년월일": X.d(r.birth), "성별": X.str(r.gender), "주소": X.str(r.addr), "형제/자매": X.rels(r.sib),
		}),
	},
	enrolls: {
		db: "등록(학원) DB",
		props: (r, X) => appsPut({
			"이름": X.enrollName(r), // title "학생 반"
			"학생정보": X.rel(r.studentId), "클래스": X.rel(r.classId), "등록일": X.d(r.start), "종료일": X.d(r.end),
			"수강료 조정": +r.discount ? 0 - +r.discount : null, // 시제품 discount(깎는 금액, 양수) → 조정(음수 = 할인). 0은 비움
			"등록 안내 메모": X.str(r.note), "메모(내부용)": X.str(r.memo),
		}),
	},
	blocks: {
		db: "시간표(학원) DB",
		props: (r, X) => appsPut({
			"이름": appsBlockName(r, X), // title "반 (요일) HH:mm~HH:mm"
			"시즌": X.rel(r.seasonId), "클래스": X.rel(r.classId), "요일": APPS_DAYS[r.day] || "",
			"등원시간(HH:mm)": X.hhmm(r.start), "하원시간(HH:mm)": X.hhmm(r.end),
			"등록": X.rels(r.regs), "수업 방식": r.mode === "individual" ? "개별 수업" : "그룹 수업",
			// 기간: 노션에 `시작일` · `종료일`이 생기고 서버가 받으면(APPS_BLOCK_2DATE) 새 두 칸, 그 전엔 옛 `적용 기간`
			...(APPS_BLOCK_2DATE
				? (() => { const f = X.periodFrom(r); return f === undefined ? {} : { "시작일": f ? X.d(f) : null, "종료일": f && r.to ? X.d(r.to) : null } })()
				: { "적용 기간": X.period(r) }),
		}),
	},
	progress: {
		db: "진도관리(학원) DB",
		props: (r, X) => {
			// solo = 학생 한 명의 줄(개별 진도 + 학생 있음). 개별 진도라도 학생이 없으면 그 반의 기준 교재(반 교재)다 — 클래스를 쓰고 제목은 "교재 · 반"
			const solo = r.mode === "개별" && !!r.studentId, indiv = r.mode === "개별", book = X.nameOf("books", r.bookId)
			const enId = solo ? X.enrollOf(r.studentId, r.classId, r._enrollId) : ""
			// title: 개별 줄 "교재명 · 등록 이름", 반 교재(그룹 줄) "교재명 · 반 이름"
			const title = X.join(" · ", book, solo ? X.enrollName(X.row("enrolls", enId)) : X.nameOf("classes", r.classId))
			// 개별 줄에는 클래스 · 주제를 쓰지 않는다(서버 [교재 생성]과 같은 모양 — 반 교재 조회가 클래스로 하므로)
			return appsPut({
				"진도교재": title,
				"라이브러리": X.rel(r.bookId), "클래스": solo ? undefined : X.rel(r.classId), "진도방식": indiv ? "개별 진도" : "그룹 진도",
				// 반 교재(그룹 줄)의 등록 = 그 반을 지금 다니는 등록 전부(서버 [교재 생성]과 같은 규칙 — 반 전체가 한 줄을 같이 씀).
				// 개별 진도의 기준 교재는 학생마다 따로 줄이 생기므로 등록을 잇지 않는다
				"등록": solo ? X.rel(enId) : indiv ? [] : X.rels((DB_OF(X).enrolls || []).filter((e) => !e.del && e.classId === r.classId && !e.ended && !(e.end && e.end < X.today)).map((e) => e.id)),
				"반별교재": solo ? X.rel(X.tplOf(r)) : [],
				"진행상태": X.str(r.stat) || "다음 교재", "주제": solo ? undefined : X.str(r.topic),
			})
		},
	},
	// 일정(2.8, 담당 261118): 이미 있는 일정의 이름 · 날짜 · 구분 · 잠금 · 숨김 · 학부모 공개 · 보일 범위(클래스 · 학생 · 학교 · 학년) — 서버가 받는 10칸 안. 새 일정은 보내지 않음
	// 날짜: 시각이 있는 일정(_time)은 보내지 않음(날짜만 보내면 시각이 지워짐 — 노션에서). 잠긴 줄 날짜는 appsEvLock이 거름
	// 구분(kind)은 노션에서 수식이 될 예정이라 읽기만(담당 261118). 세부 구분 · 기록(내부용)은 서버 저장 층이 받게 되면(APPS_EV_MORE) 보냄
	events: {
		db: "일정(학원) DB",
		props: (r, X) => appsPut({
			// 잠금 칸은 쓰지 않음(대표 261118: `잠금` 칸을 버리고 학사 일정은 자동 잠금 — appsEvLock)
			"이름": X.str(r.name), "날짜": r._time ? undefined : X.range(r.start, r.end),
			"세부 구분": APPS_EV_MORE ? X.str(r.sub) : undefined, "기록(내부용)": APPS_EV_MORE ? X.str(r.rec) : undefined,
			"숨김": !!r.hide, "학부모 공개": !!r.pub,
			"클래스": X.rels(r.classIds), "학생": X.rels(r.students), "학교": X.rels(r.schools),
			"학년": X.byNames("glevels", r.grades, "일정 학년"), // 학년 이름 → 학년(학원) DB id
			// 담당자(직원 한 명). 할 일 달성여부 · 우선순위(261124 대표 "노션에서 바뀌면 앱도" — 홈 [✔️] · [✖️] · 창 고르기 · 보드 끌기).
			// 앱은 글자만(달성 · 미달성 · 중요 · 보류) 보내고, 노션 선택지에 아이콘이 붙어 있으면 서버가 그 선택지로 맞춘다. 바뀐 칸만 가므로 할 일이 아닌 일정은 보내지 않음
			"담당자": X.rels(r.who ? [r.who] : []),
			"달성여부": X.str(r.ach), "우선순위": X.str(r.pri),
		}),
	},
	// 시험(261123 시험 보강 — 서버 WRITE_DBS에 이미 열림, 칸 제한 없음). 노션에서 사람이 고치는 칸만 보낸다.
	// 시험(학원): 연도 · 시험 구분 · 회차. 이름은 노션 규칙 "연도 시험"(노션 [편집] 시험 이름 자동화가 다시 계산해도 같은 값)
	tests: {
		db: "시험(학원) DB",
		props: (r, X) => ({
			"이름": X.str(r.name), "연도": X.str(r.year), "시험 구분": X.str(r.kind),
			"지필고사": r.kind === "지필고사" ? X.str(r.term) : "", "모의고사(수능)": r.kind === "모의고사" ? X.str(r.mock) : "",
		}),
	},
	// 시험정보(학원): 시험 · 학교 · 학년 · 과목 · 시험일 · 시험일정 · 시험 범위(단원목록). 이름은 노션 [편집] 시험정보 이름 자동화("시험 (학교 학년 영역)")가 만든다
	exams: {
		db: "시험정보(학원) DB",
		props: (r, X) => appsPut({
			"시험": X.rel(r.testId), "학교": X.byName("schools", r.school, "시험 학교"), "학년": X.byName("glevels", r.grade, "시험 학년"),
			"과목": X.rels(r.subjectIds), "시험일": X.d(r.date), "시험일정": X.rel(r.periodId),
			"단원목록": X.rels((r.unitIds || []).filter(appsIsId)), // 노션 단원 id만(예시 자료의 단원은 보내지 않음)
		}),
	},
	// 성적(학원): 학생마다 한 줄 — 노션 [응시학생 등록](학생 자동화 [생성] 응시 성적)과 같은 칸(학생 · 시험정보 · 학년 · 학교) + 사람이 넣는 점수 · 등수 · 응시인원 · 등급.
	// 학년 · 학교는 만들 때만(그 학생의 지금 학년 · 학교 — appsOff가 고치기에서 뺀다). 이름은 노션 [편집] 성적 이름 자동화가 만든다. 시험지 · 성적표 파일은 노션에서
	grades: {
		db: "성적(학원) DB",
		props: (r, X) => {
			const s = X.row("students", r.sid) || {}
			return appsPut({
				"학생": X.rel(r.sid), "시험정보": X.rel(r.examId),
				"학년": X.byName("glevels", s.grade, "성적 학년"), "학교": X.byName("schools", s.school, "성적 학교"),
				"점수": X.num(r.score), "등수": X.num(r.rank), "응시인원": X.num(r.total), "등급": X.str(r.level),
			})
		},
	},
}

// ---------- 기준 값(불러온 직후 · 저장 직후) ----------
// appLoad 뒤에 한 번 부른다. 고치지 않은 노션 줄의 지금 값을 적어 둔다.
function appSaveMark(DB) {
	const X = appSaveX(DB, null)
	for (const coll of APPS_ORDER) for (const row of DB[coll] || []) {
		if (row._virtual || !appsIsId(row.id) || appsDirty(coll, row) || row.del) continue
		APPS_BASE.set(coll + ":" + row.id, JSON.stringify(APPSAVE[coll].props(row, X)))
	}
}

// ---------- 보내지 않는 것(0단계, 대표 261117 "앱 → 서버 → 노션") ----------
// 노션 버튼 · 서버 동작이 딸린 일까지 하는 것은 앱이 "임의 칸 쓰기"로 보내지 않는다(같은 일의 길이 둘이 되지 않게). 화면도 같은 것을 잠근다(live.js).
//   통째로: 라이브러리(서버 textbook-api가 단원까지 함) · 학교(school-api가 학교 코드까지 함)
//   진도관리: 학생 한 명의 줄(개별 진도 복사 = 노션 [교재 생성]) · 이미 있는 줄의 진행상태(수료 = 노션 [수료])
//   등록: 이미 있는 줄의 종료일(노션 [종료 처리]) / 시간표: 수업이 만들어진 줄의 요일 · 시간 · 명단 · 적용 기간(출석이 함께 맞춰져야 함)
// events: 서버 저장 층이 일정 DB를 받음(PR #450, 2e8da51 — 일정 저장 칸 10개: 이름·날짜·구분·잠금·숨김·학부모 공개·클래스·학생·학교·학년). 앱은 그중 보이기 칸 6개만 보냄
const APPS_OFF = ["schools"]
function appsOff(coll, row, isNew, send) {
	if (APPS_OFF.includes(coll)) return "all"
	if (coll === "books" && isNew) return "all" // 261119: 새 교재는 라이브러리 등록(textbook-api register-custom)으로만 — 서버가 save create를 400으로 거절
	if (coll === "routines" && !APPS_RT_ON) return "all"
	if (coll === "events" && isNew) return "all" // 새 일정은 노션에서
	// 실제 자료 모드에서 일정 쓰기 칸(P2e — live.js LIVE_EVW)이 꺼져 있으면 일정은 보내지 않음(261119 원본검수 Z2)
	if (coll === "events" && typeof window !== "undefined" && window.LIVE && window.LIVE.loaded && !window.LIVE_EVW) return "all"
	// 시험 쓰기 칸(P2x — live.js LIVE_EXW)이 꺼져 있으면 시험 · 시험정보 · 성적은 보내지 않음(일정 P2e와 같은 방식)
	if ((coll === "tests" || coll === "exams" || coll === "grades") && typeof window !== "undefined" && window.LIVE && window.LIVE.loaded && !window.LIVE_EXW) return "all"
	if (coll === "grades" && !isNew) { delete send["학년"]; delete send["학교"] } // 학년 · 학교는 만들 때만(노션 자동화가 학생 값을 한 번 복사하는 것과 같음)
	if (coll === "progress") { if (row.mode === "개별" && row.studentId) return "all"; if (!isNew) delete send["진행상태"] }
	if (coll === "enrolls" && !isNew) delete send["종료일"]
	if (coll === "blocks" && !isNew && row.lessons) ["요일", "등원시간(HH:mm)", "하원시간(HH:mm)", "등록", "적용 기간", "시작일", "종료일", "이름"].forEach((k) => delete send[k])
	return ""
}

// 일정 자동 잠금과 날짜(대표 261118: `잠금` 칸을 버리고 학사 일정은 자동 잠금 — 화면이 끌기를 막고, 여기서도 날짜를 보내지 않는다)
//   학사 일정(구분 수식 값에 "학사 일정")인데 날짜가 바뀜 → 날짜를 노션 값으로 되돌리고 알림
// 돌려줌: partial 여부(지금은 늘 false)
function appsEvLock(row, base, send, say) {
	if (!("날짜" in send)) return false
	// 기준 = 노션에 저장된 구분(_kind0, 화면 SAVEDC 판정과 같음 — 앱에서 세부 구분을 바꿔도 저장 전엔 잠김 유지)
	if (!/학사 일정/.test(String(row._kind0 !== undefined ? row._kind0 : row.kind || ""))) return false
	delete send["날짜"]
	const d = base && base["날짜"]
	if (d && d.start) { row.start = d.start; row.end = d.end || "" }
	say(`일정 ${row.name || ""}: 학사 일정은 날짜를 바꿀 수 없어 되돌렸어요 — 학교 학사일정에서 와요`.trim())
	return false
}

// ---------- 모으기 ----------
// 지우기(서버 save op:"delete", 노션 휴지통 + 사본 삭제)를 받는 DB(앱 컬렉션 → 노션 DB). 그 밖은 앱에서 지우지 않음(서버가 요청 전체를 400으로 거절하므로 앱이 미리 걸러 이유를 보여 줌).
// 지우는 순서 = 딸린 줄 먼저(진도 → 시간표 → 등록 → 학생 → 클래스 → 시즌 → 강사 → 과목 → 영역): 서버가 연결된 기록이 있으면 막기 때문
const APPS_DEL_ORDER = ["progress", "blocks", "enrolls", "students", "classes", "seasons", "teachers", "subjects", "areas"]
// only(coll, row) = 이 줄만 모으는 거름(창 [저장]); 없으면 모두(위 [저장])
function appSaveCollect(DB, only) {
	const warn = [], changes = [], refs = [], noop = [], dels = [], delRows = [], refused = []
	let warnKeep = 0
	const X = appSaveX(DB, warn)
	const made = new Set() // 이 요청에서 먼저 만들어지는 tmp
	for (const coll of APPS_ORDER) {
		let rows = (DB[coll] || []).slice()
		if (coll === "progress") rows.sort((a, b) => (a.mode === "개별") - (b.mode === "개별")) // 반 교재(그룹) 먼저
		for (const row of rows) {
			if (!row || row._virtual) continue
			if (only && !only(coll, row)) continue
			warn.length = warnKeep // 앞 줄이 보낼 것 없이 넘어갔으면 그 줄의 알림은 버린다(이미 저장된 줄 알림이 저장마다 되풀이되지 않게)
			const isNew = !appsIsId(row.id)
			if (row.del) { // 지우기: 노션에 있는 줄만(저장 전 새 줄은 화면에서만 사라짐). 허용 DB는 아래에서 op:"delete"로, 그 밖은 이유와 함께 거절
					if (!isNew) { dels.push({ coll, id: row.id, name: row.name || "" }); if (APPS_DEL_ORDER.includes(coll)) delRows.push({ coll, row }); else refused.push({ coll, row }) }
					continue
				}
			// 창 아래 [ㅇㅇ 저장]은 앱 안에서만 "저장됨"으로 바꾸므로, 작성 중 표시가 없어도 불러온 값(기준)과 달라진 줄은 보낸다
			if (!isNew && !appsDirty(coll, row) && !APPS_BASE.has(coll + ":" + row.id)) continue
			const props = APPSAVE[coll].props(row, X)
			if (appsOff(coll, row, isNew, {}) === "all") { warn.length = warnKeep; continue } // 보내지 않는 묶음 · 줄
			// 아직 만들어지지 않은 줄(뒤에 오는 새 줄 · 삭제 예정 새 줄)을 가리키는 관계는 이번엔 빼고, 그 줄은 작성 중으로 남긴다
			let partial = false
			for (const [k, v] of Object.entries(props)) {
				if (!Array.isArray(v) || !v.some((s) => typeof s === "string" && s.startsWith("tmp:"))) continue
				const keep = v.filter((s) => !String(s).startsWith("tmp:") || made.has(s))
				if (keep.length !== v.length) { props[k] = keep; partial = true }
			}
			if (partial) warn.push(`${coll} ${row.name || row.id}: 아직 저장 전인 줄과의 연결은 다음 저장 때 들어가요`)
			if (isNew) {
				const tmp = "tmp:" + row.id
				changes.push({ op: "create", db: APPSAVE[coll].db, tmp, props })
				made.add(tmp)
				refs.push({ coll, row, partial }); warnKeep = warn.length
				continue
			}
			// 고친 줄: 기준 값이 있으면 달라진 칸만
			let send = props
			const base = APPS_BASE.has(coll + ":" + row.id) ? JSON.parse(APPS_BASE.get(coll + ":" + row.id)) : null
			if (base) {
				send = {}
				for (const [k, v] of Object.entries(props)) if (JSON.stringify(v) !== JSON.stringify(base[k])) send[k] = v
				appsOff(coll, row, false, send) // 노션 버튼이 하는 칸은 뺀다
				// 작성 중 표시가 없는 줄은 사람이 고친 칸만: 다른 줄 이름에서 만들어지는 제목(등록 · 시간표 `이름`, 진도 `진도교재`)은 따라 보내지 않는다
				if (!appsDirty(coll, row)) {
					if (coll === "enrolls" || coll === "blocks") delete send["이름"]
					if (coll === "progress") delete send["진도교재"]
					if (!Object.keys(send).length) continue
				}
				if (!Object.keys(send).length) { noop.push({ coll, row }); continue }
			}
			if (!base) { appsOff(coll, row, false, send); if (!Object.keys(send).length) { noop.push({ coll, row }); continue } }
			if (coll === "events" && appsEvLock(row, base, send, (m) => warn.push(m))) partial = true
			if (coll === "events" && !Object.keys(send).length) { noop.push({ coll, row }); warnKeep = warn.length; continue } // 되돌림 알림은 남긴다
			const ch = { op: "update", db: APPSAVE[coll].db, id: row.id, props: send }
			if (row._edited) ch.edited = row._edited
			changes.push(ch)
			refs.push({ coll, row, partial }); warnKeep = warn.length
		}
	}
	warn.length = warnKeep
	// 지우기는 만들기·고치기 뒤에, 딸린 줄 먼저
	for (const coll of APPS_DEL_ORDER) for (const d of delRows) {
		if (d.coll !== coll) continue
		const ch = { op: "delete", db: APPSAVE[coll].db, id: d.row.id }
		if (d.row._edited) ch.edited = d.row._edited
		changes.push(ch); refs.push({ coll, row: d.row, del: true })
	}
	return { changes, refs, noop, dels, refused, warn }
}

// ---------- 보내기 ----------
async function appSavePost({ url, anonKey, session }, changes) {
	const { res, body } = await appPostJson(String(url).replace(/\/+$/, "") + "/functions/v1/app-api", { /* 노션이 바쁘면(503 busy) 한 번 자동 재시도 — 저장은 노션에 쓰기 전 단계에서 끊겨 중복 없음(appdata.js) */
		method: "POST",
		headers: { "Content-Type": "application/json", "x-admin-key": session, Authorization: "Bearer " + anonKey, apikey: anonKey },
		body: JSON.stringify({ action: "save", changes }),
	})
	if (!res.ok || !body || !Array.isArray(body.results)) throw new Error(`저장 실패 (${res.status}${body && body.error ? " · " + body.error : ""})`)
	return body.results
}
// DB 전체에서 옛 id를 가리키는 칸(글자 · 글자 배열)을 새 id로
function appSaveRemap(DB, oldId, newId) {
	for (const list of Object.values(DB)) {
		if (!Array.isArray(list)) continue
		for (const row of list) {
			if (!row || typeof row !== "object") continue
			for (const k of Object.keys(row)) {
				const v = row[k]
				if (v === oldId) row[k] = newId
				else if (Array.isArray(v) && v.includes(oldId)) row[k] = v.map((x) => (x === oldId ? newId : x))
			}
		}
	}
}
// opts = { only(coll,row): 이 줄만(창 [저장]) · step: 한 번에 보낼 줄(진행 n/m 단위, 기본 10) · onProgress(n, m): 보낸 줄 수 }
async function appSaveSend(conn, DB, opts) {
	opts = opts || {}
	// 노션 자료를 이번에 끝까지 받은 뒤에만 보낸다(예시 자료 · 반쯤 받은 자료가 노션에 들어가는 것을 막음)
	if (!conn || conn.loaded !== true) throw new Error("노션 자료를 다 받기 전에는 저장할 수 없어요")
	const col = appSaveCollect(DB, opts.only)
	const out = { sent: 0, ok: 0, deleted: 0, failed: [], skipped: col.noop.length, dels: [], warn: col.warn, idMap: {} }
	// 앱에서 지우지 않는 DB의 삭제 예정 줄: 보내지 않고 이유를 보여 준 뒤 삭제 예정을 풀어 숫자에 남지 않게(거짓 성공 없음)
	for (const { coll, row } of col.refused || []) {
		out.failed.push({ coll, id: row.id, name: row.name || "", error: "이 항목은 앱에서 지우지 않아요 — 노션에서 지워요(삭제 예정을 풀었어요)" })
		delete row.del
	}
	const real = new Map() // "tmp:<옛 id>" → 노션 id(앞 묶음에서 만든 것)
	const done = [] // 성공한 줄(기준 값은 id를 다 바꾼 뒤에 적는다)
	const fail = (ref, error, conflict, row) => out.failed.push({ coll: ref.coll, id: ref.row.id, name: ref.row.name || "", error, conflict: !!conflict, ...(row ? { row } : {}) })
	let stop = ""
	const STEP = Math.max(1, Math.min(APPS_MAX, opts.step || 10))
	for (let at = 0; at < col.changes.length; at += STEP) {
		const refs = col.refs.slice(at, at + STEP)
		if (stop) { refs.forEach((ref) => fail(ref, "앞 묶음 저장이 실패해 보내지 않았어요")); continue }
		if (opts.onProgress) { try { opts.onProgress(at, col.changes.length) } catch (_) {} }
		const batch = col.changes.slice(at, at + STEP).map((c) => {
			if (c.op === "delete") return { ...c } // 지우기는 props 없음
			const props = {}
			for (const [k, v] of Object.entries(c.props)) props[k] = Array.isArray(v) ? v.map((s) => (real.has(s) ? real.get(s) : s)) : v
			return { ...c, props }
		})
		let results
		try { results = await appSavePost(conn, batch) } catch (e) { stop = e.message; refs.forEach((ref) => fail(ref, e.message)); continue }
		out.sent += batch.length
		refs.forEach((ref, i) => {
			const r = results.find((x) => x.i === i)
			if (!r || !r.ok) return fail(ref, ref.del ? ((r && r.error) || "결과가 없어요") : appsFailText(ref.coll, (r && r.error) || "결과가 없어요"), r && r.conflict, r && r.conflict ? r.row : null)
			const { coll, row } = ref
			if (ref.del) { // 지우기 성공: 노션 휴지통 + 사본에서 빠짐 → 화면 목록에서도 뺌
				const arr = DB[coll] || [], at2 = arr.indexOf(row)
				if (at2 > -1) arr.splice(at2, 1)
				APPS_BASE.delete(coll + ":" + row.id)
				out.deleted++; out.ok++
				return
			}
			if (batch[i].op === "create" && r.id && r.id !== row.id) {
				const old = row.id
				real.set("tmp:" + old, r.id)
				out.idMap[old] = r.id
				appSaveRemap(DB, old, r.id) // row.id 자신도 여기서 바뀐다
				row.id = r.id
			}
			if (r.row && r.row.notion_edited_at) row._edited = r.row.notion_edited_at
			/* (261123 출시 전 5번) 노션엔 저장됐고 앱 사본만 못 맞춘 줄: 성공으로 이어 가고(새 id는 위에서 바꿈 — 다시 만들지 않음) 안내만 남긴다 */
			if (r.warn) out.warn.push({ coll, name: row.name || "", error: r.warn })
			if (!ref.partial) { if (coll === "seasons") delete row.dirty; if (row.state === "draft") row.state = "saved" }
			else if (coll === "seasons") row.dirty = true
			else row.state = "draft"
			out.ok++
			done.push(ref)
		})
	}
	// 달라진 칸이 없던 작성 중 줄은 저장된 것으로
	col.noop.forEach(({ coll, row }) => { if (coll === "seasons") delete row.dirty; else row.state = "saved" })
	// 기준 값 새로 적기(연결이 덜 들어간 줄은 기준을 비워 다음 저장 때 전부 보낸다)
	const X = appSaveX(DB, null)
	done.forEach(({ coll, row, partial }) => { if (partial) APPS_BASE.delete(coll + ":" + row.id); else APPS_BASE.set(coll + ":" + row.id, JSON.stringify(APPSAVE[coll].props(row, X))) })
	return out
}

if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { APPSAVE, APPS_ORDER, APPS_MAX, APPS_BASE, APPS_DAYS, APPS_SEA_COLOR, APPS_CLS_HEX, APPS_PRE, appsFailText, appSaveX, appSaveMark, appSaveCollect, appSaveRemap, appSavePost, appSaveSend }
