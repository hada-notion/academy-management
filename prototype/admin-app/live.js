/* 실제 자료 모드: 주소에 ?live=1 → 학원 연결 설정(hada_config.js) · 관리자 로그인(admin_auth.js) → app-api 읽기(appdata.js)로 예시 자료를 노션 자료로 바꿔 끼운다.
   연결 설정 파일은 저장소 맨 위(이 화면 기준 ../../)에 있다. 없으면(시제품 로컬 서버) 예시 자료 그대로 둔다. 저장 연결은 다음 단계. */
(function () {
  if (!/[?&]live=1(&|$)/.test(location.search)) return;
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
  const P2ON = gOn.has("P2"), RO = new Set([...GATES.P2, ...GATES.P3, ...GATES.P3b]); /* P3 수업은 걸음 1 = 보기만 */
  window.liveRO = (s) => RO.has(s);
  window.liveScr = (t) => (t && t.screen === "timetable" && t.state && t.state.view === "lesson" ? "lesson" : t ? t.screen : "");
  let roBase = null, roScreen = null, roBusy = false;
  window.liveRoReset = () => { roBase = null; };
  const roCss = document.createElement("style");
  roCss.textContent = ".live-ro #view [data-gdel]{display:none!important}.ro-note{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:#FFF6DA;color:#3A3226;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ro-note a{color:inherit;font-weight:600;text-decoration:underline}";
  document.head.appendChild(roCss);
  const roDress = () => {
    const q = (s) => document.querySelectorAll(s), why = "보기만 하는 화면이에요 — 노션에서 해요";
    q("#addRow,#tbEd,[data-act2]").forEach((b) => { b.disabled = true; b.title = why; });
    q(".panel input:not([type=checkbox]):not([type=radio]),.panel textarea").forEach((i) => { i.readOnly = true; });
    q(".panel select,.panel input[type=checkbox],.panel input[type=radio]").forEach((i) => { i.disabled = true; });
    q(".panel .tdnone").forEach((n) => { const t = n.lastChild; if (t && /여기서 고쳐요/.test(t.textContent)) t.textContent = "줄을 누르면 여기서 봐요 — 고칠 것은 노션에서 고쳐요"; });
    q(".panel button").forEach((b) => { if (/저장\s*$/.test(b.textContent) && !b.dataset.act2) { b.disabled = true; b.title = why; } }); /* 창 아래 [ㅇㅇ 저장] */
    const p = document.querySelector(".panel"), id = String((activeTab.state || {}).sel || "");
    if (p && /^[0-9a-f-]{32,36}$/i.test(id) && !p.querySelector(".ro-note")) {
      const n = document.createElement("div"); n.className = "ro-note";
      n.innerHTML = `<span>보기만 하는 화면이에요</span><a href="https://www.notion.so/${id.replace(/-/g, "")}" target="_blank" rel="noopener">노션에서 열기</a>`;
      const body = p.querySelector(".pbody"); body ? body.insertBefore(n, body.firstChild) : p.appendChild(n);
    }
  };
  const roLock = () => {
    const t = typeof activeTab !== "undefined" ? activeTab : null, scr = liveScr(t), on = !!(t && window.LIVE && window.LIVE.loaded && RO.has(scr));
    document.body.classList.toggle("live-ro", on);
    if (!on) { roBase = null; roScreen = null; return; }
    const now = snapshot();
    if (roBase === null || roScreen !== scr) { roBase = now; roScreen = scr; }
    else if (now !== roBase && !roBusy) {
      roBusy = true;
      try {
        Object.assign(DB, JSON.parse(roBase)); lastSnap = snapshot();
        try { LDIRTY.clear(); } catch (_) {} /* 수업 창에서 생긴 작성 중 표시도 지운다(수업 화면은 모두 보기만) */
        if (undoStack.length && undoStack[undoStack.length - 1] === roBase) undoStack.pop();
        r0(); say("이 화면은 보기만 해요 — 고칠 것은 노션에서 고쳐요");
      } finally { roBusy = false; }
      const after = snapshot(); if (after !== roBase) roBase = after; /* 그리면서 스스로 바뀌는 값은 받아들인다(되돌리기를 되풀이하지 않게) */
    }
    roDress();
  };
  const r0 = render;
  /* 수업 화면 = 시간표 화면의 [수업] 보기. 수업 칸(P3)이 꺼져 있으면 그 보기로 못 넘어가게 한다(단추도 숨김) */
  const lessonGate = () => {
    const t = typeof activeTab !== "undefined" ? activeTab : null;
    if (t && t.screen === "timetable" && t.state && t.state.view === "lesson" && !gateOn("lesson")) { t.state.view = "tt"; t.state.lsel = null; say("수업 화면은 아직 열지 않았어요 — 노션에서 봐요"); }
  };
  roCss.textContent += gateOn("lesson") ? "" : '#view [data-view="lesson"]{display:none!important}';
  render = function () { try { lessonGate(); } catch (_) {} const out = r0.apply(this, arguments); try { roLock(); } catch (_) {} try { if (typeof liveLessonNeed === "function") liveLessonNeed(); } catch (_) {} return out; };
  /* 되돌리기 · 다시 하기 · 모두 되돌리기는 입력 칸(P1)의 값을 움직이는 일이라 보기 화면에서도 막지 않는다 */
  ["undo", "redo", "revertAll"].forEach((k) => { try { const f0 = eval(k); eval(k + " = function () { roBase = null; return f0.apply(this, arguments); }"); } catch (_) {} });
  document.addEventListener("beforeinput", (e) => { if (document.body.classList.contains("live-ro") && e.target.closest && e.target.closest(".panel,#view table")) e.preventDefault(); }, true);
  const wipe = () => { try { if (typeof liveLessonReset === "function") liveLessonReset(); appApply({}, DB); if (typeof lastSnap !== "undefined" && typeof snapshot === "function") lastSnap = snapshot(); if (typeof undoStack !== "undefined") undoStack.length = 0; if (typeof render === "function") render(); } catch (_) {} };
  wipe();
  banner("노션 자료를 받는 중이에요 — 받기 전에는 저장할 수 없어요");
  const sd0 = saveDialog;
  saveDialog = (only) => { if (!(window.LIVE && window.LIVE.loaded)) { say("노션 자료를 다 받기 전에는 저장할 수 없어요"); return; } return sd0(only); };
  const stop = (msg) => { banner(msg + " — 저장할 수 없어요. 주소에서 ?live=1을 빼면 예시 자료로 열려요", true); };
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
        try { liveOptions(await liveApi({ url: cfg.url, anonKey: cfg.anonKey, session }, { action: "options" })); } catch (_) { /* 선택지를 못 받아도 화면은 열린다(저장 때 서버가 거름) */ }
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
      m.querySelector("#cc").onclick = () => { location.href = location.pathname; }; /* 예시 자료 = 실제 자료 모드를 벗어난 주소 */
      const submit = async () => {
        err.textContent = "";
        try { session = await HadaAdminAuth.login(cfg.url, pw.value); HadaAdminAuth.saveSession(session); close(); go(); }
        catch (e) { err.textContent = e.message; pw.select(); }
      };
      m.querySelector("#co").onclick = submit;
      pw.onkeydown = (e) => { if (e.key === "Enter") submit(); };
      setTimeout(() => pw.focus(), 0);
    });
    session ? go() : ask();
  }
  setTimeout(start, 0);
})();

