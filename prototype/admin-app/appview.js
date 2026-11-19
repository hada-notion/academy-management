/* 앱 보기 층(P2 보기 1:1): appdata.js 뒤에 불러, 아직 비어 있던 묶음(일정·보고서·가정통신문·수강료·청구서·청구 항목·비용·시험·성적·알림톡 설정·기타경비·자료)을 노션 복사본에서 읽어 채운다(읽기만). 칸 대응 표는 MAPPING-P2.md */

// ---------- 보조 ----------
const APPV_DB = {
	enroll: "등록(학원) DB", cls: "클래스(학원) DB", stu: "학생(학원) DB", lib: "라이브러리(학원) DB",
	event: "일정(학원) DB", box: "알림톡 발송함(학원) DB", report: "보고서(학원) DB", letter: "가정통신문(학원) DB",
	tuition: "수강료(학원) DB", pay: "결제(학원) DB", bill: "청구서(학원) DB", line: "청구 항목(학원) DB", billPay: "청구 결제(학원) DB",
	etc: "기타경비(학원) DB", exam: "시험(학원) DB", examInfo: "시험정보(학원) DB", grade: "성적(학원) DB",
	alim: "알림톡 설정(학원) DB", file: "자료(학원) DB",
}
// appLoad가 더 받아야 할 DB(appdata.js APPMAP의 DB는 빼고)
const APPV_DBS = [APPV_DB.event, APPV_DB.box, APPV_DB.report, APPV_DB.letter, APPV_DB.tuition, APPV_DB.pay, APPV_DB.bill, APPV_DB.line, APPV_DB.billPay, APPV_DB.etc, APPV_DB.exam, APPV_DB.examInfo, APPV_DB.grade, APPV_DB.alim, APPV_DB.file]
const APPV_ETC6 = ["모의고사비", "재료비", "피복비", "급식비", "기숙사비", "차량비"]
// 일정 진행상태: 노션(시작 전·진행 중·미완료·완료) → 시제품(예정·진행 중·완료). 미완료는 시제품에 없는 값이라 그대로 둔다
const APPV_EV_STAT = { "시작 전": "예정", "진행 중": "진행 중", "완료": "완료", "미완료": "미완료" }
const APPV_REPORT_KINDS = { "주간 보고서": "주간", "월간 보고서": "월간", "수료 보고서": "수료" }
// 알림톡 받는 사람: 노션 옵션 → 시제품 고르기 값
const APPV_TARGET = { "우선 연락 대상": "우선 연락처" }

// 숫자: number 그대로 · 숫자 글자 · 배열(롤업)이면 숫자 합 · 그 밖은 null
function APPV_n(v) {
	if (typeof v === "number") return isFinite(v) ? v : null
	if (Array.isArray(v)) { const a = v.map(APPV_n).filter((x) => x != null); return a.length ? a.reduce((s, x) => s + x, 0) : null }
	if (typeof v === "string" && v.trim() !== "") { const t = +v.replace(/[,원\s]/g, ""); return isFinite(t) ? t : null }
	return null
}
// 날짜 {start} → "YYYY.MM"(시제품 달 표기)
const APPV_month = (v) => (v && v.start ? String(v.start).slice(0, 7).replace("-", ".") : "")
// 옵션 이름 앞 이모지 · 기호 떼기("📆 학원 일정" → "학원 일정")
const APPV_strip = (s) => String(s == null ? "" : s).replace(/^[^\p{L}\p{N}]+/u, "").trim()
const APPV_done = (s) => /완료/.test(String(s || "")) && !/미완료/.test(String(s || ""))
const APPV_true = (v) => v === true || v === "true" || (Array.isArray(v) && v.some((x) => x === true))
const APPV_max = (a) => a.filter(Boolean).sort().pop() || ""

