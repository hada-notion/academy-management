/* 실제 자료 모드의 수업 층(P3 걸음 1 — 보기만). live.js가 부른다.
   예시 모드는 수업 · 명단 · 출결을 시간표에서 계산해 지어낸다(lessonMade · seedAtt). 실제 자료 모드에서는 그 계산을 끄고
   수업 관리 서버(class-room 함수, 관리 앱과 같은 관리자 세션)가 준 수업 · 출석만 보여 준다. 쓰기는 아직 잇지 않는다.
   열쇠: 앱 수업 = "<시간표 id>|<날짜>", 서버 = 수업 id · 출석 id · 등록 id → 아래 표로 잇는다. */
const LIVE_L = {}; /* 수업 열쇠 → { id(수업 id), sum(출석현황 글자), n(출석 줄 수) } */
const LIVE_LD = {}; /* 날짜 → "loading" | "ok" | "fail" */
const LIVE_LS = {}; /* 수업 열쇠 → { state, roster[학생 id], att{학생 id: 출석 id} } — 창을 연 수업 */
const LIVE_LX = {}; /* 날짜 → 시간표와 맞지 않아 그리지 못한 수업 수(보강 수업 포함) */
/* 방금 저장한 값(261119 원본검수: 저장 뒤 값을 이전 값으로 되돌리면 앱이 '변경 없음'으로 봄). 수업 관리 서버는 저장 뒤 사본에서 다시 읽는데 사본이 잠깐 늦으면 옛 값이 와서
   그 값이 새 기준이 된다 → 저장 성공한 값을 60초 동안 다시 받은 값 위에 덮어 기준으로 삼는다. 수업 열쇠 → { at, rec: { 기록 id: { range, content, bookId } }, att: { 출석 id: 상태 글 }, rt: { 체크 id: done }, notice } */
const LIVE_SAVED = {};
const LIVE_SAVED_TTL = 60000;
const liveSavedOf = (k) => { const V = LIVE_SAVED[k]; if (!V) return null; if (Date.now() - V.at > LIVE_SAVED_TTL) { delete LIVE_SAVED[k]; return null; } return V; };
/* 보강(261119 담당 (가) — 서버 PR #474 v2.8 모델: 결석 → [보강 배정] → 기존 결석). 읽기는 칸 P3b(보강 화면), 쓰기는 칸 P3m(window.LIVE_MKW)
   LIVE_MW = 보강 대기(class-room makeup-waiting): list[{k, sid, classId, d}] · byK[k] = { absId(결석 출석 id), sessionId(고른 보강 수업), decision }
   LIVE_MKD = 날짜 → 그날 보강 수업 · LIVE_MKS = 보강 수업 id → { state, sids(서버 명단), attIds{학생: 보강 출석 id} } */
