/* 시험 화면 보강(261123 과제 시험보강 — 노션 시험 메뉴와 같은 결과):
   - 보기 칩 [지필고사 | 모의고사 | 성적 | 달력] = 노션 시험 메뉴 보기 셋(지필고사 · 모의고사 · 성적) + 앱 달력
   - 시험(학원) 줄: 시험정보 창 [시험]에서 고르고, 없으면 적어서 새로("2026 2학기 기말고사" · "2026 6월 모의고사")
   - 성적: 노션처럼 학생마다 점수 · 등수 · 응시인원 · 등급, 백분율은 노션 수식 값(저장 전엔 등수 ÷ 응시인원), 시험지 · 성적표는 노션에서
   - 시험 범위: 과목의 교재 단원에서 고르기(노션 `단원목록` 관계)
   - [시험 기간 연결]: 노션 버튼과 같은 서버 동작(`요청` = exam-period-link, livereq.js 공용 입구) + 마지막 오류 · 응시학생 현황
   - [응시학생 등록]: 노션 버튼과 같은 거름(같은 학년 · 학교를 골랐으면 그 학교 · 재원 · 이 시험 성적 없음) → 학생마다 성적 줄(학생 · 시험정보 · 학년 · 학교).
     실제 자료 모드는 그 줄들을 바로 노션에 저장(노션 버튼도 누르면 바로 생김). 쓰는 길은 appsave.js tests · exams · grades(칸 P2x) */
