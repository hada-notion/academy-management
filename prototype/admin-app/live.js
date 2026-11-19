/* 실제 자료 모드: 주소에 ?live=1 → 학원 연결 설정(hada_config.js) · 관리자 로그인(admin_auth.js) → app-api 읽기(appdata.js)로 예시 자료를 노션 자료로 바꿔 끼운다.
   연결 설정 파일은 저장소 맨 위(이 화면 기준 ../../)에 있다. 없으면(시제품 로컬 서버) 예시 자료 그대로 둔다. 저장 연결은 다음 단계. */
/* 실제 자료 모드 판정(한 곳, 261119 대표 "?live=1 없이 바로 메인으로"): 명시한 주소 매개변수가 먼저 — live=1 = 실제 자료, live=0 · demo=1 = 예시 자료.
   없으면 배포 사이트(localhost · 127.0.0.1 · 파일 열기가 아닌 곳)는 실제 자료, 로컬 시제품 서버는 지금처럼 예시 자료(시험 도구 · 시연용 예시는 그대로). */
window.liveModeFor = function (search, hostname, protocol) {
  const has = (re) => re.test(String(search || ""));
  if (has(/[?&]demo=1(&|$)/) || has(/[?&]live=0(&|$)/)) return false;
  if (has(/[?&]live=1(&|$)/)) return true;
  return !(protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(String(hostname || "")) || /\.localhost$/.test(String(hostname || "")));
};
(function () {
  if (!window.liveModeFor(location.search, location.hostname, location.protocol)) return;
  const ROOT = "../../";
  const load = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));
  /* 실제 자료 모드에서는 예시 자료를 띄우지 않는다: 곧바로 모든 묶음을 비우고, 노션 자료를 다 받기 전(또는 못 받았을 때)에는
     저장 창이 열리지 않는다. 예시 자료가 노션에 들어가는 길을 없앤다(저장 층 appSaveSend도 LIVE.loaded가 없으면 보내지 않는다). */
  window.LIVE_MODE = true;
  /* 수업 · 출결은 지어내지 않는다(livelesson.js): 수업 관리 서버가 준 것만 보인다 */
  if (typeof liveLessonInstall === "function") liveLessonInstall();
  /* 실제 자료 모드의 오늘 = 진짜 오늘(예시 자료의 고정 기준일을 쓰지 않는다 — 새 학생 문의일 · 등록일 기본값) */
  try { const n = new Date(), p = (v) => String(v).padStart(2, "0"); TODAY = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; if (window.HP) HP.today = TODAY; } catch (_) {}
  const banner = (msg, bad) => {
    let b = document.getElementById("liveBanner");
    if (!msg) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "liveBanner"; b.setAttribute("role", "status"); b.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;padding:8px 14px;border-radius:10px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.12);max-width:90vw"; document.body.appendChild(b); }
    b.style.background = bad ? "#FDECEC" : "#FFF6DA"; b.style.color = "#3A3226"; b.textContent = msg;
  };
  /* 노션이 바빠요(app-api 503 busy, 노션서버 항목 100): 데이터 층(appdata.js appPostJson)이 재시도를 기다리는 동안 안내 띠. 끝나면 있던 띠(예: 받는 중)로 되돌린다 */
  let busyPrev = null;
  window.liveBusy = (msg) => { if (msg) { if (busyPrev === null) { const b0 = document.getElementById("liveBanner"); busyPrev = b0 ? b0.textContent : ""; } banner(msg, false); } else if (busyPrev !== null) { banner(busyPrev); busyPrev = null; } };
  /* 칸 켜기(hada-rules.js GATES · GATES_ON): 꺼진 칸의 화면은 메뉴에서 빼고 열리지 않게 한다. 주소 &gates=P1,P2 = 검수용 */
  const gOn = new Set(((/[?&]gates=([\w,]+)/.exec(location.search) || [])[1] || GATES_ON.join(",")).split(",").filter(Boolean));
  window.gateOn = (s) => String(s).startsWith("ext:") || Object.entries(GATES).some(([g, list]) => gOn.has(g) && list.includes(s));
  for (let i = MENU.length - 1; i >= 0; i--) { MENU[i][1] = MENU[i][1].filter((x) => gateOn(x[0])); if (!MENU[i][1].length) MENU.splice(i, 1); }
  const os0 = openScreen;
  openScreen = (s, ...rest) => { if (!gateOn(s)) { say("이 화면은 아직 열지 않았어요 — 노션에서 봐요"); return; } return os0(s, ...rest); };
  try { /* 지난번에 열어 둔 탭이 꺼진 화면이면 학생 화면으로 */
    const fix = (t) => { if (t && !gateOn(t.screen)) { t.screen = "students"; t.back = []; t.fwd = []; t.state = { season: "", mode: "edit", zoom: 2, filter: {}, sel: null, lf: {} }; } };
    (typeof tabs !== "undefined" ? tabs : []).forEach(fix); if (typeof activeTab !== "undefined") fix(activeTab);
  } catch (_) {}
  /* 보기만(P2 보기 칸): 이 칸의 화면은 노션 값을 보여 주기만 한다. 쓰는 단추는 끄고, 창의 칸은 잠그고, 그래도 값이 바뀌면 그 자리에서 되돌린다.
     고칠 것은 창 위 [노션에서 열기]로. (이 묶음들은 저장 층 대상이 아니라 노션에 갈 길도 없다) */
  /* 0단계(대표 261117): 입력 칸(P1) 안에서도 노션 버튼 · 서버 동작이 따로 있는 화면은 보기만 — 라이브러리(교재 등록 = 서버가 단원까지) · 학교(학교 검색 = 학교 코드까지) */
  /* 일정 쓰기(칸 P2e — 화면 묶음 없음, P2와 함께 켤 때만, 261119 원본검수 Z2): 켜면 일정 화면은 보기만에서 빠지고 저장 층(appsave events)으로 노션에 씀. 꺼져 있으면 보기만 */
  const EVW = gOn.has("P2") && gOn.has("P2e"); window.LIVE_EVW = EVW;
  /* 보강 쓰기(칸 P3m — 화면 묶음 없음, 보강 화면 칸 P3b와 함께 켤 때만, 261119 담당 (가)): 켜면 보강 화면이 보기만에서 빠지고 [저장]이 서버 보강 동작(livelesson.js liveMakeupSave)으로 */
  const MKW = gOn.has("P3b") && gOn.has("P3m"); window.LIVE_MKW = MKW;
  const P2ON = gOn.has("P2"), RO = new Set([...GATES.P2, ...GATES.P3, ...GATES.P3b, "schools"].filter((s) => !(EVW && s === "events") && !(MKW && s === "makeup"))); /* P3 수업은 걸음 1 = 보기만 */
  window.liveRO = (s) => RO.has(s);
  window.liveScr = (t) => (t && t.screen === "timetable" && t.state && t.state.view === "lesson" ? "lesson" : t ? t.screen : "");
  let roBase = null, roScreen = null, roBusy = false;
  /* 출결 쓰기(P3 걸음 2, 칸 P3w — 수업 칸 P3과 함께 켤 때만): 수업 창의 [출석][결석] · [모두 출석] · [되돌리기] · [수업 저장]만 풀고 나머지는 보기만 그대로 */
  const ATTW = gOn.has("P3") && gOn.has("P3w"); window.LIVE_ATTW = ATTW;
  const attw = () => ATTW && liveScr(typeof activeTab !== "undefined" ? activeTab : null) === "lesson";
  const roPass = () => RO_PASS0 + (attw() ? ",.attseg,#allOk,#lsRev,#lsSave,#attEd,.attv.ed,.attpop .so" : "") + (recTab() ? "," + REC_AREA : "") + (recw() ? ",#lsRev,#lsSave" : "") /* 학습기록 쓰기(P3b)만 켜도 수업 창 아래 [수업 저장] · [되돌리기]가 눌림(기록 · 루틴 체크 저장) */ + (window.LIVE_MKW && inLesson() ? ",[data-mkin]" : ""); /* 536판(대표 261119): 출결 = 값 칸 .attv + 머리 [편집] #attEd + 떠 있는 목록 .attpop .so(body). .attseg는 과제 단추 */
  /* 학습기록 쓰기(칸 P3b — 수업 칸 P3과 함께 켤 때만, 261119 원본검수 Z1): 하루 수업 페이지의 학습기록 · 과제검사 · 학습활동 · 진도 · 루틴 탭을 풀고, 저장은 livelesson.js(update-record · create-records · save-activities · save-routines) */
  const RECW = gOn.has("P3") && gOn.has("P3b"); window.LIVE_RECW = RECW;
  const REC_TABS = ["prog", "log", "hw", "act", "rt"];
  const inLesson = () => liveScr(typeof activeTab !== "undefined" ? activeTab : null) === "lesson";
  const recw = () => RECW && inLesson();
  /* 학습기록 쓰기가 켜지면 수업 창의 [학습] 탭 · 학생 창의 [학습] 탭 안을 잠그지 않는다(수업 전체 화면은 없어져 옛 #lpIn · .lpx · lptab은 더 쓰지 않음) */
  const recTab = () => { if (!recw()) return false; const st = (activeTab && activeTab.state) || {}; return st.lsStu ? st.astab === "learn" : (st.ltab === "log" || st.ltab === "rt"/* 루틴 탭: P3b의 루틴 체크 · [루틴 체크 생성] 쓰기도 같은 칸(원본검수 261119) */); };
  const REC_AREA = ".panel .ptab.on,.panel .pbody";
  /* 보기만 되돌리기에서 뺄 값: 출결 쓰기면 출결 · 한마디(anotes), 학습기록 쓰기면 기록 · 오늘 진도(lpToday) */
  const roKeepKeys = () => [...(attw() ? ["att", "anotes"] : []), ...(recw() ? ["recs", "lpToday"] : [])];
  const snapRo = () => { const ks = roKeepKeys(); if (!ks.length) return snapshot(); const keep = {}; ks.forEach((k) => { keep[k] = DB[k]; DB[k] = Array.isArray(keep[k]) ? [] : {}; }); try { return snapshot(); } finally { Object.assign(DB, keep); } };
  window.liveRoReset = () => { roBase = null; };
  const roCss = document.createElement("style");
  roCss.textContent = ".live-ro #view [data-gdel]{display:none!important}.ro-note{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#FFF6DA;color:#3A3226;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ro-note a{color:inherit;font-weight:600;text-decoration:underline}.ro-line{margin:-2px 0 8px;padding:0 4px;font-size:12px;color:#8A8378}";
  document.head.appendChild(roCss);
  /* 보기 전용 화면 안내(261119 대표 "보기 중심인 화면에만 안내, 나머지는 다 사용 가능"): 시험 · 수강료 · 청구서 · 손익 분석 · 법정 서류만 제목 줄 아래 작은 회색 한 줄(토스트 아님 · 닫기 없음).
     어느 화면인지는 이 목록 한 곳이 기준 — 목록에 없는 화면(수업 · 일정 · 학생 · 클래스 · 등록 …)에는 보기만 칸이어도 안 뜬다 */
  const RO_NOTE_SCREENS = new Set(["exams", "tuition", "bill", "bookfees", "charges", "etcs", "profit", "costs", "legal", "schools", "records", "reports", "completion", "letters", "files", "alims"]);
  const RO_NOTE_TEXT = "이 화면은 보기만 해요 — 고칠 것은 노션에서 고쳐요";
  /* 261119 대표("라이브러리 [+] · [연필]이 막혀 있다"): [+] · [연필]이 꺼진 화면은 이유를 한 줄로 — 라이브러리 · 학교는 노션 버튼이 서버 동작(교재 단원 · 학교 코드)까지 해서 앱에서 직접 추가하지 않음 */
  const RO_NOTE_BY = { schools: "학교는 보기만 해요 — 학교 추가는 노션 학교 페이지의 [학교 검색]에서 해요(학교 코드까지 가져와요)" };
  const roNote = (show, scr) => {
    const v = document.getElementById("view"); if (!v) return;
    let n = v.querySelector(":scope > .ro-line");
    if (!show) { if (n) n.remove(); return; }
    const top = v.querySelector(":scope > .top"); if (!top) return;
    const txt = RO_NOTE_BY[scr] || RO_NOTE_TEXT;
    if (n && n.textContent !== txt) n.textContent = txt;
    if (!n) { n = document.createElement("div"); n.className = "ro-line"; n.textContent = txt; }
    if (top.nextElementSibling !== n) top.after(n);
  };
  const roDress = () => {
    const q = (s) => document.querySelectorAll(s), why = "";
    q("#addRow,#tbEd,[data-act2]").forEach((b) => { b.disabled = true; b.title = why; });
    const recFree = (el) => recTab() && el.closest(REC_AREA); /* 학습기록 쓰기 칸이 켜진 하루 수업 페이지의 기록 탭은 잠그지 않음 */
    q(".panel input:not([type=checkbox]):not([type=radio]),.panel textarea").forEach((i) => { if (!recFree(i)) i.readOnly = true; });
    q(".panel select,.panel input[type=checkbox],.panel input[type=radio]").forEach((i) => { if (!recFree(i)) i.disabled = true; });
    /* 창 안의 누르는 것은 이동(RO_PASS)만 남기고 모두 끈다: 전송 · 삭제 · 생성 · 저장 · 켜고 끄기 · 고르기 */
    /* 화면 위 줄 · 달력 · 창 어디든: 허용 목록(이동 · 보기 바꾸기 · 찾기 · 인쇄 · 입력 칸 저장 단추)에 없는 단추는 모두 끈다 — 새 단추가 생겨도 기본이 꺼짐 */
    q("#view button,#view .hf-box,#view select").forEach((b) => { if (b.closest(roPass()) || recFree(b)) return; if ("disabled" in b) b.disabled = true; b.setAttribute("aria-disabled", "true"); b.title = why; });
    const p = document.querySelector(".panel"), id = String((activeTab.state || {}).sel || "");
    if (p && /^[0-9a-f-]{32,36}$/i.test(id) && !p.querySelector(".ro-note")) {
      const n = document.createElement("div"); n.className = "ro-note";
      n.innerHTML = `<a href="https://www.notion.so/${id.replace(/-/g, "")}" target="_blank" rel="noopener">노션에서 열기</a>`;
      const body = p.querySelector(".pbody"); body ? body.insertBefore(n, body.firstChild) : p.appendChild(n);
    }
  };
  const roLock = () => {
    const t = typeof activeTab !== "undefined" ? activeTab : null, scr = liveScr(t), on = !!(t && window.LIVE && window.LIVE.loaded && RO.has(scr));
    document.body.classList.toggle("live-ro", on);
    roNote(on && RO_NOTE_SCREENS.has(scr), scr);
    if (!on) { roBase = null; roScreen = null; return; }
    const now = snapRo();
    if (roBase === null || roScreen !== scr) { roBase = now; roScreen = scr; }
    else if (now !== roBase && !roBusy) {
      roBusy = true;
      try {
        const ks = roKeepKeys(), keep = ks.length ? Object.fromEntries(ks.map((x) => [x, DB[x]])) : null; /* 쓰기가 켜진 수업 화면: 출결 · 기록 값은 되돌리지 않는다 */
        Object.assign(DB, JSON.parse(roBase)); if (keep) Object.assign(DB, keep); lastSnap = snapshot();
        if (!keep) { try { LDIRTY.clear(); } catch (_) {} } /* 수업 창에서 생긴 작성 중 표시도 지운다(보기만일 때) */
        if (undoStack.length && undoStack[undoStack.length - 1] === roBase) undoStack.pop(); /* 방금 고친 것의 되돌리기 기록 */
        r0();
      } finally { roBusy = false; }
      const after = snapRo(); if (after !== roBase) roBase = after; /* 그리면서 스스로 바뀌는 값은 받아들인다(되돌리기를 되풀이하지 않게) */
    }
    roDress();
  };
  /* 보강 쓰기 칸: 저장 대기 수에 서버 보강 배정 · 빼기 · 지우기 수를 더한다(새 보강은 화면이 이미 셈) */
  if (MKW && typeof dirtyCount === "function") { const dc0 = dirtyCount; dirtyCount = function () { let n = dc0.apply(this, arguments); try { if (typeof liveMakeupPlan === "function") { const P = liveMakeupPlan(); n += P.assign.length + P.unlink.length + P.del.length + P.att.length; } } catch (_) {} return n; }; }
  /* 학습기록 쓰기 칸: 루틴 체크를 눌러 바뀐 수업도 저장 대기 수에 더한다(이미 작성 중으로 센 수업은 빼서 두 번 세지 않음) */
  if (RECW && typeof dirtyCount === "function") { const dc1 = dirtyCount; dirtyCount = function () { let n = dc1.apply(this, arguments); try { if (typeof liveRoutineDirtyKeys === "function") n += liveRoutineDirtyKeys().filter((k) => !LDIRTY.has(k)).length; } catch (_) {} return n; }; }
  /* 수업 창 아래 [수업 저장 n] · [되돌리기]도 루틴 체크 변경을 센다(원본검수 261119: 체크를 눌러도 [수업 저장]이 비활성이던 것) */
  if (RECW && typeof lCount === "function") { const lc0 = lCount; lCount = function (k) { let n = lc0.apply(this, arguments); try { if (typeof liveRoutineChangedN === "function") n += liveRoutineChangedN(k); } catch (_) {} return n; }; }
  if (RECW && typeof lRevert === "function") { const lr0 = lRevert; lRevert = function (k) { const r = lr0.apply(this, arguments); try { if (typeof liveRoutineRevert === "function") liveRoutineRevert(k); } catch (_) {} return r; }; }
  const r0 = render;
  /* 수업 화면 = 시간표 화면의 [수업] 보기. 수업 칸(P3)이 꺼져 있으면 그 보기로 못 넘어가게 한다(단추도 숨김) */
  const lessonGate = () => {
    const t = typeof activeTab !== "undefined" ? activeTab : null;
    if (t && t.screen === "timetable" && t.state && t.state.view === "lesson" && !gateOn("lesson")) { t.state.view = "tt"; t.state.lsel = null; say("수업 화면은 아직 열지 않았어요 — 노션에서 봐요"); }
  };
  roCss.textContent += gateOn("lesson") ? "" : '#view [data-view="lesson"]{display:none!important}';
  /* 0단계 — 입력 화면(P1)에서 잠그는 것(두 길로 갈라지는 일): 노션 버튼이 딸린 일까지 하는 단추는 끄고 [노션에서 해요]로 알린다.
     등록 [종료 처리] · [링크 재발급], 진도 [교재 생성] · [수료], 안내 전송 · 접수 안내 · 학사일정, 시간표 [잠금 해제](수업이 만들어진 시간표의 요일 · 시간),
     학생 [개인정보 동의](체크하면 노션 자동화가 접수 안내 알림톡을 보낸다 — 앱은 그 칸을 보내지 않는다). 저장 층(appsave.js appsOff)도 같은 것을 보내지 않는다. */
  const P1_DENY = "[data-act=end],[data-act=enReissue],[data-act=genPg],[data-act=genPg1],[data-act=pgDone],[data-act=pgRep],[data-pgdo],[data-cetone],#bfM,#pLock"; /* [data-cetone] = 클래스 창 [한 번 청구] — 청구서는 노션 [기타경비 청구](서버)가 만듦, 앱엔 저장 길 없음 */
  const P1_DENY_TEXT = /(접수 안내|등록 안내|안내 전송|안내문 전송|재발급|학사일정 가져오기|종료 처리|교재 생성|교재비에 담기|한 번 청구)\s*\d*\s*$/; /* 담기 = 노션 [담기](서버가 청구서까지 만듦) */
  const P1_WHY = "";
  const p1Denied = (el) => { const hf = el && el.closest && el.closest(".hf"); if (hf && hf.closest("#view")) { const lb = hf.querySelector(".hf-lbl"); if (lb && /^개인정보 동의/.test(lb.textContent.trim())) return el.closest(".qhelp,[data-help]") ? null : hf; } const b = el && el.closest && el.closest("button,[role=button],.btn,.lnk,label,.swf,[data-hf]"); if (!b || !b.closest("#view")) return null; if (b.matches(P1_DENY) || b.closest(P1_DENY)) return b; const t = (b.textContent || "").trim(); if (b.matches("button,.btn,.lnk") && P1_DENY_TEXT.test(t)) return b; if (/개인정보 동의/.test(t) && t.length < 40) return b; return null; };
  const p1Dress = () => {
    if (!(window.LIVE && window.LIVE.loaded) || document.body.classList.contains("live-ro")) return;
    document.querySelectorAll("#view button,#view .lnk,#view .swf,#view [data-hf],#view .hf").forEach((el) => { if (p1Denied(el) !== el) return; if ("disabled" in el) el.disabled = true; el.setAttribute("aria-disabled", "true"); el.title = /개인정보 동의/.test(el.textContent) ? "개인정보 동의는 노션에서 체크해요 — 체크하면 접수 안내 알림톡이 나가요" : P1_WHY; el.classList.add("live-off"); });
  };
  /* 꺼진 것은 꺼진 모양으로(원본 검수 H3): 실제 자료 모드에서 잠근 단추 · 칸은 글자까지 흐리게 */
  roCss.textContent += ".live-off,.live-ro #view button[aria-disabled=true],.live-ro #view .hf-box[aria-disabled=true]{opacity:.45!important;filter:grayscale(1);cursor:not-allowed!important}";
  const p1Block = (e) => { if (!(window.LIVE && window.LIVE.loaded) || document.body.classList.contains("live-ro")) return; const b = p1Denied(e.target); if (!b) return; if (e.type === "keydown" && !["Enter", " "].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); if (e.type === "click" && /개인정보 동의/.test(b.textContent)) say("개인정보 동의는 노션에서 체크해요 — 체크하면 접수 안내 알림톡이 나가요"); };
  ["click", "mousedown", "pointerdown", "keydown", "change"].forEach((ev) => document.addEventListener(ev, p1Block, true));
  /* 수업이 만들어진 시간표의 요일 · 시간 · 명단, 이미 있는 등록의 종료일은 그 자리에서 되돌린다(끌어 옮기기 · 명단 넣기처럼 단추가 아닌 길까지) */
  const p1Guard = () => {
    if (!(window.LIVE && window.LIVE.loaded)) return;
    let hit = "";
    DB.blocks.forEach((b) => { if (!b.lessons || b.del || !TSAVED.has(b.id)) return; const o = JSON.parse(TSAVED.get(b.id)); if (!o.lessons) return; if (b.day === o.day && b.start === o.start && b.end === o.end && JSON.stringify(b.regs) === JSON.stringify(o.regs)) return; Object.keys(b).forEach((k) => delete b[k]); Object.assign(b, o); hit = "수업이 만들어진 시간표의 요일 · 시간 · 명단은 노션에서 바꿔요 — 출석이 함께 맞춰져야 해요"; });
    const S = typeof SAVEDC !== "undefined" ? SAVEDC.enrolls : null;
    if (S) DB.enrolls.forEach((e, i) => { const sv = S.get(e.id); if (!sv) return; /* 불러온(저장된) 등록만 — 새 등록의 종료일은 그대로 */ const o = JSON.parse(sv); const stray = "d" in e && !("d" in o); /* 날짜 칸에 치던 글자(d)가 줄에 남아 '작성 중'으로 잡히던 것(원본 검수 H2) */ const canon = (r) => JSON.stringify(Object.keys(r).filter((k) => k !== "state" && k !== "_o" && r[k] !== undefined && r[k] !== null && r[k] !== "" && r[k] !== false && !(Array.isArray(r[k]) && !r[k].length) /* 그리면서 붙는 빈 목록(adjs 등)은 다른 값으로 치지 않는다 */).sort().map((k) => [k, r[k]])); const changed = (e.end || "") !== (o.end || "") || !!e.ended !== !!o.ended || stray; if (changed) { if ("end" in o) e.end = o.end; else delete e.end; if ("ended" in o) e.ended = o.ended; else delete e.ended; if (stray) delete e.d; hit = hit || "등록 종료는 노션 [종료 처리]로 해요 — 남은 수업 · 출석 정리까지 함께 해요"; } /* 525판(원본 검수 523): 값이 원래대로 돌아왔는데 '작성 중' 표시만 남은 등록은 표시도 되돌린다 — [저장 n] · 확인 창에 남지 않게 */ if (e.state === "draft" && canon(e) === canon(o)) { e.state = o.state; hit = hit || " "; } });
    /* 학교는 앱이 만들지 않는다(원본 검수 H1): 고르기 목록의 "+ 생성"으로 생긴 학교 줄은 그 자리에서 빼고, 그 학교를 적은 학생의 학교 칸은 비운다 */
    const isId = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v));
    const fresh = (DB.schools || []).filter((s) => !isId(s.id));
    /* 학교 칸은 비우지 않고 불러온 값으로 되돌린다. 되돌린 뒤 불러온 값과 같아진 학생은 '작성 중'에서 뺀다 */
    const schBack = (s) => { const b0 = LIVE_STU0.has(s.id) ? JSON.parse(LIVE_STU0.get(s.id)) : null; s.school = s._o && "school" in s._o ? s._o.school || "" : b0 ? b0.school || "" : ""; if (b0) { const canon = (o) => JSON.stringify(Object.keys(o).filter((k) => k !== "_o" && k !== "state" && o[k] !== undefined).sort().map((k) => [k, o[k]])); if (canon(s) === canon(b0)) { if ("state" in b0) s.state = b0.state; else delete s.state; delete s._o; } } };
    if (fresh.length) { const gone = new Set(fresh.map((s) => s.name)); DB.schools = DB.schools.filter((s) => isId(s.id)); (DB.students || []).forEach((s) => { if (gone.has(s.school)) schBack(s); }); hit = hit || "학교는 노션 [학교 검색]으로 먼저 넣어요 — 학교 코드 · 학사일정이 함께 들어가요"; }
    else { const have = new Set((DB.schools || []).map((s) => s.name)); (DB.students || []).forEach((s) => { if (s.school && !have.has(s.school) && s.state === "draft") { schBack(s); if (s.school && !have.has(s.school)) s.school = ""; hit = hit || "없는 학교예요 — 학교는 노션 [학교 검색]으로 먼저 넣어요"; } }); }
    if (hit) { try { savedSync(); lastSnap = snapshot(); } catch (_) {} r0(); if (hit.trim()) say(hit); }
  };
  /* 칸을 고친 바로 뒤에도 본다(다시 그리지 않는 길 — 원본 검수 H2: 종료일이 저장 전까지 고친 값으로 보였음) */
  let p1Tick = null;
  ["change", "click", "focusout"].forEach((ev) => document.addEventListener(ev, () => { if (!(window.LIVE && window.LIVE.loaded) || p1Tick) return; p1Tick = setTimeout(() => { p1Tick = null; try { p1Guard(); p1Dress(); } catch (_) {} /* 칸이 초점을 잃은 뒤 늦게 값을 다시 적는 길까지(원본 검수 521: 화면은 비는데 줄에 종료일이 남았음) */ setTimeout(() => { try { p1Guard(); p1Dress(); } catch (_) {} }, 250); }, 0); }, true));
  render = function () { try { lessonGate(); } catch (_) {} const out = r0.apply(this, arguments); try { p1Guard(); } catch (_) {} try { roLock(); } catch (_) {} try { p1Dress(); } catch (_) {} try { if (typeof liveLessonNeed === "function") liveLessonNeed(); } catch (_) {} return out; };
  /* 되돌리기 · 다시 하기 · 모두 되돌리기는 입력 칸(P1)의 값을 움직이는 일이라 보기 화면에서도 막지 않는다 */
  ["undo", "redo", "revertAll"].forEach((k) => { try { const f0 = eval(k); eval(k + " = function () { roBase = null; if (k === 'revertAll') { try { liveStuRestore(); } catch (_) {} } return f0.apply(this, arguments); }"); } catch (_) {} });
  /* 불러온 학생의 기준 값(원본 검수 H4): [모두 되돌리기]는 "처음 값(_o)이 없는 작성 중 학생 = 새 학생"으로 보고 지운다. 노션에서 불러온 학생은 처음 값이
     없어도(고르기 목록 · 표 편집처럼 _o를 안 남기는 길로 고친 경우) 지우지 않고 불러온 값으로 되돌린다. 기준은 받은 직후 · 저장 직후에 적는다 */
  const LIVE_STU0 = new Map();
  window.liveStuMark = () => { LIVE_STU0.clear(); (DB.students || []).forEach((s) => { if (s.state !== "draft") { /* 받은 직후 · 저장 직후의 저장된 학생 = 노션에 있는 학생 */ const c = Object.assign({}, s); delete c._o; LIVE_STU0.set(s.id, JSON.stringify(c)); } }); };
  /* 526판: 선택지에 없어 보내지 않은 값(학생과의 관계)은 저장 뒤 줄에 남기지 않는다 — 노션에 있는 값(되돌리기 기준)으로 돌리고, 보낸 값 기준도 맞춘다 */
  window.liveSelBack = () => { const list = (window.LIVE_SEL || {})["학생과의 관계"]; if (!Array.isArray(list) || !list.length) return; (DB.students || []).forEach((s) => { if (s.state === "draft" || !s.gprel || list.includes(s.gprel) || !LIVE_STU0.has(s.id)) return; s.gprel = JSON.parse(LIVE_STU0.get(s.id)).gprel || ""; try { APPS_BASE.set("students:" + s.id, JSON.stringify(APPSAVE.students.props(s, appSaveX(DB, null)))); } catch (_) {} }); };
  window.liveStuRestore =() => { if (!(window.LIVE && window.LIVE.loaded)) return; (DB.students || []).forEach((s) => { if (s.state !== "draft" || s._o || !LIVE_STU0.has(s.id)) return; const base = JSON.parse(LIVE_STU0.get(s.id)); Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, base); }); };
  document.addEventListener("beforeinput", (e) => { if (document.body.classList.contains("live-ro") && e.target.closest && e.target.closest(".panel,#view table")) e.preventDefault(); }, true);
  /* 보기 칸의 쓰기는 여기 한 곳에서 막는다(화면마다 막지 않는다):
     ① 창 본문 · 창 아래 단추 줄의 누르는 것(단추 · 고르기 · 켜고 끄기 · 전송 · 삭제 · 생성)은 눌리기 전에 막는다. 이동(탭 · 줄 열기 · 도움말 · 노션 링크)만 지나간다.
     ② 그래도 값이 바뀌면(다시 그리지 않는 길 포함) 누른 바로 뒤에 견줘 되돌린다. */
  /* 허용 목록(보기 화면에서 눌러도 되는 것 = 값이 바뀌지 않는 것). 여기 없는 단추 · 고르기 · 입력은 보기 화면에서 꺼지고 막힌다.
     창: 링크 · 도움말 · 노션 · 줄 열기/이동 · 접기 · 탭 · 할 일 줄. 위 줄: 날짜 · 달 · 주 이동, 보기 탭, 찾기, 엑셀 · 인쇄, 크기, 창 고정,
     그리고 입력 칸(P1)에서 고친 것을 다루는 실행 취소 · 다시 실행 · 모두 되돌리기 · 저장. */
  const RO_PASS0 = "a,[data-help],[data-notion],.hnot,[data-drill],[data-go],[data-gobook],[data-gochs],[data-gobill],[data-act^=go],[data-rpdo^=open],[data-rpdo^=notion],[data-pgfold],[data-entab],[data-ldn],[data-lmn],.ptabs,.ro-note,.tdr,.tdmore,.qhelp,summary,"
    + "[data-dn],[data-mn],[data-sub],[data-cfnav],[data-mtab],[data-view],[data-wkd],[data-evsel],.foldchip,#lq,.sbx,#xlB,#prB,#undoB,#redoB,#rvAll,#saveAll,#panelT,#mkPanelT,#seaChip,#wkP,#wkN,#wkT,#lmAtt,#cbFind,#zOut,#zIn,#makeWeek,#lGen"; /* #makeWeek · #lGen(수업 메뉴 v559의 생성 단추) = 수업 생성: 노션 버튼과 같은 서버 함수(generate-classes)를 부르는 run이라 보기 화면에서도 켠다(대표 261117 "수업 생성은 앱에서도") */
  const RO_HIT = "button,input,select,textarea,label,[role],[tabindex],[contenteditable],.btn,.lnk,.hf-box";
  const roBlock = (e) => {
    if (!document.body.classList.contains("live-ro") || !e.target.closest) return;
    /* 보기 화면의 엑셀은 내려받기만: [한번에 올리기]는 어디에 떠 있든(메뉴 · 창) 막는다 */
    { const up = e.target.closest("button,label,[role=menuitem],.btn,input[type=file]"); if (up && (up.matches("input[type=file]") || /올리기/.test(up.textContent || ""))) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; } }
    if (!e.target.closest("#view")) return;
    if (e.target.closest(roPass()) || !e.target.closest(RO_HIT)) return;
    if (!e.target.closest(".panel") && !e.target.closest("button,select,[role=button],.btn,.lnk,.hf-box")) return; /* 창 밖은 단추 · 고르기만(표 줄 · 카드 · 찾기 칸은 그대로) */
    if (e.type === "keydown" && !["Enter", " ", "Delete", "Backspace"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  };
  ["click", "mousedown", "pointerdown", "keydown", "change"].forEach((ev) => document.addEventListener(ev, roBlock, true));
  let roTick = null;
  const roSoon = () => { if (!document.body.classList.contains("live-ro") || roTick) return; roTick = setTimeout(() => { roTick = null; try { roLock(); } catch (_) {} }, 0); };
  ["click", "change", "input", "keyup", "drop", "paste"].forEach((ev) => document.addEventListener(ev, roSoon, true));
  const wipe = () => { try { if (typeof liveLessonReset === "function") liveLessonReset(); appApply({}, DB); if (typeof lastSnap !== "undefined" && typeof snapshot === "function") lastSnap = snapshot(); if (typeof undoStack !== "undefined") undoStack.length = 0; if (typeof render === "function") render(); } catch (_) {} };
  wipe();
  banner("노션 자료를 받는 중이에요 — 받기 전에는 저장할 수 없어요");
  const sd0 = saveDialog;
  saveDialog = (only) => { if (!(window.LIVE && window.LIVE.loaded)) { say("노션 자료를 다 받기 전에는 저장할 수 없어요"); return; } try { p1Guard(); } catch (_) {} /* 저장 창을 열기 전에 잠근 값(종료일 등)을 한 번 더 되돌린다 */ return sd0(only); };
  const stop = (msg) => { banner(msg + " — 저장할 수 없어요. 주소 끝에 ?demo=1을 붙이면 예시 자료로 열려요", true); };
  /* 판 확인: 브라우저가 옛 화면 파일을 들고 있으면(판 번호가 서버와 다름) 한 번 새로 받는다 */
  const fresh = async () => {
    try {
      const mine = (document.querySelector('script[src*="live.js?v="]') || {}).src || "", v0 = (/v=(\d+)/.exec(mine) || [])[1];
      const txt = await (await fetch(location.pathname, { cache: "reload" })).text(), v1 = (/live\.js\?v=(\d+)/.exec(txt) || [])[1];
      if (v0 && v1 && v0 !== v1 && sessionStorage.getItem("hada_live_reload") !== v1) { sessionStorage.setItem("hada_live_reload", v1); location.reload(); return false; }
    } catch (_) {}
    return true;
  };
  async function start() {
    if (!(await fresh())) return;
    try { await load(ROOT + "hada_config.js"); await load(ROOT + "admin_auth.js"); }
    catch (_) { stop("학원 연결 설정을 찾지 못했어요"); return; }
    let cfg;
    try { cfg = HadaAdminAuth.config(); } catch (e) { stop(e.message); return; }
    let session = HadaAdminAuth.savedSession();
    const go = async () => {
      document.body.classList.add("live-loading");
      window.LIVE = null; wipe();
      banner("노션 자료를 받는 중이에요 — 받기 전에는 저장할 수 없어요");
      try {
        /* 보기 칸(P2)이 켜져 있으면 보기 묶음(일정 · 보고서 · 수강료 · 청구 · 시험 · 알림톡 설정 · 자료)도 함께 받는다 */
        await (P2ON && typeof appViewLoad === "function" ? appViewLoad : appLoad)({ url: cfg.url, anonKey: cfg.anonKey, session });
        appSaveMark(DB); /* 불러온 값을 기준으로 적어 둠 — 저장 때 달라진 칸만 보냄 */
        try { liveStuMark(); } catch (_) {} /* 학생 되돌리기 기준 */
        /* [모두 되돌리기]가 돌아갈 값도 불러온 값으로 적어 둔다(안 적으면 고친 줄이 되돌리기 때 화면에서 빠진다) */
        try { savedSync(); DB.blocks.forEach((b) => { try { tSnap(b); } catch (_) {} }); } catch (_) {}
        /* 노션 선택지(options)는 첫 화면을 그린 뒤 뒤에서 받는다(261119 첫 로드 느림: 서버가 options를 처음 부를 때 노션을 20여 번 불러 6~9초). 화면은 선택지 없이도 열리고,
           받는 동안 고르기 칸에서 새 값 만들기는 막고(optAdd) 저장은 받기를 기다린다(liveSave). 받으면 다시 그린다. 못 받아도 화면은 그대로(저장 때 서버가 거름) */
        window.LIVE_OPTS_PENDING = true;
        window.LIVE_OPTS_PROMISE = liveApi({ url: cfg.url, anonKey: cfg.anonKey, session }, { action: "options" }).then((res) => { liveOptions(res); }, () => {}).then(() => { window.LIVE_OPTS_PENDING = false; try { if (typeof render === "function") render(); } catch (_) {} });
        /* loaded = 이번에 노션 자료를 끝까지 받았다는 표시. 이 표시가 있을 때만 저장한다 */
        window.LIVE = { url: cfg.url, anonKey: cfg.anonKey, session, at: new Date().toISOString(), loaded: true };
        liveHooks();
        if (typeof snapshot === "function") lastSnap = snapshot();
        if (typeof render === "function") render();
        banner("");
        say("노션 자료로 바꿨어요");
      } catch (e) {
        window.LIVE = null; wipe(); /* 받다가 실패하면 반쯤 받은 자료도 버린다 */
        if (/\((401|403)/.test(e.message)) { HadaAdminAuth.saveSession(""); session = ""; banner("관리자 로그인이 필요해요 — 로그인 전에는 저장할 수 없어요"); ask(); }
        else stop("노션 자료를 불러오지 못했어요(" + e.message + ")");
      } finally { document.body.classList.remove("live-loading"); }
    };
    const ask = () => modal(`<h2>관리자 로그인</h2><div class="box"><p class="hint">노션 자료를 읽으려면 관리자 비밀번호를 넣어요.</p><input id="lvpw" type="password" autocomplete="current-password" aria-label="관리자 비밀번호"><p class="hint" id="lverr"></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">예시 자료로 보기</button><button class="btn pri" id="co">로그인</button></div>`, (m, close) => {
      const pw = m.querySelector("#lvpw"), err = m.querySelector("#lverr");
      m.querySelector("#cc").onclick = () => { location.href = location.pathname + "?demo=1"; }; /* 예시 자료 = 실제 자료 모드를 벗어난 주소(배포 사이트는 매개변수 없이 열면 실제 자료라 ?demo=1을 붙인다) */
      const submit = async () => {
        err.textContent = "";
        try { session = await HadaAdminAuth.login(cfg.url, pw.value); HadaAdminAuth.saveSession(session); close(); go(); }
        catch (e) { err.textContent = e.message; pw.select(); }
      };
      m.querySelector("#co").onclick = submit;
      pw.onkeydown = (e) => { if (e.key === "Enter") submit(); };
      setTimeout(() => pw.focus(), 0);
    });
    window.liveReload = go; /* 교재 등록처럼 서버가 직접 만든 자료를 다시 받을 때 */
    session ? go() : ask();
  }
  setTimeout(start, 0);
})();