// 반대편 찾기 표(한 번만 만든다): 관계가 25개를 넘어 "칸#more"가 된 줄도 자식 쪽 관계로 다 찾는다
function APPV_index(X) {
	if (X._v) return X._v
	const by = (db, prop) => { const m = new Map(); X.all(db).forEach((r) => X.ids((r.props || {})[prop]).forEach((id) => { if (!m.has(id)) m.set(id, []); m.get(id).push(r) })); return m }
	const v = {
		payByTuition: by(APPV_DB.pay, "수강료"), linesByBill: by(APPV_DB.line, "교재비"), billPayByLine: by(APPV_DB.billPay, "교재배부"),
		reportsByBox: by(APPV_DB.report, "알림톡 발송함"), lettersByBox: by(APPV_DB.letter, "알림톡 발송함"), gradesByExam: by(APPV_DB.grade, "시험정보"),
	}
	// 부모 쪽 관계 id ∪ 자식 쪽 관계 → 원본 줄(중복 없이)
	v.kids = (map, id, ownIds, db) => { const m = new Map(); (map.get(id) || []).forEach((r) => m.set(r.id, r)); (ownIds || []).forEach((i) => { const r = X.raw(db, i); if (r) m.set(r.id, r) }); return [...m.values()] }
	X._v = v
	return v
}
// 등록 id → { enrollId, studentId, classId, ep(등록 props), cp(클래스 props) }
function APPV_en(X, enrollId) {
	const en = X.raw(APPV_DB.enroll, enrollId), ep = en ? en.props || {} : {}
	const classId = X.id1(ep["클래스"]), c = X.raw(APPV_DB.cls, classId)
	return { enrollId: en ? en.id : "", studentId: X.id1(ep["학생정보"]), classId, ep, cp: c ? c.props || {} : {} }
}
// 청구 항목 한 줄의 금액 · 결제: 교재비 금액(수식) → 수기입력 → 기타경비 신고 금액 → 라이브러리 가격
function APPV_line(X, r) {
	const p = r.props || {}, v = APPV_index(X)
	const etc = X.raw(APPV_DB.etc, X.id1(p["기타경비"])), lib = X.raw(APPV_DB.lib, X.id1(p["라이브러리"]))
	let amount = APPV_n(p["교재비 금액"]), calc = "notion"
	if (amount == null) { calc = "app"; amount = APPV_n(p["교재비 수기입력"]); if (amount == null && etc) amount = APPV_n(etc.props["신고 금액"]); if (amount == null && lib) amount = APPV_n(lib.props["가격"]); if (amount == null) amount = 0 }
	const pays = v.kids(v.billPayByLine, r.id, X.ids(p["교재결제"]), APPV_DB.billPay)
	const sum = pays.reduce((s, x) => s + (APPV_n(x.props["결제 금액"]) || 0), 0)
	const got = pays.length ? sum : (APPV_n(p["결제금액"]) || 0)
	const st = X.str(p["결제 상태"])
	const paid = amount > 0 ? got >= amount : (APPV_done(st) || /완납/.test(st)) && !/미납/.test(st)
	const name = X.str(p["이름"]) || (lib ? X.str(lib.props["교재명"]) : "") || (etc ? X.str(etc.props["이름"]) : "")
	return { amount, calc, got, paid, paidOn: paid ? APPV_max(pays.map((x) => X.d(x.props["결제일"]))) : "", name, lib, etc, libName: lib ? X.str(lib.props["교재명"]) : "" }
}

