/* 실제 자료 모드 — 노션 버튼과 같은 일을 하는 앱 단추(261123, 과제 막힌단추).
   노션 버튼은 그 줄의 칸을 바꾸고(`요청` = 동작 ID, 또는 자동화가 보는 상태 칸), 서버(notion-events)가 그 칸을 보고 같은 함수를 부른다
   (docs/notion-button-requests.md). 앱도 같은 줄의 같은 칸을 앱 저장 길(app-api save update)로 바꾼다 — 서버는 고치지 않는다.
   - 누르면: 노션 버튼과 같은 뜻의 확인 창(알림톡은 앱의 공용 보내기 창) → 그 줄만 바로 저장 → 처리 중 · 완료 · 실패를 창 위 한 줄과 알림으로.
   - 저장하지 않은 변경이 있는 줄은 보내지 않는다(서버는 노션 값을 읽으므로 — 먼저 [저장]).
   - 무엇을 바꾸나(노션 버튼 원본 대조, 결과\대조표.md):
       등록 [링크 재발급] → 등록 요청 = reg-link-regenerate        등록 [등록 안내 전송] → 등록 요청 = reg-registration-notice
       등록 · 클래스 [시간표 변경 안내 전송] → 등록 `시간표 안내 상태` = ⚪ 대기(노션 자동화가 요청 = reg-timetable-notice) — 클래스는 수강 중 등록 전부
       등록 · 클래스 [교재 생성] → 등록 `교재 생성 상태` = ⚪ 대기(자동화 → reg-textbook-queue) — 클래스는 수강 중 등록 전부
       진도 [수료] → 진도관리 요청 = progress-completion
       (클래스 [한 번 청구] = 노션 [기타경비 청구]는 재무 구조 정리 뒤로 보류 — 담당 P0 261123. 아래 길은 남겨 두고 LQ_OPEN에서만 뺌)
       학생 [접수 안내 전송] → 학생 요청 = student-inquiry            학생 [개인정보 동의] 체크 → 학생 `개인정보 동의`만(노션 자동화 student-inquiry-auto는
         "동의 ☑인 새 줄"에서만 돈다 — 원본 실측 261123: 이미 있는 줄은 노션에서 직접 체크해도 안 돎. 그래서 안내는 [접수 안내 전송]으로)
       등록 [종료 처리] → 등록 `종료일` = 고른 날 + 요청 = reg-end-cleanup(261123 과제 종료처리 — 서버가 노션 버튼의 수업 단계까지:
         앞으로 수업 명단에서 빼기 · 출석 조정 ⚪ 대기 · 시간표 비우기 · 교재 정리). 확인 창 숫자는 서버 미리보기(app-api end-preview, 같은 거름)
   - 아직 막힌 것(서버가 그 DB에 쓰지 못함 · 노션 버튼이 다른 DB까지 고침): 수료 보고서 [보내기](보고서 DB) ·
     교재비에 담기(청구서) · 수강료 · 청구서 [안내 전송] · 수업 안내 · 일정 안내 — live.js P1_DENY.
   실제 자료 모드가 아니면 아무것도 하지 않는다(시제품 예시 흐름 그대로). */
const LQ = { next: null, watch: new Map(), timer: null, last: new Map() };
const LQ_DB = { students: "학생(학원) DB", enrolls: "등록(학원) DB", classes: "클래스(학원) DB", progress: "진도관리(학원) DB" };
const LQ_NAME = { "reg-end-cleanup": "종료 처리", "reg-link-regenerate": "링크 재발급", "reg-registration-notice": "등록 안내", "progress-completion": "수료", "class-etc-charge": "기타경비 청구", "student-inquiry": "접수안내 전송",
  "교재 생성 상태": "교재 생성", "시간표 안내 상태": "시간표 변경 안내" };
/* 요청 칸의 동작 ID → 노션 버튼 이름(대기 줄에 보임 — liverefresh.js lrReq) */
window.LQ_ACT_NAME = { "reg-link-regenerate": "링크 재발급", "reg-registration-notice": "등록 안내", "reg-end-cleanup": "종료 처리", "reg-textbook-queue": "교재 생성", "reg-timetable-notice": "시간표 안내",
  "progress-completion": "수료", "class-etc-charge": "기타경비 청구", "student-inquiry": "접수안내 전송", "student-inquiry-auto": "접수안내 전송", "reg-report-sync": "학생 페이지 동기화", "class-report-sync": "학생 페이지 동기화" };
