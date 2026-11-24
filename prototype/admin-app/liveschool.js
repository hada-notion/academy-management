/* 실제 자료 모드의 학교(261123 대표 "학교 검색은 앱으로 옮기자" — 옛 학교 검색 웹 화면에만 있던 것을 옮김).
   서버 school-api · sync-school-calendar는 그대로 부른다(고치지 않음).
   - [학교 검색] 창: meta(노션 학교 페이지 · 학교 코드) → search(나이스, 지역은 주소로 좁힘)
       [학교 추가]      = 앱 저장 길(app-api save create, 학교(학원) DB 이름만) → link(그 페이지에 교육청 · 학교 코드 · 주소 · 홈페이지 · 학교 구분)
       [학교 코드 연결] = 이미 있는 학교(학교 코드 없음)에 link만 — 이름 · 학생 연결은 그대로
     끝나면 학교 DB 사본을 맞추고(app-api run sync-copy) 다시 받는다. 저장 안 한 변경이 있으면 그 줄만 화면에 넣는다.
   - [학사일정 가져오기]: 학교 코드가 있고 오늘 아직 안 가져온 학교마다 sync-school-calendar(start). 서버가 이어서 하므로 몇 분 뒤 [동기화]
   실제 자료 모드가 아니면 아무것도 바꾸지 않는다(시제품 예시 결과 그대로). */
