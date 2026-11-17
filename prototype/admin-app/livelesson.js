/* 실제 자료 모드의 수업 층(P3 걸음 1 — 보기만). live.js가 부른다.
   예시 모드는 수업 · 명단 · 출결을 시간표에서 계산해 지어낸다(lessonMade · seedAtt). 실제 자료 모드에서는 그 계산을 끄고
   수업 관리 서버(class-room 함수, 관리 앱과 같은 관리자 세션)가 준 수업 · 출석만 보여 준다. 쓰기는 아직 잇지 않는다.
   열쇠: 앱 수업 = "<시간표 id>|<날짜>", 서버 = 수업 id · 출석 id · 등록 id → 아래 표로 잇는다. */
const LIVE_L = {}; /* 수업 열쇠 → { id(수업 id), sum(출석현황 글자), n(출석 줄 수) } */
const LIVE_LD = {}; /* 날짜 → "loading" | "ok" | "fail" */
const LIVE_LS = {}; /* 수업 열쇠 → { state, roster[학생 id], att{학생 id: 출석 id} } — 창을 연 수업 */
const LIVE_LX = {}; /* 날짜 → 시간표와 맞지 않아 그리지 못한 수업 수(보강 수업 포함) */
const LIVE_ATT = { "🟢 출석": "출석", "🔴 결석": "결석", "🔵 보강": "보강" };