// ---------- 묶음 대응 ----------
// row(r, X): r = app-api 한 줄, p = r.props. filter(r, X)가 있으면 그 줄만. 순서대로 채운다(뒤 묶음이 앞 묶음을 본다)
const APPVIEW = {
	etcs: {
		db: APPV_DB.etc,
		row: (r, X, p = r.props) => ({ id: r.id, name: X.str(p["이름"]), item: X.str(p["기타경비 항목"]), amt: APPV_n(p["신고 금액"]) || 0, memo: "", _mode: X.str(p["받는 방식"]) || "매달", state: "saved" }),
	},
	events: {
		db: APPV_DB.event,
		// 숨김 줄도 받아 hide로 넘긴다(화면이 달력에서 뺌 · 숨김 보기에서만 보임). 수는 out._appv.hiddenEvents
		row: (r, X, p = r.props) => {
			const start = X.d(p["날짜"]), end = X.dEnd(p["날짜"])
			return {
				// kind = 노션 `구분` 수식 값 그대로(261118부터 세부 구분에서 계산: 할일 · 학원 일정 · 학사 일정 — 읽기만, 앱은 쓰지 않음). 세부는 sub
				// guide(안내 구분) 연결 없앰: 원본 일정 전부에 세부 구분이 채워짐(노션완성 261118, 242행). 화면 옛 코드가 읽어도 깨지지 않게 빈 값
				id: r.id, name: X.str(p["이름"]), kind: X.str(p["구분"]) || "학원 일정", guide: "", _kind0: X.str(p["구분"]), // _kind0 = 노션에 저장된 구분(학사 일정 자동 잠금 판정 — 화면과 같은 기준)
				// 세부 구분 · 기록(내부용)(2.8, 노션완성이 칸 넣는 중 — 없으면 "")
				sub: X.str(p["세부 구분"]), rec: X.str(p["기록(내부용)"]),
				hide: !!p["숨김"], neisKey: X.str(p["NEIS 동기화키"]),
				// 공개 상태(노션 수식 글, 담당이 만들 예정) — 칸이 없으면 "" → 화면이 같은 규칙으로 계산
				pubState: X.str(p["공개 상태"]),
				schools: X.ids(p["학교"]), grades: X.ids(p["학년"]).map((id) => X.title("학년(학원) DB", id, "이름")).filter(Boolean), students: X.ids(p["학생"]),
				// 날짜 시작~끝 = 노션 값 그대로(끝이 없으면 "")
				start, end, who: X.id1(p["담당자"]),
				stat: APPV_EV_STAT[p["진행상태"]] || X.str(p["진행상태"]) || "예정", pub: !!p["학부모 공개"], memo: X.str(p["일정 안내 메모"]),
				classIds: X.ids(p["클래스"]), school: X.title("학교(학원) DB", X.id1(p["학교"]), "이름"), state: "saved",
				_time: X.dt(p["날짜"]).length > 10 ? X.dt(p["날짜"]).slice(11) : "", _students: X.ids(p["학생"]), _neis: !!X.str(p["NEIS 동기화키"]),
			}
		},
		sort: (a, b) => String(a.start).localeCompare(String(b.start)),
	},
	costs: {
		db: APPV_DB.pay,
		// 결제 DB에서 수강료에 이어지지 않은 줄만(지출 + 수강료 · 교재비가 아닌 매출). 수강료에 이어진 결제는 tuition의 결제 칸으로 간다
		filter: (r, X) => !X.ids((r.props || {})["수강료"]).length && !(r.props || {})["수강료#more"],
		row: (r, X, p = r.props) => ({ id: r.id, name: X.str(p["결제"]), kind: X.str(p["구분"]) || "지출", date: X.d(p["결제일"]), how: X.str(p["결제 수단"]), amount: APPV_n(p["결제 금액"]) || 0, memo: X.str(p["비고"]), etcAmt: APPV_n(p["기타경비"]) || 0, state: "saved", _profit: APPV_n(p["손익"]) }),
		sort: (a, b) => String(b.date).localeCompare(String(a.date)),
	},
	// 결제 DB 전부(수강료에 이은 줄 포함) — 수강료 ⑥ [결제 기록]·손익 [결제 내역]이 노션처럼 이 줄을 다 본다(261118 재무 대조 6·7). 읽기만
	// etcAmt = 결제 DB `기타경비`(결제 금액 중 기타경비 수납액), tuitionIds = 이은 수강료(비면 수강료와 무관한 결제)
	pays: {
		db: APPV_DB.pay,
		row: (r, X, p = r.props) => {
			const tIds = X.ids(p["수강료"]), t = X.raw(APPV_DB.tuition, tIds[0]), E = t ? APPV_en(X, X.id1((t.props || {})["등록"])) : null
			return {
				id: r.id, name: X.str(p["결제"]), kind: X.str(p["구분"]) || "지출", date: X.d(p["결제일"]), month: APPV_month(p["결제일"]), how: X.str(p["결제 수단"]),
				amount: APPV_n(p["결제 금액"]) || 0, etcAmt: APPV_n(p["기타경비"]) || 0, memo: X.str(p["비고"]), tuitionIds: tIds, studentId: E ? E.studentId : "", classId: E ? E.classId : "",
				state: "saved", _tuMore: !!p["수강료#more"], _profit: APPV_n(p["손익"]),
			}
		},
		sort: (a, b) => String(b.date).localeCompare(String(a.date)),
	},
	// 청구 결제 DB 줄 목록 — 청구서 [결제] 탭(노션: 이름 · 결제상태 · 결제일 · 교재 · 결제 금액 · 결제 방법). 읽기만, 결제 넣기는 노션
	billPays: {
		db: APPV_DB.billPay,
		row: (r, X, p = r.props) => {
			const lineIds = X.ids(p["교재배부"]), lines = lineIds.map((id) => X.raw(APPV_DB.line, id)).filter(Boolean)
			const billId = X.id1(p["교재비 안내"]) || (lines[0] ? X.id1((lines[0].props || {})["교재비"]) : "")
			const bill = X.raw(APPV_DB.bill, billId), E = APPV_en(X, X.id1(((bill || lines[0] || {}).props || {})["등록"]))
			// 교재: 롤업·글이면 그 값, 관계(id)면 이은 청구 항목 이름으로
			const b = p["교재"], bookTxt = typeof b === "string" ? b : Array.isArray(b) && b.length && !X.raw(APPV_DB.lib, String(b[0])) && !X.raw(APPV_DB.line, String(b[0])) ? X.str(b) : ""
			return {
				id: r.id, name: X.str(p["이름"]), st: X.str(p["결제상태"]), date: X.d(p["결제일"]), month: APPV_month(p["결제일"]),
				book: bookTxt || lines.map((l) => APPV_line(X, l).name).filter(Boolean).join(", "), amount: APPV_n(p["결제 금액"]) || 0, how: X.str(p["결제 방법"]),
				lineIds, billId, studentId: E.studentId, classId: E.classId, state: "saved", _err: X.str(p["마지막 오류"]),
			}
		},
		sort: (a, b) => String(b.date).localeCompare(String(a.date)),
	},
	// 반 수강료 발송함(알림톡 발송함 DB, 구분 "수강료", 반 × 달) — 수강료 ② [수강료 발송함] 보기. 읽기만, [일괄 전송]은 노션
	tuBoxes: {
		db: APPV_DB.box,
		filter: (r) => (r.props || {})["구분"] === "수강료",
		row: (r, X, p = r.props) => {
			const tIds = X.ids(p["수강료"]), n = APPV_n(p["수강료총건수(내부)"]) ?? tIds.length, wait = APPV_n(p["수강료대기건수(내부)"]) ?? 0
			return {
				id: r.id, name: X.str(p["이름"]), classId: X.id1(p["클래스"]), month: APPV_month(p["기간"]), from: X.d(p["기간"]), to: X.dEnd(p["기간"]) || X.d(p["기간"]),
				n, wait, progress: X.str(p["진행 상황"]) || (n ? `${Math.max(0, n - wait)}/${n}` : ""), st: X.str(p["상태"]), tuitionIds: tIds,
				state: "saved", _err: X.str(p["마지막 오류"]), _more: !!p["수강료#more"],
			}
		},
		sort: (a, b) => String(b.month).localeCompare(String(a.month)),
	},
	alims: {
		db: APPV_DB.alim,
		row: (r, X, p = r.props) => {
			const to = X.arr(p["알림 수신 대상"]).map((t) => APPV_TARGET[t] || t)
			return {
				id: r.id, name: X.str(p["발송 구분"]), code: X.str(p["코드"]), on: !!p["활성 여부"], tpl: !!X.str(p["템플릿 ID"]),
				from: X.str(p["발신번호"]), target: to.length ? to.join(" · ") : "우선 연락처", ment: X.str(p["안내멘트"]), state: "saved", _targets: to,
			}
		},
	},
	files: {
		db: APPV_DB.file,
		row: (r, X, p = r.props) => {
			const fs = Array.isArray(p["첨부파일"]) ? p["첨부파일"] : []
			return { id: r.id, name: X.str(p["이름"]), kind: X.str(p["구분"]) || "운영자료", files: fs.map((f) => (f && f.name) || "파일"), tags: X.arr(p["태그"]), state: "saved", _urls: fs.map((f) => (f && f.url) || "") }
		},
	},
	tuition: {
		db: APPV_DB.tuition,
		row: (r, X, p = r.props) => {
			const v = APPV_index(X), E = APPV_en(X, X.id1(p["등록"]))
			const qty = APPV_n(p["실제 수업량"]) || 0, clsQty = APPV_n(E.cp["월간 수업 총량"])
			const full = clsQty > 0 ? clsQty : qty > 0 ? qty : 8
			const adj = APPV_n(p["청구금액 조정"]) || 0, F = APPV_n(p["청구금액"])
			// 시제품 계산 tuFee = max(0, round(base × qty ÷ full) + adj). 노션 [청구금액]과 같아지게 base를 거꾸로 푼다(청구금액이 없으면 클래스 수강료 + 등록 수강료 조정)
			const base = F == null ? (APPV_n(E.cp["수강료"]) || 0) + (APPV_n(E.ep["수강료 조정"]) || 0) : qty > 0 ? ((F - adj) * full) / qty : 0
			const fee = Math.max(0, Math.round((base * qty) / full) + adj)
			// 매달 기타경비: 클래스에 붙은 기타경비 중 받는 방식이 매달인 것. 노션 [기타경비 금액]과 합이 다르면 그 값 한 줄로
			let etcs = X.ids(E.cp["기타경비"]).map((id) => X.raw(APPV_DB.etc, id)).filter((x) => x && x.props["받는 방식"] !== "한 번")
				.map((x) => ({ item: X.str(x.props["기타경비 항목"]), name: X.str(x.props["이름"]), amt: APPV_n(x.props["신고 금액"]) || 0, etcId: x.id })).filter((z) => z.amt)
			const En = APPV_n(p["기타경비 금액"]), etcSum = etcs.reduce((s, z) => s + z.amt, 0)
			let etcDiff = false
			if (En != null && En !== etcSum) { etcDiff = true; etcs = En > 0 ? [{ item: (etcs[0] && etcs[0].item) || "재료비", name: "기타경비", amt: En }] : [] }
			const total = fee + etcs.reduce((s, z) => s + z.amt, 0)
			// 결제: 이 수강료에 이어진 결제(학원) DB 줄
			const pays = v.kids(v.payByTuition, r.id, X.ids(p["관련 결제"]), APPV_DB.pay)
			const got = pays.length ? pays.reduce((s, x) => s + (APPV_n(x.props["결제 금액"]) || 0), 0) : APPV_n(p["결제금액"]) || 0
			const last = pays.slice().sort((a, b) => String(X.d(a.props["결제일"])).localeCompare(String(X.d(b.props["결제일"])))).pop()
			return {
				id: r.id, studentId: E.studentId, classId: E.classId, month: APPV_month(p["청구기간"]),
				qty, adj, why: X.str(p["청구금액 조정 사유"]), etcs, base, full,
				sent: APPV_done(p["안내문 전송 상태"]) || APPV_true(p["같은 달 보냄"]),
				pay: /과오납/.test(X.str(p["결제 관리"])) ? "과오납" : /완료/.test(X.str(p["결제 관리"])) ? "완료" : /미납/.test(X.str(p["결제 관리"])) ? "미납" : got <= 0 || got < total ? "미납" : got === total ? "완료" : "과오납", paidOn: last ? X.d(last.props["결제일"]) : "", how: last ? X.str(last.props["결제 수단"]) : "", got,
				// _noTotal = 클래스 `월간 수업 총량`이 빔 → 노션 [월 수강료 생성]은 그 반을 ⚠️로 멈춤(앱도 계산으로 채우지 않음 — 재무 대조 C)
				state: "saved", _noTotal: !(clsQty > 0), _enrollId: E.enrollId, _amt: F, _etc: En, _calc: F == null ? "app" : "notion", _diff: F != null && fee !== F, _etcDiff: etcDiff, _memo: X.str(p["메모(내부용)"]),
			}
		},
	},
	// 청구 항목 전부(노션 값 그대로). 화면 묶음 out.charges에는 청구서에 안 묶인 줄만 넣는다 — 묶인 줄은 시제품 chargesSync가 bookfees에서 다시 만든다(appViewApply)
	charges: {
		db: APPV_DB.line,
		row: (r, X, p = r.props) => {
			const L = APPV_line(X, r), E = APPV_en(X, X.id1(p["등록"]))
			const kind = X.str(p["종류"]) || (X.str(p["기타경비 항목"]) ? "기타경비" : "교재비"), billId = X.id1(p["교재비"])
			return {
				id: r.id, studentId: E.studentId, classId: E.classId, kind,
				item: kind === "기타경비" ? X.str(p["기타경비 항목"]) || (L.etc ? X.str(L.etc.props["기타경비 항목"]) : "") || "재료비" : "교재비",
				name: L.name, take: !(L.amount < 0), amount: L.amount, month: APPV_month(p["청구 월"]) || APPV_month(p["배부일"]),
				bill: billId ? "bookfee" : "", billId, paidOn: L.paidOn, etcId: X.id1(p["기타경비"]), state: "saved",
				_paid: L.paid, _got: L.got, _calc: L.calc, _given: X.d(p["배부일"]), _bookId: L.lib ? L.lib.id : "", _enrollId: E.enrollId,
			}
		},
	},
	bookfees: {
		db: APPV_DB.bill,
		row: (r, X, p = r.props) => {
			const v = APPV_index(X), E = APPV_en(X, X.id1(p["등록"]))
			const lines = v.kids(v.linesByBill, r.id, X.ids(p["교재배부"]), APPV_DB.line), Ls = lines.map((l) => APPV_line(X, l))
			const T = APPV_n(p["총 금액"]), P = APPV_n(p["결제금액"])
			const total = T != null ? T : Ls.reduce((s, l) => s + l.amount, 0), paid = P != null ? P : Ls.reduce((s, l) => s + Math.min(l.got, Math.max(l.amount, 0)), 0)
			// 갈래: 노션 [구분] 수식(교재비 · 재료비 · 기타경비 항목 이름). 비면 줄의 종류에서
			let g = X.str(p["구분"])
			if (!g && lines[0]) { const lp = lines[0].props || {}; g = lp["종류"] === "기타경비" ? X.str(lp["기타경비 항목"]) || "기타경비" : "교재비" }
			const cat = g === "재료비" ? "재료비" : !g || g === "교재비" ? "교재비" : "기타경비"
			const o = {
				id: r.id, studentId: E.studentId, classId: E.classId,
				// 시제품은 items를 ", "로 나눠 라이브러리 이름과 맞춘다 → 교재 줄은 라이브러리 교재명, 그 밖은 줄 이름
				items: Ls.map((l) => l.libName || l.name).filter(Boolean).join(", "), total, paid,
				sent: APPV_done(p["안내문 전송 상태"]), state: "saved", cat,
				month: lines.map((l) => APPV_month(l.props["청구 월"]) || APPV_month(l.props["배부일"])).filter(Boolean)[0] || "",
				paidOn: total > 0 && paid >= total ? APPV_max(Ls.map((l) => l.paidOn)) : "",
				_enrollId: E.enrollId, _lineIds: lines.map((l) => l.id), _calc: T == null ? "app" : "notion", _unpaid: APPV_n(p["미납금액"]), _name: X.str(p["이름"]),
			}
			if (cat === "기타경비") o.etcItem = APPV_ETC6.includes(g) ? g : (lines[0] && X.str(lines[0].props["기타경비 항목"])) || ""
			return o
		},
	},
	// 시제품 시험 한 줄 = 학교 · 학년 · 과목별 시험 = 노션 시험정보. 이름은 연결한 시험(학원) DB 줄의 이름
	exams: {
		db: APPV_DB.examInfo,
		row: (r, X, p = r.props) => {
			const v = APPV_index(X), units = X.ids(p["단원목록"]).length
			const totals = v.kids(v.gradesByExam, r.id, X.ids(p["성적"]), APPV_DB.grade).map((g) => APPV_n(g.props["응시인원"])).filter((n) => n != null)
			return {
				id: r.id, name: X.title(APPV_DB.exam, X.id1(p["시험"]), "이름") || X.str(p["이름"]),
				school: X.title("학교(학원) DB", X.id1(p["학교"]), "이름"), grade: X.title("학년(학원) DB", X.id1(p["학년"]), "이름"),
				subjectIds: X.ids(p["과목"]), date: X.d(p["시험일"]),
				// 시험 범위 = 단원목록 관계(단원목록 DB는 복사본에 없음) → 개수만
				units: units || p["단원목록#more"] ? `단원 ${p["단원목록#more"] ? "25개 넘음" : units + "개"}` : "",
				total: totals.length ? Math.max(...totals) : "", state: "saved", periodId: X.id1(p["시험일정"]), _examId: X.id1(p["시험"]), _title: X.str(p["이름"]), _status: X.str(p["응시학생 현황"]),
			}
		},
		sort: (a, b) => String(a.date).localeCompare(String(b.date)),
	},
	grades: {
		db: APPV_DB.grade,
		row: (r, X, p = r.props) => {
			const sc = APPV_n(p["점수"]), rk = APPV_n(p["등수"])
			return { id: r.id, examId: X.id1(p["시험정보"]), sid: X.id1(p["학생"]), score: sc == null ? "" : sc, rank: rk == null ? "" : rk, state: "saved", _total: APPV_n(p["응시인원"]), _pct: p["백분률"] == null ? "" : p["백분률"], _level: X.str(p["등급"]) }
		},
	},
	// 시제품 학습 보고서 한 줄 = 클래스별 보고서 묶음 = 노션 알림톡 발송함(구분 주간 · 월간 · 수료 보고서). 학생 장(보고서 DB)은 out.rpStu
	reports: {
		db: APPV_DB.box,
		filter: (r) => !!APPV_REPORT_KINDS[(r.props || {})["구분"]],
		row: (r, X, p = r.props) => {
			const v = APPV_index(X), kids = v.kids(v.reportsByBox, r.id, X.ids(p["보고서"]), APPV_DB.report)
			const n = kids.length || APPV_n(p["보고서총건수(내부)"]) || 0
			const wait = kids.length ? kids.filter((k) => APPV_rpWait(k.props)).length : APPV_n(p["보고서대기건수(내부)"]) || 0
			const done = Math.max(0, n - wait)
			// 시제품 상태: left>0 = 보내는 중 · sent = 모두 전송 · 그 밖 = 생성. 하나도 안 보냈으면 left 0 · sent false(남은 수는 rpLeft가 n으로 셈)
			return { id: r.id, classId: X.id1(p["클래스"]), kind: APPV_REPORT_KINDS[p["구분"]], from: X.d(p["기간"]), to: X.dEnd(p["기간"]) || X.d(p["기간"]), n, left: done > 0 ? wait : 0, sent: n > 0 && done > 0, note: "", state: "saved", _wait: wait, _err: X.str(p["마지막 오류"]), _name: X.str(p["이름"]) }
		},
		sort: (a, b) => String(b.from).localeCompare(String(a.from)),
	},
	// 시제품 가정통신문 한 줄 = 달마다 클래스별 = 노션 알림톡 발송함(구분 가정통신문). 학생 장(가정통신문 DB)은 수 · 전송 여부만
	letters: {
		db: APPV_DB.box,
		filter: (r) => (r.props || {})["구분"] === "가정통신문",
		row: (r, X, p = r.props) => {
			const v = APPV_index(X), kids = v.kids(v.lettersByBox, r.id, X.ids(p["가정통신문"]), APPV_DB.letter)
			const sentN = kids.filter((k) => APPV_done(k.props["안내문 전송 상태"]) || APPV_true(k.props["같은 달 보냄"])).length
			return { id: r.id, classId: X.id1(p["클래스"]), month: APPV_month(p["기간"]), note: X.str(p["가정통신문 안내 메모"]), n: kids.length, sent: kids.length > 0 && sentN === kids.length, state: "saved", _sentN: sentN, _err: X.str(p["마지막 오류"]) }
		},
	},
}
// 보고서 한 장이 아직 안 보낸 것인지: [일괄전송 선택]이 켜져 있고(만들 때 켜지고 보내면 꺼짐) 전송 상태가 완료가 아님
function APPV_rpWait(p) { return !!(p || {})["일괄전송 선택"] && !APPV_done((p || {})["보고서 전송 상태"]) }

