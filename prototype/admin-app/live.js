/* 실제 자료 모드: 주소에 ?live=1 → 학원 연결 설정(hada_config.js) · 관리자 로그인(admin_auth.js) → app-api 읽기(appdata.js)로 예시 자료를 노션 자료로 바꿔 끼운다.
   연결 설정 파일은 저장소 맨 위(이 화면 기준 ../../)에 있다. 없으면(시제품 로컬 서버) 예시 자료 그대로 둔다. 저장 연결은 다음 단계. */
(function () {
  if (!/[?&]live=1(&|$)/.test(location.search)) return;
  const ROOT = "../../";
  const load = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  const say = (m) => (typeof toast === "function" ? toast(m) : console.log(m));
  async function start() {
    try { await load(ROOT + "hada_config.js"); await load(ROOT + "admin_auth.js"); }
    catch (_) { say("학원 연결 설정을 찾지 못했어요 — 예시 자료로 보여요"); return; }
    let cfg;
    try { cfg = HadaAdminAuth.config(); } catch (e) { say(e.message); return; }
    let session = HadaAdminAuth.savedSession();
    const go = async () => {
      document.body.classList.add("live-loading");
      say("노션 자료를 불러오는 중이에요");
      try {
        await appLoad({ url: cfg.url, anonKey: cfg.anonKey, session });
        window.LIVE = { url: cfg.url, at: new Date().toISOString() };
        if (typeof snapshot === "function") lastSnap = snapshot();
        if (typeof render === "function") render();
        say("노션 자료로 바꿨어요");
      } catch (e) {
        if (/\((401|403)/.test(e.message)) { HadaAdminAuth.saveSession(""); session = ""; ask(); }
        else say("노션 자료를 불러오지 못했어요 — " + e.message);
      } finally { document.body.classList.remove("live-loading"); }
    };
    const ask = () => modal(`<h2>관리자 로그인</h2><div class="box"><p class="hint">노션 자료를 읽으려면 관리자 비밀번호를 넣어요.</p><input id="lvpw" type="password" autocomplete="current-password" aria-label="관리자 비밀번호"><p class="hint" id="lverr"></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">예시 자료로 보기</button><button class="btn pri" id="co">로그인</button></div>`, (m, close) => {
      const pw = m.querySelector("#lvpw"), err = m.querySelector("#lverr");
      m.querySelector("#cc").onclick = close;
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
