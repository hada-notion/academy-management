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
  /* 실제 자료 모드의 오늘 = 진짜 오늘(예시 자료의 고정 기준일을 쓰지 않는다 — 새 학생 문의일 · 등록일 기본값) */
  try { const n = new Date(), p = (v) => String(v).padStart(2, "0"); TODAY = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; if (window.HP) HP.today = TODAY; } catch (_) {}
  const banner = (msg, bad) => {
    let b = document.getElementById("liveBanner");
    if (!msg) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "liveBanner"; b.setAttribute("role", "status"); b.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;padding:8px 14px;border-radius:10px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.12);max-width:90vw"; document.body.appendChild(b); }
    b.style.background = bad ? "#FDECEC" : "#FFF6DA"; b.style.color = "#3A3226"; b.textContent = msg;
  };
  const wipe = () => { try { appApply({}, DB); if (typeof lastSnap !== "undefined" && typeof snapshot === "function") lastSnap = snapshot(); if (typeof undoStack !== "undefined") undoStack.length = 0; if (typeof render === "function") render(); } catch (_) {} };
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
        await appLoad({ url: cfg.url, anonKey: cfg.anonKey, session });
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