/* 서버가 받은 뒤 그 줄에 남기는 이유 칸(완료여도 할 일을 못 했으면 여기에 — 알림톡 꺼짐 · 예시 데이터 부족 등) */
const LQ_ERR = ["접수안내 마지막 오류", "마지막 오류"];
/* 동작마다 서버가 결과를 적는 상태 칸 — 같은 이유가 되풀이돼도(이유 글이 그대로) 이 칸이 ⚠️면 "받았지만 못 함" */
const LQ_STAT = { "등록 안내": "안내 상태", "시간표 변경 안내": "시간표 안내 상태", "교재 생성": "교재 생성 상태", "접수안내 전송": "접수안내 전송 상태", "수료": "수료 상태" };
const lqStatBad = (r, label) => { const k = LQ_STAT[label], v = k ? String(((r && r.props) || {})[k] || "") : ""; return /^⚠️/.test(v); };
const lqErrOf = (r) => { const p = (r && r.props) || {}; for (const k of LQ_ERR) if (typeof p[k] === "string" && p[k].trim()) return p[k].trim(); return ""; };
/* 앱이 여는 단추(live.js p1Denied가 먼저 통과시킴) */
window.LQ_OPEN = "[data-act=end],[data-act=enReissue],[data-act=genPg],[data-act=genPg1],[data-act=pgDone],[data-act=pgRep],[data-pgdo^='done|'],[data-pgdo^='rep|'],[data-s1rc],[data-engd2],[data-ttn],#bfM";
const lqLive = () => !!(window.LIVE && window.LIVE.loaded && window.APP_RAW);
const lqEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lqIsId = (v) => /^[0-9a-f-]{32,36}$/i.test(String(v || ""));
const lqRow = (coll, id) => (DB[coll] || []).find((x) => x && String(x.id) === String(id));
const lqRaw = (coll, id) => { const m = window.APP_RAW && window.APP_RAW.raw[LQ_DB[coll]]; return m ? m.get(String(id)) : null; };
/* 노션 버튼이 고르는 "수강 중" 등록(노션 수식 `수강상태` = 🟢 수강 중 — 클래스 [교재 생성] · [시간표 변경 안내]와 같은 거름) */
function lqActive(classId) {
  const m = window.APP_RAW && window.APP_RAW.raw[LQ_DB.enrolls]; if (!m) return [];
  const cid = String(classId).replace(/-/g, "");
  return [...m.values()].filter((r) => { const p = r.props || {}; return /수강 중/.test(String(p["수강상태"] || "")) && (p["클래스"] || []).some((x) => String(x).replace(/-/g, "") === cid); }).map((r) => r.id);
}
/* 보내기 전: 저장 안 한 변경이 있으면 막는다 */
function lqBlocked(coll, ids) {
  for (const id of ids) {
    if (!lqIsId(id)) return "아직 노션에 저장하지 않은 줄이에요 — [저장]한 뒤 눌러요";
    const x = lqRow(coll, id);
    if (x && (x.state === "draft" || x.del || (typeof appsDirty === "function" && appsDirty(coll, x)))) return "저장하지 않은 변경이 있어요 — 서버는 노션 값을 읽어요. 먼저 [저장]한 뒤 눌러요";
  }
  return "";
}
/* 그 줄들만 바로 저장: props는 줄마다 같은 칸 */
async function lqSend(coll, ids, props, label) {
  const c = window.LIVE, db = LQ_DB[coll];
  const before = new Map(ids.map((id) => { const r = lqRaw(coll, id); return [String(id), { res: String(((r || {}).props || {})["요청 결과"] || ""), err: lqErrOf(r) }]; }));
  let out;
  try { out = await liveApi(c, { action: "save", changes: ids.map((id) => ({ op: "update", db, id, props })) }); }
  catch (e) {
    const m = /401|403|로그인/.test(e.message || "") ? "관리자 로그인이 필요해요 — 새로고침해서 다시 로그인해요" : e.message || "서버에 연결하지 못했어요";
    toast(`${label} 요청을 보내지 못했어요 — ${m}`); return false;
  }
  const bad = (out.results || []).filter((r) => !r.ok);
  const rows = (out.results || []).filter((r) => r.ok && r.row).map((r) => r.row);
  try { if (rows.length && typeof lrApplyRaw === "function" && lrApplyRaw(rows, [])) { LR.need = true; LR.reqVer++; lrFlush(); } } catch (_) {}
  const at = Date.now(), scr = activeTab && activeTab.screen, sel = activeTab && activeTab.state ? String(activeTab.state.sel || "") : "";
  (out.results || []).filter((r) => r.ok).forEach((r) => LQ.watch.set(String(r.id), Object.assign({ coll, label, at, scr, sel, res: "", err: "" }, before.get(String(r.id)) || {})));
  lqTick();
  if (bad.length) toast(`${label}: ${bad.length}줄은 보내지 못했어요 — ${bad[0].error || "이유 없음"}`);
  else toast(`${label} 요청을 노션에 보냈어요 — 보통 몇 초 ~ 1분 안에 끝나요`);
  try { render(); } catch (_) {}
  return !bad.length;
}
/* 처리 중 · 완료 · 실패 지켜보기: 자동 갱신(liverefresh.js)이 받은 요청 칸을 본다. 끝나면 알림 한 번, 3분 지나면 그만 본다 */
function lqTick() {
  if (LQ.timer) return;
  LQ.timer = setInterval(() => {
    if (!LQ.watch.size) { clearInterval(LQ.timer); LQ.timer = null; return; }
    try { lrPoke(); } catch (_) {}
    const done = [];
    for (const [id, w] of LQ.watch) {
      const r = lqRaw(w.coll, id), q = r && typeof lrReq === "function" ? lrReq(r) : null, res = String(((r || {}).props || {})["요청 결과"] || "");
      const fresh = res && res !== w.res;
      if (q && fresh && (q.k === "ok" || q.k === "fail")) {
        /* 큐로 보내는 동작(알림톡 · 교재 생성 등)은 요청 ✅ = "서버가 받음"이고 실제 결과는 상태 칸에 나중에 — 상태 칸이 ✅ · ⚠️가 될 때까지 더 본다 */
        const sk = LQ_STAT[w.label], sv = sk ? String(((r || {}).props || {})[sk] || "") : "";
        if (q.k === "ok" && sk && /^(⏳|🔄)/u.test(sv)) { if (!w.queued) { w.queued = true; try { render(); } catch (_) {} } if (Date.now() - w.at <= 180000) continue; }
        done.push([id, w, q]); continue;
      }
      if (Date.now() - w.at > 180000) { LQ.watch.delete(id); LQ.last.set(id, Object.assign({}, w, { k: "slow", msg: "3분이 지나도 결과가 오지 않았어요 — 홈 입력 점검의 \"오래 걸리는 요청\"에서 봐요", end: Date.now() })); toast(`${w.label}: 3분이 지나도 결과가 오지 않았어요 — 홈 입력 점검의 "오래 걸리는 요청"에서 봐요`); }
    }
    /* 완료여도 그 줄의 오류 칸이 새로 찼으면(알림톡 꺼짐 · 데이터 부족) "받았지만 못 함"으로 알린다 — 노션에서 보는 것과 같은 이유 글 */
    const fin = done.map(([id, w, q]) => { LQ.watch.delete(id); const r1 = lqRaw(w.coll, id), e = lqErrOf(r1), warn = q.k === "ok" && (lqStatBad(r1, w.label) || (!!e && e !== w.err)); const k = q.k === "fail" ? "fail" : warn ? "warn" : "ok", msg = q.k === "fail" ? q.msg : warn ? (e || String(((r1 || {}).props || {})["실시간 처리 상태"] || "").replace(/^⚠️\s*/u, "") || "이유는 노션 그 줄의 상태 칸에 있어요") : q.msg; LQ.last.set(id, Object.assign({}, w, { k, msg, end: Date.now(), doneRes: String(((r1 || {}).props || {})["요청 결과"] || "") })); return { w, k, msg }; });
    if (fin.length) {
      const by = new Map(); fin.forEach((f) => { const key = f.w.label + "|" + f.k + "|" + f.msg; by.set(key, Object.assign({ n: 0 }, f, { n: ((by.get(key) || {}).n || 0) + 1 })); });
      toast([...by.values()].map((f) => `${f.w.label}${f.n > 1 ? ` ${f.n}줄` : ""} ${f.k === "ok" ? "완료" : f.k === "warn" ? "— 서버가 받았지만 하지 못했어요" : "실패"}${f.msg ? " — " + f.msg : ""}`).join(" / "));
    }
    if (done.length) { try { render(); } catch (_) {} }
  }, 3000);
}
/* 창 위 한 줄: 이 창에서 보낸 요청(창이 다른 줄을 보고 있어도 — 학생 창에서 보낸 등록 요청 등) */
function lqDress() {
  if (!lqLive()) return;
  const panel = document.querySelector("#view .panel") || document.querySelector(".panel"); if (!panel) return;
  panel.querySelectorAll(".lq-note").forEach((n) => n.remove());
  const scr = activeTab && activeTab.screen, sel = activeTab && activeTab.state ? String(activeTab.state.sel || "") : "";
  const here = (w) => w.scr === scr && w.sel === sel;
  /* 처리 중: 보낸 줄이 끝날 때까지는 이 한 줄만 — 창이 보고 있는 그 줄의 자동 갱신 한 줄(lr-note)은 앞 요청의 결과일 수 있어 숨긴다
     (상태 칸을 바꾸는 단추는 노션 자동화가 요청을 쓰기까지 몇 초 ~ 1분 동안 앞 요청 "완료"가 보였음 — 사용성 시험 261123) */
  const ws = [...LQ.watch].filter(([, w]) => here(w)).map(([, w]) => w);
  const selLast = sel && LQ.last.get(sel), selBad = selLast && here(selLast) && selLast.k !== "ok" && Date.now() - selLast.end < 600000 && String(((lqRaw(selLast.coll, sel) || {}).props || {})["요청 결과"] || "") === selLast.doneRes; /* 받았지만 못 함 · 실패면 자동 갱신의 초록 "완료" 줄은 숨김(두 줄이 엇갈려 보였음) */
  if (sel && (selBad || (LQ.watch.has(sel) && here(LQ.watch.get(sel))))) panel.querySelectorAll(".lr-note.ok,.lr-note.fail,.lr-note.run,.lr-note.wait,.lr-note.slow").forEach((n) => { if (!n.classList.contains("lq-note")) n.remove(); });
  const by = new Map(); ws.forEach((w) => by.set(w.label, (by.get(w.label) || 0) + 1));
  const PILL = { ok: ["ok", "완료"], warn: ["fail", "받았지만 못 함"], fail: ["fail", "실패"], slow: ["slow", "오래 걸려요"] };
  /* 끝난 결과(10분): 못 함 · 실패는 그 줄을 보고 있어도 이유를 보인다 */
  const fins = new Map(); for (const [id, f] of LQ.last) { if (Date.now() - f.end > 600000) { LQ.last.delete(id); continue; } if (!here(f) || (id === sel && f.k === "ok")) continue; if (f.doneRes !== undefined && String(((lqRaw(f.coll, id) || {}).props || {})["요청 결과"] || "") !== f.doneRes) { LQ.last.delete(id); continue; } /* 그 뒤 새 요청이 있었으면 지난 결과는 내림 */ const key = f.label + "|" + f.k + "|" + f.msg; fins.set(key, Object.assign({ n: 0 }, f, { n: ((fins.get(key) || {}).n || 0) + 1 })); }
  if (!by.size && !fins.size) return;
  const qd = new Set(ws.filter((w) => w.queued).map((w) => w.label));
  const html = [...by].map(([l, n]) => `<div class="lr-note run lq-note" role="status"><span class="pill lr-rq run">노션 요청 처리 중</span><span class="lr-msg">${lqEsc(l)}${n > 1 ? ` · ${n}줄` : ""} — ${qd.has(l) ? "서버가 받아 대기열에서 처리하고 있어요. " : ""}끝나면 알려 드려요</span></div>`).join("")
    + [...fins.values()].map((f) => `<div class="lr-note ${PILL[f.k][0]} lq-note" role="status"><span class="pill lr-rq ${PILL[f.k][0]}">노션 요청 ${PILL[f.k][1]}</span><span class="lr-msg">${lqEsc(f.label)}${f.n > 1 ? ` · ${f.n}줄` : ""}${f.msg ? " — " + lqEsc(f.msg) : ""}</span></div>`).join("");
  const body = panel.querySelector(":scope > .pbody"), head = panel.querySelector(":scope > .ptabs") || panel.querySelector(":scope > .phead");
  if (body) body.insertAdjacentHTML("afterbegin", html); else if (head) head.insertAdjacentHTML("afterend", html); else panel.insertAdjacentHTML("afterbegin", html);
}
/* 다른 화면(재무 등)이 같은 길을 쓰는 공용 입구: 확인 창 없이 바로 — 부르는 쪽이 확인 창을 띄운 뒤에.
   liveRequest("classes", [id], { "요청": "class-etc-charge" }, "기타경비 청구") → 저장 · 처리 중 · 결과 알림까지 같은 모양 */
