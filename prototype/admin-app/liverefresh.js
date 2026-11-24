/* 열린 화면 자동 갱신 · 노션 요청 상태(261123, 과제 261123-앱자동갱신) — 실제 자료 모드에서만.
   신호: 서버 사본(app_rows · cr_*)이 바뀌면 DB가 Realtime 공개 채널 hada-app에 "바뀜"만 보낸다(DB 이름 · 줄 수 — 값 · 줄 id 없음, 마이그레이션 20261123050000).
   받기: 신호가 오면 0.6초 모아 app-api { action:"changes", since }로 그 뒤 바뀐 줄 · 지운 줄만 받는다(관리자 세션, 노션은 안 부름).
         신호 연결이 끊겨도 60초마다(연결돼 있으면 5분마다) 같은 것을 불러 따라잡고, 끊기면 2초 → 30초 간격으로 다시 붙는다.
   끼우기: 받은 줄을 불러온 원자료(window.APP_RAW)에 넣고 appApply(+ appViewApply)로 다시 계산 → 이전 계산과 달라진 줄만 화면 묶음(DB)에서 바꾼다.
         저장 안 한 줄(작성 중 · 지움 표시)은 덮지 않고 창 위에 "노션에서 바뀌었어요 [노션 값 불러오기]". 입력 칸에 커서가 있거나 대화상자 · 저장 · 동기화 중이면 끝날 때까지 미룬다.
   수업(cr_*): 수업 · 오늘 · 보강 화면이 열려 있고 수업에 작성 중이 없으면 받은 수업을 비우고 다시 받는다.
   요청: 노션 버튼 · 자동화가 쓰는 [요청] · [요청 결과] 칸(docs/notion-button-requests.md) — 창 위 한 줄, 표 줄 알약, 홈 입력 점검 "노션 요청 실패 · 오래 걸리는 요청".
   끄기: 주소에 refresh=0 (신호 · 따라잡기 · 끼우기 모두 끔. 요청 상태 표시는 그대로) */
const LR = { cur: null, crAt: null, loadAt: null, prev: null, ws: null, joined: false, ref: 0, joinRef: null, hb: null, rt: null, retry: 0,
  busy: false, again: false, lastPull: 0, pokeT: null, need: false, crNeed: false, crT: null, pending: new Map(), flash: new Map(), reqVer: 0, applied: 0 };
const LR_OFF = /[?&]refresh=0(&|$)/.test(location.search);
const LR_POLL_MS = 60000, LR_POLL_JOINED_MS = 300000, LR_POKE_MS = 600, LR_MIN_GAP_MS = 1000, LR_SLOW_MS = 5 * 60000, LR_OK_SHOW_MS = 10 * 60000;
const lrLive = () => !!(window.LIVE_MODE && window.LIVE && window.LIVE.loaded && window.APP_RAW);