/* 실제 자료 모드의 [저장]: 작성 중인 줄(입력 범위 12개 묶음)을 app-api save로 노션에 쓴다. 저장 창의 [저장]이 부른다(LIVE일 때만).
   성공한 줄은 저장됨으로, 실패 · 충돌 줄은 작성 중으로 남기고 이유를 보여 준다. 지우기는 보내지 않는다(노션에서 직접). */
async function liveApi(conn, body) {
  const res = await fetch(String(conn.url).replace(/\/+$/, "") + "/functions/v1/app-api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": conn.session, Authorization: "Bearer " + conn.anonKey, apikey: conn.anonKey },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
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
}
/* 실제 자료 모드에서 앱의 두 곳을 바꿔 끼운다(한 번만):
   - 저장 숫자(dirtyCount): 작성 중 표시가 아니라 "노션에 아직 안 간 줄 수"(새 줄 + 불러온 값과 달라진 줄)도 센다.
   - 알림(toast): 창 아래 [ㅇㅇ 저장]처럼 앱 안에서만 저장하던 곳("(시제품: 노션에 쓰지 않음)")은 그 말을 떼고 바로 노션 저장을 잇는다. */
function liveHooks() {
  if (window._liveHooked) return; window._liveHooked = true;
  const dc0 = dirtyCount, toast0 = toast, optAdd0 = optAdd;
  /* 노션 선택지로 바꾼 목록에는 앱에서 새 값을 만들지 않는다(노션에서 선택지를 먼저 만든다) */
  optAdd = (k, t) => {
    if (window.LIVE && window.LIVE_OPTS && window.LIVE_OPTS[k]) { toast0(`'${String(t || "").trim()}'은(는) 노션 [${window.LIVE_OPTS[k]}] 선택지에 없어요 — 노션에서 선택지를 먼저 만들어요`); return null; }
    return optAdd0(k, t);
  };
  const pending = () => { try { return appSaveCollect(DB).changes.length; } catch (_) { return 0; } };
  dirtyCount = () => Math.max(dc0(), window.LIVE ? pending() : 0);
  toast = (msg) => {
    const m = String(msg), tag = /\s*\(시제품: 노션에 쓰지 않음\)/;
    if (window.LIVE && tag.test(m)) {
      if (!window._liveSaving && pending()) { setTimeout(() => liveSave(), 0); return; }
      return toast0(m.replace(tag, ""));
    }
    toast0(m);
  };
}
/* 실제 자료 모드의 [수업 생성]: 시간표마다 다음 수업 한 번을 노션 수업 생성 큐에 맡긴다(app-api run — 시간표 [수업 추가]와 같은 처리).
   저장 전인 새 시간표는 노션에 아직 없으므로 먼저 저장하라고 알린다. 수업 · 출석은 1~2분 뒤 노션에 생긴다(앱 화면에는 그리지 않음). */
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
    toast(`수업 생성을 맡겼어요 · 시간표 ${body.queued}개 — 1~2분 뒤 노션 수업에 생겨요${unsaved ? ` (저장 전 시간표 ${unsaved}개는 빠짐)` : ""}`);
    return body;
  } catch (e) { toast("수업 생성을 맡기지 못했어요 — " + e.message); return null; }
}
async function liveSave() {
  if (!(window.LIVE && window.LIVE.loaded)) { toast("노션 자료를 다 받기 전에는 저장할 수 없어요"); return null; }
  if (window._liveSaving) return null;
  window._liveSaving = true;
  try { return await liveSaveRun(); } finally { window._liveSaving = false; }
}
async function liveSaveRun() {
  const say = (m) => toast(m);
  const esc2 = (s) => (typeof esc === "function" ? esc(s) : String(s));
  say("노션에 저장하는 중이에요");
  let res;
  try { res = await appSaveSend(window.LIVE, DB); }
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
  render(); try { savedSync(); } catch (_) {}
  const dels = (res.dels || []).length, warn = (res.warn || []).length;
  if (!res.failed.length && !dels && !warn) { say(`노션에 저장했어요 · ${res.ok}줄`); return res; }
  const li = (a) => a.map((f) => `<li><b>${esc2(f.name || f.coll || "")}</b> — ${esc2(f.conflict ? "그사이 노션에서 바뀌었어요. 새로 고친 뒤 다시 저장해요" : f.error || f.msg || f)}</li>`).join("");
  modal(`<h2>저장 결과</h2><div class="box"><p>노션에 저장 ${res.ok}줄${res.failed.length ? ` · 저장 안 됨 ${res.failed.length}줄(작성 중으로 남겼어요)` : ""}</p>${res.failed.length ? `<ul>${li(res.failed)}</ul>` : ""}${warn ? `<p class="hint">확인할 것 ${warn}건</p><ul>${li((res.warn || []).map((w) => (typeof w === "string" ? { error: w } : w)))}</ul>` : ""}${dels ? `<p class="hint">삭제 예정 ${dels}줄은 보내지 않았어요 — 노션에서 직접 지워요.</p>` : ""}</div><div class="actions"><span class="sp"></span><button class="btn pri" id="co">확인</button></div>`, (m, close) => { m.querySelector("#co").onclick = close; });
  return res;
}