const LIVE_MW = { state: "", byK: {}, list: [] };
const LIVE_MKD = {};
const LIVE_MKS = {};
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
  /* 보강 대기(261119 (가)): 실제 자료에서는 열어 본 수업의 결석이 아니라 서버 보강 대기(노션 "보강 대기" 보기와 같은 결석)를 쓴다 */
  /* 예시 모드의 "오래된 결석은 보강 끝" 꾸밈은 실제 자료에서 끈다(보강 여부를 잘못 비워 저장하지 않게) */
  if (typeof seedMkw === "function") seedMkw = () => {};
  if (typeof absAll === "function") { const abs0 = absAll; absAll = (from) => (LIVE_MW.state === "ok" ? LIVE_MW.list.map((a) => ({ ...a })) : LIVE_MW.state ? [] : abs0(from)); }
}
/* 받은 것을 모두 버린다(새로 받기 · 읽기 실패 · 로그인 전) */
function liveLessonReset() {
  [LIVE_L, LIVE_LD, LIVE_LS, LIVE_LX, LIVE_LN, LIVE_MKD, LIVE_MKS, LIVE_RECM].forEach((o) => Object.keys(o).forEach((k) => delete o[k]));
  ["att", "made", "lov", "mkw", "lmsg", "lrep"].forEach((k) => { DB[k] = {}; });
  LIVE_MW.state = ""; LIVE_MW.byK = {}; LIVE_MW.list = [];
  if (Array.isArray(DB.mk)) DB.mk = DB.mk.filter((m) => !m._live);
}
async function liveLessonApi(body) {
  const c = window.LIVE;
  let res;
  try {
    res = await fetch(String(c.url).replace(/\/+$/, "") + "/functions/v1/class-room", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey },
      body: JSON.stringify(body),
    });
  } catch (_) { const e = new Error("서버에 연결하지 못했어요(인터넷 · 서버 상태 확인)"); e.body = {}; e.status = 0; throw e; }
  const out = await res.json().catch(() => null);
  /* (261123 출시 전 4번) 일부만 실패하면 서버가 502 + 된 줄(savedIds · records · sessionId) · 안 된 줄(failed)을 함께 준다 — 오류에 붙여 둔다 */
  if (!res.ok || !out || out.error) { const e = new Error((out && out.error) || "요청 실패 (" + res.status + ")"); e.body = out || {}; e.status = res.status; throw e; }
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
    LIVE_L[k] = { id: x.s.id, sum: x.s.attendanceSummary || "", n: x.s.students || 0, start: x.at.m, end: x.end && x.end.m != null ? x.end.m : x.at.m + len,
      /* 하루 수업 페이지 · [오늘] 보기(261118, 서버 PR #461): 강사 · 학습기록 수 · 수업 구분(정규/보강/휴강, 비면 "") · 학습 내용 · 처리 상태 · 마지막 오류 · 시간표 id */
      teacherIds: x.s.teacherIds || [], records: x.s.records || 0, kind: x.s.kind || "", summary: x.s.summary || "", busy: x.s.busy || "", error: x.s.error || "", blockId: x.s.blockId || null }; x.done = true; };
  /* 525판(원본 검수 523 — 같은 반 · 같은 요일에 다른 시즌 시간표가 있으면 수업이 그쪽에 이어져 진짜 시간표가 "수업 없음"이 됐음):
     ⓪ 시간표의 [수업] 관계에 그 수업 id가 있으면 그 시간표(노션이 말하는 그대로) ① 시작 시각이 같은 시간표 ② 남은 시간표에 차례로.
     ① ②의 후보는 그 날짜가 적용 기간(시즌 기간 · 적용 기간) 안인 시간표만 — 다른 시즌 · 아직 시작 전인 시간표에는 잇지 않는다. */
  const norm = (v) => String(v || "").replace(/-/g, "").toLowerCase();
  const onDate = (b, d) => { try { return inPer(effPeriod(b), d); } catch (_) { return true; } };
  const cands = (x) => DB.blocks.filter((b) => !b.del && b.classId === x.cid && b.day === dow(x.at.d) && !used.has(lkey(b, x.at.d)) && onDate(b, x.at.d)).sort((a, b) => (a.start == null) - (b.start == null) || (a.start || 0) - (b.start || 0) || String(a.id).localeCompare(String(b.id)));
  list.forEach((x) => { if (x.s.makeup || !x.cid || !x.at || x.at.m == null) { x.skip = true; return; } const sid = norm(x.s.id); const b = DB.blocks.find((c) => !c.del && (c._lessonIds || []).some((v) => norm(v) === sid) && !used.has(lkey(c, x.at.d))); if (b) put(x, b); });
  list.forEach((x) => { if (x.skip || x.done) return; const b = cands(x).find((c) => c.start === x.at.m); if (b) put(x, b); });
  list.forEach((x) => { if (x.skip || x.done) return; const b = cands(x)[0]; if (b) put(x, b); });
  list.forEach((x) => { if (x.skip || !x.done) miss++; });
  LIVE_LX[date] = miss;
  /* 보강 수업(261119 (가)): 그날 보강 수업을 따로 모아 둔다 — 명단은 liveMakeupSessions가 받는다 */
  LIVE_MKD[date] = list.filter((x) => x.s.makeup && x.at && x.at.m != null).map((x) => ({ id: x.s.id, d: x.at.d, start: x.at.m, end: x.end && x.end.m != null ? x.end.m : x.at.m + 60, teacherIds: x.s.teacherIds || [] }));
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
    liveMakeupSessions(need);
  });
}
/* 수업 창을 열 때 그 수업의 명단 · 출결 · 한마디 · 학습기록을 받는다 */
/* lite = 여러 수업을 미리 받을 때(주간 · 출결 현황 보기): 명단 · 출결 · 학습기록만 — 학습활동 · 루틴은 창을 열 때 */
function liveLessonOpen(k, lite) {
  const L = LIVE_L[k];
  /* 미리 받기(lite)로 열린 수업을 창으로 열 때: 빠졌던 학습활동 · 루틴만 이어서 받는다(안 받으면 창의 루틴 탭 · 과제 결과가 비어 있음 — 원본검수 261119) */
  if (L && !lite && LIVE_LS[k] && LIVE_LS[k].lite && LIVE_LS[k].state === "ok" && window.LIVE && window.LIVE.loaded) { LIVE_LS[k].lite = false; liveLessonActs(k); liveLessonRoutines(k); return; }
  if (!L || LIVE_LS[k] || !(window.LIVE && window.LIVE.loaded)) return;
  /* times = 학생 id → { in, out }(등 · 하원 "HH:MM", 없으면 "" — 화면이 고치면 저장 때 바뀐 것만) · report = 학생 id → 일일 보고서 전송 상태(비면 "")
     recIds = 노션에 있는 학습기록 id · info = 수업 머리 값(서버 session.session 그대로: kind · summary · busy · error · blockId · notice(수업 안내 메모 — 화면이 고치면 저장 때) · noticeStatus · noticePreview …)
     routines = 서버 routines 결과({ available, status, checks[] }) — 받기 전 null */
  LIVE_LS[k] = { state: "loading", roster: [], att: {}, times: {}, report: {}, recIds: new Set(), info: null, routines: null, lite: !!lite };
  liveLessonApi({ action: "session", sessionId: L.id }).then((res) => {
    if (!LIVE_LS[k] || LIVE_L[k] !== L) return;
    const [bid, d] = k.split("|"), b = byId(DB.blocks, bid), S = LIVE_LS[k];
    const hm = (iso) => { const t = liveSeoul(iso); return t && t.m != null ? String(Math.floor(t.m / 60)).padStart(2, "0") + ":" + String(t.m % 60).padStart(2, "0") : ""; };
    S.info = res.session || null; S._notice0 = S.info ? S.info.notice || "" : "";
    DB.anotes = DB.anotes.filter((n) => n.key !== k);
    Object.keys(DB.att).forEach((a) => { if (a.startsWith(k + "|")) delete DB.att[a]; });
    (res.students || []).forEach((x) => {
      const e = enr(x.registrationId); if (!e || !stu(e.studentId)) return;
      const sid = e.studentId; S.roster.push(sid); S.att[sid] = x.attendanceId;
      S.times[sid] = { in: hm(x.arrivedAt), out: hm(x.leftAt) }; S.report[sid] = x.reportStatus || "";
      DB.att[k + "|" + sid] = LIVE_ATT[x.status] || null;
      if (x.comment || x.memo) DB.anotes.push({ id: x.attendanceId, key: k, sid, classId: b ? b.classId : "", d, say: x.comment || "", memo: x.memo || "", state: "saved" });
    });
    DB.recs = DB.recs.filter((r) => r.key !== k);
    (res.records || []).forEach((r) => { S.recIds.add(r.id); DB.recs.push({ id: r.id, key: k, classId: b ? b.classId : "", d, kind: r.kind || "학습", bookId: r.bookId || "", range: r.range || "", content: r.content || "", acts: {}, state: "saved", _title: r.title || "", _hw: r.homework || null, _score: r.score || null, _act: {} }); });
    /* 방금 저장한 값이 있으면 사본이 늦어 옛 값이 와도 저장한 값을 기준으로 삼는다(LIVE_SAVED) */
    { const V = liveSavedOf(k);
      if (V) {
        DB.recs.forEach((r) => { const s = V.rec && V.rec[r.id]; if (s) { r.range = s.range; r.content = s.content; r.bookId = s.bookId || ""; } });
        Object.keys(S.att).forEach((sid) => { const a = V.att && V.att[S.att[sid]]; if (a !== undefined) DB.att[k + "|" + sid] = LIVE_ATT[a] || null; });
        if (V.notice != null && S.info) { S.info.notice = V.notice; S._notice0 = V.notice; }
      } }
    S._times0 = JSON.stringify(S.times);
    if (!lite) { liveLessonActs(k); /* 과제 · 평가 기록의 학생별 결과(학습활동)는 따로 받는다 */
      liveLessonRoutines(k); }
    S.state = "ok";
    if (window.liveRoReset) window.liveRoReset();
    try { lastSnap = snapshot(); } catch (_) {}
    render();
  }, (e) => { delete LIVE_LS[k]; toast("수업을 불러오지 못했어요 — " + e.message); });
}
/* 과제 · 평가 기록의 학생별 결과(학습활동, 서버 activities)를 받아 rec.acts에 넣는다 — 화면 모양 acts[학생 id] = { hw: 완료|일부 완료|미제출, ok: 맞힌 문항 }.
   rec._act[학생 id] = 학습활동 id, rec._actBase = 받은 그대로(저장 때 바뀐 것만 보내려고) */