window.liveRequest = (coll, ids, props, label) => { if (!LQ_DB[coll]) throw new Error("liveRequest: 모르는 묶음 " + coll); const why = lqBlocked(coll, ids); if (why) { toast(why); return Promise.resolve(false); } return lqSend(coll, ids, props, label); };
window.liveRequestDb = (coll, db) => { LQ_DB[coll] = db; }; /* 재무 묶음(청구서 등)을 더할 때 */
/* 확인 창 → 보내기 */
function lqAsk(title, body, ok, coll, ids, props, label) {
  const why = lqBlocked(coll, ids); if (why) { toast(why); return; }
  if (!ids.length) { toast("보낼 줄이 없어요"); return; }
  askRun(title, body, ok, () => { lqSend(coll, ids, props, label); });
}
/* 앱의 공용 알림톡 보내기 창(alimSend)을 쓰는 흐름: 다음 한 번만 [보내기]를 서버 요청으로 바꾼다 */
function lqNextAlim(coll, ids, props, label, note) { LQ.next = { coll, ids, props, label, note }; setTimeout(() => { LQ.next = null; }, 0); }
(function lqWrapAlim() {
  if (typeof alimSend !== "function") return;
  const a0 = alimSend;
  window.alimSend = alimSend = function (o) {
    const n = LQ.next; LQ.next = null;
    if (!n || !lqLive()) return a0.apply(this, arguments);
    return a0.call(this, Object.assign({}, o, { note: n.note, onSend: () => { lqSend(n.coll, n.ids, n.props, n.label); } }));
  };
})();
const LQ_ALIM_NOTE = (btn) => `노션 [${btn}] 버튼과 같아요 — 서버가 알림톡 설정을 보고 보내요(설정이 꺼져 있으면 보내지 않고 이유를 남겨요). 보낸 결과는 이 줄의 상태 칸에 남아요.`;

