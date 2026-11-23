/* 실제 자료 모드의 관리자 설정(261123 관리자 설정 실제 연결): 시제품 카드(토스트만)를 서버에 붙인다.
   옛 관리자 설정 웹 화면과 같은 서버 동작을 같은 값으로 부른다(그 웹 화면은 261123에 없앰 — 모두 이 앱에서).
   - 로그인 상태 · 로그아웃 · 관리자 비밀번호 바꾸기: admin-security (profile · logout · change)
   - 예시 데이터 비우기: clear-example-data (state · status · start · stop) — 워크스페이스 이름을 그대로 넣어야 시작, 한 번 끝나면 서버가 잠근다
   - 서버 · 노션 연결, 노션 연동 구독 상태: admin-security status + app-api admin-status(_shared/notionSubscriptionStatus.ts, 서버 표에서 읽기만)
   - 웹훅 키 교체 · 교체 현황(옛 버튼 방식)은 옮기지 않는다 — 원본은 노션 연동 구독 방식. 옛 방식 학원은 구독으로 바꾼 뒤 이 판을 받는다(docs/updates/v2.8.0.md 운영 적용 순서).
   - 외부 키(나이스 · 국립중앙도서관 — 카카오는 v2.8.0 항목 113에서 뺌): admin-security (keys-status check · key-set · key-test · key-clear) — 넣은 키는 서버 Vault에만,
     화면을 열면 서버가 연결 상태를 바로 알려 줌(10분 안 결과는 다시 씀),
     화면에는 있음 · 바꾼 날 · 연결 확인 결과만(값은 되돌려 받지 않음). 함수는 Vault 먼저 · 없으면 Supabase Secrets(_shared/externalKeys.ts)
   - 첫 설치의 초기 비밀번호(0000)는 live.js 로그인 창이 바로 새 비밀번호를 정하게 한다(서버 scope "settings" 로그인 → change).
     그 창에서 비밀번호를 바꾸지 않고 [예시 데이터 비우기]도 할 수 있다(261123 대표 "0000 비밀번호로 진행 가능하도록 / 한번 진행하고 나면 막히도록"):
     0000 세션은 서버가 clear-example-data만 더 받는다(_shared/adminSecurity.ts authorizeInitialSetup) — 아래 window.liveInitialClear가 같은 비우기 창을 그 세션으로 연다.
   비밀번호 칸 값은 보낸 바로 뒤 지우고, 어디에도 적지 않는다(콘솔 · 저장소 · 주소). 실제 자료 모드가 아니면(LIVE 없음) 시제품 카드 그대로. */