/* 실제 자료 모드의 [저장]: 작성 중인 줄(입력 범위 12개 묶음)을 app-api save로 노션에 쓴다. 저장 창의 [저장]이 부른다(LIVE일 때만).
   성공한 줄은 저장됨으로, 실패 · 충돌 줄은 작성 중으로 남기고 이유를 보여 준다. 지우기는 보내지 않는다(노션에서 직접). */
async function liveApi(conn, body) {
  const { res, body: out } = await appPostJson(String(conn.url).replace(/\/+$/, "") + "/functions/v1/app-api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": conn.session, Authorization: "Bearer " + conn.anonKey, apikey: conn.anonKey },
    body: JSON.stringify(body),
  });
  if (!res.ok || !out || !out.ok) throw new Error((out && out.error) || "요청 실패 (" + res.status + ")");
  return out;
}
/* 고르기 목록을 노션 선택지로 바꾼다(저장은 노션에 없는 값을 받지 않으므로 앱도 있는 값만 고르게).
   앱 목록 이름 ↔ 노션 [DB · 칸]. 노션 목록이 비었거나 못 받은 것은 앱 목록 그대로 둔다. LIVE_OPTS = 새 값 만들기를 막을 목록. */
const LIVE_OPT_MAP = { role: ["강사(학원) DB", "직책"], series: ["라이브러리(학원) DB", "시리즈"], pub: ["라이브러리(학원) DB", "출판사"], curr: ["라이브러리(학원) DB", "교육과정"], unit: ["라이브러리(학원) DB", "진도 단위"], btype: ["라이브러리(학원) DB", "교재 유형"] };
function liveOptions(res) {
  const dbs = (res && res.dbs) || {};
  if (!DB.opts) DB.opts = {};
  window.LIVE_OPTS = {};
  for (const [k, [db, prop]] of Object.entries(LIVE_OPT_MAP)) {
    const list = dbs[db] && dbs[db][prop];
    if (Array.isArray(list) && list.length) { DB.opts[k] = list.slice(); window.LIVE_OPTS[k] = prop; }
  }
  const route = dbs["학생(학원) DB"] && dbs["학생(학원) DB"]["문의 경로"];
  if (Array.isArray(route) && route.length && typeof ROUTES !== "undefined") { ROUTES.length = 0; ROUTES.push(...route); window.LIVE_OPTS.route = "문의 경로"; }
  /* 글일 수도 선택일 수도 있는 칸(524판): 노션이 선택 칸이면 그 선택지 목록을 적어 둔다 — 저장 층(appsave.js X.opt)이 목록에 없는 값은 그 칸만 빼고 알린다. 글 칸이면 목록이 없다 */
  window.LIVE_SEL = {};
  const rel = dbs["학생(학원) DB"] && dbs["학생(학원) DB"]["학생과의 관계"];
  if (Array.isArray(rel) && rel.length) window.LIVE_SEL["학생과의 관계"] = rel.slice();
}
/* 실제 자료 모드에서 앱의 두 곳을 바꿔 끼운다(한 번만):
   - 저장 숫자(dirtyCount): 작성 중 표시가 아니라 "노션에 아직 안 간 줄 수"(새 줄 + 불러온 값과 달라진 줄)도 센다.
   - 알림(toast): 창 아래 [ㅇㅇ 저장]처럼 앱 안에서만 저장하던 곳("(시제품: 노션에 쓰지 않음)")은 그 말을 떼고 바로 노션 저장을 잇는다. */