/* 등록 [종료 처리](261123 과제 종료처리): 노션 버튼은 `종료일`(비면 오늘) 다음 날부터의 수업에서 이 등록을 빼고(보강 제외) 출석 조정 · 시간표 비우기 ·
   교재 정리까지 한다. 앱은 종료일을 고르게 하고 `종료일` + `요청` = reg-end-cleanup을 한 번에 저장 — 서버가 같은 단계를 한다(_shared/registrationEnd.ts).
   확인 창: 되돌릴 수 없음 · 종료일 · 빠지는 앞으로 수업 수(서버 미리보기 — 실제 처리와 같은 거름). 종료일이 오늘보다 앞이면 지난 수업 · 출석도 빠짐을 따로 알린다. */
const lqDay = (d) => { const [y, m, dd] = String(d).split("-").map(Number); return y ? `${m}월 ${dd}일` : ""; };
const lqPlus1 = (d) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
function lqEndAsk(e) {
  const today = typeof TODAY === "string" ? TODAY : new Date().toISOString().slice(0, 10);
  let day = e.end || today, seq = 0, ready = false;
  const body = `<div><b>${lqEsc(nmStu(e.studentId))}</b> · ${lqEsc(nmCls(e.classId))}</div><div class="hfh" id="lqEndD"></div>
<ul class="askl"><li id="lqEndN">빠지는 수업을 세고 있어요…</li><li>시간표 연결이 풀리고, 시작하지 않은 교재는 정리돼요</li><li>학생 · 등록 · 종료일까지의 출결 기록은 그대로 남아요</li></ul>
<div class="hint">노션 등록 [종료 처리]와 같아요 — 되돌리는 기능이 없어요. 바로 노션에 반영돼요.</div>`;
  askRun("이 등록을 종료할까요?", body, "종료 처리", () => {
    if (!ready) { toast("빠지는 수업을 세는 중이에요 — 잠시 뒤 다시 눌러요"); return; }
    lqSend("enrolls", [String(e.id)], { "종료일": day, "요청": "reg-end-cleanup" }, LQ_NAME["reg-end-cleanup"]);
  });
  const root = document.getElementById("modalRoot"); if (!root) return;
  const co = root.querySelector("#co"), n = root.querySelector("#lqEndN");
  setTimeout(() => { const cc = root.querySelector("#cc"); if (cc) cc.focus({ preventScroll: true }); }, 20); /* 되돌릴 수 없는 일 — 첫 초점은 [취소] */
  const count = () => {
    const my = ++seq; ready = false; if (co) co.disabled = true; if (n) n.textContent = "빠지는 수업을 세고 있어요…";
    liveApi(window.LIVE, { action: "end-preview", id: String(e.id), endDate: day }).then((r) => {
      if (my !== seq || !n || !n.isConnected) return;
      const dates = (r && r.dates) || [], past = dates.filter((d) => d <= today).length;
      n.innerHTML = dates.length
        ? `${lqDay(lqPlus1(day))}부터 수업 <b>${dates.length}개</b>에서 빠져요 (${lqEsc(lqDay(dates[0]))}${dates.length > 1 ? ` ~ ${lqEsc(lqDay(dates[dates.length - 1]))}` : ""})${past ? ` — <b>이미 지난 수업 ${past}개</b>도 빠지고 그 출석이 지워져요` : ""}`
        : `${lqDay(lqPlus1(day))}부터 만들어진 수업이 없어요 — 종료일 · 시간표만 정리돼요`;
      ready = true; if (co) co.disabled = false;
    }).catch((err) => {
      if (my !== seq || !n || !n.isConnected) return;
      n.textContent = `빠지는 수업을 세지 못했어요 — ${(err && err.message) || "서버 연결 실패"}. 창을 닫고 다시 눌러요`;
    });
  };
  const host = root.querySelector("#lqEndD");
  if (host && typeof HF !== "undefined" && HF.date) HF.date(host, { label: "종료일", value: day, clear: false, help: "이 날까지 다니고, 다음 날부터의 수업에서 빠져요", onChange: (v) => { if (v && v !== day) { day = v; count(); } } });
  count();
}
/* 누름 가로채기: 앱의 다른 듣기보다 먼저(window 잡기 단계) */
function lqClick(ev) {
  if (!lqLive() || !ev.target.closest) return;
  const t = ev.target;
  if (!t.closest("#view")) return;
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
  /* 학생 [개인정보 동의] — 노션 자동화가 접수 안내를 보낸다 */
  const hf = t.closest(".hf");
  if (hf && !t.closest(".qhelp,[data-help]")) {
    const lb = hf.querySelector(".hf-lbl");
    if (lb && /^개인정보 동의/.test(lb.textContent.trim()) && activeTab && activeTab.screen === "students") {
      stop();
      const id = String(activeTab.state.sel || ""), x = lqRow("students", id); if (!x) return;
      if (x.consent) { lqAsk("개인정보 동의를 해제할까요?", `<div><b>${lqEsc(x.name)}</b></div><div class="hint">노션 학생 페이지의 [개인정보 동의] 체크를 풀어요. 이미 보낸 접수 안내는 그대로예요.</div>`, "동의 해제", "students", [id], { "개인정보 동의": false }, "개인정보 동의 해제"); return; }
      lqAsk("개인정보 동의를 체크할까요?", `<div><b>${lqEsc(x.name)}</b></div><div class="hint">노션에서 [개인정보 동의]를 체크한 것과 같아요. 이미 있는 학생은 체크만 바뀌어요(노션 자동화는 동의가 체크된 채 새로 들어온 학생에게만 접수 안내를 보내요) — 안내를 보내려면 아래 [접수 안내 전송]을 눌러요.</div>`, "동의 체크", "students", [id], { "개인정보 동의": true }, "개인정보 동의");
      return;
    }
  }
  const b = t.closest("button,.btn,.lnk"); if (!b || b.disabled) return;
  const rid = b.dataset.rid;
  if (b.matches("[data-act=enReissue]") && rid) {
    stop(); const e = lqRow("enrolls", rid); if (!e) return;
    lqAsk("리포트 링크를 다시 생성할까요?", `<div>${lqEsc(nmStu(e.studentId))} · ${lqEsc(nmCls(e.classId))}</div><div class="hint">노션 등록 [링크 재발급]과 같아요. 옛 링크는 바로 막혀요 — 학부모에게 새 링크를 다시 보내야 해요.</div>`, "재발급", "enrolls", [rid], { "요청": "reg-link-regenerate" }, LQ_NAME["reg-link-regenerate"]);
    return;
  }
  if (b.matches("[data-act=end]") && rid) {
    stop(); const e = lqRow("enrolls", rid); if (!e) return;
    const why = lqBlocked("enrolls", [rid]); if (why) { toast(why); return; }
    lqEndAsk(e);
    return;
  }
  if (b.matches("[data-act=genPg1]") && rid) {
    stop(); const e = lqRow("enrolls", rid); if (!e) return;
    lqAsk("개별 교재를 생성할까요?", `<div><b>${lqEsc(nmStu(e.studentId))}</b> · ${lqEsc(nmCls(e.classId))}</div><div class="hint">노션 등록 [교재 생성]과 같아요 — 이 클래스의 개별 진도 기준 교재를 이 학생 것으로 복사해요. 이미 있는 교재는 건너뛰어요.</div>`, "교재 생성", "enrolls", [rid], { "교재 생성 상태": "⚪ 대기" }, LQ_NAME["교재 생성 상태"]);
    return;
  }
  if (b.matches("[data-act=genPg]") && rid) {
    stop(); const c = lqRow("classes", rid); if (!c) return; const ids = lqActive(rid);
    lqAsk("개별 교재를 생성할까요?", `<div><b>${lqEsc(c.name)}</b> · 수강 중 ${ids.length}명</div><div class="hint">노션 클래스 [교재 생성]과 같아요 — 수강 중인 학생마다 개별 진도 기준 교재를 복사해요. 이미 있는 학생은 건너뛰어요.</div>`, "교재 생성", "enrolls", ids, { "교재 생성 상태": "⚪ 대기" }, LQ_NAME["교재 생성 상태"]);
    return;
  }
  const pgdo = b.dataset.pgdo || "";
  if ((b.matches("[data-act=pgDone]") && rid) || pgdo.startsWith("done|")) {
    stop(); const id = rid || pgdo.split("|")[1], x = lqRow("progress", id); if (!x) return;
    if (x.stat !== "완료") { toast("진행상태가 완료일 때 수료해요"); return; }
    lqAsk("이 교재를 수료 처리할까요?", `<div><b>${lqEsc(nmBook(x.bookId))}</b> · ${lqEsc(nmCls(x.classId))}${x.mode === "개별" && x.studentId ? " · " + lqEsc(nmStu(x.studentId)) : ""}</div><div class="hint">노션 진도 [수료]와 같아요 — 진도교재가 완료로 바뀌고, 수강 중인 학생마다 수료 보고서가 만들어져요. 보내기는 발송함에서 따로 해요.</div>`, "수료", "progress", [id], { "요청": "progress-completion" }, LQ_NAME["progress-completion"]);
    return;
  }
  if (b.dataset.cetone && b.matches(window.LQ_OPEN)) {
    stop(); const cid = b.dataset.cetone, c = lqRow("classes", cid); if (!c) return;
    const em = window.APP_RAW.raw["기타경비(학원) DB"], once = (c.etcIds || []).map((i) => em && em.get(String(i))).filter((r) => r && /한 번/.test(String((r.props || {})["받는 방식"] || ""))).map((r) => (r.props || {})["이름"] || "");
    lqAsk("기타경비를 청구할까요?", `<div><b>${lqEsc(c.name)}</b> · 수강 중 ${lqActive(cid).length}명</div><div class="hint">노션 클래스 [기타경비 청구]와 같아요 — 이 반에 붙인 기타경비 중 받는 방식이 "한 번"인 것을 오늘 다니는 학생마다 청구서로 만들어요.</div>${once.length ? `<div>한 번 받는 기타경비: ${once.map(lqEsc).join(" · ")}</div>` : '<div class="hint">이 반에 받는 방식이 "한 번"인 기타경비가 없어요 — 서버가 이유를 남기고 아무것도 만들지 않아요.</div>'}`, "청구", "classes", [cid], { "요청": "class-etc-charge" }, LQ_NAME["class-etc-charge"]);
    return;
  }
  /* 알림톡: 앱 보내기 창은 그대로, [보내기]만 서버 요청으로 */
  if (b.dataset.s1rc) {
    const id = b.dataset.s1rc, why = lqBlocked("students", [id]); if (why) { stop(); toast(why); return; }
    lqNextAlim("students", [id], { "요청": "student-inquiry" }, LQ_NAME["student-inquiry"], LQ_ALIM_NOTE("접수안내 전송") + " 이미 보냈어도 다시 보내요.");
    return; /* 앱의 미리보기 창이 이어서 뜬다 */
  }
  if (b.dataset.engd2) {
    const id = b.dataset.engd2, e = lqRow("enrolls", id), why = lqBlocked("enrolls", [id]); if (why) { stop(); toast(why); return; }
    if (e && (e.ntype || "등록 안내") !== "등록 안내") { stop(); toast("클래스 변경 안내는 없어졌어요 — 반을 옮기면 새 등록의 [등록 안내]로 보내요"); return; }
    lqNextAlim("enrolls", [id], { "요청": "reg-registration-notice" }, LQ_NAME["reg-registration-notice"], LQ_ALIM_NOTE("등록 안내") + " 등록 안내 메모는 보낸 뒤 비워져요.");
    return;
  }
  if (b.dataset.ttn) {
    const [k, id] = b.dataset.ttn.split("|"), ids = k === "e" ? [id] : lqActive(id), why = lqBlocked("enrolls", ids); if (why) { stop(); toast(why); return; }
    lqNextAlim("enrolls", ids, { "시간표 안내 상태": "⚪ 대기" }, LQ_NAME["시간표 안내 상태"], LQ_ALIM_NOTE("시간표 변경 안내") + (k === "e" ? "" : ` 수강 중 ${ids.length}명에게 한 통씩 — 미리보기는 첫 학생 값이에요.`));
    return;
  }
}
["click"].forEach((t) => window.addEventListener(t, lqClick, true));
window.addEventListener("keydown", (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target && ev.target.closest && ev.target.closest(".hf") && lqLive()) { const lb = ev.target.closest(".hf").querySelector(".hf-lbl"); if (lb && /^개인정보 동의/.test(lb.textContent.trim())) { ev.preventDefault(); ev.stopImmediatePropagation(); ev.target.click(); } } }, true);
/* 다시 그릴 때마다 창 위 한 줄 */
(function lqWrapRender() {
  const go = () => { if (typeof render !== "function" || render._lq) return false; const r0 = render; render = function () { const out = r0.apply(this, arguments); try { lqDress(); } catch (_) {} return out; }; render._lq = true; return true; };
  if (!go()) setTimeout(go, 0);
})();
