/* 강사별 관리 앱 계정(강사계정 261123). 실제 자료 모드에서만 쓴다.
   - 강사 로그인: 아이디 = 노션 강사 DB 연락처(휴대폰 번호), 첫 비밀번호 = 같은 번호. 첫 로그인이면 바로 새 비밀번호 정하기(바꾸기 전엔 서버가 아무것도 열지 않음).
   - 강사가 보는 메뉴 = 서버(app-api "me")가 준 메뉴 이름(노션 메뉴(학원) DB 편집허용 · 댓글허용 ↔ 강사 DB 노션 계정)만. 댓글허용만인 메뉴는 보기만.
     재무 · 관리자 설정 · 바로가기는 늘 빠진다. 메뉴가 하나도 없으면 서버가 로그인을 거절한다(빈 화면 안내는 남은 세션용 대비). 화면을 숨기는 것은 보기 좋으라고 — 막는 것은 서버(_shared/teacherAccess.ts).
   - 원장: 직원 창 [앱 계정] 탭 — 켜기 · 끄기 · 상태(첫 로그인 전 · 사용 중 · 잠김 · 꺼짐) · 첫 비밀번호로 되돌리기.
   비밀번호 칸 값은 보낸 바로 뒤 지우고 어디에도 적지 않는다. 서버: admin-security teacher-* · teachers-status */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sec = async (url, body, key) => {
    const res = await fetch(String(url).replace(/\/+$/, "") + "/functions/v1/admin-security", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "x-admin-key": key } : {}) }, body: JSON.stringify(body), cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(out.error || "로그인 서버에 연결하지 못했어요"); e.status = res.status; throw e; }
    return out;
  };
  const phoneText = (d) => { const s = String(d || ""); return s.length === 11 ? `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}` : s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}` : s; };

  /* ---------- 강사 로그인 창 ---------- */
  /* done(session) = 로그인 끝(바꾼 뒤 새 비밀번호로 다시 받은 세션), back() = 원장 로그인 창으로 */
  window.liveTeacherAsk = function (cfg, done, back) {
    modal(`<h2>강사 로그인</h2><div class="box"><p class="hint">아이디는 노션 직원 정보의 휴대폰 번호예요. 처음에는 비밀번호도 같은 번호예요.</p>`
      + `<label class="lt-l" for="ltid">아이디(휴대폰 번호)</label><input id="ltid" type="tel" inputmode="numeric" autocomplete="username" placeholder="010-0000-0000">`
      + `<label class="lt-l" for="ltpw">비밀번호</label><input id="ltpw" type="password" autocomplete="current-password"><p class="hint lt-err" id="lterr" role="alert"></p></div>`
      + `<div class="actions"><button class="btn" id="ltback">원장 로그인</button><span class="sp"></span><button class="btn pri" id="co">로그인</button></div>`, (m, close) => {
      const id = m.querySelector("#ltid"), pw = m.querySelector("#ltpw"), err = m.querySelector("#lterr"), ok = m.querySelector("#co");
      m.onclick = null; /* 바깥을 눌러 닫히지 않게 — 로그인 전에는 앱 화면에 남지 않는다 */
      m.querySelector("#ltback").onclick = () => { pw.value = ""; close(); back(); };
      const submit = async () => {
        err.textContent = "";
        if (!id.value.trim() || !pw.value) { err.textContent = "아이디와 비밀번호를 넣어요"; return; }
        ok.disabled = true;
        try {
          const out = await sec(cfg.url, { action: "teacher-login", phone: id.value, password: pw.value });
          const first = pw.value, phone = id.value; pw.value = "";
          close();
          if (out.must_change) window.liveTeacherFirst(cfg, phone, first, out.session, done, back);
          else done(out.session);
        } catch (e) { err.textContent = e.message; pw.select(); } finally { ok.disabled = false; }
      };
      ok.onclick = submit;
      [id, pw].forEach((i) => { i.onkeydown = (e) => { if (e.key === "Enter") submit(); }; });
      setTimeout(() => id.focus(), 0);
    });
  };
  /* 첫 로그인: 새 비밀번호 정하기 → 바꾸기 → 새 비밀번호로 다시 로그인. 취소하면 그 세션은 로그아웃(첫 비밀번호 세션이 남지 않게) */
  window.liveTeacherFirst = function (cfg, phone, first, s1, done, back) {
    modal(`<h2>새 비밀번호 정하기</h2><div class="box"><p class="hint">처음 로그인했어요. 앞으로 쓸 비밀번호를 정해요(8자 이상, 휴대폰 번호와 다르게). 바꾸기 전에는 다른 화면을 쓸 수 없어요.</p>`
      + `<label class="lt-l" for="ltn1">새 비밀번호</label><input id="ltn1" type="password" autocomplete="new-password">`
      + `<label class="lt-l" for="ltn2">새 비밀번호 확인</label><input id="ltn2" type="password" autocomplete="new-password"><p class="hint lt-err" id="lterr" role="alert"></p></div>`
      + `<div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">비밀번호 저장</button></div>`, (m, close) => {
      const a = m.querySelector("#ltn1"), b = m.querySelector("#ltn2"), err = m.querySelector("#lterr"), ok = m.querySelector("#co");
      const wipe = () => { a.value = ""; b.value = ""; };
      m.onclick = null;
      m.querySelector("#cc").onclick = () => { wipe(); first = ""; close(); sec(cfg.url, { action: "teacher-logout" }, s1).catch(() => {}); back(); };
      const submit = async () => {
        err.textContent = "";
        if (!a.value) { err.textContent = "새 비밀번호를 넣어요"; return; }
        if (a.value !== b.value) { err.textContent = "새 비밀번호와 확인 값이 달라요"; return; }
        ok.disabled = true;
        try {
          await sec(cfg.url, { action: "teacher-change", current_password: first, new_password: a.value }, s1);
          const out = await sec(cfg.url, { action: "teacher-login", phone, password: a.value });
          wipe(); first = ""; close(); toast("새 비밀번호로 바꿨어요"); done(out.session);
        } catch (e) { err.textContent = e.message; } finally { ok.disabled = false; }
      };
      ok.onclick = submit;
      [a, b].forEach((i) => { i.onkeydown = (e) => { if (e.key === "Enter") submit(); }; });
      setTimeout(() => a.focus(), 0);
    });
  };

  /* 로그인한 강사가 비밀번호 바꾸기(대표 261123 "비밀번호 수정은 어디서"): 현재 · 새 · 확인 → teacher-change → 새 비밀번호로 다시 로그인(서버가 이 강사 세션을 모두 끊으므로).
     값은 보낸 바로 뒤 지운다. 잊었으면 원장이 [첫 비밀번호로 되돌리기] */
  window.liveTeacherChangePw = function () {
    const c = window.LIVE; if (!c) return;
    modal(`<h2>비밀번호 바꾸기</h2><div class="box"><p class="hint">8자 이상, 휴대폰 번호와 다르게 정해요. 바꾸면 다른 기기의 로그인은 풀려요.</p>`
      + `<label class="lt-l" for="ltc0">현재 비밀번호</label><input id="ltc0" type="password" autocomplete="current-password">`
      + `<label class="lt-l" for="ltc1">새 비밀번호</label><input id="ltc1" type="password" autocomplete="new-password">`
      + `<label class="lt-l" for="ltc2">새 비밀번호 확인</label><input id="ltc2" type="password" autocomplete="new-password"><p class="hint lt-err" id="lterr" role="alert"></p></div>`
      + `<div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">비밀번호 저장</button></div>`, (m, close) => {
      const a0 = m.querySelector("#ltc0"), a = m.querySelector("#ltc1"), b = m.querySelector("#ltc2"), err = m.querySelector("#lterr"), ok = m.querySelector("#co");
      const wipe = () => { a0.value = ""; a.value = ""; b.value = ""; };
      m.querySelector("#cc").onclick = () => { wipe(); close(); };
      const submit = async () => {
        err.textContent = "";
        if (!a0.value || !a.value) { err.textContent = "현재 비밀번호와 새 비밀번호를 넣어요"; return; }
        if (a.value !== b.value) { err.textContent = "새 비밀번호와 확인 값이 달라요"; return; }
        ok.disabled = true;
        try {
          const out = await sec(c.url, { action: "teacher-change", current_password: a0.value, new_password: a.value }, c.session);
          const again = out.phone ? await sec(c.url, { action: "teacher-login", phone: out.phone, password: a.value }).catch(() => null) : null;
          wipe(); close();
          try { HadaAdminAuth.saveSession(again && again.session ? again.session : ""); } catch (_) {}
          toast(again && again.session ? "비밀번호를 바꿨어요" : "비밀번호를 바꿨어요 — 새 비밀번호로 다시 로그인해요");
          setTimeout(() => location.reload(), 600);
        } catch (e) { err.textContent = e.message; } finally { ok.disabled = false; }
      };
      ok.onclick = submit;
      [a0, a, b].forEach((i) => { i.onkeydown = (e) => { if (e.key === "Enter") submit(); }; });
      setTimeout(() => a0.focus(), 0);
    });
  };

  /* ---------- 강사 화면: 메뉴 거름 ---------- */
  /* 화면 이름 → 노션 메뉴 이름(hada-admin.html NOTION 표와 같은 이름 · 메뉴가 아닌 하위 화면은 그 메뉴) */
  const SCREEN_MENU = () => (typeof NOTION !== "undefined" ? NOTION : {});
  const OWNER_SCREENS = new Set(["tuition", "bill", "bookfees", "charges", "etcs", "costs", "profit", "legal", "admin"]);
  window.liveTeacherAllowed = (scr, menus, forMenu) => {
    const s = String(scr || "");
    if (s === "ext:manual") return true;
    if (s.startsWith("ext:") || s.startsWith("web:") || OWNER_SCREENS.has(s)) return false;
    if (s === "timetable") return menus.includes("시간표") || (!forMenu && menus.includes("수업")); /* 수업 메뉴도 화면 id는 timetable(보기 lesson) — 쓰기는 서버가 메뉴마다 거름 */
    if (s === "lesson") return menus.includes("수업");
    const n = SCREEN_MENU()[s];
    return !!n && menus.includes(n);
  };
  /* me = app-api "me" 결과. 강사면 메뉴를 거르고 화면 열기를 막는다(한 번만) */
  window.liveRoleApply = function (me) {
    if (!me || me.role !== "teacher") { window.LIVE_TEACHER = null; return; }
    if (window.LIVE_TEACHER) { window.LIVE_TEACHER = me; return; }
    window.LIVE_TEACHER = me;
    const menus = Array.isArray(me.menus) ? me.menus : [];
    const ok = (s) => window.liveTeacherAllowed(s, menus);
    for (let i = MENU.length - 1; i >= 0; i--) { MENU[i][1] = MENU[i][1].filter((x) => window.liveTeacherAllowed(x[0], menus, true)); if (!MENU[i][1].length) MENU.splice(i, 1); }
    const gate0 = window.gateOn;
    window.gateOn = (s) => gate0(s) && (ok(s) || s === "ext:manual");
    /* 강사에게 없는 메뉴 화면을 열려고 하면(링크 · 바로가기) 기능 잠금 말("아직 열지 않았어요") 대신 메뉴 권한 말로 */
    try { const os = openScreen; openScreen = function (s) { if (!ok(s) && s !== "ext:manual") { toast("이 메뉴 권한이 없어요 — 원장에게 노션 메뉴관리 권한을 요청하세요"); return; } return os.apply(this, arguments); }; } catch (_) {}
    try {
      const firstOk = (() => { for (const g of MENU) for (const x of g[1]) if (!String(x[0]).includes(":")) return x[0]; return ""; })();
      const scrOf = (t) => (typeof window.liveScr === "function" ? window.liveScr(t) : t.screen);
      const fix = (t) => {
        if (!t || ok(scrOf(t)) || !firstOk) return;
        t.screen = firstOk === "lesson" ? "timetable" : firstOk; t.back = []; t.fwd = [];
        t.state = { season: "", mode: "edit", zoom: 2, filter: {}, sel: null, lf: {}, ...(firstOk === "lesson" ? { view: "lesson" } : {}) };
      };
      (typeof tabs !== "undefined" ? tabs : []).forEach(fix); if (typeof activeTab !== "undefined") fix(activeTab);
    } catch (_) {}
    /* (대표 261123 "댓글허용이면 보기만") 보이지만 편집허용이 없는 메뉴의 화면은 보기만 잠금(live.js liveRoAdd) — 저장 · 편집 · 단추가 꺼진다. 서버도 403 */
    const edits = Array.isArray(me.editMenus) ? me.editMenus : menus;
    if (typeof window.liveRoAdd === "function") {
      const scrs = new Set([...Object.keys(SCREEN_MENU()), "lesson", "timetable"]);
      scrs.forEach((x) => { if (ok(x) && !window.liveTeacherAllowed(x, edits)) window.liveRoAdd(x); });
    }
    document.body.classList.add("live-teacher");
    try { const rv0 = rvSync; rvSync = function () { const o = rv0.apply(this, arguments); try { lockBar(); } catch (_) {} return o; }; } catch (_) {}
  };
  /* 보기만(댓글허용) 메뉴 화면: 위 줄 [저장] · [동기화]를 흐리게(눌리지 않게) 하고 바뀐 줄 숫자는 숨긴다(담당 261123 — 서버도 403이지만 화면이 헷갈리지 않게).
     render 뒤(liveTeacherMount)와 숫자를 다시 쓰는 rvSync 뒤에 한 번씩 적용한다 */
  const VO_TITLE = "댓글 권한 메뉴라 보기만 해요 — 저장 · 동기화는 편집허용 메뉴에서";
  const viewOnlyNow = () => { try { const t = typeof activeTab !== "undefined" ? activeTab : null; const scr = typeof window.liveScr === "function" ? window.liveScr(t) : t && t.screen; return !!(window.LIVE_TEACHER && window.liveTeacherRo && window.liveTeacherRo.has(scr)); } catch (_) { return false; } };
  const lockBar = () => {
    const vo = viewOnlyNow();
    ["saveAll", "syncBtn"].forEach((id) => {
      const b = document.getElementById(id); if (!b) return;
      if (vo) { b.disabled = true; b.dataset.ltvo = "1"; b.title = VO_TITLE; }
      else if (b.dataset.ltvo) { delete b.dataset.ltvo; if (id === "syncBtn") b.disabled = !!window._liveSyncing; }
    });
    document.body.classList.toggle("lt-vo", vo);
  };
  window.liveTeacherLockBar = lockBar;
  /* 강사 화면 덧그리기: 메뉴가 하나도 없으면 빈 화면 안내, 위 줄에 "강사 · 이름 [로그아웃]" */
  window.liveTeacherMount = function () {
    const t = window.LIVE_TEACHER;
    let chip = document.getElementById("ltWho");
    if (!t) { if (chip) chip.remove(); return; }
    lockBar();
    /* 왼쪽 메뉴 맨 위(원장용 [시작하기] 자리): 누가 로그인했는지 + [로그아웃] */
    const side = document.getElementById("side");
    if (side && (!chip || chip.parentElement !== side || side.firstElementChild !== chip)) {
      if (chip) chip.remove();
      side.insertAdjacentHTML("afterbegin", `<div class="lt-who" id="ltWho"><span class="tag b">강사</span><b>${esc(t.name || "")}</b><span class="lt-acts"><button type="button" class="btn" id="ltPw">비밀번호 바꾸기</button><button type="button" class="btn" id="ltOut">로그아웃</button></span></div>`);
      chip = document.getElementById("ltWho");
      chip.querySelector("#ltPw").onclick = () => window.liveTeacherChangePw();
      chip.querySelector("#ltOut").onclick = async () => {
        const c = window.LIVE; try { if (c) await sec(c.url, { action: "teacher-logout" }, c.session); } catch (_) {}
        try { HadaAdminAuth.saveSession(""); } catch (_) {}
        location.reload();
      };
    }
    const menus = Array.isArray(t.menus) ? t.menus : [];
    const view = document.getElementById("view");
    if (view && !menus.length && !view.querySelector(".lt-empty")) {
      view.innerHTML = `<div class="lt-empty box"><h3>아직 열 수 있는 메뉴가 없어요</h3><p class="hint">원장에게 메뉴 권한을 요청하세요. 원장이 노션 메뉴관리에서 메뉴의 편집허용에 내 노션 계정을 넣으면, 다시 로그인했을 때 그 메뉴가 보여요.</p></div>`;
    }
  };

  /* ---------- 원장: 직원 창 [앱 계정] 탭 ---------- */
  const S = { list: null, at: 0, busy: false, err: "" };
  const id32 = (v) => String(v || "").replace(/-/g, "").toLowerCase();
  const owner = () => !!(window.LIVE && window.LIVE.loaded && !window.LIVE_TEACHER);
  async function refresh(force) {
    if (!owner() || S.busy || (!force && S.list && Date.now() - S.at < 30000)) return;
    S.busy = true;
    try { S.list = (await sec(window.LIVE.url, { action: "teachers-status" }, window.LIVE.session)).teachers || []; S.err = ""; S.at = Date.now(); }
    catch (e) { S.err = e.message; }
    finally { S.busy = false; try { render(); } catch (_) {} }
  }
  window.liveTeacherAccounts = { refresh, state: S };
  const stateOf = (row) => {
    const a = row && row.account;
    if (!a) return ["꺼짐", "", "앱 계정을 켜지 않았어요"];
    if (!a.enabled) return ["꺼짐", "", "앱 계정을 껐어요 — 로그인할 수 없어요"];
    if (a.locked) return ["잠김", "r", "비밀번호를 여러 번 틀려 15분 잠겼어요"];
    if (row.menu && !row.menu.menus) return ["메뉴 권한 없음", "r", "노션 메뉴관리 편집허용 · 댓글허용 어디에도 없어 로그인이 안 돼요"];
    if (a.must_change) return ["첫 로그인 전", "w", "첫 비밀번호(휴대폰 번호)로 로그인해 새 비밀번호를 정해야 해요"];
    return ["사용 중", "g", "강사가 정한 비밀번호로 쓰고 있어요"];
  };
  function acctBox(x) {
    if (!S.list && !S.err) { refresh(); return `<div class="box"><p class="hint">앱 계정 상태를 불러오는 중이에요</p></div>`; }
    if (S.err && !S.list) return `<div class="box"><p class="hint">앱 계정 상태를 불러오지 못했어요 — ${esc(S.err)}</p><button class="btn" data-ltact="reload">다시 불러오기</button></div>`;
    const row = (S.list || []).find((r) => r.teacher_id === id32(x.id));
    if (!row) return `<div class="box"><p class="hint">서버 자료에 이 강사가 아직 없어요 — 위 [동기화] 뒤 다시 봐요</p><button class="btn" data-ltact="reload">다시 불러오기</button></div>`;
    const [label, tone, desc] = stateOf(row), a = row.account, on = !!(a && a.enabled);
    const warn = !row.phone ? "노션 연락처에 휴대폰 번호가 없어요 — 번호를 넣어야 켤 수 있어요" : row.duplicate ? "같은 휴대폰 번호인 강사가 둘 이상이에요 — 노션 연락처를 먼저 고쳐요" : "";
    /* 메뉴 권한(노션 메뉴관리 편집허용 · 댓글허용): 하나도 없으면 켜도 로그인이 거절된다 */
    const m = row.menu, noMenu = !!(m && !m.menus);
    const menuTxt = !m ? "확인하지 못했어요(노션 계정을 읽지 못함)" : noMenu ? "메뉴 권한 없음 — 로그인 안 됨(노션 메뉴관리 편집허용 · 댓글허용에 이 강사를 넣어요)" : `${m.menus}개 메뉴(고치기 ${m.edit} · 보기만 ${m.menus - m.edit})`;
    const idNow = a && a.phone && a.phone !== row.phone ? `${phoneText(a.phone)} <span class="hint">(노션 번호가 바뀌었어요 — 되돌리기를 하면 새 번호로 맞춰요)</span>` : phoneText(row.phone || (a && a.phone)) || "—";
    return `<div class="box lt-acct"><h3>관리 앱 계정 <span class="tag ${tone}">${label}</span></h3><p class="hint">${desc}</p>`
      + `<dl class="lt-kv"><dt>아이디</dt><dd>${idNow}</dd><dt>첫 비밀번호</dt><dd>휴대폰 번호와 같아요(첫 로그인 때 바꿔요)</dd><dt>메뉴 권한</dt><dd${noMenu ? ' class="lt-bad"' : ""}>${esc(menuTxt)}</dd><dt>보이는 메뉴</dt><dd>노션 메뉴관리 편집허용 메뉴는 고치기, 댓글허용 메뉴는 보기만 — 재무 · 관리자 설정은 늘 원장만</dd></dl>`
      + (warn ? `<div class="warnbox">${warn}</div>` : "")
      + `<div class="lt-row">${on ? `<button class="btn" data-ltact="off" data-ltid="${esc(row.teacher_id)}">앱 계정 끄기</button>` : `<button class="btn pri" data-ltact="on" data-ltid="${esc(row.teacher_id)}" ${warn ? "disabled" : ""}>앱 계정 켜기</button>`}`
      + (a ? `<button class="btn" data-ltact="reset" data-ltid="${esc(row.teacher_id)}" ${warn ? "disabled" : ""}>첫 비밀번호로 되돌리기</button>` : "") + `</div>`
      + `<p class="hint">켜면 이 강사가 휴대폰 번호로 로그인할 수 있어요. 번호를 아는 사람이 먼저 로그인하지 않게, 강사에게 알려 줄 때 켜요. 퇴사하면 끄기.</p></div>`;
  }
  function install() {
    if (typeof LTABS === "undefined" || !LTABS.teachers || LTABS.teachers._lt) return;
    const t0 = LTABS.teachers;
    LTABS.teachers = function (x) {
      const tabs = t0(x);
      if (!owner()) return tabs;
      const row = (S.list || []).find((r) => r.teacher_id === id32(x.id));
      tabs.push(["acct", "앱 계정", row ? stateOf(row)[0] : "", acctBox(x)]);
      return tabs;
    };
    LTABS.teachers._lt = true;
  }
  const run = async (act, tid, name) => {
    try {
      await sec(window.LIVE.url, { action: act, teacher_id: tid }, window.LIVE.session);
      toast(act === "teacher-enable" ? `${name} 선생님 앱 계정을 켰어요` : act === "teacher-disable" ? `${name} 선생님 앱 계정을 껐어요` : `${name} 선생님 비밀번호를 첫 비밀번호(휴대폰 번호)로 되돌렸어요`);
    } catch (e) { toast(e.message); }
    await refresh(true);
  };
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-ltact]"); if (!b || b.disabled) return;
    ev.preventDefault();
    const act = b.dataset.ltact, tid = b.dataset.ltid || "";
    if (act === "reload") { refresh(true); return; }
    const row = (S.list || []).find((r) => r.teacher_id === tid), name = row ? row.name : "";
    if (act === "on") return askRun("앱 계정 켜기", `<p><b>${esc(name)}</b> 선생님이 휴대폰 번호(${esc(phoneText(row && row.phone))})로 로그인할 수 있게 돼요. 첫 비밀번호도 같은 번호라, 강사에게 알려 줄 때 켜요.</p>`, "켜기", () => run("teacher-enable", tid, name));
    if (act === "off") return askRun("앱 계정 끄기", `<p><b>${esc(name)}</b> 선생님의 로그인이 바로 끊기고 다시 로그인할 수 없어요. 다시 켜면 쓰던 비밀번호 그대로예요.</p>`, "끄기", () => run("teacher-disable", tid, name));
    if (act === "reset") return askRun("첫 비밀번호로 되돌리기", `<p><b>${esc(name)}</b> 선생님 비밀번호를 휴대폰 번호로 되돌려요. 로그인 중이면 끊기고, 다음 로그인 때 새 비밀번호를 다시 정해요. 잠김도 풀려요.</p>`, "되돌리기", () => run("teacher-reset", tid, name));
  }, true);
  install();
  const css = document.createElement("style");
  css.textContent = ".lt-l{display:block;margin:var(--space-2) 0 var(--space-1);font-size:var(--text-label);color:var(--muted)}.lt-err{color:var(--danger-ink);min-height:1.4em}"
    + ".lt-kv{display:grid;grid-template-columns:auto 1fr;gap:var(--space-1) var(--space-3);margin:var(--space-2) 0;font-size:var(--text-label)}.lt-kv dt{color:var(--muted)}.lt-kv dd{margin:0}"
    + ".lt-vo #saveAll .num{display:none}.lt-bad{color:var(--danger-ink);font-weight:600}.lt-row{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:var(--space-2) 0}.lt-who{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin:0 0 var(--space-3);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--surface);font-size:var(--text-label)}.lt-who .sp{flex:1}.lt-who .lt-acts{display:flex;gap:var(--space-2);width:100%}.lt-who .lt-acts .btn{flex:1}.live-teacher .side .tour{display:none}"
    + ".lt-empty{max-width:var(--form-max,560px);margin:var(--space-6,48px) auto}";
  document.head.appendChild(css);
})();