/* ---------- 요청 칸 읽기 ---------- */
/* 요청 값: 동작 ID(서버가 아직 안 받음) = 대기 · 🔄 처리 중 · ✅ 완료 · ⚠️ 실패. 요청 결과 = 서버가 쓴 한 줄(이유 · 걸린 초) */
function lrReq(r) {
  const p = (r && r.props) || {}, v = String(p["요청"] == null ? "" : p["요청"]).trim();
  const msg = String(p["요청 결과"] == null ? "" : p["요청 결과"]).trim().replace(/^(🔄|✅|⚠️)?\s*(처리 중|완료|실패)\s*·?\s*/u, "").replace(/\s*·\s*\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?(?=\s*·|\s*$)/, "").replace(/\s*·?\s*(\d{1,2}\/\d{1,2}\s+)?\d{1,2}:\d{2}(:\d{2})?\s*$/, ""); /* 앞머리 상태는 알약이 보이고, 글 끝 시각은 lrReqHtml이 한 번만 붙임 */
  if (!v) return null;
  const age = Date.now() - (Date.parse(r.notion_edited_at || "") || Date.now());
  if (/^🔄|처리 중/.test(v)) return { k: age > LR_SLOW_MS ? "slow" : "run", label: age > LR_SLOW_MS ? "오래 걸려요" : "처리 중", msg, age };
  if (/^✅|완료/.test(v)) return { k: "ok", label: "완료", msg, age };
  if (/^⚠️|실패/.test(v)) return { k: "fail", label: "실패", msg: msg || "이유가 적혀 있지 않아요", age };
  /* 대기(요청 = 동작 ID): 요청 결과 칸에는 앞 요청의 글이 남아 있으므로 쓰지 않는다(261123 막힌단추 사용성 — "대기 · 교재 생성 1.6초"처럼 보였음) */
  return { k: age > LR_SLOW_MS ? "slow" : "wait", label: age > LR_SLOW_MS ? "오래 걸려요" : "대기", msg: (window.LQ_ACT_NAME && window.LQ_ACT_NAME[v] ? window.LQ_ACT_NAME[v] + " — " : "") + "서버가 받기를 기다려요", age, action: v };
}
function lrRawRow(id) {
  const R = window.APP_RAW; if (!R || !id) return null;
  for (const db in R.raw) { const r = R.raw[db] && R.raw[db].get(String(id)); if (r) return { db, r }; }
  return null;
}
const LR_TITLE_KEYS = ["이름", "학생이름", "클래스명", "교재명", "제목", "보고서 제목", "청구서 이름", "항목", "이름(자동)"];
function lrTitle(r) {
  const p = (r && r.props) || {};
  for (const k of LR_TITLE_KEYS) if (typeof p[k] === "string" && p[k].trim()) return p[k].trim();
  return "이름 없는 줄";
}
const lrDbShort = (db) => String(db || "").replace(/\(학원\)\s*DB$/, "").trim();
/* 홈 입력 점검에 모을 것: 실패 전부 + 5분 넘게 대기 · 처리 중 */
function lrReqList() {
  const out = { fail: [], slow: [] }, R = window.APP_RAW; if (!R) return out;
  for (const db in R.raw) for (const r of R.raw[db].values()) {
    const q = lrReq(r); if (!q) continue;
    if (q.k === "fail") out.fail.push({ db, r, q }); else if (q.k === "slow") out.slow.push({ db, r, q });
  }
  return out;
}