// ---------- 채우기 ----------
// appApply(raw, out) 뒤에 부른다. raw = { "<DB 제목>": Map(id → app-api 줄) }
function appViewApply(raw, out) {
	const X = appX(raw, out)
	X.coll = (name) => out[name] || []
	const stamp = (m, r) => Object.assign(m.row({ ...r, props: r.props || {} }, X), { _edited: r.notion_edited_at || "" })
	const info = { hiddenEvents: 0 }
	for (const [coll, m] of Object.entries(APPVIEW)) {
		const all = raw[m.db] ? [...raw[m.db].values()] : []
		const rows = m.filter ? all.filter((r) => m.filter(r, X)) : all
		if (coll === "events") info.hiddenEvents = all.filter((r) => (r.props || {})["숨김"]).length
		const list = rows.map((r) => stamp(m, r))
		if (m.sort) list.sort(m.sort)
		out[coll] = list
	}
	// 보고서 학생 장(시제품 rpItems가 읽는 DB.rpStu): 보고서(학원) DB 한 줄 = 학생 한 명
	out.rpStu = (raw[APPV_DB.report] ? [...raw[APPV_DB.report].values()] : []).map((r) => {
		const p = r.props || {}, E = APPV_en(X, X.id1(p["등록"])), err = /오류/.test(X.str(p["보고서 전송 상태"]))
		return { id: r.id, rpId: X.id1(p["알림톡 발송함"]), enId: E.enrollId, studentId: E.studentId, note: X.str(p["선생님 한마디"]), st: APPV_rpWait(p) ? "wait" : "ok", sentAt: "", state: "saved", _err: err ? X.str(p["마지막 오류"]) || "오류" : "", _log: X.str(p["전송 내역"]), _edited: r.notion_edited_at || "" }
	})
	// 손익 = 결제 DB만(노션 손익 분석과 같은 원천 — 청구 결제 · 청구 항목은 안 더함). 달마다 매출 · 지출 · 손익 · 그중 기타경비 · 수강료에 이은 매출
	const pm = {}
	;(out.pays || []).forEach((x) => {
		if (!x.month) return
		const z = pm[x.month] = pm[x.month] || { month: x.month, sales: 0, cost: 0, etc: 0, tuition: 0, n: 0 }
		z.n++
		if (x.kind === "매출") { z.sales += x.amount; z.etc += x.etcAmt; if (x.tuitionIds.length || x._tuMore) z.tuition += x.amount } else if (x.kind === "지출") z.cost += x.amount
	})
	info.profitByMonth = Object.values(pm).map((z) => ({ ...z, profit: z.sales - z.cost })).sort((a, b) => b.month.localeCompare(a.month))
	// 월간 수업 총량이 빈 클래스(노션 [월 수강료 생성]이 ⚠️로 멈추는 반) — 화면 할 일 · 생성 안내가 읽음
	info.noTotalClasses = (out.classes || []).filter((c) => !c.del && !(+c.qty > 0)).map((c) => c.id)
	appViewFixLinks(out)
	out._appv = info
	return out
}
// 관계가 끊긴 줄(학생 · 클래스 · 등록 · 시험을 못 찾음)은 화면에서 빼고 out._broken에 더한다(appdata.js appFixLinks와 같은 모양, 노션은 그대로)
function appViewFixLinks(out) {
	const has = (coll) => new Set((out[coll] || []).map((x) => x.id))
	const broken = Array.isArray(out._broken) ? out._broken : (out._broken = [])
	const keep = (coll, ok, why) => { out[coll] = (out[coll] || []).filter((r) => { if (ok(r)) return true; broken.push({ coll, id: r.id, why }); return false }) }
	const sIds = has("students"), cIds = has("classes"), tIds = has("teachers"), subIds = has("subjects"), etcIds = has("etcs")
	keep("tuition", (t) => sIds.has(t.studentId) && cIds.has(t.classId), "등록 · 학생 또는 클래스 연결 없음")
	keep("bookfees", (b) => sIds.has(b.studentId) && cIds.has(b.classId), "등록 · 학생 또는 클래스 연결 없음")
	keep("charges", (c) => sIds.has(c.studentId), "등록 · 학생 연결 없음")
	keep("reports", (x) => cIds.has(x.classId), "클래스 연결 없음")
	keep("letters", (x) => cIds.has(x.classId), "클래스 연결 없음")
	keep("tuBoxes", (x) => cIds.has(x.classId), "클래스 연결 없음")
	;(out.pays || []).concat(out.billPays || []).forEach((x) => { if (!sIds.has(x.studentId)) x.studentId = ""; if (!cIds.has(x.classId)) x.classId = "" })
	const exIds = has("exams")
	keep("grades", (g) => sIds.has(g.sid) && exIds.has(g.examId), "학생 또는 시험정보 연결 없음")
	const rpIds = has("reports")
	keep("rpStu", (i) => sIds.has(i.studentId) && rpIds.has(i.rpId), "등록 · 학생 또는 발송함 연결 없음")
	const bfIds = has("bookfees")
	;(out.charges || []).forEach((c) => { if (!cIds.has(c.classId)) c.classId = ""; if (c.etcId && !etcIds.has(c.etcId)) c.etcId = ""; if (c.billId && !bfIds.has(c.billId)) { c.bill = ""; c.billId = "" } })
	;(out.events || []).forEach((e) => { if (!tIds.has(e.who)) e.who = ""; e.classIds = (e.classIds || []).filter((id) => cIds.has(id)) })
	;(out.exams || []).forEach((x) => { x.subjectIds = (x.subjectIds || []).filter((id) => subIds.has(id)) })
	// 청구 항목: 노션 값 전부는 _appvCharges에 두고, 화면 묶음에는 청구서에 안 묶인 줄만(묶인 줄은 시제품 chargesSync가 bookfees에서 다시 만든다 — 두 번 보이지 않게)
	out._appvCharges = out.charges || []
	out.charges = out._appvCharges.filter((c) => !c.bill)
	return out
}
// appLoad 대신 쓸 수 있는 한 번에 불러오기: APPMAP의 DB + APPV_DBS를 받고 appApply → appViewApply
async function appViewLoad({ url, anonKey, session, target }) {
	const out = target || (typeof DB !== "undefined" ? DB : null)
	if (!out) throw new Error("DB 객체가 없습니다")
	const dbs = [...new Set([...Object.values(APPMAP).map((m) => m.db), ...APPV_DBS])]
	const raw = await appListMany({ url, anonKey, session }, dbs) /* 동시에 받음(appdata.js) — 요청 순서 · 실패 메시지는 순차 받기와 같음 */
	appApply(raw, out)
	return appViewApply(raw, out)
}

if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { APPVIEW, APPV_DBS, appViewApply, appViewFixLinks, appViewLoad }