/* 서울 날짜 · 분(자정부터). 노션 원문 시각(…+09:00)이든 UTC든 서울 기준으로 바꾼다 */
function liveSeoul(iso) {
  if (!iso) return null;
  if (!String(iso).includes("T")) return { d: String(iso).slice(0, 10), m: null };
  const t = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString();
  return { d: t.slice(0, 10), m: +t.slice(11, 13) * 60 + +t.slice(14, 16) };
}
/* 출석현황 글자("🟢 출석 3 | 🔴 결석 1 | …") → 수. 못 읽으면 null */
function liveSum(text, n) {
  const pick = (w) => { const m = new RegExp(w + "\\s*(\\d+)").exec(String(text || "")); return m ? +m[1] : 0; };
  if (!text) return null;
  const r = { 출석: pick("출석"), 결석: pick("결석"), 보강: pick("보강"), 미입력: 0 };
  r.미입력 = Math.max(0, (n || 0) - r.출석 - r.결석 - r.보강);
  return r;
}
/* 예시 모드의 계산을 서버 값으로 바꿔 끼운다(한 번). 실제 자료 모드에 들어오자마자 부른다 — 받기 전에도 지어낸 수업 · 출결이 보이지 않게 */
function liveLessonInstall() {
  if (window._liveLessonOn) return; window._liveLessonOn = true;
  const roster0 = lessonRoster, sum0 = attSum, eff0 = lessonEff;
  lessonEff = (b, d) => { const L = LIVE_L[lkey(b, d)]; return L ? { d, start: L.start, end: L.end, off: false, moved: false } : eff0(b, d); };
  seedAtt = () => null;
  /* 수업 창 [수업 저장] · Ctrl+Enter = 노션에 출결 쓰기(예시 모드의 "앱 안에서만 저장"을 쓰지 않는다) */
  lSaveDialog = (k, after) => { liveLessonSave(k).then((ok) => { if (ok && after) after(); }); };
  lessonMade = (b, d) => !!LIVE_L[lkey(b, d)];
  lessonRoster = (b, d) => { const s = LIVE_LS[lkey(b, d)]; return s && s.state === "ok" ? s.roster.map((id) => stu(id)).filter(Boolean) : roster0(b, d); };
  attSum = (b, d) => { const k = lkey(b, d), s = LIVE_LS[k], L = LIVE_L[k]; if (s && s.state === "ok") return sum0(b, d); return (L && liveSum(L.sum, L.n)) || sum0(b, d); };
}
/* 받은 것을 모두 버린다(새로 받기 · 읽기 실패 · 로그인 전) */
function liveLessonReset() {
  [LIVE_L, LIVE_LD, LIVE_LS, LIVE_LX].forEach((o) => Object.keys(o).forEach((k) => delete o[k]));
  ["att", "made", "lov", "mkw", "lmsg", "lrep"].forEach((k) => { DB[k] = {}; });
}
async function liveLessonApi(body) {
  const c = window.LIVE;
  const res = await fetch(String(c.url).replace(/\/+$/, "") + "/functions/v1/class-room", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || out.error) throw new Error((out && out.error) || "요청 실패 (" + res.status + ")");
  return out;
}
/* 하루 수업을 받아 시간표와 잇는다: 클래스 + 요일 + 시작 시각이 같은 시간표. 시각만 다르면 그 반 그 요일에 하나뿐인 시간표에 잇는다 */
function liveLessonDayApply(date, res) {
  let miss = 0; const used = new Set(Object.keys(LIVE_L));
  /* 두 번 돈다(원본 검수 H6): ① 시작 시각까지 같은 시간표에 먼저 잇고 ② 남은 수업은 그 반 · 그 요일의 남은 시간표에 차례로 잇는다.
     같은 반에 그 요일 시간표가 여럿이고 시각이 안 맞아도(시간표의 등 · 하원 시간이 비어 있는 경우 등) 수업 수만큼 시간표가 "수업 있음"이 된다 —
     안 이으면 이미 수업이 있는 시간표가 "수업 없음"으로 세어져 [수업 생성]이 다음 차례 수업을 또 만든다. */
  const list = (res.sessions || []).map((s) => ({ s, at: liveSeoul(s.start), end: liveSeoul(s.end), cid: (s.classIds || [])[0] }));
  const put = (x, b) => { const k = lkey(b, x.at.d); used.add(k); const len = b.end > b.start ? b.end - b.start : 60;
    /* 시각은 시간표가 아니라 노션 수업의 시각 그대로(시간표를 고친 뒤에도 이미 만든 수업은 제 시각) */
    LIVE_L[k] = { id: x.s.id, sum: x.s.attendanceSummary || "", n: x.s.students || 0, start: x.at.m, end: x.end && x.end.m != null ? x.end.m : x.at.m + len }; x.done = true; };
  const cands = (x) => DB.blocks.filter((b) => !b.del && b.classId === x.cid && b.day === dow(x.at.d) && !used.has(lkey(b, x.at.d))).sort((a, b) => (a.start == null) - (b.start == null) || (a.start || 0) - (b.start || 0) || String(a.id).localeCompare(String(b.id)));
  list.forEach((x) => { if (x.s.makeup || !x.cid || !x.at || x.at.m == null) { x.skip = true; return; } const b = cands(x).find((c) => c.start === x.at.m); if (b) put(x, b); });
  list.forEach((x) => { if (x.skip || x.done) return; const b = cands(x)[0]; if (b) put(x, b); });
  list.forEach((x) => { if (x.skip || !x.done) miss++; });
  LIVE_LX[date] = miss;
}
/* [수업 생성] 대상에서 뺄 시간표(원본 검수 H5 · H6, 담당 261117): 서버는 시간표마다 "마지막 수업 다음 차례"를 한 번 만든다. 그래서 보는 주의 빈 칸이
   서버가 만들 그 차례일 때만 대상이다 — 아니면 눌러도 그 칸은 안 채워지고 뒤 주 수업만 늘어난다. 빼는 것:
   지난 날짜 · 이번 주보다 앞 / 다음 주보다 뒤의 주 · 아직 다 못 받은 날이 있는 동안 · 앞 주(오늘 뒤)에 빈 칸이 남은 시간표 · 뒤 주에 이미 수업이 있는 시간표 ·
   방금 수업 생성을 맡긴 시간표(30분 — 서버가 만들고 사본에 오기 전에 다시 세지 않게) · 저장 전인 새 시간표. */