/* ---------- 다시 계산 · 끼우기 ---------- */
function lrCompute() {
  const R = window.APP_RAW, out = {};
  appApply(R.raw, out);
  if (R.view && typeof appViewApply === "function") appViewApply(R.raw, out);
  return out;
}
function lrIndex(out) {
  const m = new Map();
  for (const [coll, list] of Object.entries(out)) {
    if (coll.startsWith("_") || !Array.isArray(list)) continue;
    const ids = new Map(); list.forEach((x) => { if (x && x.id != null) ids.set(String(x.id), JSON.stringify(x)); }); m.set(coll, ids);
  }
  return m;
}
const lrDirty = (coll, x) => !!(x && (x.state === "draft" || x.dirty || x.del || (typeof appsDirty === "function" && appsDirty(coll, x))));
/* 받은 줄을 원자료에 넣는다. 값이 그대로면 건너뜀(겹쳐 읽기 · 같은 값 다시 쓰기). 바뀐 줄 수 */
function lrApplyRaw(rows, gone) {
  const raw = window.APP_RAW.raw; let n = 0;
  const has = new Set((rows || []).map((r) => String(r.id)));
  (gone || []).forEach((g) => { const m = raw[g.db]; if (m && m.has(String(g.id)) && !has.has(String(g.id))) { m.delete(String(g.id)); n++; } });
  (rows || []).forEach((r) => {
    const m = raw[r.db]; if (!m) return;
    const o = m.get(String(r.id));
    if (o && o.notion_edited_at === r.notion_edited_at && (o.url || "") === (r.url || "") && (o.icon || "") === (r.icon || "") && JSON.stringify(o.props || {}) === JSON.stringify(r.props || {})) return;
    const { db, ...row } = r; m.set(String(r.id), row); n++;
  });
  return n;
}
/* 지금 끼워도 되나: 입력 칸에 커서 · 대화상자 · 저장 · 동기화 · 자료 받는 중이면 다음 차례로 */
function lrSafe() {
  if (window._liveSaving || window._liveSyncing || window._liveLessonSaving || document.body.classList.contains("live-loading")) return false;
  const mr = document.getElementById("modalRoot"); if (mr && mr.children.length) return false;
  const a = document.activeElement;
  if (a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return false;
  return true;
}
function lrMerge() {
  const fresh = lrCompute(), idx = lrIndex(fresh), prev = LR.prev || new Map(), ids = [];
  let changed = 0, held = 0;
  for (const [coll, list] of Object.entries(fresh)) {
    if (coll.startsWith("_") || !Array.isArray(list) || !Array.isArray(DB[coll])) { DB[coll] = list; continue; }
    const P = prev.get(coll) || new Map(), N = idx.get(coll) || new Map(), byId = new Map(list.map((x) => [String(x.id), x])), cur = DB[coll];
    for (let i = cur.length - 1; i >= 0; i--) {
      const x = cur[i]; if (!x || x.id == null) continue;
      const id = String(x.id); if (!P.has(id)) continue; /* 앱에서 새로 만든 줄 · 앱이 덧붙인 줄은 그대로 */
      if (N.get(id) === P.get(id)) continue; /* 서버 값이 그대로 */
      if (lrDirty(coll, x)) { LR.pending.set(id, { coll, fresh: byId.get(id) || null }); held++; continue; }
      if (N.has(id)) cur[i] = byId.get(id); else cur.splice(i, 1);
      changed++; ids.push(id);
    }
    for (const [id, f] of byId) if (!P.has(id) && !cur.some((x) => x && String(x.id) === id)) { cur.push(f); changed++; ids.push(id); }
  }
  LR.prev = idx;
  return { changed, held, ids };
}
/* 바꾼 줄을 "저장된 값"으로 적는다 — 작성 중 표시 · 되돌리기 기록이 생기지 않게 */
function lrMarkSaved(ids) {
  try { appSaveMark(DB); } catch (_) {}
  try { liveStuMark(); } catch (_) {}
  try { savedSync(); } catch (_) {}
  try { const s = new Set(ids); (DB.blocks || []).forEach((b) => { if (s.has(String(b.id))) tSnap(b); }); } catch (_) {}
  try { if (typeof window.liveRoReset === "function") window.liveRoReset(); } catch (_) {}
  try { lastSnap = snapshot(); } catch (_) {}
}
function lrFlush() {
  if (!LR.need || !lrLive()) return;
  if (!lrSafe()) return; /* 1초 뒤 다시(lrTick) */
  LR.need = false;
  const { changed, held, ids } = lrMerge();
  const now = Date.now(); ids.forEach((id) => LR.flash.set(id, now));
  lrMarkSaved(ids);
  LR.applied += changed;
  try { render(); } catch (_) {}
  if (changed) toast(`노션에서 바뀐 ${changed}줄을 화면에 반영했어요${held ? ` · 작성 중인 ${held}줄은 그대로 뒀어요` : ""}`);
  else if (held) toast(`작성 중인 ${held}줄이 노션에서 바뀌었어요 — 창 위에서 노션 값을 불러올 수 있어요`);
}
/* 작성 중인 줄을 노션 값으로(창 [노션 값 불러오기]) */
function lrTakeNotion(id) {
  const p = LR.pending.get(String(id)); if (!p) return;
  const cur = DB[p.coll] || [], i = cur.findIndex((x) => x && String(x.id) === String(id));
  if (i >= 0) { if (p.fresh) cur[i] = p.fresh; else cur.splice(i, 1); }
  LR.pending.delete(String(id));
  try { if (typeof LDIRTY !== "undefined") LDIRTY.delete(String(id)); } catch (_) {}
  lrMarkSaved([String(id)]);
  try { render(); } catch (_) {}
  toast(p.fresh ? "노션 값으로 바꿨어요" : "노션에서 지운 줄이라 화면에서 뺐어요");
}
/* 작성 중이던 줄이 더는 작성 중이 아니면: 저장했으면(노션 수정 시각이 같거나 뒤) 표시만 지우고, 되돌렸으면 노션 값으로 */
function lrPendingTidy() {
  for (const [id, p] of [...LR.pending]) {
    const x = (DB[p.coll] || []).find((r) => r && String(r.id) === id);
    if (x && lrDirty(p.coll, x)) continue;
    LR.pending.delete(id);
    if (x && p.fresh && String(x._edited || "") < String(p.fresh._edited || "")) { const cur = DB[p.coll]; cur[cur.indexOf(x)] = p.fresh; lrMarkSaved([id]); }
  }
}

/* 툴바 글자(live.js liveSyncMount가 부름): 자동 갱신이 켜져 있으면 그 상태와 마지막 받은 시각, 아니면 null(기존 "마지막 동기화") */
function lrSyncText() {
  if (LR_OFF || !lrLive()) return null;
  const tm = LR.okAt ? new Date(LR.okAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }) : "";
  return "자동 갱신 켜짐" + (tm ? ` · 마지막 받음 ${tm}` : "");
}
function lrSyncAt() { const t = document.getElementById("syncAt"), x = lrSyncText(); if (t && x && t.textContent !== x) t.textContent = x; }
window.lrSyncText = lrSyncText;