const LIVE_HW_IN = { 제출: "완료", "일부 제출": "일부 완료", 미제출: "미제출" }, LIVE_HW_OUT = { 완료: "제출", "일부 완료": "일부 제출", 미제출: "미제출" };
function liveLessonActs(k) {
  const recs = (DB.recs || []).filter((r) => r.key === k && (r.kind === "과제" || r.kind === "평가") && LIVE_LS[k] && LIVE_LS[k].recIds.has(r.id));
  recs.forEach((r) => liveLessonApi({ action: "activities", recordId: r.id }).then((res) => {
    const acts = {}, ids = {};
    (res.activities || []).forEach((a) => {
      const e = enr(a.registrationId); if (!e) return;
      const v = {}; if (r.kind === "과제" && LIVE_HW_IN[a.status]) v.hw = LIVE_HW_IN[a.status];
      if (r.kind === "평가" && a.correct != null) v.ok = a.correct;
      if (a.memo) v.memo = a.memo;
      acts[e.studentId] = v; ids[e.studentId] = a.id;
      if (r.kind === "평가" && a.total) r.total = a.total;
    });
    if (r.state === "draft") return; /* 받는 사이 사람이 고쳤으면 덮지 않는다 */
    r.acts = acts; r._act = ids; r._actBase = JSON.stringify(acts);
    if (window.liveRoReset) window.liveRoReset();
    try { lastSnap = snapshot(); } catch (_) {}
    render();
  }, () => {}));
}
/* 루틴 체크(서버 routines): S.routines = { available, status, checks:[{ checkId, routineId, routineName, order, attendanceId, registrationId, done }] }.
   check마다 sid(학생 id)를 붙인다(registrationId → 등록 → 학생) */
function liveLessonRoutines(k) {
  const L = LIVE_L[k], S = LIVE_LS[k];
  if (!L || !S) return Promise.resolve();
  return liveLessonApi({ action: "routines", sessionId: L.id }).then((res) => {
    if (LIVE_LS[k] !== S) return;
    (res.checks || []).forEach((c) => { const e = enr(c.registrationId); c.sid = e ? e.studentId : ""; });
    { const V = liveSavedOf(k); if (V && V.rt) (res.checks || []).forEach((c) => { if (c.checkId in V.rt) c.done = V.rt[c.checkId]; }); } /* 방금 저장한 체크는 저장한 값 기준 */
    /* 화면이 check.done을 바꾸면 [저장] 때 바뀐 것만 save-routines로(칸 P3b) — 받은 값은 S._rt0 */
    S.routines = res; S._rt0 = Object.fromEntries((res.checks || []).map((c) => [c.checkId, !!c.done])); render();
  }, () => { if (LIVE_LS[k] === S) S.routines = { available: false, status: "", checks: [], failed: true }; });
}
/* [루틴 체크 생성](칸 P3b — window.LIVE_RECW): 서버가 큐로 만든다 → 5 · 10 · 20 · 40초 뒤 다시 읽어 status가 ✅/⚠️면 멈춘다 */
async function liveLessonRoutineCreate(k) {
  const L = LIVE_L[k];
  if (!(window.LIVE && window.LIVE.loaded && window.LIVE_RECW)) { return false; }
  if (!L) return false;
  try {
    const res = await liveLessonApi({ action: "create-routine-checks", sessionId: L.id });
    toast(res.queued ? "루틴 체크를 만드는 중이에요 — 잠시 뒤 채워져요" : "이미 만드는 중이에요 — 잠시 뒤 채워져요");
    for (const s of [5, 10, 20, 40]) {
      await new Promise((ok) => setTimeout(ok, s * 1000));
      if (!LIVE_LS[k]) return true;
      await liveLessonRoutines(k);
      const st = String((LIVE_LS[k] && LIVE_LS[k].routines && LIVE_LS[k].routines.status) || "");
      if (/✅|⚠️/.test(st)) { if (/⚠️/.test(st)) toast("루틴 체크를 만들지 못했어요 — 노션 수업의 마지막 오류를 봐요"); return /✅/.test(st); }
    }
    toast("루틴 체크가 아직 다 안 만들어졌어요 — 잠시 뒤 다시 열어요");
    return true;
  } catch (e) { toast("루틴 체크를 만들지 못했어요 — " + e.message); return false; }
}
/* 같은 반 앞뒤 수업(머리 ‹ ›, 서버 class-sessions) → LIVE_LN[수업 열쇠] = [{ id, date, time, total, present, absent, missing }] */
const LIVE_LN = {};
function liveLessonNeighbors(k) {
  const L = LIVE_L[k];
  if (!L || LIVE_LN[k] || !(window.LIVE && window.LIVE.loaded)) return;
  LIVE_LN[k] = "loading";
  liveLessonApi({ action: "class-sessions", sessionId: L.id, around: k.split("|")[1] }).then((res) => { LIVE_LN[k] = res.sessions || []; render(); }, () => { delete LIVE_LN[k]; });
}

/* 수업 저장(하루 수업 페이지 [저장]) — 수업 관리 서버(class-room)로 노션에 쓴다. 저장 뒤 그 수업과 그날 수업을 다시 받는다.
   ① 출결 상태 · 한마디 · 메모(칸 P3w — window.LIVE_ATTW): save-attendance 한 줄에 함께
   ② 학습기록(칸 P3b — window.LIVE_RECW, 화면이 켬): 있는 기록 = update-record(범위 · 내용 · 교재), 새 기록 = create-records,
      학생별 결과 = save-activities(과제 상태 · 맞힌 문항 · 전체 문항 · 메모). 새 기록의 학생별 결과는 학습활동이 만들어진 뒤 다음 저장에.
   휴강 · 이 주만 옮기기 · 보강은 보내지 않는다(화면에서도 잠겨 있다). */