const LIVE_GEN_KEY = "hada_live_gen";
function liveGenPending() { try { const o = JSON.parse(sessionStorage.getItem(LIVE_GEN_KEY) || "{}"), now = Date.now(); Object.keys(o).forEach((k) => { if (now - o[k] > 30 * 60000) delete o[k]; }); return o; } catch (_) { return {}; } }
function liveGenMark(ids) { try { const o = liveGenPending(); (ids || []).forEach((id) => { o[id] = Date.now(); }); sessionStorage.setItem(LIVE_GEN_KEY, JSON.stringify(o)); } catch (_) {} }
function liveGenSkip(b, d) {
  if (!window.LIVE_MODE) return false;
  if (!(window.LIVE && window.LIVE.loaded)) return true;
  if (!/^[0-9a-f-]{32,36}$/i.test(String(b.id))) return true;
  if (d < TODAY) return true;
  const w0 = dPlus(TODAY, -dow(TODAY)), w = dPlus(d, -dow(d));
  if (w < w0 || w > dPlus(w0, 7)) return true;
  const span = []; for (let x = w0; x <= dPlus(w, 13); x = dPlus(x, 1)) span.push(x);
  if (span.some((x) => LIVE_LD[x] !== "ok")) { liveLessonDays(span); return true; }
  for (let x = w0; x < w; x = dPlus(x, 7)) { const dd = dPlus(x, b.day); if (dd >= TODAY && !LIVE_L[lkey(b, dd)]) return true; }
  if (LIVE_L[lkey(b, dPlus(d, 7))]) return true;
  if (liveGenPending()[b.id]) return true;
  return false;
}
/* 화면이 보는 날짜들의 수업을 받는다(이미 받은 날은 건너뜀). 다 받으면 다시 그린다 */
function liveLessonDays(dates) {
  if (!(window.LIVE && window.LIVE.loaded)) return;
  const need = dates.filter((d) => !LIVE_LD[d]);
  if (!need.length) return;
  need.forEach((d) => { LIVE_LD[d] = "loading"; });
  Promise.all(need.map((d) => liveLessonApi({ action: "day", date: d }).then((res) => { if (LIVE_LD[d] !== "loading") return; liveLessonDayApply(d, res); LIVE_LD[d] = "ok"; }, () => { if (LIVE_LD[d] === "loading") LIVE_LD[d] = "fail"; }))).then(() => {
    if (window.liveRoReset) window.liveRoReset(); /* 서버 값을 받아 바뀐 것은 고친 것이 아니다 */
    try { lastSnap = snapshot(); } catch (_) {}
    if (need.some((d) => LIVE_LD[d] === "fail")) toast("수업을 불러오지 못한 날이 있어요 — 새로 고침 하면 다시 받아요");
    render();
  });
}
/* 수업 창을 열 때 그 수업의 명단 · 출결 · 한마디 · 학습기록을 받는다 */
function liveLessonOpen(k) {
  const L = LIVE_L[k];
  if (!L || LIVE_LS[k] || !(window.LIVE && window.LIVE.loaded)) return;
  LIVE_LS[k] = { state: "loading", roster: [], att: {} };
  liveLessonApi({ action: "session", sessionId: L.id }).then((res) => {
    if (!LIVE_LS[k] || LIVE_L[k] !== L) return;
    const [bid, d] = k.split("|"), b = byId(DB.blocks, bid), S = LIVE_LS[k];
    DB.anotes = DB.anotes.filter((n) => n.key !== k);
    Object.keys(DB.att).forEach((a) => { if (a.startsWith(k + "|")) delete DB.att[a]; });
    (res.students || []).forEach((x) => {
      const e = enr(x.registrationId); if (!e || !stu(e.studentId)) return;
      const sid = e.studentId; S.roster.push(sid); S.att[sid] = x.attendanceId;
      DB.att[k + "|" + sid] = LIVE_ATT[x.status] || null;
      if (x.comment || x.memo) DB.anotes.push({ id: x.attendanceId, key: k, sid, classId: b ? b.classId : "", d, say: x.comment || "", memo: x.memo || "", state: "saved" });
    });
    DB.recs = DB.recs.filter((r) => r.key !== k);
    (res.records || []).forEach((r) => DB.recs.push({ id: r.id, key: k, classId: b ? b.classId : "", d, kind: r.kind || "학습", bookId: r.bookId || "", range: r.range || "", content: r.content || "", acts: {}, state: "saved", _title: r.title || "", _hw: r.homework || null, _score: r.score || null }));
    S.state = "ok";
    if (window.liveRoReset) window.liveRoReset();
    try { lastSnap = snapshot(); } catch (_) {}
    render();
  }, (e) => { delete LIVE_LS[k]; toast("수업을 불러오지 못했어요 — " + e.message); });
}
/* 출결 쓰기(P3 걸음 2, 칸 P3w): 이 수업에서 바뀐 학생의 출석 상태만 수업 관리 서버(save-attendance)로 노션에 쓴다.
   한마디 · 메모 · 학습기록 · 휴강 · 옮기기는 보내지 않는다(화면에서도 잠겨 있다). 저장 뒤 그 수업과 그날 수업을 다시 받는다. */