/* ---------- 받기 ---------- */
async function lrPull() {
  if (!lrLive() || LR_OFF) return;
  if (LR.busy) { LR.again = true; return; }
  const gap = Date.now() - LR.lastPull; if (gap < LR_MIN_GAP_MS) { if (!LR.pokeT) LR.pokeT = setTimeout(() => { LR.pokeT = null; lrPull(); }, LR_MIN_GAP_MS - gap); return; } /* 너무 잦으면 남은 간격 뒤 한 번 */
  LR.busy = true; LR.lastPull = Date.now();
  try {
    const at = window.LIVE.at;
    const res = await liveApi(window.LIVE, { action: "changes", since: LR.cur, dbs: Object.keys(window.APP_RAW.raw) });
    if (!lrLive() || window.LIVE.at !== at) return; /* 그사이 전체를 다시 받았으면 버림 */
    LR.cur = res.now || LR.cur; LR.okAt = Date.now(); lrSyncAt();
    if (res.many) { lrMany(); }
    else if (lrApplyRaw(res.rows, res.gone)) { LR.need = true; LR.reqVer++; lrFlush(); }
    if (res.crAt) { if (LR.crAt && res.crAt > LR.crAt) lrCrPoke(); LR.crAt = res.crAt; }
    if ("subscription" in res) { /* (261123) 노션 연동 구독 끊김 — 바뀌면 홈 입력 점검을 다시 그림 */
      const was = LR.sub ? LR.sub.state : null; LR.sub = res.subscription || null;
      if (was !== (LR.sub ? LR.sub.state : null)) { try { render(); } catch (_) {} }
    }
  } catch (e) { try { console.warn("[자동 갱신]", e.message); } catch (_) {} }
  finally { LR.busy = false; if (LR.again) { LR.again = false; setTimeout(lrPull, LR_MIN_GAP_MS); } }
}
/* 바뀐 줄이 너무 많음(대량 편집 · 처음 채우기): 작성 중이 없으면 전체를 다시 받고, 있으면 한 줄로 알림 */
function lrMany() {
  const dirty = typeof dirtyCount === "function" ? dirtyCount() : 0;
  if (!dirty && lrSafe() && typeof window.liveReload === "function") { window.liveReload(); return; }
  toast("노션에서 많은 줄이 바뀌었어요 — 저장한 뒤 [동기화]를 누르면 모두 받아요");
}
function lrPoke() { if (LR.pokeT) return; LR.pokeT = setTimeout(() => { LR.pokeT = null; lrPull(); }, LR_POKE_MS); }

/* 수업 사본이 바뀜: 수업 · 오늘 · 보강 화면이면 받은 수업을 비우고 다시 받는다(수업에 작성 중이 있으면 미룸) */
function lrCrPoke() { LR.crNeed = true; if (LR.crT) return; LR.crT = setTimeout(() => { LR.crT = null; lrCrFlush(); }, 1500); }
function lrCrFlush() {
  if (!LR.crNeed || !lrLive() || typeof liveLessonReset !== "function") return;
  const t = typeof activeTab !== "undefined" ? activeTab : null, st = (t && t.state) || {};
  const onLesson = t && ((t.screen === "timetable" && st.view === "lesson") || t.screen === "today" || t.screen === "makeup");
  if (!onLesson) { LR.crNeed = false; try { liveLessonReset(); } catch (_) {} return; } /* 다른 화면: 다음에 열 때 새로 받게 비워만 둠 */
  const lDirty = (typeof LDIRTY !== "undefined" && LDIRTY.size) || Object.keys(DB.rtdirty || {}).length;
  if (lDirty || !lrSafe()) return; /* 1초 뒤 다시(lrTick) */
  LR.crNeed = false;
  try { liveLessonReset(); lastSnap = snapshot(); render(); } catch (_) {}
}