const LIVE_ATT_OUT = { 출석: "🟢 출석", 결석: "🔴 결석", 보강: "🔵 보강" };
function liveLessonPlan(k) {
  const S = LIVE_LS[k], c = lChanges(k) || { att: [] }, by = {}, miss = [], ATTW = !!window.LIVE_ATTW, RECW = !!window.LIVE_RECW;
  const row = (sid) => { const aid = S.att[sid]; if (!aid) { miss.push(sid); return null; } return (by[aid] = by[aid] || { attendanceId: aid }); };
  if (ATTW) {
    c.att.forEach((sid) => { const r = row(sid); if (r) r.status = LIVE_ATT_OUT[DB.att[k + "|" + sid]] || ""; });
    (DB.anotes || []).filter((n) => n.key === k && n.state === "draft").forEach((n) => { const r = row(n.sid); if (r) { r.comment = n.say || ""; r.memo = n.memo || ""; } });
    /* 등 · 하원 시각: 화면이 S.times를 고치면 바뀐 것만 — "HH:MM" → 그 수업 날짜의 서울 시각(ISO), ""는 비우기 */
    const t0 = S._times0 ? JSON.parse(S._times0) : {}, day = k.split("|")[1];
    const iso = (hm) => (/^\d{1,2}:\d{2}$/.test(hm || "") ? `${day}T${hm.padStart(5, "0")}:00+09:00` : "");
    Object.entries(S.times || {}).forEach(([sid, t]) => {
      const o = t0[sid] || { in: "", out: "" };
      if ((t.in || "") !== (o.in || "")) { const r = row(sid); if (r) r.arrivedAt = iso(t.in); }
      if ((t.out || "") !== (o.out || "")) { const r = row(sid); if (r) r.leftAt = iso(t.out); }
    });
  }
  /* 수업 안내 메모(S.info.notice, 칸 P3w): 바뀌었으면 update-session — 보내기(✉)는 없음 */
  const notice = ATTW && S.info && (S.info.notice || "") !== (S._notice0 || "") ? String(S.info.notice || "") : null;
  const recUpd = [], recNew = [], acts = [];
  if (RECW) (DB.recs || []).filter((r) => r.key === k && r.state === "draft" && !r.del).forEach((r) => {
    if (!S.recIds.has(r.id)) { recNew.push({ rec: r, body: { sessionId: LIVE_L[k].id, kind: r.kind, bookIds: r.bookId ? [r.bookId] : [], range: r.range || "", content: r.content || "" } }); return; }
    recUpd.push({ recordId: r.id, range: r.range || "", content: r.content || "", bookId: r.bookId || null });
    const base = r._actBase ? JSON.parse(r._actBase) : {};
    Object.entries(r.acts || {}).forEach(([sid, v]) => {
      const id = (r._act || {})[sid]; if (!id || JSON.stringify(v) === JSON.stringify(base[sid] || {})) return;
      const it = { activityId: id };
      if (r.kind === "과제") it.status = LIVE_HW_OUT[v.hw] || "";
      if (r.kind === "평가") { it.correct = v.ok == null || v.ok === "" ? null : +v.ok; if (r.total) it.total = +r.total; }
      if (v.memo !== undefined) it.memo = String(v.memo || "");
      acts.push(it);
    });
  });
  /* 루틴 체크 했음(칸 P3b, 서버 PR #462 save-routines): 받은 값과 달라진 줄만 */
  const routines = RECW && S.routines && S._rt0 ? (S.routines.checks || []).filter((c) => c.checkId in S._rt0 && !!c.done !== S._rt0[c.checkId]).map((c) => ({ checkId: c.checkId, done: !!c.done })) : [];
  return { att: Object.values(by), miss, recUpd, recNew, acts, notice, routines };
}
/* 루틴 체크를 눌러 바뀐 수업(칸 P3b, 261119 원본검수): 수업 창 루틴 탭의 클릭은 S.routines.checks[].done만 바꾸고 작성 중 표시(LDIRTY)를 안 만들어, 위 [저장] 수에 안 잡히고 save-routines가 안 나갔다.
   받은 값(S._rt0)과 달라진 체크가 있는 수업 열쇠를 돌려준다 — 저장 수(dirtyCount)와 저장 대상(liveSave)이 함께 쓴다 */