function liveHooks() {
  if (window._liveHooked) return; window._liveHooked = true;
  const dc0 = dirtyCount, toast0 = toast, optAdd0 = optAdd;
  /* 노션 선택지로 바꾼 목록에는 앱에서 새 값을 만들지 않는다(노션에서 선택지를 먼저 만든다) */
  optAdd = (k, t) => {
    if (window.LIVE && window.LIVE_OPTS_PENDING) { toast0("노션 선택지를 불러오는 중이에요 — 잠시 뒤 다시 만들어요"); return null; }
    if (window.LIVE && window.LIVE_OPTS && window.LIVE_OPTS[k]) { toast0(`'${String(t || "").trim()}'은(는) 노션 [${window.LIVE_OPTS[k]}] 선택지에 없어요 — 노션에서 선택지를 먼저 만들어요`); return null; }
    return optAdd0(k, t);
  };
  const pending = () => { try { return appSaveCollect(DB).changes.length; } catch (_) { return 0; } };
  dirtyCount = () => Math.max(dc0(), window.LIVE ? pending() : 0);
  toast = (msg) => {
    const m = String(msg), tag = /\s*\(시제품: 노션에 쓰지 않음\)/;
    if (window.LIVE && tag.test(m)) {
      /* 서버에 쓰는 길은 창 [저장](그 창의 줄만)과 위 [저장](모두) 둘뿐 — 예전에는 이 알림이 뜰 때마다 모두 저장했다(자동 저장). 이제 창이 열려 있으면 그 줄만, 아니면 저장하지 않고 위 [저장]을 안내한다 */
      if (window._liveSaving) return toast0(m.replace(tag, ""));
      const sel = typeof activeTab !== "undefined" && activeTab && activeTab.state ? activeTab.state.sel : null;
      let hit = null;
      if (sel) for (const coll of APPS_ORDER) { const r = (DB[coll] || []).find((x) => x && x.id === sel); if (r) { hit = { coll, r }; break; } }
      if (hit && pending()) { setTimeout(() => liveSaveRow({ coll: hit.coll }, hit.r), 0); return; }
      return toast0(m.replace(tag, "") + (pending() ? " — 위 [저장]을 눌러 노션에 저장해요" : ""));
    }
    toast0(m);
  };
  /* [동기화] 버튼(261119 대표 "느려도 정확하게"): 우측 상단 [저장] 옆. render 뒤마다 붙이고, 마지막 동기화 시각은 서버 status의 syncedAt으로 */
  try { const render0 = render; render = function () { const o = render0.apply(this, arguments); try { liveSyncMount(); } catch (_) {} return o; }; } catch (_) {}
  setTimeout(() => { try { liveSyncStatus(); } catch (_) {} }, 3000);
  /* 메뉴 [N] 주소를 미리 받아 둔다(누를 때 새 탭이 팝업으로 막히지 않게) — 못 받아도 누를 때 다시 시도 */
  setTimeout(() => { try { liveMenuPages().catch(() => {}); } catch (_) {} }, 2500);
  /* 라이브러리(교재) 입력(261119 대표): [+] = 새 교재 등록 창(서버 textbook-api register-custom — 교재 + 단원목록을 노션에), 줄·표 편집은 저장의 update. 프로그램은 노션에서 */
  try {
    bookFindOpen = () => liveBookRegisterOpen();
    LISTS.books_b.add = LISTS.books.add = () => liveBookRegisterOpen();
    LISTS.books_b.addLabel = "교재 등록";
    LISTS.books_p.add = null; LISTS.books_p.blank = null; LISTS.books_p.noAddWhy = "프로그램은 노션 라이브러리에서 추가해요";
  } catch (_) {}
}
/* 새 교재 등록 창(실제 자료 모드): 교재명 · 출판사 · 시리즈 · 가격 · 전체 분량 · ISBN13 · 단원 목록(한 줄에 하나 "이름 쪽"). 과목 · 구분 등은 등록 뒤 줄 창에서.
   서버(textbook-api register-custom)가 거절하면 사람 말로 보여 주고 창은 열어 둔다(같은 ISBN13 = 409). 성공하면 저장 안 한 변경이 없을 때 노션 자료를 다시 받아 목록에 바로 나타낸다 */