/* ---------- 신호(Realtime, Phoenix 최소 구현) ---------- */
function lrConnect() {
  if (LR.ws || LR_OFF || !lrLive() || typeof WebSocket === "undefined") return;
  const c = window.LIVE;
  const u = String(c.url).replace(/\/+$/, "").replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(c.anonKey) + "&vsn=1.0.0";
  let ws; try { ws = new WebSocket(u); } catch (_) { lrRetry(); return; }
  LR.ws = ws;
  ws.onopen = () => {
    LR.joinRef = String(++LR.ref);
    ws.send(JSON.stringify({ topic: "realtime:hada-app", event: "phx_join", ref: LR.joinRef, join_ref: LR.joinRef,
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, postgres_changes: [], private: false }, access_token: c.anonKey } }));
    clearInterval(LR.hb);
    LR.hb = setInterval(() => { try { ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++LR.ref) })); } catch (_) {} }, 25000);
  };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.event === "phx_reply" && m.ref === LR.joinRef) {
      if (m.payload && m.payload.status === "ok") { LR.joined = true; LR.retry = 0; lrDot(); lrPoke(); } /* 붙자마자 한 번 따라잡기(끊긴 사이 바뀐 것) */
      else { try { ws.close(); } catch (_) {} }
      return;
    }
    if (m.event === "broadcast" && m.payload) { const ev = m.payload.event; if (ev === "rows") lrPoke(); else if (ev === "cr") lrCrPoke(); return; }
    if ((m.event === "phx_error" || m.event === "phx_close") && m.topic === "realtime:hada-app") { try { ws.close(); } catch (_) {} }
  };
  ws.onclose = () => { clearInterval(LR.hb); LR.hb = null; if (LR.ws === ws) LR.ws = null; LR.joined = false; lrDot(); lrRetry(); };
  ws.onerror = () => {};
}
function lrRetry() {
  if (LR.rt || LR_OFF) return;
  const d = Math.min(30000, 2000 * Math.pow(2, LR.retry++));
  LR.rt = setTimeout(() => { LR.rt = null; if (lrLive()) lrConnect(); }, d);
}
function lrClose() { const ws = LR.ws; LR.ws = null; LR.joined = false; clearInterval(LR.hb); try { if (ws) ws.close(); } catch (_) {} }