function liveRoutineChangedN(k) {
  const S = typeof LIVE_LS !== "undefined" ? LIVE_LS[k] : null;
  if (!window.LIVE_RECW || !S || S.state !== "ok" || !S.routines || !S._rt0) return 0;
  return (S.routines.checks || []).filter((c) => c.checkId in S._rt0 && !!c.done !== S._rt0[c.checkId]).length;
}
function liveRoutineDirtyKeys() {
  if (!window.LIVE_RECW || typeof LIVE_LS === "undefined") return [];
  return Object.keys(LIVE_LS).filter((k) => liveRoutineChangedN(k) > 0);
}
/* 수업 창 [되돌리기]: 눌러 바꾼 루틴 체크도 받은 값으로 */
function liveRoutineRevert(k) {
  const S = typeof LIVE_LS !== "undefined" ? LIVE_LS[k] : null;
  if (!window.LIVE_RECW || !S || !S.routines || !S._rt0) return;
  (S.routines.checks || []).forEach((c) => { if (c.checkId in S._rt0) c.done = S._rt0[c.checkId]; });
}
async function liveLessonSave(k) {
  if (!(window.LIVE && window.LIVE.loaded && (window.LIVE_ATTW || window.LIVE_RECW))) { return false; }
  const S = LIVE_LS[k], L = LIVE_L[k];
  if (!L || !S || S.state !== "ok") { toast("수업을 다 받은 뒤에 저장해요"); return false; }
  const P = liveLessonPlan(k);
  if (P.miss.length) { toast("출석 줄을 찾지 못한 학생이 있어 저장하지 않았어요 — 새로 고침 한 뒤 다시 해요"); return false; }
  const n = P.att.length + P.recUpd.length + P.recNew.length + P.acts.length + P.routines.length + (P.notice !== null ? 1 : 0);
  if (!n) { toast("저장할 것이 없어요"); return false; }
  if (window._liveLessonSaving) return false;
  window._liveLessonSaving = true;
  liveLessonSave.failed = false; liveLessonSave.fails = [];
  toast("노션에 저장하는 중이에요");
  const done = [], fail = [];
  const step = async (what, fn) => { try { await fn(); done.push(what); return true; } catch (e) { fail.push(what + " — " + e.message); return false; } };
  const V = { at: Date.now(), rec: {}, att: {}, rt: {}, notice: null }; /* 저장 성공한 것만 모은다(LIVE_SAVED) */
  /* (261123 출시 전 1번) 된 것만 따로 센다 — 일부가 실패하면 그 수업을 노션 값으로 다시 받지 않고(받으면 실패한 입력이 지워짐) 된 것만 기준 값을 새로 적는다 */
  const okAtt = new Set(), okAct = new Set(), okRec = new Set(), madeRec = {}; let okNotice = false, okRt = false;
  /* 여러 명 저장(출결 · 학생별 결과): 서버가 일부만 실패하면 502 + savedIds · failed(출시 전 4번) — 된 줄만 성공으로 */
  const many = async (what, action, items, key, okSet) => {
    let bad = 0, why = "";
    for (let i = 0; i < items.length; i += 60) {
      const part = items.slice(i, i + 60);
      try { await liveLessonApi({ action, items: part }); part.forEach((it) => okSet.add(it[key])); }
      catch (e) {
        const saved = new Set((e.body && e.body.savedIds) || []);
        part.forEach((it) => { if (saved.has(it[key])) okSet.add(it[key]); else bad++; });
        const f0 = e.body && Array.isArray(e.body.failed) && e.body.failed[0];
        why = why || (f0 && f0.error) || e.message;
      }
    }
    if (bad < items.length) done.push(`${what} ${items.length - bad}건`);
    if (bad) fail.push(`${what} ${items.length}건 중 ${bad}건 — ${why}`);
  };
  try {
    if (P.att.length) { await many("출결", "save-attendance", P.att, "attendanceId", okAtt); P.att.forEach((a) => { if (a.status !== undefined && okAtt.has(a.attendanceId)) V.att[a.attendanceId] = a.status; }); }
    if (P.notice !== null) { if (await step("수업 안내 메모", () => liveLessonApi({ action: "update-session", sessionId: L.id, notice: P.notice }))) { V.notice = P.notice; okNotice = true; } }
    for (const u of P.recUpd) { if (await step("학습기록", () => liveLessonApi({ action: "update-record", ...u }))) { V.rec[u.recordId] = { range: u.range, content: u.content, bookId: u.bookId }; okRec.add(u.recordId); } }
    for (const x of P.recNew) await step(`새 ${x.rec.kind} 기록`, async () => {
      let res;
      try { res = await liveLessonApi({ action: "create-records", ...x.body }); }
      catch (e) { const r0 = ((e.body && e.body.records) || []).find((r) => r.id); if (r0) madeRec[x.rec.id] = r0.id; throw e; } /* 일부만 만들어졌으면 그 id로 이어 감(다시 만들지 않음) */
      const made = (res.records || res.results || []).find((r) => r.created !== false) || (res.records || res.results || [])[0];
      if (made && made.id) madeRec[x.rec.id] = made.id;
      /* 과제 · 평가는 학생별 학습활동을 만들어 둔다(서버가 뒤에서 만든다 — 학생별 결과는 다음 저장에) */
      if (made && made.id && (x.rec.kind === "과제" || x.rec.kind === "평가")) await liveLessonApi({ action: "create-activities", recordId: made.id });
    });
    if (P.acts.length) await many("학생별 결과", "save-activities", P.acts, "activityId", okAct);
    if (P.routines.length) { if (await step(`루틴 체크 ${P.routines.length}건`, async () => { for (let i = 0; i < P.routines.length; i += 60) await liveLessonApi({ action: "save-routines", items: P.routines.slice(i, i + 60) }); })) { P.routines.forEach((c) => { V.rt[c.checkId] = !!c.done; }); okRt = true; } }
    LIVE_SAVED[k] = V; /* 다시 받을 때 이 값을 기준으로(60초) */
    const newHw = P.recNew.some((x) => x.rec.kind !== "학습");
    if (!fail.length) {
      LDIRTY.delete(k);
      delete LIVE_LS[k]; delete LIVE_LN[k]; delete LIVE_LD[k.split("|")[1]]; /* 그 수업 · 그날을 노션 값으로 다시 받는다 */
    } else liveLessonKeepFailed(k, S, P, { okAtt, okAct, okRec, madeRec, okNotice, okRt });
    if (window.liveRoReset) window.liveRoReset();
    try { undoStack.length = 0; if (typeof redoStack !== "undefined") redoStack = []; lastSnap = snapshot(); } catch (_) {}
    render();
    liveLessonSave.failed = fail.length > 0; liveLessonSave.fails = fail.slice();
    toast(fail.length ? `${done.length ? "일부만 저장했어요" : "저장하지 못했어요"} — 못 한 것은 작성 중으로 남겼어요(다시 [저장]) · ${fail.join(" · ")}` : `노션에 저장했어요 · ${done.join(" · ")}${newHw ? " — 학생별 결과는 잠시 뒤 다시 열어 적어요" : ""}`);
    return !fail.length;
  } finally { window._liveLessonSaving = false; }
}
/* (261123 출시 전 1번) 수업 저장이 일부 실패했을 때: 입력은 그대로 두고(다시 받지 않음) 된 것만 "저장됨" 기준으로 옮긴다.
   그래서 작성 중 표시 · 위 [저장] 수에는 실패한 것만 남고, 다시 [저장]하면 실패한 것만 다시 나간다. */