const LSCH = { asked: new Set() };
const lsLive = () => !!(window.LIVE && window.LIVE.loaded);
const lsIsId = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v || ""));
const lsCid = (v) => String(v || "").replace(/-/g, "").toLowerCase();
const lsErr = (e) => (e && (e.status === 401 || e.status === 403) && !/학교 DB/.test(e.message || "") ? "관리자 로그인이 필요해요 — 새로고침해서 다시 로그인해요" : (e && e.message) || "서버에 연결하지 못했어요");
/* 나이스 이름 → 학교 DB 짧은 이름(이름 규칙 docs/이름-규칙.md: 운양중 · 운양고) */
function lsShort(n) {
  const s = String(n || "").trim();
  return s.replace(/여자중학교$/, "여중").replace(/여자고등학교$/, "여고").replace(/초등학교$/, "초").replace(/중학교$/, "중").replace(/고등학교$/, "고") || s;
}
async function lsCall(fn, body) {
  const c = window.LIVE;
  if (!c) throw new Error("노션 자료를 받은 뒤에 해요");
  const res = await fetch(String(c.url).replace(/\/+$/, "") + "/functions/v1/" + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || out.error) { const e = new Error((out && out.error) || "요청 실패 (" + res.status + ")"); e.status = res.status; throw e; }
  return out;
}
const liveSchoolApi = (body) => lsCall("school-api", body);
/* 학교 DB 사본을 맞춘 뒤 다시 받는다(서버가 노션에 직접 쓴 학교 코드는 노션 구독 알림이 오지 않아 사본에 바로 안 들어옴) */
async function lsAfter(row, okMsg) {
  const have = (DB.schools || []).find((x) => lsCid(x.id) === lsCid(row.id));
  if (have) Object.assign(have, row); else (DB.schools = DB.schools || []).unshift(row);
  try { if (typeof window.liveRoReset === "function") window.liveRoReset(); } catch (_) {}
  if (activeTab && activeTab.screen === "schools") { activeTab.state.sel = row.id; activeTab.state.ft = "all"; panelOpen = true; } /* 필터 탭이 새 줄을 가리지 않게 전체로 */
  render();
  let clean = false; try { clean = dirtyCount() === 0; } catch (_) {}
  if (!clean || typeof window.liveReload !== "function") { toast(okMsg + " — 저장하지 않은 변경이 있어서 노션 값은 저장 뒤 [동기화]로 맞춰요"); return; }
  const c = window.LIVE;
  try {
    await appPostJson(String(c.url).replace(/\/+$/, "") + "/functions/v1/app-api", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey }, body: JSON.stringify({ action: "run", name: "sync-copy", dbs: ["학교(학원) DB"], full: true }) });
  } catch (_) { /* 못 맞춰도 다시 받기는 한다 */ }
  try { await window.liveReload(); } catch (_) {}
  const again = (DB.schools || []).find((x) => lsCid(x.id) === lsCid(row.id));
  if (!again) (DB.schools = DB.schools || []).unshift(row); else if (!again.code) Object.assign(again, { code: true, kind: row.kind || again.kind, addr: row.addr || again.addr });
  try { if (typeof window.liveRoReset === "function") window.liveRoReset(); } catch (_) {}
  if (activeTab && activeTab.screen === "schools") { activeTab.state.sel = (again || row).id; activeTab.state.ft = "all"; panelOpen = true; }
  render();
  toast(okMsg);
}
/* [학교 검색] 창. target = 처음 고를 연결할 학교(학교 코드 없는 노션 학교 id) */
function liveSchoolFind(target) {
  const S = { pages: null, res: [], busy: "", msg: "", q: "", region: "" };
  const sel = activeTab && activeTab.screen === "schools" ? (activeTab.state || {}).sel : "";
  const self = (DB.schools || []).find((x) => !x.del && lsIsId(x.id) && !x.code && lsCid(x.id) === lsCid(target || sel));
  S.target = self ? self.id : "";
  S.q = self ? self.name : "";
  /* 노션 학교 DB의 템플릿 페이지(이름 = 학교 구분)는 연결할 학교로 고르지 않는다 */
  const codeless = () => (DB.schools || []).filter((x) => !x.del && lsIsId(x.id) && !x.code && !/^(유치원\/어린이집|초등학교|중학교|고등학교)$/.test(x.name || ""));
  modal(`<h2>학교 검색${HELP(HELPTX.schoolFind)}</h2>
    <div class="field"><label class="lab" for="nsT">연결할 학교</label><select class="inp" id="nsT"></select></div>
    <div class="bfq"><span class="searchbox">${IC("search")}<input class="inp" id="nsQ" placeholder="학교 이름 두 글자 이상" autocomplete="off" maxlength="80"></span><input class="inp nsr" id="nsR" placeholder="지역(선택) · 예: 김포" autocomplete="off" maxlength="80"><button class="btn" id="nsGo">검색</button></div>
    <div id="nsL"></div>
    <div class="actions"><span class="hint">학교 정보 출처: 나이스 교육정보 개방 포털</span><span class="sp"></span><button class="btn" id="nsC">닫기</button></div>`, (m, close) => {
    const q = m.querySelector("#nsQ"), rg = m.querySelector("#nsR"), T = m.querySelector("#nsT"), L = m.querySelector("#nsL");
    q.value = S.q;
    m.querySelector("#nsC").onclick = () => { if (!S.busy) close(); };
    const fillT = () => { T.innerHTML = `<option value="">새 학교로 추가</option>` + codeless().map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · 학교 코드 없음</option>`).join(""); T.value = S.target; };
    fillT();
    T.onchange = () => { S.target = T.value; const x = codeless().find((z) => z.id === S.target); if (x && !q.value.trim()) q.value = x.name; draw(); };
    const linkedBy = (s) => (S.pages || []).find((p) => p.code && p.code === s.code);
    const sameName = (s) => codeless().find((x) => x.name === lsShort(s.name) || x.name === s.name);
    const plan = (s) => {
      const on = linkedBy(s);
      if (on) return { off: true, label: "이미 있어요", note: `노션 학교 '${on.name}'에 연결돼 있어요` };
      if (S.target) { const x = codeless().find((z) => z.id === S.target); return { pageId: S.target, name: x ? x.name : "", label: "학교 코드 연결", note: x ? `'${x.name}'에 학교 코드를 붙여요` : "" }; }
      const x = sameName(s);
      if (x) return { pageId: x.id, name: x.name, label: "학교 코드 연결", note: `이름이 같은 '${x.name}'(학교 코드 없음)에 학교 코드를 붙여요` };
      const short = lsShort(s.name), taken = (DB.schools || []).some((z) => !z.del && z.name === short);
      return { create: taken ? s.name : short, label: "학교 추가", note: `노션 학교에 '${taken ? s.name : short}'(으)로 추가해요` };
    };
    function draw() {
      if (S.busy) { L.innerHTML = `<div class="hint">${esc(S.busy)}</div>`; return; }
      if (!S.res.length) { L.innerHTML = `<div class="hint">${esc(S.msg || "학교 이름을 적고 [검색]을 눌러요. 같은 이름이 여럿이면 지역을 적어 좁혀요")}</div>`; return; }
      L.innerHTML = `<div class="hint">${esc(S.msg)}</div><div class="bfl nsl">${S.res.map((s, i) => { const p = plan(s); return `<div class="nsrow"><span class="nst"><b>${esc(s.name)}</b><span class="hint">${esc([s.kind, s.address].filter(Boolean).join(" · "))}</span><span class="hint">${esc(p.note || "")}</span></span>${s.website ? `<a class="lnk" href="${esc(s.website)}" target="_blank" rel="noopener noreferrer">학교 홈페이지</a>` : ""}<button class="btn${p.off ? "" : " pri"}" data-ns="${i}" ${p.off ? "disabled" : ""}>${esc(p.label)}</button></div>`; }).join("")}</div>`;
      L.querySelectorAll("[data-ns]").forEach((b) => (b.onclick = () => pick(+b.dataset.ns)));
    }
    const go = async () => {
      const t = q.value.trim();
      S.res = []; S.msg = "";
      if (t.length < 2) { S.msg = "학교 이름을 두 글자 이상 적어요"; return draw(); }
      S.busy = "나이스에서 검색하는 중…"; draw();
      try {
        if (!S.pages) S.pages = (await liveSchoolApi({ action: "meta" })).schools || [];
        const r = await liveSchoolApi({ action: "search", query: t, region: rg.value.trim() });
        S.res = r.schools || [];
        S.msg = S.res.length ? `${S.res.length}곳을 찾았어요 — 지역 · 주소를 확인해요` : `'${t}'(으)로 찾은 학교가 없어요 — 이름이나 지역을 다시 확인해요`;
      } catch (e) { S.msg = lsErr(e); }
      S.busy = ""; draw();
    };
    const pick = async (i) => {
      const s = S.res[i], p = s && plan(s);
      if (!p || p.off || S.busy) return;
      let pageId = p.pageId, made = false;
      try {
        if (p.create) {
          S.busy = `'${p.create}' 학교를 노션에 추가하는 중…`; draw();
          const r = (await appSavePost(window.LIVE, [{ op: "create", db: "학교(학원) DB", tmp: "tmp:ns" + Date.now().toString(36), props: { "이름": p.create } }]))[0];
          if (!r || !r.ok || !r.id) throw new Error((r && r.error) || "학교 페이지를 만들지 못했어요");
          pageId = r.id; made = true;
        }
        S.busy = "학교 코드를 붙이는 중…"; draw();
        await liveSchoolApi({ action: "link", pageId, office: s.office, code: s.code });
        const nm = p.create || p.name;
        close();
        await lsAfter({ id: pageId, name: nm, kind: s.kind || "", addr: s.address || "", code: true, sync: "", state: "saved" }, made ? `${nm}을(를) 추가했어요 — 학교 코드가 붙어 [학사일정 가져오기]를 할 수 있어요` : `${nm}에 학교 코드를 붙였어요 — [학사일정 가져오기]를 할 수 있어요`);
      } catch (e) {
        S.busy = "";
        if (made) {
          /* 페이지는 생겼는데 코드를 못 붙임: 목록에는 넣고(코드 없음) 다시 연결할 수 있게 고른 학교로 둔다 */
          (DB.schools = DB.schools || []).unshift({ id: pageId, name: p.create, kind: "", addr: "", code: false, sync: "", state: "saved" });
          try { if (typeof window.liveRoReset === "function") window.liveRoReset(); } catch (_) {}
          S.target = pageId; fillT(); render();
          S.msg = `'${p.create}'은(는) 노션에 추가했지만 학교 코드는 못 붙였어요 — ${lsErr(e)}. 다시 [학교 코드 연결]을 눌러요`;
        } else S.msg = lsErr(e);
        draw();
      }
    };
    m.querySelector("#nsGo").onclick = go;
    [q, rg].forEach((x) => (x.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(); } }));
    draw();
    setTimeout(() => q.focus({ preventScroll: true }), 0);
  });
}
/* [학사일정 가져오기]: 노션 학교 버튼과 같은 서버 함수(sync-school-calendar start)를 고른 학교에 부른다(학교 창에서 한 곳씩) */
async function liveSchoolCal(list) {
  const ok = [], bad = [];
  for (const s of list) {
    try { await lsCall("sync-school-calendar", { action: "start", pageId: s.id }); ok.push(s); LSCH.asked.add(s.id); }
    /* 보안 설정(ADMIN_SECURITY_ENABLED)이 켜진 학원은 서버가 브라우저 로그인으로 이 함수를 받지 않는다(관리자 세션 허용 목록 밖) — 노션 버튼으로 안내 */
    catch (e) { bad.push(`${s.name}: ${e && (e.status === 401 || e.status === 403) ? "이 학원은 노션 학교 페이지의 [학사일정 가져오기] 버튼으로 해요" : lsErr(e)}`); }
  }
  render();
  if (ok.length) toast(`${ok.map((x) => x.name).join(" · ")} 학사일정 가져오기를 맡겼어요 — 몇 분 뒤 위 [동기화]를 누르면 일정에 보여요${bad.length ? ` · 못 맡긴 곳 ${bad.join(" · ")}` : ""}`);
  else toast(`학사일정 가져오기를 맡기지 못했어요 — ${bad.join(" · ")}`);
}
(function lsInstall() {
  try {
    const find0 = schoolFind;
    schoolFind = function () { return lsLive() ? liveSchoolFind() : find0.apply(this, arguments); };
    /* 학교 창 [학사일정 가져오기](hada-admin.html schCalRun) — 실제 자료면 그 학교 하나만 서버(sync-school-calendar start)에 맡긴다. 맡긴 학교는 이 창에서 다시 못 누름 */
    window.schCalAsked = (id) => lsLive() && LSCH.asked.has(id);
    const run0 = window.schCalRun;
    window.schCalRun = (id) => {
      if (!lsLive()) return run0(id);
      const s = (DB.schools || []).find((x) => x.id === id);
      if (!s || !lsIsId(s.id) || !s.code || LSCH.asked.has(s.id)) return;
      askRun("학사일정을 가져올까요?", `<b>${esc(s.name)}</b>의 학사일정을 나이스에서 가져와 노션 일정에 넣어요(이미 있는 일정은 건너뜀). 몇 분 걸려요 — 끝나면 [동기화]로 일정에 보여요.`, "가져오기", () => liveSchoolCal([s]));
    };
  } catch (_) {}
  /* 노션 학교 페이지의 [학교 검색] 링크: hada-admin.html?live=1&school=<페이지 id> — 노션 자료를 받은 뒤 학교 화면에서 그 학교를 고르고,
     학교 코드가 없으면 [학교 검색] 창을 그 학교를 연결할 학교로 연다. 주소에서 school=은 지운다(새로고침해도 다시 열리지 않게) */
  const want = (/[?&]school=([0-9a-fA-F-]{32,36})/.exec(location.search) || [])[1];
  if (!want) return;
  try { const u = new URL(location.href); u.searchParams.delete("school"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch (_) {}
  let tries = 0;
  const t = setInterval(() => {
    if (++tries > 240) { clearInterval(t); return; } /* 2분 안에 노션 자료를 못 받으면 그만 */
    if (!lsLive() || document.querySelector("#modalRoot .dlg")) return; /* 로그인 창 · 다른 창이 떠 있으면 기다림 */
    clearInterval(t);
    const row = (DB.schools || []).find((x) => !x.del && lsCid(x.id) === lsCid(want));
    try { openScreen("schools"); } catch (_) {}
    if (!row) { toast("노션 학교 페이지를 앱에서 찾지 못했어요 — 위 [동기화] 뒤 [학교 검색]을 눌러요"); return; }
    activeTab.state.sel = row.id; activeTab.state.ft = "all"; panelOpen = true; render();
    if (!row.code) liveSchoolFind(row.id);
  }, 500);
})();