async function liveBookApi(body) {
  const c = window.LIVE;
  if (!c) throw new Error("노션 자료를 받은 뒤에 등록해요");
  const res = await fetch(String(c.url).replace(/\/+$/, "") + "/functions/v1/textbook-api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || out.error) { const e = new Error((out && out.error) || "요청 실패 (" + res.status + ")"); e.status = res.status; throw e; }
  return out;
}
function liveBookRegisterOpen() {
  const F = { title: "", publisher: "", series: "", price: "", pages: "", isbn: "", units: "" };
  const opts = (k) => (DB.opts && Array.isArray(DB.opts[k]) ? DB.opts[k] : []).map((v) => ({ v, t: v }));
  modal(`<h2>교재 등록${HELP("노션 라이브러리에 교재 1권과 단원 목록을 만들어요. 과목 · 구분 등은 등록한 뒤 줄 창에서 넣어요. 같은 ISBN의 교재가 이미 있으면 등록되지 않아요. 출판사 · 시리즈는 노션 선택지에 있는 값만 고를 수 있어요.")}</h2>
    <div class="hfgrid nc"><div class="hfh" id="brT"></div><div class="hfh" id="brP"></div><div class="hfh" id="brS"></div><div class="hfh" id="brPr"></div><div class="hfh" id="brPg"></div><div class="hfh" id="brI"></div></div>
    <div class="hfh" id="brU"></div><div class="hint" id="brM"></div>
    <div class="actions"><span class="sp"></span><button class="btn" id="brC">취소</button><button class="btn pri" id="brO" disabled>교재 등록</button></div>`, (m, close) => {
    const ok = m.querySelector("#brO"), msg = m.querySelector("#brM");
    const upd = () => { ok.disabled = !F.title.trim(); };
    HF.text(m.querySelector("#brT"), { label: "교재명", placeholder: "예: 쎈 고등 수학(상)", max: 200, onChange: (v) => { F.title = v; upd(); } });
    HF.select(m.querySelector("#brP"), { label: "출판사", value: null, clear: true, placeholder: "고르기", items: opts("pub"), onChange: (v) => { F.publisher = v || ""; } });
    HF.select(m.querySelector("#brS"), { label: "시리즈", value: null, clear: true, placeholder: "고르기", items: opts("series"), onChange: (v) => { F.series = v || ""; } });
    HF.num(m.querySelector("#brPr"), { label: "가격", unit: "원", onChange: (v) => { F.price = String(v || "").replace(/[^\d]/g, ""); } });
    HF.num(m.querySelector("#brPg"), { label: "전체 분량", unit: "쪽", onChange: (v) => { F.pages = String(v || "").replace(/[^\d]/g, ""); } });
    HF.text(m.querySelector("#brI"), { label: "ISBN13", placeholder: "978으로 시작하는 13자리", max: 17, onChange: (v) => { F.isbn = v; } });
    HF.memo(m.querySelector("#brU"), { label: "단원 목록", placeholder: "한 줄에 하나씩 — 예) 1. 집합 8", rows: 5, onChange: (v) => { F.units = v; } });
    m.querySelector("#brC").onclick = close;
    ok.onclick = async () => {
      msg.textContent = ""; ok.disabled = true; ok.textContent = "등록 중…";
      try {
        const units = (typeof unitParse === "function" ? unitParse(F.units, F.pages) : []).map((u) => ({ name: u.name, page: u.from == null ? 0 : u.from }));
        const body = { action: "register-custom", title: F.title.trim(), units };
        if (F.isbn.trim()) body.isbn13 = F.isbn.trim();
        if (F.price) body.price = +F.price;
        if (F.pages) body.pages = +F.pages;
        if (F.series) body.series = F.series;
        if (F.publisher) body.publisher = F.publisher;
        await liveBookApi(body);
        close();
        if (dirtyCount() === 0 && typeof window.liveReload === "function") { await window.liveReload(); toast("교재를 등록했어요 — 과목 · 구분은 줄을 눌러 넣어요"); }
        else toast("교재를 등록했어요 — 저장하지 않은 변경이 있어서 목록은 저장하고 새로고침하면 보여요");
      } catch (e) {
        ok.textContent = "교재 등록"; upd();
        msg.className = "hint warn";
        msg.textContent = e.status === 409 ? "이미 라이브러리에 있는 교재예요(ISBN이 같아요)" : e.status === 401 || e.status === 403 ? "관리자 로그인이 필요해요 — 새로고침해서 다시 로그인해요" : e.message || "등록하지 못했어요";
      }
    };
    setTimeout(() => { const i = m.querySelector("#brT input"); if (i) i.focus(); }, 0);
  });
}
/* 창 [저장](대표 261119): 그 창의 줄만 서버에 저장한다(학생 창은 그 학생의 작성 중 등록까지). 삭제 예정 줄은 save op:"delete"로 — 성공한 줄만 화면에서 빠진다.
   저장 전 새 줄을 삭제한 경우는 노션에 없으므로 화면에서만 지운다. 서버 반영이 끝난 뒤 위 숫자와 창이 함께 맞춰진다(liveSaveRun) */
function liveSaveRow(L, r) {
  if (!r) return null;
  if (L.coll === "enrolls" && !r.del && (!r.studentId || !r.classId)) { toast("학생과 클래스를 골라야 등록을 저장할 수 있어요"); return null; }
  if (r.del && typeof appsIsId === "function" && !appsIsId(r.id)) {
    const a = DB[L.coll] || [], i = a.indexOf(r);
    if (i > -1) a.splice(i, 1);
    try { if (activeTab.state.sel === r.id) { activeTab.state.sel = null; } commit(); } catch (_) {}
    toast("삭제했어요 — 저장 전에 만든 줄이라 노션에는 없었어요");
    return null;
  }
  const only = (coll, row) => row === r || (L.coll === "students" && coll === "enrolls" && row.studentId === r.id);
  return liveSave({ only }).then((res) => { try { if (res && res.deleted && activeTab.state.sel === r.id && !(DB[L.coll] || []).includes(r)) { activeTab.state.sel = null; render(); } } catch (_) {} return res; });
}
/* ═════ [동기화](노션 → 서버 사본, 261119) — 서버 app-api { action:"run", name:"sync-copy", dbs, full:true }(노션에서 지운 줄까지 통째로 대조, 느려도 됨).
   현재 화면이 보여 주는 DB(3개 이하)만. 끝나면 목록을 다시 읽어 화면을 맞추고 "마지막 동기화 HH:MM"(서버 syncedAt)을 보인다.
   저장 안 한 변경이 있으면 막는다(동기화가 덮어쓰지 않게). 503 busy는 appPostJson이 한 번 다시 시도, 504 등은 사람 말로 ═════ */
const LIVE_SYNC_DBS = {
  students: ["학생(학원) DB", "등록(학원) DB"], enrolls: ["등록(학원) DB", "학생(학원) DB", "클래스(학원) DB"], classes: ["클래스(학원) DB", "강사(학원) DB", "시간표(학원) DB"],
  teachers: ["강사(학원) DB"], schools: ["학교(학원) DB", "학년(학원) DB"], subjects: ["과목(학원) DB", "영역(학원) DB"], books: ["라이브러리(학원) DB"],
  progress: ["진도관리(학원) DB", "라이브러리(학원) DB", "클래스(학원) DB"], timetable: ["시간표(학원) DB", "클래스(학원) DB", "등록(학원) DB"], events: ["일정(학원) DB", "시즌(학원) DB"],
  exams: ["시험정보(학원) DB", "시험(학원) DB", "성적(학원) DB"], tuition: ["수강료(학원) DB", "결제(학원) DB"], bill: ["청구서(학원) DB", "청구 항목(학원) DB", "청구 결제(학원) DB"],
  profit: ["결제(학원) DB", "기타경비(학원) DB"], reports: ["보고서(학원) DB", "알림톡 발송함(학원) DB"], completion: ["보고서(학원) DB", "알림톡 발송함(학원) DB"],
  letters: ["가정통신문(학원) DB", "알림톡 발송함(학원) DB"], files: ["자료(학원) DB"], alims: ["알림톡 설정(학원) DB", "알림톡 발송함(학원) DB"],
};
function liveSyncDbs() { const s = window.liveScr ? window.liveScr(activeTab) : (activeTab && activeTab.screen) || ""; return LIVE_SYNC_DBS[s] || ["시간표(학원) DB", "등록(학원) DB"]; }
function liveSyncTime(iso) { try { return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }); } catch (_) { return ""; } }
function liveSyncMount() {
  const sa = document.getElementById("saveAll");
  const on = !!(window.LIVE && window.LIVE.loaded);
  let b = document.getElementById("syncBtn"), t = document.getElementById("syncAt");
  if (!sa || !on) { if (b) b.remove(); if (t) t.remove(); return; }
  if (b && b.parentElement !== sa.parentElement) { b.remove(); if (t) t.remove(); b = t = null; }
  if (!b) {
    sa.insertAdjacentHTML("beforebegin", `<span class="sync-at" id="syncAt"></span><button type="button" class="btn tb-sync ${window._liveSyncing ? "busy" : ""}" id="syncBtn" ${window._liveSyncing ? "disabled" : ""} title="동기화 — 노션에서 바뀐 것 · 지운 줄까지 이 화면의 자료를 통째로 맞춰요(오래 걸릴 수 있어요). 저장과는 달라요: 노션 → 앱 방향이에요">${IC("rotc", "s")}<span>${window._liveSyncing ? "맞추는 중…" : "동기화"}</span></button>`);
    b = document.getElementById("syncBtn"); t = document.getElementById("syncAt"); b.onclick = liveSyncRun;
  }
  if (t) { const txt = window.LIVE_SYNCED_AT ? `마지막 동기화 ${liveSyncTime(window.LIVE_SYNCED_AT)}` : ""; if (t.textContent !== txt || !t.dataset.f) { t.textContent = txt; t.dataset.f = "1"; try { if (typeof fitBars === "function") fitBars(); } catch (_) {} } } /* 단추 · 시각이 붙은 뒤 위 줄이 맞는지 다시 잰다 */
}
/* 시스템 타이틀 = 노션 최상위 페이지 제목(서버 status.rootTitle). 사이드바 제목 · 탭 제목 앞부분에 쓰고, 없으면 지금 글자 그대로. */
function liveRootTitle(t) {
  t = String(t || "").trim(); if (!t) return;
  window.LIVE_ROOT_TITLE = t;
  document.title = "관리 앱 | " + t;
  document.querySelectorAll(".brand").forEach((b) => { b.textContent = t; b.title = "노션 첫 페이지 제목 · " + t; });
}
async function liveSyncStatus() {
  try { const res = await liveApi(window.LIVE, { action: "status" }); if (res && res.rootTitle) liveRootTitle(res.rootTitle); if (res && res.syncedAt) { window.LIVE_SYNCED_AT = res.syncedAt; liveSyncMount(); } } catch (_) {}
}
async function liveSyncRun() {
  if (!(window.LIVE && window.LIVE.loaded)) { toast("노션 자료를 받은 뒤에 동기화해요"); return; }
  if (window._liveSyncing || window._liveSaving) return;
  let dirty = 0; try { dirty = dirtyCount(); } catch (_) {}
  if (dirty > 0) { toast(`저장하지 않은 변경이 ${dirty}개 있어요 — 먼저 위 [저장]을 눌러요(동기화가 덮어쓰지 않게)`); return; }
  const dbs = liveSyncDbs();
  window._liveSyncing = true; liveSyncMount(); try { render(); } catch (_) {}
  toast("노션과 맞추는 중이에요 — 노션에서 지운 줄까지 대조해서 오래 걸릴 수 있어요");
  const c = window.LIVE;
  try {
    const { res, body } = await appPostJson(String(c.url).replace(/\/+$/, "") + "/functions/v1/app-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey },
      body: JSON.stringify({ action: "run", name: "sync-copy", dbs, full: true }),
    });
    if (res.status === 504 || res.status === 502) throw new Error("시간이 오래 걸려 연결이 끊겼어요 — 서버가 계속 맞추고 있을 수 있어요. 잠시 뒤 다시 눌러요");
    if (res.status === 503 || (body && body.busy)) throw new Error("노션이 바빠요 — 잠시 뒤 다시 눌러요");
    if (!res.ok || !body || !body.ok) throw new Error((body && body.error) || "동기화하지 못했어요 (" + res.status + ")");
    if (body.syncedAt) window.LIVE_SYNCED_AT = body.syncedAt;
    window._liveSyncing = false;
    if (typeof window.liveReload === "function") await window.liveReload(); /* 사본을 다시 읽어 화면을 서버 값으로 맞춘다 */
    const probs = Object.entries(body.problems || {}).map(([db, why]) => `${String(db).replace(/\(학원\) DB$/, "")}: ${why}`);
    const nf = (body.notFilled || []).length;
    toast(`동기화했어요 · 바뀐 ${body.changed || 0}줄${body.deleted ? ` · 노션에서 지운 ${body.deleted}줄` : ""}${nf ? ` — 아직 처음 채우는 중인 항목이 있어요(${(body.notFilled || []).map((x) => String(x).replace(/\(학원\) DB$/, "")).join(", ")})` : ""}${probs.length ? ` — 맞추지 못한 것: ${probs.join(" · ")}` : ""}`);
  } catch (e) { toast("동기화하지 못했어요 — " + e.message); }
  finally { window._liveSyncing = false; try { liveSyncMount(); const b = document.getElementById("syncBtn"); if (b) { b.classList.remove("busy"); b.disabled = false; const s = b.querySelector("span"); if (s) s.textContent = "동기화"; } } catch (_) {} }
}
/* 실제 자료 모드의 [수업 생성]: 시간표마다 다음 수업 한 번을 노션 수업 생성 큐에 맡긴다(app-api run — 시간표 [수업 추가]와 같은 처리).
   저장 전인 새 시간표는 노션에 아직 없으므로 먼저 저장하라고 알린다. 수업 · 출석은 1-2분 뒤 노션에 생긴다(앱 화면에는 그리지 않음). */