function liveLessonKeepFailed(k, S, P, ok) {
  const B = LDIRTY.get(k), sidOf = (aid) => Object.keys(S.att).find((sid) => S.att[sid] === aid);
  const t0 = S._times0 ? JSON.parse(S._times0) : {};
  P.att.forEach((a) => {
    const sid = sidOf(a.attendanceId); if (!sid || !ok.okAtt.has(a.attendanceId)) return;
    if (B && B.att && a.status !== undefined) { const ak = k + "|" + sid; if (ak in DB.att) B.att[sid] = DB.att[ak]; else delete B.att[sid]; }
    if (a.arrivedAt !== undefined || a.leftAt !== undefined) t0[sid] = Object.assign({}, S.times[sid] || {});
    if (a.comment !== undefined || a.memo !== undefined) (DB.anotes || []).forEach((n) => { if (n.key === k && n.sid === sid && n.state === "draft") n.state = "saved"; });
  });
  S._times0 = JSON.stringify(t0);
  if (ok.okNotice && S.info) S._notice0 = S.info.notice || "";
  if (ok.okRt && S.routines) (S.routines.checks || []).forEach((c) => { if (S._rt0 && c.checkId in S._rt0) S._rt0[c.checkId] = !!c.done; });
  (DB.recs || []).forEach((r) => {
    if (r.key !== k || r.state !== "draft" || r.del) return;
    const newId = ok.madeRec[r.id];
    if (newId) { S.recIds.add(newId); r.id = newId; r.state = "saved"; return; } /* 새 기록: 노션에 만든 id로(다시 만들지 않음) */
    if (!S.recIds.has(r.id)) return; /* 못 만든 새 기록 — 작성 중 그대로 */
    const base = r._actBase ? JSON.parse(r._actBase) : {};
    let actFail = false;
    Object.entries(r._act || {}).forEach(([sid, id]) => { if (ok.okAct.has(id)) base[sid] = JSON.parse(JSON.stringify((r.acts || {})[sid] || {})); else if (P.acts.some((a) => a.activityId === id)) actFail = true; });
    r._actBase = JSON.stringify(base);
    if (ok.okRec.has(r.id) && !actFail) r.state = "saved";
  });
}
/* ───── 보강(261119 (가)) ───── */
const liveNorm = (v) => String(v || "").replace(/-/g, "").toLowerCase();
/* 보강 여부(노션 고르기) → 앱 판단: 필요 = need, 없음 = none, 비면 판단 전 */
const liveMkDec = (s) => (/없음/.test(s || "") ? "none" : /필요/.test(s || "") ? "need" : "");
/* 보강 대기 받기: 결석 한 줄 = 앱 결석 열쇠 "<시간표 id>|<날짜>|<학생 id>"(그 반 · 그 요일 시간표, 없으면 "mw-<결석 id>") */
function liveMakeupLoad() {
  if (!(window.LIVE && window.LIVE.loaded) || LIVE_MW.state === "loading") return;
  LIVE_MW.state = "loading";
  liveLessonApi({ action: "makeup-waiting" }).then((res) => {
    const list = [], byK = {};
    (res.waiting || []).forEach((w) => {
      const e = enr(w.registrationId); if (!e || !stu(e.studentId)) return;
      const at = liveSeoul(w.start); if (!at) return;
      const bs = DB.blocks.filter((b) => !b.del && b.classId === e.classId && b.day === dow(at.d));
      const b = bs.find((x) => x.start === at.m) || bs[0];
      const k = (b ? b.id : "mw-" + liveNorm(w.attendanceId)) + "|" + at.d + "|" + e.studentId;
      list.push({ k, sid: e.studentId, classId: e.classId, d: at.d });
      byK[k] = { absId: w.attendanceId, sessionId: w.sessionId || null, decision: w.decision || "" };
      const dec = liveMkDec(w.decision), o = Object.assign({}, DB.mkw[k] || {});
      if (dec) o.dec = dec; else delete o.dec;
      delete o.mk; /* 고른 보강 수업만 있고 배정 전이면 앱은 아직 대기로 둔다(배정 = 저장 때 assign-makeup) */
      DB.mkw[k] = o;
    });
    LIVE_MW.list = list; LIVE_MW.byK = byK; LIVE_MW.state = "ok";
    if (window.liveRoReset) window.liveRoReset();
    try { lastSnap = snapshot(); } catch (_) {}
    render();
  }, (e) => { LIVE_MW.state = "fail"; toast("보강 대기를 불러오지 못했어요 — " + e.message); render(); });
}
/* 그날들의 보강 수업 명단을 받아 앱 보강(DB.mk, _live)으로 둔다. 이미 배정된 학생은 "mkl-<수업>|<날짜>|<학생>" 표시로 묶어 앱이 다른 결석을 새로 잇지 않게 */
function liveMakeupSessions(dates) {
  if (!(window.LIVE && window.LIVE.loaded) || !Array.isArray(DB.mk)) return;
  const todo = [];
  (dates || []).forEach((d) => (LIVE_MKD[d] || []).forEach((s) => { if (!LIVE_MKS[s.id]) todo.push(s); }));
  if (!todo.length) return;
  todo.forEach((s) => { LIVE_MKS[s.id] = { state: "loading", sids: [], attIds: {} }; });
  Promise.all(todo.map((s) => liveLessonApi({ action: "session", sessionId: s.id }).then((res) => {
    const S = LIVE_MKS[s.id]; if (!S) return;
    const att = {};
    (res.students || []).forEach((x) => { const e = enr(x.registrationId); if (!e || !stu(e.studentId)) return; S.sids.push(e.studentId); S.attIds[e.studentId] = x.attendanceId; att[e.studentId] = LIVE_ATT[x.status] || ""; });
    const c0 = S.sids.map((sid) => (DB.enrolls.find((e) => e.studentId === sid && S.attIds[sid]) || {}).classId).find(Boolean) || null;
    DB.mk = DB.mk.filter((m) => m.id !== s.id);
    DB.mk.push({ id: s.id, classId: c0, d: s.d, start: s.start, end: s.end, sids: S.sids.slice(), att, _live: true, _teacherIds: s.teacherIds || [] });
    S.sids.forEach((sid) => { DB.mkw["mkl-" + liveNorm(s.id) + "|" + s.d + "|" + sid] = { dec: "need", mk: s.id }; });
    S.att0 = Object.assign({}, att); /* 받은 출결(저장 때 바뀐 학생만 save-attendance) */
    S.state = "ok";
  }, () => { LIVE_MKS[s.id] = { state: "fail", sids: [], attIds: {} }; }))).then(() => {
    if (window.liveRoReset) window.liveRoReset();
    try { lastSnap = snapshot(); } catch (_) {}
    render();
  });
}
/* 저장할 것(칸 P3m): 새 보강 = create-makeup-session(이은 결석들), 서버 보강에 새로 이은 결석 = assign-makeup, 명단에서 뺀 학생 = unlink-makeup, 지운 서버 보강 = delete-makeup-session */
function liveMakeupPlan() {
  const out = { create: [], assign: [], unlink: [], del: [], att: [], skip: [] };
  if (!window.LIVE_MKW || LIVE_MW.state !== "ok") return out;
  /* 결석 보강 여부(서버 PR #476 save-attendance makeupDecision): 받은 값과 앱 판단이 달라진 결석만 — need = 보강 필요, none = 보강 없음, 판단 전 = 비우기 */
  const DEC_OUT = { need: "보강 필요", none: "보강 없음" };
  Object.entries(LIVE_MW.byK).forEach(([k, a]) => { const now = DEC_OUT[(DB.mkw[k] || {}).dec] || "", was = DEC_OUT[liveMkDec(a.decision)] || ""; if (now !== was) out.att.push({ attendanceId: a.absId, makeupDecision: now }); });
  /* 보강 수업 출결(같은 save-attendance, 보강 출석 id): 받은 출결과 달라진 학생만 */
  DB.mk.forEach((m) => { if (!m._live || m.off || m.del) return; const S = LIVE_MKS[m.id]; if (!S || S.state !== "ok" || !S.att0) return;
    Object.entries(S.attIds).forEach(([sid, aid]) => { const now = (m.att || {})[sid] || "", was = S.att0[sid] || ""; if (now !== was && m.sids.includes(sid)) out.att.push({ attendanceId: aid, status: LIVE_ATT_OUT[now] || "" }); }); });
  const linked = (mid) => Object.entries(DB.mkw).filter(([k, w]) => w && w.mk === mid && LIVE_MW.byK[k]).map(([k]) => k);
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const iso = (d, m) => `${d}T${hm(m)}:00+09:00`;
  /* 지운 서버 보강: 받았던 보강 수업 id가 DB.mk에서 빠졌거나 꺼짐 */
  Object.entries(LIVE_MKS).forEach(([id, S]) => { if (S.state !== "ok") return; const m = DB.mk.find((x) => x.id === id); if (!m || m.off || m.del) out.del.push({ sessionId: id }); });
  DB.mk.forEach((m) => {
    if (m.off || m.del) return;
    if (!m._live) {
      const ks = linked(m.id).filter((k) => m.sids.includes(k.split("|").pop()));
      if (!ks.length) { out.skip.push(`${m.d} 보강 — 이은 결석이 없어 만들지 않음`); return; }
      /* 담당강사: 화면이 고른 값(m.teacherId)이 먼저, 없으면 그 반 담당강사 */
      const c = cls((absInfo(ks[0]) || {}).classId || m.classId) || {}, tid = m.teacherId || c.teacherId;
      if (!tid) { out.skip.push(`${m.d} 보강 — 담당강사를 몰라 만들지 않음(클래스 담당강사)`); return; }
      out.create.push({ mk: m, body: { teacherId: tid, start: iso(m.d, m.start), end: m.end > m.start ? iso(m.d, m.end) : undefined, absenceIds: ks.map((k) => LIVE_MW.byK[k].absId) } });
      return;
    }
    const S = LIVE_MKS[m.id]; if (!S || S.state !== "ok") return;
    linked(m.id).forEach((k) => { const sid = k.split("|").pop(); if (m.sids.includes(sid) && !S.sids.includes(sid)) out.assign.push({ absenceId: LIVE_MW.byK[k].absId, sessionId: m.id }); });
    S.sids.forEach((sid) => { if (!m.sids.includes(sid) && S.attIds[sid]) out.unlink.push({ attendanceId: S.attIds[sid] }); });
  });
  return out;
}
async function liveMakeupSave() {
  const P = liveMakeupPlan(), n = P.create.length + P.assign.length + P.unlink.length + P.del.length + P.att.length;
  liveMakeupSave.failed = false; liveMakeupSave.fails = [];
  if (!n) { if (P.skip.length) toast(P.skip.join(" · ")); return 0; }
  const done = [], fail = [], made = new Set();
  const step = async (what, fn) => { try { await fn(); done.push(what); return true; } catch (e) { fail.push(what + " — " + e.message); return false; } };
  if (P.att.length) await step(`보강 여부 · 보강 출결 ${P.att.length}건`, async () => { for (let i = 0; i < P.att.length; i += 60) await liveLessonApi({ action: "save-attendance", items: P.att.slice(i, i + 60) }); });
  /* (261123 출시 전 4번) 보강 수업은 만들었고 배정 일부만 실패하면 서버가 sessionId를 준다 — 이미 노션에 있으니 앱의 새 보강은 버리고 서버 것을 다시 받는다(다시 만들지 않음). 못 이은 결석은 보강 대기에 남는다 */
  for (const x of P.create) if (await step("새 보강", async () => { try { await liveLessonApi({ action: "create-makeup-session", ...x.body }); } catch (e) { if (e.body && e.body.sessionId) made.add(x.mk.id); throw e; } })) made.add(x.mk.id);
  for (const x of P.assign) await step("보강 배정", () => liveLessonApi({ action: "assign-makeup", ...x }));
  for (const x of P.unlink) await step("보강에서 빼기", () => liveLessonApi({ action: "unlink-makeup", ...x }));
  for (const x of P.del) await step("보강 지우기", () => liveLessonApi({ action: "delete-makeup-session", ...x }));
  /* 다시 받기: 서버 보강은 다시 받고, 앱에만 있던 새 보강은 만든 것만 버림(못 만든 것은 남겨 다시 저장할 수 있게). 빼기 · 지우기는 노션 [삭제] 큐라 잠시 뒤 반영 */
  DB.mk = DB.mk.filter((m) => !m._live && !made.has(m.id));
  Object.keys(LIVE_MKS).forEach((k) => delete LIVE_MKS[k]);
  Object.keys(DB.mkw).forEach((k) => { if (k.startsWith("mkl-")) delete DB.mkw[k]; });
  try { [...LDIRTY.keys()].forEach((k) => { if (k.startsWith("mk:")) LDIRTY.delete(k); }); } catch (_) {}
  LIVE_MW.state = ""; liveMakeupLoad();
  Object.keys(LIVE_MKD).forEach((d) => { delete LIVE_LD[d]; delete LIVE_MKD[d]; });
  liveMakeupSave.failed = fail.length > 0; liveMakeupSave.fails = fail.slice();
  toast(fail.length ? `보강 일부만 저장했어요 — ${fail.join(" · ")}` : `보강을 노션에 저장했어요 · ${done.join(" · ")}${P.unlink.length || P.del.length ? " — 빼기 · 지우기는 노션이 차례로 처리해요(잠시 뒤 반영)" : ""}`);
  return done.length;
}