const LIVE_ATT_OUT = { 출석: "🟢 출석", 결석: "🔴 결석", 보강: "🔵 보강" };
async function liveLessonSave(k) {
  if (!(window.LIVE && window.LIVE.loaded && window.LIVE_ATTW)) { toast("이 화면은 보기만 해요 — 고칠 것은 노션에서 고쳐요"); return false; }
  const S = LIVE_LS[k], L = LIVE_L[k], c = lChanges(k);
  if (!L || !S || S.state !== "ok") { toast("수업을 다 받은 뒤에 저장해요"); return false; }
  if (!c || !c.att.length) { toast("저장할 출결이 없어요"); return false; }
  const items = [];
  for (const sid of c.att) {
    const aid = S.att[sid];
    if (!aid) { toast("출석 줄을 찾지 못한 학생이 있어 저장하지 않았어요 — 새로 고침 한 뒤 다시 해요"); return false; }
    items.push({ attendanceId: aid, status: LIVE_ATT_OUT[DB.att[k + "|" + sid]] || "" });
  }
  if (window._liveLessonSaving) return false;
  window._liveLessonSaving = true;
  toast("노션에 저장하는 중이에요");
  try {
    let saved = 0;
    for (let i = 0; i < items.length; i += 60) { const res = await liveLessonApi({ action: "save-attendance", items: items.slice(i, i + 60) }); saved += res.saved || 0; }
    LDIRTY.delete(k);
    delete LIVE_LS[k]; delete LIVE_LD[k.split("|")[1]]; /* 그 수업 · 그날을 노션 값으로 다시 받는다 */
    if (window.liveRoReset) window.liveRoReset();
    try { undoStack.length = 0; if (typeof redoStack !== "undefined") redoStack = []; lastSnap = snapshot(); } catch (_) {}
    render();
    toast(saved === items.length ? `노션에 저장했어요 · 출결 ${saved}명` : `노션에 저장 ${saved}명 · 보낸 것 ${items.length}명 — 새로 고침 해서 확인해요`);
    return true;
  } catch (e) { toast("저장하지 못했어요 — " + e.message); return false; }
  finally { window._liveLessonSaving = false; }
}
/* 그릴 때마다(live.js render 뒤): 지금 화면이 보는 날짜 · 열린 수업을 받게 한다 */
function liveLessonNeed() {
  const t = typeof activeTab !== "undefined" ? activeTab : null;
  if (!t || !(window.LIVE && window.LIVE.loaded)) return;
  const st = t.state || {};
  if (t.screen === "timetable" && st.view === "lesson") { const w = weekOf(st); liveLessonDays([0, 1, 2, 3, 4, 5, 6].map((i) => dPlus(w.from, i))); }
  else if (t.screen === "today") liveLessonDays([st.day || TODAY]);
  else return;
  if (st.lsel && LIVE_L[st.lsel]) liveLessonOpen(st.lsel);
}
