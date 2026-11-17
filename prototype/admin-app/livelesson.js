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
  (res.sessions || []).forEach((s) => {
    const at = liveSeoul(s.start), end = liveSeoul(s.end), cid = (s.classIds || [])[0];
    if (s.makeup || !cid || !at || at.m == null) { miss++; return; }
    const cand = DB.blocks.filter((b) => !b.del && b.classId === cid && b.day === dow(at.d) && !used.has(lkey(b, at.d)));
    const b = cand.find((x) => x.start === at.m) || (cand.length === 1 ? cand[0] : null);
    if (!b) { miss++; return; }
    const k = lkey(b, at.d); used.add(k);
    /* 시각은 시간표가 아니라 노션 수업의 시각 그대로(시간표를 고친 뒤에도 이미 만든 수업은 제 시각) */
    LIVE_L[k] = { id: s.id, sum: s.attendanceSummary || "", n: s.students || 0, start: at.m, end: end && end.m != null ? end.m : at.m + (b.end - b.start) };
  });
  LIVE_LX[date] = miss;
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