/* 그릴 때마다(live.js render 뒤): 지금 화면이 보는 날짜 · 열린 수업을 받게 한다 */
function liveLessonNeed() {
  const t = typeof activeTab !== "undefined" ? activeTab : null;
  if (!t || !(window.LIVE && window.LIVE.loaded)) return;
  const st = t.state || {};
  if (t.screen === "timetable" && st.view === "lesson") {
    /* 수업 메뉴 보기(v559): 월간 수업(mon) · 출결 현황(atm) = st.lmon 달 달력(첫 월요일 ~ 마지막 일요일), 그 밖 = 그 주 7일 */
    let dates;
    if (st.lv === "mon" || st.lv === "atm") {
      const ym = st.lmon || TODAY.slice(0, 7), first = ym + "-01", last = dPlus(dPlus((+ym.slice(5) === 12 ? (+ym.slice(0, 4) + 1) + "-01" : ym.slice(0, 5) + String(+ym.slice(5) + 1).padStart(2, "0")) + "-01", 0), -1);
      const from = dPlus(first, -dow(first)), to = dPlus(last, 6 - dow(last)); /* dow: 0 = 월 */
      dates = []; for (let d = from; d <= to; d = dPlus(d, 1)) dates.push(d);
    } else { const w = weekOf(st); dates = [0, 1, 2, 3, 4, 5, 6].map((i) => dPlus(w.from, i)); }
    liveLessonDays(dates);
    /* 주간 수업 일지(wk) · 출결 현황(atm)은 학생별 출결 · 학습기록이 필요 → 그 범위의 만든 수업을 4개씩 차례로 미리 받음(가볍게) */
    if (st.lv === "wk" || st.lv === "atm") {
      const busy = Object.values(LIVE_LS).filter((s) => s.state === "loading").length;
      const want = Object.keys(LIVE_L).filter((k) => { const d = k.split("|")[1]; return d >= dates[0] && d <= dates[dates.length - 1] && d <= TODAY && !LIVE_LS[k]; }).sort();
      want.slice(0, Math.max(0, 4 - busy)).forEach((k) => liveLessonOpen(k, true));
    }
  }
  else if (t.screen === "today") liveLessonDays([st.day || TODAY]);
  else if (t.screen === "makeup") {
    /* 보강 화면: 보강 대기 + 그 달(달력 앞뒤 주 포함) 보강 수업 */
    if (!LIVE_MW.state) liveMakeupLoad();
    const ym = st.mym || TODAY.slice(0, 7), first = ym + "-01", from = dPlus(first, -dow(first)), dates = [];
    for (let i = 0; i < 42; i++) dates.push(dPlus(from, i));
    liveLessonDays(dates);
    return;
  }
  else return;
  if (st.lsel && LIVE_L[st.lsel]) { liveLessonOpen(st.lsel); liveLessonNeighbors(st.lsel); }
}