(function () {
  const S = { at: 0, loading: false, server: null, profile: null, admin: null, clear: null, keys: null, err: {} };
  /* OVR = 0000 설치 길(로그인 전, LIVE 없음)에서 비우기 창을 열 때 쓰는 연결 { url, session, onClose } */
  let OVR = null;
  const root = () => String(OVR ? OVR.url : window.LIVE.url).replace(/\/+$/, "");
  const session = () => (OVR ? OVR.session : window.LIVE && window.LIVE.session) || "";
  /* 옛 관리자 설정 화면의 request()와 같은 부름(admin-security, x-admin-key = 관리자 세션) */
  async function sec(action, values = {}, timeout = 20000) {
    const res = await fetch(root() + "/functions/v1/admin-security", { method: "POST", headers: { "Content-Type": "application/json", ...(session() ? { "x-admin-key": session() } : {}) }, body: JSON.stringify({ action, ...values }), cache: "no-store", signal: AbortSignal.timeout(timeout) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "인증 서버 응답을 확인하지 못했어요"); e.status = res.status; throw e; }
    return data;
  }
  /* 옛 관리자 설정 화면의 clearRequest()와 같은 부름(clear-example-data) */
  async function clr(action, values = {}, timeout = 90000) {
    const res = await fetch(root() + "/functions/v1/clear-example-data", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": session() }, body: JSON.stringify({ action, ...values }), cache: "no-store", signal: AbortSignal.timeout(timeout) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || "예시 데이터 비우기 서버 응답을 확인하지 못했어요"); e.status = res.status; throw e; }
    return data;
  }
  const friendly = (e) => e && (e.name === "TimeoutError" || e.name === "AbortError") ? "서버 응답이 오래 걸려 기다림을 멈췄어요 — 잠시 뒤 다시 눌러요" : e instanceof TypeError ? "서버에 연결하지 못했어요 — 네트워크를 확인해요" : (e && e.message) || "처리하지 못했어요";
  const KST = { timeZone: "Asia/Seoul" };
  const dt = (iso) => iso ? new Intl.DateTimeFormat("ko-KR", { ...KST, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
  const day = (iso) => iso ? new Intl.DateTimeFormat("ko-KR", { ...KST, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(iso)) : "";
  const ago = (iso) => { if (!iso) return ""; const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`; };
  const tag = (cls, t) => `<span class="tag ${cls}">${esc(t)}</span>`;
  const btn = (act, label, icon, cls) => `<button type="button" class="btn sm ${cls || ""}" data-ladm="${act}">${icon ? IC(icon, "s") : ""}${label}</button>`;
  const loadingCell = '<span class="hint">확인하는 중…</span>';
  const errCell = (k) => `<span class="tag r">확인 못 함</span> <span class="hint">${esc(S.err[k])}</span>`;

  /* 상태 한 번에 받기: 서버(공개 status) · 로그인(profile) · 노션 연결과 구독(app-api admin-status) · 비우기(state). 하나가 실패해도 나머지는 보인다 */
  async function load() {
    if (S.loading) return; S.loading = true; S.err = {};
    const take = (k, p) => p.then((v) => { S[k] = v; }, (e) => { S[k] = null; S.err[k] = friendly(e); if (e && e.status === 401) S.err.auth = 1; });
    await Promise.all([
      take("server", sec("status")),
      take("profile", sec("profile")),
      take("admin", liveApi(window.LIVE, { action: "admin-status" })),
      take("clear", clr("state", {}, 20000)),
      take("keys", sec("keys-status", { check: true }, 30000).then((r) => r.keys, (e) => { throw e.status === 400 ? new Error("서버에 아직 이 기능이 없어요 — 업데이트를 적용하면 생겨요") : e; }).then((k) => { if (!k || typeof k !== "object") throw new Error("서버에 아직 이 기능이 없어요 — 업데이트를 적용하면 생겨요"); return k; })),
    ]);
    S.loading = false; S.at = Date.now();
    redraw();
  }
  const redraw = () => { try { if (typeof activeTab !== "undefined" && activeTab && activeTab.screen === "admin") render(); } catch (_) {} };

  /* 비우기 상태 한 줄(옛 관리자 설정 화면 clearSummary와 같은 말) → [글, 시작할 수 있나] */
  function clearLine(s) {
    const f = s && s.flag;
    if (f && f.state === "done") return [`${dt(f.finishedAt || s.updatedAt)}에 비웠어요(${(f.done || 0).toLocaleString()}건) — 이 기능은 잠겼어요`, false, "g"];
    if (f && f.state === "locked") return ["이미 쓰고 있는 학원이라 잠겨 있어요 — 실제 데이터를 지우지 않도록 막아 둔 거예요", false, ""];
    if (f && f.state === "running" && !s.canStart) return [`비우는 중이에요: ${f.done || 0} / ${f.total || 0}${f.totalCapped ? "+" : ""}건${f.current ? ` · ${f.current}` : ""}`, true, "b"];
    if (f && f.state === "stopped") return [`중단했어요(${f.done || 0}건 지움) — 다시 시작하면 남은 것만 지워요`, true, "w"];
    if (f && (f.state === "error" || f.state === "running")) return [`멈췄어요${f.error ? `: ${f.error}` : ""} — 다시 시작하면 남은 것만 지워요`, true, "r"];
    return ["아직 비우지 않았어요 — 설치를 시작할 때 한 번 비워요", true, ""];
  }
  /* 노션 연동 구독 상태 → [표 글, 색, 설명] */
  function subLine(sub) {
    if (!sub) return null;
    if (sub.state === "down") { const h = sub.health || {}; return ["끊김", "r", `${h.reason || "노션에서 고친 줄을 웹훅으로 받지 못했어요"}${h.since ? ` · ${dt(h.since)}부터` : ""} — 그동안 ${h.pollMin || 5}분마다 맞춰요. 노션 연동 설정 Webhooks에서 구독이 Active인지 확인해요(다음 변경을 받으면 저절로 돌아와요)${h.simulating ? " · 시험(꺼짐 흉내) 중" : ""}`]; }
    if (sub.state === "on") return ["켜짐", "g", `마지막으로 받은 변경 ${dt(sub.lastEventAt)}(${ago(sub.lastEventAt)}) · 최근 24시간 ${sub.events24h.toLocaleString()}건`];
    if (sub.state === "waiting") return ["확인 대기", "w", `노션이 ${dt(sub.tokenAt)}에 확인 요청을 보냈어요 — 노션 연동 설정에서 [Verify]를 마치면 켜져요`];
    if (sub.state === "off") return ["꺼짐", "", "노션 연동 설정에서 구독을 만들면 노션에서 고친 것이 바로 앱에 들어와요(없어도 15분마다 맞춰요)"];
    return ["준비 전", "", "이 서버에는 구독을 받을 표가 아직 없어요 — 업데이트를 적용하면 생겨요"];
  }
  function subRows(sub) {
    if (S.err.admin) return [["상태", '<span class="tag r">확인 못 함</span> <span class="hint">연결 카드의 노션 칸과 같은 이유예요</span>', btn("refresh", "다시 확인", "rotc")]];
    if (!S.admin) return [["상태", loadingCell, ""]];
    const l = subLine(sub);
    if (!l) return [["상태", '<span class="tag r">확인 못 함</span>', btn("refresh", "다시 확인", "rotc")]];
    const rows = [["상태", `${tag(l[1], l[0])} <span class="hint">${esc(l[2])}</span>`, ""]];
    if (sub.health && sub.health.pollMin) rows.push(["앱 사본 폴링", `${sub.health.pollMin}분마다 <span class="hint">${sub.health.pollMin === 5 ? "구독이 끊긴 동안 짧게 — 돌아오면 15분" : "구독이 받쳐 주는 동안 안전망"}${sub.health.lastReportAt ? ` · 마지막 대조 ${esc(dt(sub.health.lastReportAt))}` : ""}</span>`, ""]);
    if (sub.state === "on" || sub.state === "waiting" || sub.state === "down") rows.push(["반영 대기", sub.pending || sub.failed ? `${sub.pending ? `${sub.pending.toLocaleString()}건 처리 중` : ""}${sub.pending && sub.failed ? " · " : ""}${sub.failed ? `<span class="tag w">${sub.failed.toLocaleString()}건 다시 맞추는 중</span>` : ""}` : '<span class="hint">없음 — 받은 변경을 모두 앱에 넣었어요</span>', ""]);
    if (sub.rejectedAt) rows.push(["거절한 요청", `<span class="tag w">${esc(dt(sub.rejectedAt))}</span> <span class="hint">서명이 맞지 않아 받지 않았어요 — 구독을 다시 만들었다면 확인 토큰을 새로 넣어요</span>`, ""]);
    return rows;
  }

  /* 외부 키(261123 키 자동 등록): 키마다 한 줄 = 이름 · 지금 쓰는 키(앱에 저장 · 서버 설정값 · 없음) · 연결 확인 · 단추 */
  const KEYS = [
    ["NEIS_API_KEY", "나이스", "학교 검색 · 학사일정", "나이스 교육정보 개방 포털(open.neis.go.kr) > 인증키 신청", "https://open.neis.go.kr", "나이스 교육정보 개방 포털"],
    ["NL_CERT_KEY", "국립중앙도서관", "라이브러리 책 검색", "국립중앙도서관 ISBN 서지정보(nl.go.kr/seoji) > 인증키 신청", "https://www.nl.go.kr/NL/contents/N31101010000.do", "국립중앙도서관 Open API"],
  ];
  /* 연결 상태(대표 261123 "누르지 않아도 바로"): 서버가 화면을 열 때 확인한 결과 — 키 없음 · 연결됨 · 키가 틀림 · 확인 못 함 */
  const STATE = { ok: ["g", "연결됨"], wrong: ["r", "키가 틀림"], unknown: ["w", "확인 못 함"], none: ["w", "키 없음"] };
  const hm = (iso) => iso ? new Intl.DateTimeFormat("ko-KR", { ...KST, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";
  function keyRows() {
    if (S.err.keys) return [["외부 키", errCell("keys"), btn("refresh", "다시 확인", "rotc")]];
    if (!S.keys) return [["외부 키", loadingCell, ""]];
    return KEYS.map(([name, label, use, , url, site]) => {
      const k = S.keys[name] || {}, st = STATE[k.state];
      const from = k.source === "app" ? `앱에 넣은 키 · ${esc(day(k.changed_at))} 저장` : k.source === "secret" ? "서버 설정값(Supabase Secrets)" : "";
      const when = k.checked_at ? ` · ${esc(hm(k.checked_at))} 확인` : "";
      const why = k.state === "wrong" ? ` — 받은 키를 다시 붙여 넣어요${k.source === "app" && k.secret ? "(삭제하면 서버 설정값으로 돌아가요)" : ""}` : k.state === "unknown" ? " — 상대 서버가 답하지 않았어요. 잠시 뒤 [연결 확인]" : k.state === "none" ? ` — ${esc(josa(use, "이", "가"))} 동작하지 않아요` : "";
      const cell = `${st ? tag(st[0], st[1]) : '<span class="hint">확인 전</span>'} <span class="hint">${from || when ? from + when + why : why.replace(/^ — /, "")}</span>`;
      const acts = btn("kset:" + name, "키 저장", "save") + (k.source ? btn("ktest:" + name, "연결 확인", "rotc") : "") + (k.app ? btn("kdel:" + name, "삭제", "trash") : "") + keyLink(url, site);
      return [`${esc(label)}<br><span class="hint">${esc(use)}</span>`, cell, acts];
    });
  }
  const keyHelp = "학원이 받은 외부 키를 여기에 붙여 넣으면 서버가 바로 써요(Supabase Secrets에 넣지 않아도 돼요 — 넣어 둔 키도 그대로 써요). 넣은 키는 다시 보여 주지 않아요. 이 화면을 열면 서버가 연결을 확인해 바로 보여 줘요(10분 안에 확인했으면 그 결과). 여기서 삭제하면 Secrets에 넣은 키로 돌아가요.";
  /* 받는 곳 링크(대표 261123): 새 탭 · 노션 키 발급 매뉴얼의 NEIS_API_KEY · NL_CERT_KEY 페이지와 같은 주소. 모양 = DESIGN.md 카드 안 이동 링크 .link-chip */
  const keyLink = (url, site) => `<a class="link-chip" href="${esc(url)}" target="_blank" rel="noopener">${esc(site)} ↗</a>`;
  const keyLabel = (name) => (KEYS.find((x) => x[0] === name) || [])[1] || name;
  const testMsg = (t, name) => t === "ok" ? `${keyLabel(name)}에 연결됐어요` : t === "wrong" ? `${josa(keyLabel(name), "이", "가")} 키를 받지 않았어요(키가 틀림) — 받은 키를 다시 붙여 넣어요` : `${keyLabel(name)} 연결을 확인하지 못했어요 — 잠시 뒤 [연결 확인]을 눌러요`;
  function keyDialog(name) {
    const [, label, use, where, url, site] = KEYS.find((x) => x[0] === name);
    const k = (S.keys && S.keys[name]) || {};
    modal(`<h2>${esc(label)} 키 저장</h2><div class="box"><p class="hint">${esc(use)}에 써요. 받는 곳: ${esc(where)} ${keyLink(url, site)}</p><label class="lab" for="lakey">${esc(label)} 키(${esc(name)})</label><input class="inp" id="lakey" type="password" autocomplete="off" spellcheck="false" maxlength="256" placeholder="받은 키를 그대로 붙여 넣어요"><p class="hint">저장하면 다음 요청부터 이 키를 써요. 저장한 뒤 한 번 연결을 확인해요. 넣은 키는 다시 보여 주지 않아요.</p>${k.app ? '<div class="warnbox">이미 앱에 저장한 키가 있어요 — 새 키로 바뀌어요.</div>' : k.secret ? '<div class="warnbox">지금은 Supabase Secrets에 넣은 키를 써요 — 저장하면 이 키를 먼저 써요(Secrets 값은 그대로 남아요).</div>' : ""}<p class="err" id="laerr" hidden></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">키 저장</button></div>`, (m, close) => {
      const f = (id) => m.querySelector(id), inp = f("#lakey"), err = f("#laerr"), ok = f("#co");
      const wipe = () => { inp.value = ""; };
      const show = (t) => { err.textContent = t; err.hidden = !t; };
      f("#cc").onclick = () => { wipe(); close(); };
      const submit = async () => {
        show("");
        const value = inp.value;
        if (!value) return show("받은 키를 붙여 넣어요");
        if (value.trim() !== value || /\s/.test(value)) return show("앞뒤 공백 · 줄바꿈 없이 키만 붙여 넣어요");
        if (value.length < 8) return show("키가 너무 짧아요 — 받은 키 전체를 붙여 넣어요");
        ok.disabled = true; ok.classList.add("loading");
        try { const r = await sec("key-set", { name, value }, 30000); wipe(); close(); toast(`${label} 키를 저장했어요 — ${testMsg(r.test, name)}`); reloadKeys(); }
        catch (e) { show(friendly(e)); if (e.status === 401) { wipe(); close(); relogin("로그인이 풀렸어요 — 다시 로그인해요"); } }
        finally { ok.disabled = false; ok.classList.remove("loading"); }
      };
      ok.onclick = submit;
      inp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
      setTimeout(() => inp.focus(), 0);
    });
  }
  function keyDelete(name) {
    const label = keyLabel(name), k = (S.keys && S.keys[name]) || {};
    modal(`<h2>${esc(label)} 키 삭제</h2><div class="box">앱에 저장한 ${esc(label)} 키를 서버에서 삭제해요.${k.secret ? " 삭제하면 Supabase Secrets에 넣은 키로 돌아가요." : `<div class="warnbox">Supabase Secrets에도 키가 없어서, 삭제하면 ${esc((KEYS.find((x) => x[0] === name) || [])[2])}이 동작하지 않아요.</div>`}<p class="err" id="laerr" hidden></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn danger" id="co">키 삭제</button></div>`, (m, close) => {
      const ok = m.querySelector("#co"), err = m.querySelector("#laerr");
      m.querySelector("#cc").onclick = close;
      ok.onclick = async () => {
        ok.disabled = true; ok.classList.add("loading");
        try { const r = await sec("key-clear", { name }); close(); toast(r.secret ? `${label} 키를 삭제했어요 — Supabase Secrets에 넣은 키로 돌아갔어요` : `${label} 키를 삭제했어요`); reloadKeys(); }
        catch (e) { err.textContent = friendly(e); err.hidden = false; }
        finally { ok.disabled = false; ok.classList.remove("loading"); }
      };
    });
  }
  async function keyTest(name, button) {
    if (button) { button.disabled = true; button.classList.add("loading"); }
    try { const r = await sec("key-test", { name }, 30000); toast(r.test ? `${r.source === "secret" ? "서버 설정값 — " : ""}${testMsg(r.test, name)}` : `${keyLabel(name)} 키가 없어요`); reloadKeys(); }
    catch (e) { toast(friendly(e)); }
    finally { if (button) { button.disabled = false; button.classList.remove("loading"); } }
  }
  async function reloadKeys() { try { const k = (await sec("keys-status", { check: true }, 30000)).keys; if (!k || typeof k !== "object") throw new Error("서버에 아직 이 기능이 없어요 — 업데이트를 적용하면 생겨요"); S.keys = k; delete S.err.keys; } catch (e) { S.err.keys = friendly(e); } redraw(); }

  /* 화면: 시안 a · b · c(주소 &admv=a|b|c, 검수용) — 노션 연동 구독을 어디에 둘지. 기본 = b(따로 카드) */
  const VARIANT = () => ((/[?&]admv=([abc])(&|$)/.exec(location.search) || [])[1] || "b");
  window.liveAdminRender = function (v) {
    if (!S.at && !S.loading) setTimeout(load, 0);
    const p = S.profile, srv = S.server, ad = S.admin, sub = ad && ad.subscription;
    const loginRow = ["상태", S.err.auth ? '<span class="tag r">로그인 풀림</span> <span class="hint">다른 곳에서 비밀번호를 바꿨거나 12시간이 지났어요</span>' : `${tag("g", "로그인됨")} <span class="hint">이 탭을 닫거나 12시간이 지나면 풀려요</span>`, S.err.auth ? btn("relogin", "다시 로그인", "login") : btn("logout", "로그아웃")];
    const pwRow = ["관리자 비밀번호", p ? `마지막으로 바꾼 날 ${esc(day(p.changed_at))}${p.change_due ? ` ${tag("w", "바꿀 때가 됐어요")}` : ` <span class="hint">· 다음 권장 ${esc(day(p.recommended_at))}</span>`}` : S.err.profile ? errCell("profile") : loadingCell, p ? btn("pw", "바꾸기", "lock") : ""];
    const pwHelp = "키오스크 · 법정 서류 · 수업 관리 · 이 앱에서 같이 써요. 바꾸면 그 화면들의 로그인이 모두 풀리고 새 비밀번호로 다시 로그인해요(키오스크 기기 포함). 노션 버튼 · 자동화는 그대로예요.";
    const cl = S.clear ? clearLine(S.clear) : null;
    const clearRow = ["상태", cl ? `${cl[2] ? tag(cl[2], cl[1] ? "열림" : "잠김") + " " : ""}${esc(cl[0])}` : S.err.clear ? errCell("clear") : loadingCell, cl && cl[1] ? btn("clear", "비울 데이터 확인…", "", "danger") : ""];
    const srvRow = ["서버", srv ? tag("g", "연결됨") : S.err.server ? errCell("server") : loadingCell, ""];
    const notionRow = ["노션", ad ? (ad.notion && ad.notion.ok ? `${tag("g", "연결됨")} <span class="hint">${esc(ad.notion.rootTitle)}</span>` : '<span class="tag r">못 읽음</span> <span class="hint">서버가 노션 첫 페이지를 읽지 못했어요 — 연동 공유를 확인해요</span>') : S.err.admin ? errCell("admin") : loadingCell, ""];
    const syncRow = ["마지막 동기화", ad && ad.syncedAt ? `${esc(dt(ad.syncedAt))} <span class="hint">(${esc(ago(ad.syncedAt))})</span>` : ad ? '<span class="hint">아직 없어요</span>' : S.err.admin ? '<span class="hint">위 노션 칸과 같은 이유로 확인 못 함</span>' : loadingCell, btn("refresh", "다시 확인", "rotc")];
    const subHelp = "노션에서 고친 것을 서버가 바로 받는 구독이에요. 노션 연동 설정(Webhooks)에서 만들고 끄며, 여기서는 받고 있는지만 봐요.";
    const loginBox = { icon: "login", title: "로그인", rows: [loginRow] };
    const clearBox = { icon: "trash", title: "예시 데이터 비우기", help: "새 학원이 처음 설치할 때 한 번만 써요. 고른 DB의 예시 페이지를 노션 휴지통으로 보내고, 끝나면 잠겨요.", rows: [clearRow] };
    const keyBox = { icon: "shield", title: "외부 키", help: keyHelp, rows: keyRows() };
    const va = VARIANT();
    let boxes;
    if (va === "a") boxes = [loginBox, { icon: "lock", title: "보안", help: pwHelp, rows: [pwRow, ["노션 연동", sub ? (() => { const l = subLine(sub); return `${tag(l[1], l[0])} <span class="hint">${esc(l[2])}</span>`; })() : S.err.admin ? errCell("admin") : loadingCell, ""]] }, keyBox, clearBox, { icon: "activity", title: "연결", rows: [srvRow, notionRow, syncRow] }];
    else if (va === "c") boxes = [loginBox, { icon: "lock", title: "보안", help: pwHelp, rows: [pwRow] }, keyBox, clearBox, { icon: "activity", title: "연결", help: subHelp, rows: [srvRow, notionRow, ...subRows(sub).map((r, i) => [i ? r[0] : "연동 구독", r[1], r[2]]), syncRow] }];
    else boxes = [loginBox, { icon: "lock", title: "보안", help: pwHelp, rows: [pwRow] }, keyBox, { icon: "activity", title: "연결", rows: [srvRow, notionRow, syncRow] }, { icon: "link", title: "노션 연동 구독", help: subHelp, rows: subRows(sub) }, clearBox];
    cardScreen(v, { title: "관리자 설정", scr: "admin", help: "보안과 설치에 쓰는 화면이에요. 원장만 써요.", boxes });
  };

  /* 로그인이 풀린 뒤: 세션을 잊고 다시 불러온다(live.js가 로그인 창을 띄운다). 저장하지 않은 줄이 있으면 먼저 묻는다 */
  function relogin(msg) {
    const n = (() => { try { return dirtyCount(); } catch (_) { return 0; } })();
    const go = () => { try { HadaAdminAuth.saveSession(""); } catch (_) {} location.reload(); };
    if (!n) { toast(msg); setTimeout(go, 900); return; }
    modal(`<h2>다시 로그인해요</h2><div class="box">${esc(msg)}<div class="warnbox">노션에 아직 보내지 않은 줄이 ${n}개 있어요. 다시 로그인하면 그 줄은 사라져요.</div></div><div class="actions"><span class="sp"></span><button class="btn pri" id="lago">다시 로그인</button></div>`, (m) => { m.querySelector("#lago").onclick = go; });
  }

  /* 비밀번호 바꾸기 — 옛 관리자 설정 화면과 같은 change(현재 · 새 · 확인). 끝나면 모든 로그인이 풀린다 */
  function pwDialog() {
    modal(`<h2>관리자 비밀번호 바꾸기</h2><div class="box"><label class="lab" for="lapw0">현재 비밀번호</label><input class="inp" id="lapw0" type="password" autocomplete="current-password" maxlength="128"><label class="lab" for="lapw1">새 비밀번호</label><input class="inp" id="lapw1" type="password" autocomplete="new-password" minlength="8" maxlength="128"><p class="hint">앞뒤 공백 없이 8~128자. 초기 비밀번호 0000은 쓸 수 없어요.</p><label class="lab" for="lapw2">새 비밀번호 확인</label><input class="inp" id="lapw2" type="password" autocomplete="new-password" minlength="8" maxlength="128"><div class="warnbox">바꾸면 키오스크 · 법정 서류 · 수업 관리 · 이 앱의 로그인이 모두 풀리고 새 비밀번호로 다시 로그인해요. 노션 버튼 · 자동화는 그대로예요.</div><p class="err" id="laerr" hidden></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">비밀번호 바꾸기</button></div>`, (m, close) => {
      const f = (id) => m.querySelector(id), err = f("#laerr"), ok = f("#co");
      const wipe = () => m.querySelectorAll("input[type=password]").forEach((i) => { i.value = ""; });
      const show = (t) => { err.textContent = t; err.hidden = !t; };
      f("#cc").onclick = () => { wipe(); close(); };
      const submit = async () => {
        show("");
        const cur = f("#lapw0").value, nw = f("#lapw1").value, cf = f("#lapw2").value;
        if (!cur || !nw) return show("현재 비밀번호와 새 비밀번호를 넣어요");
        if (nw !== cf) return show("새 비밀번호와 확인 값이 달라요");
        ok.disabled = true; ok.classList.add("loading");
        try { await sec("change", { current_password: cur, new_password: nw }); wipe(); close(); relogin("비밀번호를 바꿨어요 — 모든 로그인이 풀렸어요. 새 비밀번호로 다시 로그인해요"); }
        catch (e) { show(friendly(e)); if (e.status === 401 && /세션|로그인/.test(e.message || "")) { wipe(); close(); relogin("로그인이 풀렸어요 — 다시 로그인해요"); } }
        finally { ok.disabled = false; ok.classList.remove("loading"); }
      };
      ok.onclick = submit;
      m.querySelectorAll("input").forEach((i) => { i.onkeydown = (e) => { if (e.key === "Enter") submit(); }; });
      setTimeout(() => f("#lapw0").focus(), 0);
    });
  }

  /* 예시 데이터 비우기 — 옛 관리자 설정 화면과 같은 순서: status(DB별 건수) → 고르기 → 워크스페이스 이름 그대로 → start → 5초마다 state.
     (261123 안A) 0000 세션이면 서버가 full:true — 고르기 칸을 모두 체크 · 잠그고(서버도 start에서 고른 값을 무시하고 전부 비움) 한 줄 안내 */
  let poll = null;
  const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
  const shortDb = (n) => String(n).replace("(학원) DB", "");
  async function clearDialog(button) {
    if (button) { button.disabled = true; button.classList.add("loading"); }
    toast("비울 데이터를 세는 중이에요 — DB마다 건수를 세느라 최대 1분");
    let s;
    try { s = await clr("status"); }
    catch (e) { toast(friendly(e)); return; }
    finally { if (button) { button.disabled = false; button.classList.remove("loading"); } }
    const groups = new Map();
    for (const d of s.dbs || []) { if (!groups.has(d.group)) groups.set(d.group, { required: d.required, dbs: [] }); groups.get(d.group).dbs.push(d); }
    const groupHtml = [...groups].map(([name, g]) => `<div class="la-grp ${g.required ? "req" : "opt"}"><div class="la-gh">${esc(name)} ${tag(g.required ? "r" : "b", g.required ? "필수" : "선택")}</div>${g.dbs.map((d) => `<label class="hk"><input type="checkbox" data-ladb="${esc(d.name)}" data-n="${d.count}" ${d.required ? 'data-req="1"' : ""} ${d.checked || s.full ? "checked" : ""}${s.full ? " disabled" : ""}><span>${esc(shortDb(d.name))}</span><span class="hint">${d.count}${d.capped ? "+" : ""}건</span></label>`).join("")}</div>`).join("");
    const keep = (s.keep || []).map(shortDb).join(" · ") || "없음";
    const ws = s.workspace || "";
    modal(`<h2>예시 데이터 비우기</h2><div class="box la-clear"><div class="warnbox"><b>되돌리기 어려워요.</b> 노션 휴지통으로 보내 30일 안에 되살릴 수는 있지만 한 건씩 되살려야 해요. 실제로 쓰기 시작한 뒤에는 누르지 않아요. 한 번 끝나면 이 기능은 잠겨요.</div><div id="lasel"><p class="hint" id="lasum"></p>${s.full ? '<p class="hint" id="lafull"><b>초기 비밀번호(0000)로는 고를 수 없어요</b> — 아래 DB를 모두 비우고, 남기는 DB는 그대로예요. 골라서 비우려면 새 비밀번호를 정한 뒤 [관리자 설정]에서 해요.</p>' : ""}<div class="la-grid">${groupHtml}</div><p class="hint">항상 남기는 DB: ${esc(keep)} · 체크를 푼 DB와 매뉴얼 페이지 · DB 템플릿도 그대로예요.</p>${(s.missing || []).length ? `<p class="hint">찾지 못한 DB(연동 공유 확인): ${esc(s.missing.join(", "))}</p>` : ""}${(s.unknown || []).length ? `<p class="hint">목록에 없어 건드리지 않는 DB ${s.unknown.length}개: ${esc(s.unknown.join(", "))}</p>` : ""}<label class="lab" for="laws">확인을 위해 워크스페이스 이름 <b>${esc(ws || "(이름 없음)")}</b>을 그대로 넣어요</label><input class="inp" id="laws" autocomplete="off" spellcheck="false" maxlength="200"><p class="hint">페이지가 많으면 10~25분 걸려요. 이 창을 닫아도 서버에서 계속 지워요.</p></div><div id="laprog" hidden><div class="la-bar"><span id="labar"></span></div><p class="hint" id="lacount"></p></div><p class="hint" id="ladone" hidden></p><p class="err" id="laerr" hidden></p></div><div class="actions"><span class="sp"></span><button class="btn" id="cc">닫기</button><button class="btn" id="lastop" hidden>중단</button><button class="btn danger pri2" id="co" disabled>예시 데이터 비우기</button></div>`, (m, close0) => {
      const f = (id) => m.querySelector(id), boxes = () => [...m.querySelectorAll("[data-ladb]")], ok = f("#co"), err = f("#laerr");
      const close = () => { stopPoll(); close0(); if (OVR) { const back = OVR.onClose; OVR = null; if (back) back(); } else load(); };
      f("#cc").onclick = close;
      const show = (t) => { err.textContent = t; err.hidden = !t; };
      const sum = () => { const on = boxes().filter((b) => b.checked); f("#lasum").textContent = `이 학원 워크스페이스: ${ws || "(이름 없음)"} · 고른 DB ${on.length}개 · 비울 페이지 ${on.reduce((t, b) => t + Number(b.dataset.n), 0)}건`; ok.disabled = !s.canStart || !on.length || f("#laws").value !== ws; };
      boxes().forEach((b) => { b.onchange = sum; }); f("#laws").oninput = sum; sum();
      const progress = (st) => {
        const fl = st.flag || {}, total = fl.total || 0, done = fl.done || 0;
        f("#lasel").hidden = true; ok.hidden = true; f("#laprog").hidden = false;
        f("#labar").style.width = fl.state === "done" ? "100%" : total ? `${Math.min(100, Math.round(done * 100 / total))}%` : "0%";
        f("#lacount").textContent = fl.state === "done" ? `완료 · ${(fl.done || 0).toLocaleString()}건 비움` : `${done} / ${total}${fl.totalCapped ? "+" : ""}건${fl.current ? ` · ${fl.current}` : ""}`;
        f("#lastop").hidden = fl.state !== "running";
      };
      const finish = (st) => { const [msg] = clearLine(st); stopPoll(); f("#lastop").hidden = true; const d = f("#ladone"); d.hidden = false; d.textContent = msg; };
      const tick = async () => {
        let st; try { st = await clr("state", {}, 20000); } catch (_) { return; }
        if (st.flag && st.flag.state === "running" && !st.canStart) { progress(st); return; }
        if (st.flag && st.flag.state === "done") progress(st);
        finish(st);
      };
      const watch = () => { stopPoll(); poll = setInterval(tick, 5000); };
      if (s.flag && s.flag.state === "running" && !s.canStart) { progress(s); watch(); }
      else if (!s.canStart) { f("#lasel").hidden = true; ok.hidden = true; if (s.flag && s.flag.state === "done") progress(s); finish(s); }
      f("#lastop").onclick = async () => { try { await clr("stop", {}, 20000); toast("중단을 요청했어요 — 지우던 묶음까지만 지우고 몇 초 안에 멈춰요"); } catch (e) { show(friendly(e)); } };
      ok.onclick = async () => {
        show("");
        const dbs = boxes().filter((b) => b.checked).map((b) => b.dataset.ladb);
        if (!dbs.length) return show("비울 DB를 하나 이상 골라요");
        const keptReq = boxes().filter((b) => !b.checked && b.dataset.req).map((b) => shortDb(b.dataset.ladb));
        if (!confirm(`고른 DB ${dbs.length}개의 페이지를 모두 휴지통으로 보내요. 체크를 푼 DB와 알림톡 설정 · 과목 · 메뉴 · 웹페이지 · 학년은 남아요.` + (keptReq.length ? `\n필수 DB를 남겨요(${keptReq.join(", ")}). 예시 학생 · 업무 기록이 실제 운영에 섞일 수 있어요.` : "") + "\n계속할까요?")) return;
        ok.disabled = true; ok.classList.add("loading");
        try { const fl = await clr("start", { workspace: f("#laws").value, dbs }); progress({ flag: fl }); toast("비우기를 시작했어요 — 이 창을 닫아도 서버에서 계속 지워요"); watch(); }
        catch (e) { show(friendly(e)); }
        finally { ok.classList.remove("loading"); }
      };
    });
  }

  /* 0000 설치 길(live.js liveFirstPassword): 초기 비밀번호 세션으로 비우기 상태를 읽고, 같은 비우기 창을 연다. 창을 닫으면 onClose(비밀번호 정하기 창으로 돌아감).
     state → [한 줄, 시작할 수 있나, 색] 또는 null(서버가 아직 이 길을 모름 · 연결 실패 — 그때는 비밀번호 정하기만 보인다) */
  window.liveInitialClear = {
    state: async (conn) => { const was = OVR; OVR = { url: conn.url, session: conn.session }; try { return clearLine(await clr("state", {}, 20000)); } catch (_) { return null; } finally { OVR = was; } },
    open: (conn, onClose) => { OVR = { url: conn.url, session: conn.session, onClose }; clearDialog(null).then(() => { if (OVR && !document.querySelector("#modalRoot .la-clear")) { const back = OVR.onClose; OVR = null; if (back) back(); } }); },
  };

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-ladm]");
    if (!b || !(window.LIVE && window.LIVE.loaded)) return;
    const a = b.dataset.ladm;
    if (a.startsWith("kset:")) return keyDialog(a.slice(5));
    if (a.startsWith("ktest:")) return keyTest(a.slice(6), b);
    if (a.startsWith("kdel:")) return keyDelete(a.slice(5));
    if (a === "refresh") { S.server = S.profile = S.admin = S.clear = S.keys = null; S.at = 0; render(); return load(); }
    if (a === "pw") return pwDialog();
    if (a === "clear") return clearDialog(b);
    if (a === "relogin") return relogin("다시 로그인해요");
    if (a === "logout") return (async () => { try { await sec("logout"); } catch (_) {} relogin("로그아웃했어요 — 다시 로그인하면 이어서 써요"); })();
  });
  /* 화면 전용 모양(app.css를 건드리지 않는다 — 기존 토큰만) */
  const css = document.createElement("style");
  css.textContent = ".la-clear .la-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2);margin:var(--space-2) 0;max-height:46vh;overflow:auto}.la-grp{border:1px solid var(--line);border-radius:var(--radius-md);padding:var(--space-1) var(--space-2)}.la-gh{font-weight:700;font-size:var(--text-label);display:flex;align-items:center;gap:var(--space-1);min-height:28px}.la-grp .hk{display:flex;align-items:center;gap:var(--space-2);min-height:32px;font-size:var(--text-label)}.la-grp .hk .hint{margin-left:auto}.la-bar{height:8px;background:var(--brand-soft);border-radius:999px;overflow:hidden;margin:var(--space-2) 0}.la-bar span{display:block;height:100%;width:0;background:var(--success-ink);transition:width .3s}.dlg .lab{display:block;margin:var(--space-2) 0 var(--space-1);font-size:var(--text-label);font-weight:600}.dlg .box .inp{width:100%;box-sizing:border-box}.lv-setup{border:1px solid var(--line);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);margin:var(--space-2) 0 var(--space-3)}.lv-setup-t{font-weight:700;font-size:var(--text-label);margin-bottom:var(--space-1)}.lv-setup .btn{margin-top:var(--space-2)}";
  document.head.appendChild(css);
})();