/* ---------- 그리기(창 위 줄 · 표 알약 · 위 줄 점 · 홈) ---------- */
function lrDot() {
  const at = document.getElementById("syncAt"); if (!at) return;
  let d = document.getElementById("lrDot");
  if (LR_OFF || !lrLive()) { if (d) d.remove(); return; }
  if (!d) { d = document.createElement("span"); d.id = "lrDot"; d.className = "lr-dot"; d.setAttribute("role", "img"); }
  if (d.nextElementSibling !== at) at.before(d);
  const on = LR.joined, t = on ? "노션 변경 자동 반영 · 켜짐(몇 초 안에 화면이 바뀌어요)" : "노션 변경 자동 반영 · 다시 연결하는 중(1분마다 확인해요)";
  d.classList.toggle("on", on); d.title = t; d.setAttribute("aria-label", t);
}
const lrEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function lrReqHtml(q, when) {
  const tm = when ? (() => { try { return new Date(when).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }); } catch (_) { return ""; } })() : "";
  return `<span class="pill lr-rq ${q.k}">노션 요청 ${lrEsc(q.label)}</span><span class="lr-msg">${lrEsc(q.msg)}${tm ? ` · ${tm}` : ""}</span>`;
}
function lrDress() {
  if (!lrLive()) return;
  lrPendingTidy();
  setTimeout(lrDot, 0); /* [동기화] 칸은 바깥 render(live.js liveSyncMount)가 그린 뒤 */
  const t = typeof activeTab !== "undefined" ? activeTab : null, sel = String((t && t.state && t.state.sel) || "");
  /* 창 위(머리 · 탭 바로 아래, 본문 칸이 따로 있으면 그 맨 위) — 창마다 짜임이 달라 둘 다 받는다 */
  const panel = document.querySelector("#view .panel") || document.querySelector(".panel");
  if (panel) {
    panel.querySelectorAll(".lr-note").forEach((n) => n.remove());
    const notes = [];
    if (sel && LR.pending.has(sel)) notes.push(`<div class="lr-note w" role="status"><span>노션에서 이 줄이 바뀌었어요 — 지금 저장하면 내 값으로 덮어써요</span><button type="button" class="btn sm" data-lrtake="${lrEsc(sel)}">노션 값 불러오기</button></div>`);
    const rr = sel && lrRawRow(sel), q = rr && lrReq(rr.r);
    if (q && (q.k !== "ok" || q.age < LR_OK_SHOW_MS)) notes.push(`<div class="lr-note ${q.k}" role="status">${lrReqHtml(q, rr.r.notion_edited_at)}</div>`);
    if (notes.length) {
      const body = panel.querySelector(":scope > .pbody"), head = panel.querySelector(":scope > .ptabs") || panel.querySelector(":scope > .phead");
      if (body) body.insertAdjacentHTML("afterbegin", notes.join("")); else if (head) head.insertAdjacentHTML("afterend", notes.join("")); else panel.insertAdjacentHTML("afterbegin", notes.join(""));
    }
  }
  const now = Date.now();
  document.querySelectorAll("#view tr[data-id]").forEach((tr) => {
    const id = tr.getAttribute("data-id"), f = LR.flash.get(id);
    tr.classList.toggle("lr-flash", !!f && now - f < 4000);
    const old = tr.querySelector(".lr-rq"), rr = lrRawRow(id), q = rr && lrReq(rr.r), show = q && q.k !== "ok";
    if (!show) { if (old) old.remove(); return; }
    const html = `<span class="pill lr-rq ${q.k}" title="${lrEsc(q.msg)}">요청 ${lrEsc(q.label)}</span>`;
    if (old) { if (old.outerHTML !== html) old.outerHTML = html; return; }
    const td = [...tr.children].find((c) => c.tagName === "TD" && c.textContent.trim()); if (td) td.insertAdjacentHTML("beforeend", html);
  });
  for (const [id, f] of LR.flash) if (now - f > 4000) LR.flash.delete(id);
}
function lrHomeRows() {
  const L = lrReqList(), rows = [];
  if (LR.sub && LR.sub.state === "down") rows.push(["sub", "노션 연동 구독 끊김", "노션에서 고친 것이 바로 들어오지 않아요 — 5분마다 맞추는 중", 1]);
  if (L.fail.length) rows.push(["fail", "노션 요청 실패", "노션 버튼 · 자동화가 처리되지 않은 줄", L.fail.length]);
  if (L.slow.length) rows.push(["slow", "오래 걸리는 요청", "5분 넘게 대기 · 처리 중인 줄", L.slow.length]);
  return rows;
}
/* 구독 끊김 안내 창: 무엇이 · 지금 어떻게 돌고 있나 · 할 일 */
function lrSubOpen() {
  const h = LR.sub || {}, since = h.since ? new Date(h.since).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  modal(`<h2>노션 연동 구독 끊김</h2><div class="box lr-list">
    <div class="lr-note w" role="status"><span>${lrEsc(h.reason || "노션에서 고친 줄을 웹훅으로 받지 못했어요")}${since ? ` · ${lrEsc(since)}부터` : ""}${h.simulating ? " · 시험(꺼짐 흉내) 중" : ""}</span></div>
    <p>그동안 앱은 <b>${h.pollMin || 5}분마다</b> 노션을 다시 읽어 맞추고, 노션 버튼 · 자동화 요청도 그때 처리돼요(평소 몇 초 → 최대 ${h.pollMin || 5}분).</p>
    <p>할 일: 노션 연동 설정 → Webhooks에서 구독이 <b>Active</b>인지 봐요. 꺼져 있으면 다시 켜고, 새로 만들었다면 확인 토큰을 넣어요. 노션에서 다음 고침이 들어오면 저절로 정상(15분)으로 돌아가요.</p>
    <p class="hint">자세한 상태는 관리자 설정 → 노션 연동 구독에 있어요.</p></div><div class="actions"><span class="sp"></span><button type="button" class="btn" id="lrClose">닫기</button></div>`,
    (m, close) => { m.querySelector("#lrClose").onclick = close; });
}
function lrReqOpen(kind) {
  if (kind === "sub") { lrSubOpen(); return; }
  const L = lrReqList(), list = kind === "fail" ? L.fail : L.slow;
  const rows = list.sort((a, b) => String(b.r.notion_edited_at).localeCompare(String(a.r.notion_edited_at))).map(({ db, r, q }) =>
    `<div class="crow"><span class="cl">${lrEsc(lrDbShort(db))} · ${lrEsc(lrTitle(r))}</span><span class="cv">${lrReqHtml(q, r.notion_edited_at)}</span><span class="ca">${r.url ? `<a class="btn sm" href="${lrEsc(r.url)}" target="_blank" rel="noopener">노션에서 열기</a>` : ""}</span></div>`).join("");
  modal(`<h2>${kind === "fail" ? "노션 요청 실패" : "오래 걸리는 요청"}</h2><div class="box lr-list">${rows || '<p class="hint">없어요</p>'}<p class="hint">${kind === "fail" ? "노션에서 그 줄의 버튼을 다시 누르면 새 요청으로 처리돼요. 이유는 [요청 결과] 칸에도 있어요." : "보통 몇 초 안에 끝나요. 5분이 넘으면 노션 연동 구독 상태를 관리자 설정에서 확인해요."}</p></div><div class="actions"><span class="sp"></span><button type="button" class="btn" id="lrClose">닫기</button></div>`,
    (m, close) => { m.querySelector("#lrClose").onclick = close; });
}