/* 학습생성결함 ②(261124): 학습기록 메뉴 = 노션 학습기록 DB 목록. 수업 창을 연 수업의 기록(DB.recs)만이 아니라 보는 달의 모든 수업 기록을
   class-room range-records(서버 사본, 없으면 노션)로 받는다. 달("YYYY-MM") → { state: loading|ok|fail, at, rows }. 60초 지나면 다시 받는다 */
const LIVE_RECM = {};
function liveRecRow(x) {
  const norm = (v) => String(v || "").replace(/-/g, "").toLowerCase(), sid = norm(x.sessionId);
  let key = sid ? Object.keys(LIVE_L).find((k) => norm(LIVE_L[k].id) === sid) || "" : "";
  if (!key && x.blockId && x.date && byId(DB.blocks, x.blockId)) key = x.blockId + "|" + x.date;
  return { id: x.id, key, classId: (x.classIds || [])[0] || "", d: x.date || "", kind: x.kind || "학습", bookId: x.bookId || "", range: x.range || "", content: x.content || "", acts: {}, state: "saved", _title: x.title || "", _hw: x.homework || null, _score: x.score || null, _act: {}, _live: true, _sessionId: x.sessionId || "" };
}
function liveRecMonth(m) { // m = 보는 달("YYYY.MM" 또는 "YYYY-MM")
  m = String(m || "").replace(".", "-"); /* 화면의 달은 "YYYY.MM"(thisM · mKey) */
  if (!window.LIVE_MODE || !(window.LIVE && window.LIVE.loaded) || !/^\d{4}-\d{2}$/.test(m)) return null;
  const M = LIVE_RECM[m];
  if (M && (M.state === "loading" || (M.state !== "fail" && Date.now() - M.at < 60000))) return M;
  const [y, mo] = m.split("-").map(Number), last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const N = LIVE_RECM[m] = { state: "loading", at: Date.now(), rows: M ? M.rows : [] };
  liveLessonApi({ action: "range-records", from: m + "-01", to: m + "-" + String(last).padStart(2, "0") }).then((res) => {
    if (LIVE_RECM[m] !== N) return;
    N.rows = (res.records || []).map(liveRecRow); N.state = "ok"; N.at = Date.now();
  }).catch((e) => { if (LIVE_RECM[m] !== N) return; N.state = "fail"; N.err = e.message; }).finally(() => { if (LIVE_RECM[m] === N && typeof render === "function" && activeTab && activeTab.screen === "records") render(); });
  return N;
}
/* 학습기록 메뉴 줄: 받은 달의 기록 중 이 화면에 이미 있는 기록(수업 창에서 받은 것 · 고치는 중 · 지운 것)은 그쪽이 먼저 */
function liveRecRows() {
  const have = new Set((DB.recs || []).map((r) => r.id));
  return Object.values(LIVE_RECM).flatMap((M) => M.rows || []).filter((r) => !have.has(r.id));
}