async function liveRunClasses(blockIds) {
  const isId = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v));
  const ids = (blockIds || []).filter(isId), unsaved = (blockIds || []).length - ids.length;
  if (!ids.length) { toast("먼저 [저장]으로 시간표를 노션에 보내요 — 저장 전인 시간표는 수업을 만들 수 없어요"); return null; }
  try {
    const res = await fetch(String(window.LIVE.url).replace(/\/+$/, "") + "/functions/v1/app-api", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": window.LIVE.session, Authorization: "Bearer " + window.LIVE.anonKey, apikey: window.LIVE.anonKey },
      body: JSON.stringify({ action: "run", name: "generate-classes", timetableIds: ids }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.ok) throw new Error((body && body.error) || "요청 실패 (" + res.status + ")");
    /* 맡긴 시간표는 30분 동안 [수업 생성] 대상에서 뺀다 — 서버가 만들고 사본에 오기 전에 한 번 더 눌러 뒤 주 수업이 또 생기지 않게(원본 검수 H6) */
    try { if (typeof liveGenMark === "function") liveGenMark(ids); render(); } catch (_) {}
    toast(`수업 생성을 맡겼어요 · 시간표 ${body.queued}개 — 1-2분 뒤 노션 수업에 생겨요${unsaved ? ` (저장 전 시간표 ${unsaved}개는 빠짐)` : ""}`);
    return body;
  } catch (e) { toast("수업 생성을 맡기지 못했어요 — " + e.message); return null; }
}
async function liveSave(opts) { /* opts.only(coll,row) = 이 줄만 저장(창 [저장]) · 없으면 모든 수정(우측 상단 [저장]) */
  opts = opts || {};
  if (!(window.LIVE && window.LIVE.loaded)) { toast("노션 자료를 다 받기 전에는 저장할 수 없어요"); return null; }
  if (window._liveSaving) return null;
  window._liveSaving = true;
  try {
    if (window.LIVE_OPTS_PENDING && window.LIVE_OPTS_PROMISE) { toast("노션 선택지를 불러온 뒤에 저장해요"); await window.LIVE_OPTS_PROMISE; } /* 선택지에 없는 값을 거르려면 선택지가 먼저 필요(저장 층이 읽음) */
    /* 수업 출결(작성 중인 수업)이 있으면 먼저 수업 관리 서버로 보낸다(출결 쓰기 칸이 켜져 있을 때) */
    let lessons = 0;
    if (!opts.only && (window.LIVE_ATTW || window.LIVE_RECW) && typeof liveLessonSave === "function") {
      /* 작성 중인 수업 = 수업 창 표시(LDIRTY) + 학습기록 쓰기 칸이면 작성 중 기록이 있는 수업(Z1) — 실제 수업(LIVE_LS)만 */
      const ks = new Set([...LDIRTY.keys()].filter((k) => !k.startsWith("mk:")));
      if (window.LIVE_RECW) (DB.recs || []).forEach((r) => { if (r.state === "draft" && !r.del && r.key && typeof LIVE_LS !== "undefined" && LIVE_LS[r.key]) ks.add(r.key); });
      if (window.LIVE_RECW && typeof liveRoutineDirtyKeys === "function") liveRoutineDirtyKeys().forEach((k) => ks.add(k)); /* 루틴 체크만 바뀐 수업 */
      for (const k of ks) { if (await liveLessonSave(k)) lessons++; }
    }
    /* 보강(칸 P3m): 만들기 · 배정 · 빼기 · 지우기를 서버 보강 동작으로 */
    if (!opts.only && window.LIVE_MKW && typeof liveMakeupSave === "function") lessons += await liveMakeupSave();
    let pend = 0; try { pend = appSaveCollect(DB, opts.only).changes.length; } catch (_) {}
    if (lessons && !pend) return { ok: 0, failed: [], lessons };
    return await liveSaveRun(opts);
  } finally { window._liveSaving = false; }
}
async function liveSaveRun(opts) {
  const say = (m) => toast(m);
  const esc2 = (s) => (typeof esc === "function" ? esc(s) : String(s));
  say("노션에 저장하는 중이에요");
  let res;
  /* 서버는 줄을 하나씩 순서대로 노션에 쓴다 — 느려도 되고, 앱은 몇 줄째인지 보여 준다 */
  try { res = await appSaveSend(window.LIVE, DB, { only: opts && opts.only, onProgress: (n, m) => { if (m > 10) say(`노션에 저장하는 중이에요 · ${n}/${m}줄`); } }); }
  catch (e) { say("저장하지 못했어요 — " + e.message); return null; }
  /* 새 줄은 노션 id로 바뀐다: 열려 있는 탭이 가리키던 옛 id도 바꾼다 */
  if (window.liveRoReset) window.liveRoReset(); /* 보기 화면에서 저장했을 때 저장 결과(새 id · 저장됨)를 되돌리지 않게 */
  const map = res.idMap || {};
  const fix = (st) => { if (!st) return; ["sel", "season"].forEach((k) => { if (map[st[k]]) st[k] = map[st[k]]; }); };
  try { (typeof tabs !== "undefined" ? tabs : []).forEach((t) => fix(t.state)); if (typeof activeTab !== "undefined" && activeTab) fix(activeTab.state); } catch (_) {}
  DB.blocks.forEach((b) => { delete b.t0; delete b.regs0; delete b.ending; delete b.addFrom; delete b.moveN; try { tSnap(b); } catch (_) {} });
  try { UNLOCKED.clear(); ORIG.clear(); } catch (_) {}
  if (!res.failed.length) { try { LDIRTY.clear(); } catch (_) {} }
  /* 저장 뒤 실행 취소로 옛 id가 되살아나지 않게 되돌리기 기록을 비운다 */
  try { undoStack.length = 0; if (typeof redoStack !== "undefined") redoStack.length = 0; lastSnap = snapshot(); } catch (_) {}
  try { if (window.liveSelBack) window.liveSelBack(); } catch (_) {}
  render(); try { savedSync(); } catch (_) {} try { if (window.liveStuMark) window.liveStuMark(); } catch (_) {} /* 저장된 학생의 되돌리기 기준을 새로 적는다 */
  const warn = (res.warn || []).length;
  /* 저장 버튼 규칙(대표 261119): 서버 반영이 끝난 뒤 숫자를 줄이고, 실패한 줄은 이유와 함께 숫자에 남긴다. 바뀐 것이 없으면 "저장할 변경이 없어요" */
  let left = 0; try { left = dirtyCount(); } catch (_) {}
  if (!res.failed.length && !warn) {
    if (!res.ok && !res.sent) { say("저장할 변경이 없어요"); return res; }
    say(`저장했어요 · ${res.ok}줄${res.deleted ? ` (삭제 ${res.deleted}줄 포함)` : ""}${opts && opts.only && left ? ` · 저장할 것 ${left}개 남음(위 [저장])` : ""}`); return res;
  }
  const li = (a) => a.map((f) => `<li><b>${esc2(f.name || f.coll || "")}</b> — ${esc2(f.conflict ? "그사이 노션에서 바뀌었어요. 새로 고친 뒤 다시 저장해요" : f.error || f.msg || f)}</li>`).join("");
  modal(`<h2>저장 결과</h2><div class="box"><p>노션에 저장 ${res.ok}줄${res.failed.length ? ` · 저장 안 됨 ${res.failed.length}줄(작성 중으로 남겼어요)` : ""}</p>${res.failed.length ? `<ul>${li(res.failed)}</ul>` : ""}${warn ? `<p class="hint">확인할 것 ${warn}건</p><ul>${li((res.warn || []).map((w) => (typeof w === "string" ? { error: w } : w)))}</ul>` : ""}</div><div class="actions"><span class="sp"></span><button class="btn pri" id="co">확인</button></div>`, (m, close) => { m.querySelector("#co").onclick = close; });
  return res;
}