(function () {
  if (typeof LISTS === "undefined" || typeof DB === "undefined" || !LISTS.exams) return;
  const live = () => !!(window.LIVE && window.LIVE.loaded);
  const isId = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v || ""));
  const alive = (a) => (a || []).filter((x) => x && !x.del);
  const TERMS = ["1학기 중간고사", "1학기 기말고사", "2학기 중간고사", "2학기 기말고사"];
  const MOCKS = ["3월 모의고사", "6월 모의고사", "9월 모의고사", "수능"];
  const LEVELS = ["1등급", "2등급", "3등급", "4등급", "5등급"];
  if (!Array.isArray(DB.tests)) DB.tests = [];
  const testOf = (x) => (x && x.testId ? DB.tests.find((t) => t.id === x.testId) : null);
  /* 지필고사 · 모의고사: 고른 시험의 구분. 시험을 안 골랐으면 이름으로 짐작(모의 · 수능이면 모의고사) */
  const exKind = (x) => { const t = testOf(x); if (t && t.kind) return t.kind; return /모의|수능/.test(String((x && x.name) || "")) ? "모의고사" : "지필고사"; };
  window.exKind = exKind;
  const testName = (t) => [t.year, t.kind === "모의고사" ? t.mock : t.term].filter(Boolean).join(" ") || t.name || "";

  /* ── 예시 자료: 시험(학원) 줄이 없으면 시험정보 이름으로 만든다(실제 자료 모드는 노션 시험 DB에서 옴) ── */
  function seedTests() {
    if (live() || DB.tests.length) return;
    const y = String(TODAY).slice(0, 4), by = new Map();
    alive(DB.exams).forEach((x) => {
      const nm = String(x.name || "").trim(); if (!nm) return;
      let t = by.get(nm);
      if (!t) {
        const mock = MOCKS.find((m) => nm.includes(m)), term = TERMS.find((m) => nm.includes(m));
        t = { id: uid("ts"), year: y, kind: mock ? "모의고사" : "지필고사", term: mock ? "" : term || nm, mock: mock || "", state: "saved" };
        t.name = testName(t); by.set(nm, t); DB.tests.push(t);
      }
      x.testId = t.id; x.name = t.name;
      (DB.grades || []).forEach((g) => { if (g.examId === x.id && (g.total === undefined || g.total === "") && x.total) g.total = x.total; if (g.level === undefined) g.level = ""; });
    });
  }
  try { seedTests(); } catch (e) { console.error(e); }

  /* ── 시험 고르기 · 없으면 새로: "2026 2학기 기말고사" · "2026 6월 모의고사" · "수능"(연도가 없으면 올해) ── */
  function testNew(text) {
    const s = String(text || "").trim(); if (!s) return null;
    const y = (/(20\d\d)/.exec(s) || [])[1] || String(TODAY).slice(0, 4);
    const mock = MOCKS.find((m) => s.includes(m) || (m !== "수능" && s.includes(m.replace(" 모의고사", "")) && /모의/.test(s)));
    const term = TERMS.find((m) => s.replace(/\s+/g, "").includes(m.replace(/\s+/g, "")));
    if (!mock && !term) { toast("시험 이름에 회차를 적어요 — 예: 2026 2학기 기말고사 · 2026 6월 모의고사 · 2026 수능"); return null; }
    const t = { id: uid("ts"), year: y, kind: mock ? "모의고사" : "지필고사", term: mock ? "" : term, mock: mock || "", state: "draft" };
    t.name = testName(t);
    const have = alive(DB.tests).find((z) => z.name === t.name); if (have) return have.id;
    DB.tests.push(t); return t.id;
  }
  if (typeof REL_NEW !== "undefined") { REL_NEW.exams = REL_NEW.exams || {}; REL_NEW.exams.testId = (t) => testNew(t); }
  if (typeof REL_NAME !== "undefined") REL_NAME.testId = "시험";
  if (typeof COLLNAME !== "undefined") COLLNAME.tests = "시험(연도 · 회차)"; /* 저장 확인 창 · 저장 결과에 보이는 묶음 이름 */
  const testItems = () => alive(DB.tests).slice().sort((a, b) => String(b.year).localeCompare(String(a.year)) || String(a.name).localeCompare(String(b.name))).map((t) => ({ v: t.id, t: t.name, sub: t.kind }));

  /* ── 시험정보 창 칸: 이름(글) 대신 [시험] 고르기, 응시 인원은 성적 줄마다(노션 칸 그대로) ── */
  const FIELDS = [
    ["testId", "시험", () => testItems(), "req", "시험(연도 · 회차)을 골라요 · 없으면 적어서 생성해요 — 예: 2026 2학기 기말고사, 2026 6월 모의고사. 이 시험정보 이름은 노션이 \"시험 (학교 학년 영역)\"으로 붙여요"],
    ...LISTS.exams.fields.filter((f) => f[0] !== "name" && f[0] !== "total" && f[0] !== "units"),
  ];
  /* 창 [시험 저장]이 켜지는 때: 시험정보 줄 · 이 시험의 성적 줄 · 새로 고른 시험(학원) 줄 중 하나라도 작성 중(live.js liveSaveRow가 같은 줄들을 보냄) */
  const exDirty = (r) => !!r && (r.state === "draft" || (DB.grades || []).some((g) => g.examId === r.id && g.state === "draft") || (!!testOf(r) && testOf(r).state === "draft"));
  const onSet0 = LISTS.exams.onSet;
  const onSet = (r, k) => { if (onSet0) onSet0(r, k); if (k === "testId") { const t = testOf(r); r.name = t ? t.name : ""; } };
  const blank = () => ({ id: uid("ex"), name: "", testId: "", school: "", grade: "", subjectIds: [], date: "", units: "", unitIds: [] });
  const HELP_TXT = "학교 · 학년 · 과목별 시험 정보예요(노션 시험정보). 시험(연도 · 회차)을 고르고, 창의 [성적] 탭에서 [응시학생 등록] 뒤 학생마다 점수 · 등수 · 응시인원 · 등급을 넣어요. 보기 칩은 노션 시험 메뉴 보기(지필고사 · 모의고사 · 성적)와 같아요.";
  ["exams", "exams_", "exams_c"].forEach((k) => { const L = LISTS[k]; if (!L) return; L.fields = FIELDS; delete L._gc; /* 열 목록 캐시(listCols) — 칸을 바꿨으니 다시 만든다 */ L.onSet = onSet; L.blank = blank; L.help = HELP_TXT; L.dirtyFn = exDirty; });
  LISTS.exams_.rows = () => DB.exams.filter((x) => exKind(x) !== "모의고사");
  LISTS.exams_m = Object.assign({}, LISTS.exams_, { rows: () => DB.exams.filter((x) => exKind(x) === "모의고사"), blank: () => Object.assign(blank(), { testId: (alive(DB.tests).find((t) => t.kind === "모의고사") || {}).id || "" }) });

  /* ── 성적 보기(노션 성적 보기와 같은 칸) ── */
  const exOf = (g) => DB.exams.find((e) => e.id === g.examId) || {};
  const pctOf = (g) => {
    if (g.state !== "draft" && g._pct !== undefined && g._pct !== "" && g._pct != null && isFinite(+g._pct)) { const v = +g._pct; return Math.round((v <= 1 && v > 0 ? v * 100 : v) * 10) / 10; }
    return g.rank && +g.total ? Math.round(g.rank / g.total * 1000) / 10 : null;
  };
  window.exPct = pctOf;
  const gName = (g) => `${nmStu(g.sid)} · ${exOf(g).name || "시험"}`;
  LISTS.exams_g = {
    title: "시험", coll: "grades", unit: "명", ph: "학생 · 시험 검색", noDel: true, filters: [], ftabs: null,
    help: "학생마다 성적 한 줄이에요(노션 성적 보기). 점수 · 등수 · 응시인원 · 등급을 넣고 [저장]하면 노션에 들어가요. 백분율은 노션 수식이 계산해요. 성적 줄은 시험정보 창 [성적] 탭의 [응시학생 등록]으로 생겨요. 시험지 · 성적표 파일은 노션에서 올려요.",
    rows: () => DB.grades.filter((g) => !g.del && DB.exams.some((e) => e.id === g.examId && !e.del)),
    cols: [["학생", (g) => nmStu(g.sid)], ["시험정보", (g) => { const x = exOf(g); return [x.name, x.school, x.grade].filter(Boolean).join(" ") || "—"; }], ["과목", (g) => exSubj(exOf(g)) || "—"], ["점수", (g) => (g.score === "" || g.score == null ? "—" : g.score + "점")],
      ["응시인원", (g) => (g.total ? g.total + "명" : "—")], ["등수", (g) => (g.rank ? g.rank + "등" : "—")], ["백분율", (g) => { const p = pctOf(g); return p == null ? "—" : p + "%"; }], ["등급", (g) => g.level || "—"],
      ["파일", (g) => [g._paper ? "시험지" : "", g._sheet ? "성적표" : ""].filter(Boolean).join(" · ") || "—"]],
    fields: [["score", "점수", null, "num", "", "점"], ["rank", "등수", null, "num", "", "등"], ["total", "응시인원", null, "num", "학교 전체 응시 인원 — 백분율 = 등수 ÷ 응시인원", "명"], ["level", "등급", LEVELS, "opt", "1~5등급(노션 선택지)"]],
  };
  LISTS.exams.subs = [["", "지필고사"], ["m", "모의고사"], ["g", "성적"], ["c", "달력"]];
  LISTS.exams.subCount = (k) => k === "" ? LISTS.exams_.rows().filter((x) => !x.del).length : k === "m" ? LISTS.exams_m.rows().filter((x) => !x.del).length : k === "g" ? LISTS.exams_g.rows().length : "";
  if (typeof HEAD_DEF !== "undefined") HEAD_DEF.grades = (g) => { const x = exOf(g); return { name: nmStu(g.sid), belong: [x.name, x.school, x.grade].filter(Boolean).join(" "), info: [g.score !== "" && g.score != null ? g.score + "점" : "점수 전", g.rank ? g.rank + "등" + (g.total ? "/" + g.total + "명" : "") : "", g.level || ""] }; };

  /* ── 성적 탭(시험정보 창) ── */
  const fileCell = (g) => {
    const have = [g._paper ? "시험지" : "", g._sheet ? "성적표" : ""].filter(Boolean).join(" · ");
    if (isId(g.id)) return `<a class="exfl" href="https://www.notion.so/${String(g.id).replace(/-/g, "")}" target="_blank" rel="noopener" title="시험지 · 성적표는 노션 성적 페이지에서 올려요">${IC("ext", "s")}${have || "노션에서 올리기"}</a>`;
    return `<span class="hint exfl" title="저장하면 노션 성적 페이지에서 파일을 올릴 수 있어요">${have || "저장 뒤 노션에서"}</span>`;
  };
  window.exBox = exBox = function (x) {
    const gs = exGr(x), todo = exTodo(x), sc = gs.filter((g) => g.score !== "" && g.score != null);
    const lv = (g) => `<select class="inp exlv" data-gx="${g.id}" data-gf="level" aria-label="${esc(nmStu(g.sid))} 등급"><option value="">등급</option>${LEVELS.map((v) => `<option ${g.level === v ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    const st = ""; /* 노션 수식 응시학생 현황은 성적 줄을 만든 뒤에도 사본에 옛 값이 남아(시험정보 줄 편집 시각이 안 바뀜) 앱 셈과 엇갈렸음 — 앱 셈 한 줄만(같은 뜻) */
    return `<div class="box"><h3>성적 <span class="hint">${gs.length}명</span>${HELP("[응시학생 등록] = 같은 학년(학교를 골랐으면 그 학교)의 재원 학생 가운데 이 시험 성적이 없는 학생마다 성적 줄을 생성해요(노션 버튼과 같아요). 이미 있는 학생은 건드리지 않아요. 학생마다 점수 · 등수 · 응시인원 · 등급을 넣고 [저장]해요. 백분율은 노션 수식(저장 전엔 등수 ÷ 응시인원 × 100). 시험지 · 성적표는 줄 끝 링크로 노션에서 올려요.")}<span class="sp"></span><button type="button" class="btn sm" data-exgen="${x.id}" ${todo.length ? "" : "disabled"} title="${todo.length ? `응시학생 등록 — 아직 줄이 없는 학생 ${todo.length}명` : "응시학생 등록 — 등록할 학생이 없어요"}">${IC("plus", "s")}응시학생 등록 ${todo.length}</button></h3>${st}<div class="valline exst">${!gs.length && !todo.length ? "이 학년 재원 학생이 없어요" : todo.length ? `미응시 ${todo.length}명` : "전원 응시"}${sc.length ? ` · 평균 ${Math.round(sc.reduce((a, g) => a + +g.score, 0) / sc.length * 10) / 10}점 (입력 ${sc.length}/${gs.length}명)` : ""}</div>${gs.length ? `<div class="recst exgr"><div class="recrow exgh"><span class="nm">학생</span><span>점수</span><span>등수</span><span>응시인원</span></div>${gs.map((g) => `<div class="recrow"><span class="nm">${esc(nmStu(g.sid))}${g.state === "draft" ? ' <i class="tdot"></i>' : ""}</span><input class="inp recsc" data-gs="${g.id}" data-gf="score" inputmode="decimal" autocomplete="off" value="${g.score ?? ""}" placeholder="점수" aria-label="${esc(nmStu(g.sid))} 점수"><input class="inp recsc" data-gs="${g.id}" data-gf="rank" inputmode="numeric" autocomplete="off" value="${g.rank ?? ""}" placeholder="등수" aria-label="${esc(nmStu(g.sid))} 등수"><input class="inp recsc" data-gx="${g.id}" data-gf="total" inputmode="numeric" autocomplete="off" value="${g.total ?? ""}" placeholder="인원" aria-label="${esc(nmStu(g.sid))} 응시인원"><div class="exg2">${lv(g)}<span class="recpt" title="백분율 = 등수 ÷ 응시인원 × 100 (노션 수식)">백분율 ${pctOf(g) == null ? "—" : pctOf(g) + "%"}</span><span class="sp"></span>${fileCell(g)}</div></div>`).join("")}</div>` : ""}</div>`;
  };

  /* ── 시험 범위(단원 고르기) · 시험 기간 연결 · 마지막 오류: 창 [시험일] 아래 ── */
  const UNM = (window.EX_UNM = window.EX_UNM || {}); // 단원 id → 이름(고르기 창에서 받은 것)
  const unitLabel = (x) => { const ids = x.unitIds || []; if (!ids.length) return x.units || ""; const nm = ids.map((id) => UNM[id]).filter(Boolean); return nm.length === ids.length ? (nm.length > 3 ? `${nm[0]} ~ ${nm[nm.length - 1]} (${nm.length}개)` : nm.join(", ")) : `단원 ${x._unitMore ? "25개 넘음" : ids.length + "개"}`; };
  function exMount2(p, x) {
    if (!p || !x || p.querySelector(".exmore")) return;
    const anchor = p.querySelector(".expd") || (p.querySelector('[data-hf="date"]') || {}).parentElement; if (!anchor) return;
    const L = x.periodId && live(), err = live() && x._err;
    const h = `<div class="exmore"><div class="exrg">${IC("book", "s")}<span class="l">시험 범위</span><span class="v">${esc(unitLabel(x)) || '<span class="hint">비어 있어요</span>'}</span><button type="button" class="btn sm" data-exunits="${x.id}">범위 고르기</button></div>${live() ? `<div class="exrg">${IC("calendar", "s")}<span class="l">시험 기간</span><span class="v">${L ? "연결됨" : '<span class="hint">아직 연결 전</span>'}</span><button type="button" class="btn sm" data-exlink="${x.id}" title="노션 [시험 기간 연결]과 같아요 — 학교 · 이름이 맞는 그 해 시험 기간 일정 하나를 이어요">시험 기간 연결</button></div>${err ? `<div class="hint warn">⚠️ ${esc(err)}</div>` : ""}` : ""}</div>`;
    anchor.insertAdjacentHTML("afterend", h);
  }
  ["exams", "exams_", "exams_m", "exams_c"].forEach((k) => { const L = LISTS[k]; if (!L) return; const m0 = L.mountX; L.mountX = (p, x) => { if (m0) m0(p, x); exMount2(p, x); }; });

  function unitsDialog(x) {
    const subs = new Set(x.subjectIds || []);
    let books = alive(DB.books).filter((b) => subs.has(b.subjectId)); const all = !books.length; if (all) books = alive(DB.books);
    const S = { book: (books[0] || {}).id || "", list: null, err: "", pick: new Set(x.unitIds || []) };
    const close = modal(`<h2>시험 범위 고르기${HELP("노션 시험정보의 시험 범위(단원목록)예요. 교재를 고르고 범위에 드는 단원을 체크해요. 다른 교재에서 고른 단원은 그대로 남아요.")}</h2><div class="box"><div class="row"><select class="inp" id="exuB" style="flex:1">${books.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")}</select></div>${all && books.length ? '<div class="hint">이 시험 과목의 교재가 없어 모든 교재를 보여요</div>' : ""}${x._unitMore ? '<div class="hint warn">노션에 단원이 25개 넘게 이어져 있어요 — 여기서 고치면 고른 단원만 남아요</div>' : ""}<div id="exuL" class="exul"></div></div><div class="actions"><span class="hint" id="exuN"></span><span class="sp"></span><button class="btn" id="exuX">취소</button><button class="btn pri" id="exuO">적용</button></div>`, (m, cl) => {
      const draw = () => {
        const box = m.querySelector("#exuL"), n = m.querySelector("#exuN");
        n.textContent = `${S.pick.size}개 고름`;
        if (!S.book) { box.innerHTML = '<div class="hint">교재가 없어요 — 라이브러리에서 교재와 단원을 먼저 넣어요</div>'; return; }
        if (S.err) { box.innerHTML = `<div class="hint warn">${esc(S.err)}</div>`; return; }
        if (!S.list) { box.innerHTML = '<div class="hint">단원을 불러오는 중…</div>'; return; }
        box.innerHTML = S.list.length ? `<div class="exuh"><button type="button" class="linkbtn" id="exuAll">모두</button> · <button type="button" class="linkbtn" id="exuNone">모두 빼기</button></div>` + S.list.map((u) => `<label class="exu"><input type="checkbox" data-u="${esc(u.id)}" ${S.pick.has(u.id) ? "checked" : ""}><span>${esc(u.name || "이름 없음")}</span>${u.page != null ? `<small class="hint">${esc(u.page)}쪽~</small>` : ""}</label>`).join("") : '<div class="hint">이 교재에 단원이 없어요 — 라이브러리 [단원] 탭에서 넣어요</div>';
        box.querySelectorAll("[data-u]").forEach((c) => c.onchange = () => { c.checked ? S.pick.add(c.dataset.u) : S.pick.delete(c.dataset.u); n.textContent = `${S.pick.size}개 고름`; });
        const a = box.querySelector("#exuAll"), z = box.querySelector("#exuNone");
        if (a) a.onclick = () => { S.list.forEach((u) => S.pick.add(u.id)); draw(); };
        if (z) z.onclick = () => { S.list.forEach((u) => S.pick.delete(u.id)); draw(); };
      };
      const load = () => {
        S.list = null; S.err = ""; draw(); if (!S.book) return;
        const b = DB.books.find((z) => z.id === S.book) || {};
        if (live() && typeof liveBookApi === "function" && isId(S.book)) {
          liveBookApi({ action: "units", bookId: S.book }).then((r) => { if (S.book !== b.id) return; S.list = (r.units || []).map((u) => ({ id: u.id, name: u.name, page: u.page })); S.list.forEach((u) => { UNM[u.id] = u.name; }); draw(); }, (e) => { S.err = "단원을 불러오지 못했어요 — " + ((e && e.message) || e); draw(); });
        } else { S.list = (b.units || []).map((u, i) => ({ id: b.id + "#" + i, name: u.name || (u.from != null ? u.from + "쪽~" : "단원 " + (i + 1)), page: u.from })); S.list.forEach((u) => { UNM[u.id] = u.name; }); draw(); }
      };
      m.querySelector("#exuB").onchange = (e) => { S.book = e.target.value; load(); };
      m.querySelector("#exuX").onclick = cl;
      m.querySelector("#exuO").onclick = () => {
        const ids = [...S.pick];
        if (JSON.stringify(ids.slice().sort()) !== JSON.stringify((x.unitIds || []).slice().sort())) { x.unitIds = ids; x.units = unitLabel(x); markDirty(listOf(activeTab.screen, activeTab.state) || LISTS.exams, x); commit(); toast(`시험 범위 ${ids.length}개 단원(작성 중) — [저장]하면 노션에 들어가요`); }
        cl();
      };
      load();
    });
    return close;
  }

  /* ── 응시학생 등록 ── */
  async function exGen(x) {
    const todo = exTodo(x); if (!todo.length) return toast("등록할 학생이 없어요");
    if (live() && (!isId(x.id) || x.state === "draft")) return toast("이 시험정보를 먼저 [저장]해요 — 노션에 있는 시험정보에만 성적 줄을 만들어요");
    const rows = todo.map((s) => ({ id: uid("gr"), examId: x.id, sid: s.id, score: "", rank: "", total: "", level: "", state: live() ? "draft" : "saved" }));
    DB.grades.push(...rows);
    if (!live()) { commit(); toast(`응시학생 ${rows.length}명을 등록했어요 — Ctrl+Z로 되돌려요`); return; }
    commit();
    const ids = new Set(rows.map((r) => r.id));
    const res = await liveSave({ only: (c, r) => c === "grades" && ids.has(r.id) });
    if (res && !res.failed.length) toast(`응시학생 ${rows.length}명 — 노션 성적 줄을 만들었어요(이름은 노션이 붙여요)`);
  }

  /* ── 누르기 · 바꾸기(창 어디서든) ── */
  document.addEventListener("click", (ev) => {
    const t = ev.target; if (!t.closest || !activeTab || activeTab.screen !== "exams") return;
    const g = t.closest("[data-exgen]"), u = t.closest("[data-exunits]"), k = t.closest("[data-exlink]");
    const row = (b, a) => DB.exams.find((e) => e.id === b.dataset[a]);
    if (g && !g.disabled) { ev.preventDefault(); const x = row(g, "exgen"); if (x) exGen(x); return; }
    if (u) { ev.preventDefault(); const x = row(u, "exunits"); if (x) unitsDialog(x); return; }
    if (k) {
      ev.preventDefault(); const x = row(k, "exlink"); if (!x) return;
      if (!live() || typeof window.liveRequest !== "function") return toast("실제 자료 모드에서 노션 [시험 기간 연결]과 같은 일을 해요 — 예시에서는 위 시험 기간 단추로 골라요");
      if (!x.school) return toast("학교를 먼저 골라요 — 그 학교 시험 기간 일정과 이어요");
      try { window.liveRequestDb("exams", "시험정보(학원) DB"); if (window.LQ_ACT_NAME) window.LQ_ACT_NAME["exam-period-link"] = "시험 기간 연결"; window.liveRequest("exams", [String(x.id)], { "요청": "exam-period-link" }, "시험 기간 연결"); } catch (e) { toast("시험 기간 연결을 보내지 못했어요 — " + e.message); }
    }
  }, true);
  document.addEventListener("change", (ev) => {
    const i = ev.target; if (!i || !i.dataset || !i.dataset.gx) return;
    const g = DB.grades.find((z) => z.id === i.dataset.gx); if (!g) return;
    const f = i.dataset.gf, v = String(i.value || "").trim();
    const n = f === "total" ? (v === "" ? "" : Math.max(1, Math.round(+v.replace(/,/g, "")) || 1)) : v;
    if (g[f] === n) return; g[f] = n; g.state = "draft"; setTimeout(commitKeepFocus, 0);
  }, true);

  const css = document.createElement("style");
  css.textContent = ".exgr .recrow{display:grid;grid-template-columns:minmax(56px,1fr) 64px 56px 64px;gap:4px 6px;align-items:center;padding:6px 0;border-bottom:1px solid #F0EBE3}.exgr .exg2{grid-column:1/-1;display:flex;gap:8px;align-items:center}.exgr .exg2 .sp{flex:1}.exgr .exg2 .recpt{font-size:12px;color:#5C554B;white-space:nowrap}.exlv{width:88px}.exgr .exgh{font-size:12px;color:#8A8378}.exgr .exgh span{white-space:nowrap}.exlv{min-width:0;padding:4px 6px;height:32px}.exfl{font-size:12px;white-space:nowrap;display:inline-flex;gap:4px;align-items:center}a.exfl{color:#5C554B;text-decoration:underline;text-underline-offset:2px}.exmore{margin:8px 0 4px;display:grid;gap:6px}.exrg{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.exrg .l{font-size:12px;color:#8A8378;min-width:64px}.exrg .v{flex:1;min-width:0}.exul{max-height:360px;overflow:auto;display:grid;gap:2px;margin-top:8px}.exu{display:flex;gap:8px;align-items:center;padding:6px 4px;border-radius:6px;cursor:pointer}.exu:hover{background:#F6F2EA}.exuh{font-size:12px;margin:4px 0}";
  document.head.appendChild(css);
})();