/* ---------- 설치 ---------- */
function lrTick() {
  if (!lrLive()) { if (LR.ws && !(window.LIVE && window.LIVE.loaded)) lrClose(); return; }
  if (window.LIVE.at !== LR.loadAt) { /* 처음 받음 · 다시 받음([동기화] · 교재 등록) = 새 기준 */
    LR.loadAt = window.LIVE.at; LR.prev = lrIndex(lrCompute()); LR.pending.clear(); LR.need = false;
    LR.cur = new Date(Date.parse(window.LIVE.at) - 60000).toISOString(); /* 받는 데 걸린 시간만큼 겹쳐 읽음(같은 값은 건너뜀) */
    if (!LR_OFF) { lrConnect(); lrPoke(); }
    return;
  }
  lrDot(); /* [동기화] 옆 점(위 줄은 render 뒤에 붙음) */
  if (LR.need) lrFlush();
  if (LR.crNeed && !LR.crT) lrCrFlush();
  if (!LR_OFF && !document.hidden && Date.now() - LR.lastPull > (LR.joined ? LR_POLL_JOINED_MS : LR_POLL_MS)) lrPull();
}
(function lrInstall() {
  if (!window.liveModeFor || !window.liveModeFor(location.search, location.hostname, location.protocol)) return;
  const r0 = typeof render === "function" ? render : null;
  if (r0) render = function () { const o = r0.apply(this, arguments); try { lrDress(); } catch (_) {} return o; };
  if (typeof todayTodoBox === "function") {
    const t0 = todayTodoBox;
    todayTodoBox = function () {
      let h = t0.apply(this, arguments);
      try {
        const add = lrLive() ? lrHomeRows() : []; if (!add.length) return h;
        /* 261124: 홈 입력 점검 목록을 뺌 — 실패 · 끊김이 있을 때만 "알림" 상자로 */
        if (!h) h = `<section class="cbox todobox"><h3>${IC("alert", "l")}알림 <span class="hint">0</span></h3></section>`;
        const html = add.map(([k, t, tip, n]) => `<div class="crow tdl" data-lrreq="${k}" title="${lrEsc(t)} 목록 열기"><span class="cl">${IC("alert", "s")} ${lrEsc(t)}</span><span class="cv">${lrEsc(tip)}</span><span class="ca"><b class="todo">${n}</b>${IC("right", "s")}</span></div>`).join("");
        h = h.replace('<div class="hint">오늘 손볼 일이 없어요</div>', "");
        h = h.replace(/((?:입력 점검|알림) <span class="hint">)(\d+)(<\/span>)/, (_, a, n, b) => a + (+n + add.reduce((s, r) => s + r[3], 0)) + b);
        const at = h.lastIndexOf("</section>"); h = h.slice(0, at) + html + h.slice(at);
      } catch (_) {}
      return h;
    };
  }
  document.addEventListener("click", (e) => {
    const tk = e.target.closest && e.target.closest("[data-lrtake]"); if (tk) { e.preventDefault(); e.stopPropagation(); lrTakeNotion(tk.getAttribute("data-lrtake")); return; }
    const rq = e.target.closest && e.target.closest("[data-lrreq]"); if (rq) { e.preventDefault(); lrReqOpen(rq.getAttribute("data-lrreq")); }
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && lrLive() && !LR_OFF) { lrPoke(); if (!LR.ws) { LR.retry = 0; lrConnect(); } } });
  window.addEventListener("online", () => { if (lrLive() && !LR_OFF) { LR.retry = 0; if (!LR.ws) lrConnect(); lrPoke(); } });
  setInterval(lrTick, 1000);
  window.LR_STATE = LR; /* 검사용(값 없음) */
})();
