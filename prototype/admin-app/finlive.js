/* 재무 화면이 노션에 쓰는 길(261123 재무 서버 2바퀴 · 동작 목록 "재무서버결과.md" 맨 위 2바퀴 장). 실제 자료(live) 연결에서만 쓴다 — 예시 화면은 확인 창까지만.
   [결제]            → app-api record-payment { requestId, tuitionId | itemId }  (금액은 보내지 않음 — 전액 한 줄, 노션 [결제] 버튼과 같음)
   결제 줄 고치기      → app-api save update 결제(학원) DB(결제 금액 · 결제 수단 · 결제일 · 비고) / 청구 결제(학원) DB(결제 금액 · 결제 방법 · 결제일) — 답 linked(연결 수강료 · 청구 항목)까지 끼움
   [＋ 결제 줄](지출 등) → app-api save create 결제(학원) DB(결제 · 결제 금액 · 결제일 · 구분 · 결제 수단 꼭)
   [교재비 생성]       → 수강 중이고 교재비가 비어 있는 등록마다 save update `교재비 생성 상태` = ⚪ 대기(노션 자동화가 청구서를 만들고 ✅ 완료)
   [기타경비 청구]     → 클래스 `요청` = class-etc-charge(livereq.js 공용 입구)
   [담기]            → 청구서 `요청` = cart-progress-book(같은 입구)
   실제 결제 · 알림톡은 없다(노션에 기록만). 서버 사본은 끝난 뒤 자동 갱신(lrPoke)이 따라온다. */
(function () {
  const live = () => !!(window.LIVE && window.LIVE.loaded && window.APP_RAW);
  const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const E = (s) => (typeof esc === "function" ? esc(s) : String(s == null ? "" : s));
  const won = (n) => (typeof WON === "function" ? WON(n) : String(n));
  const say = (m) => { try { toast(m); } catch (_) {} };
  const post = (body) => liveApi(window.LIVE, body);
  const errText = (e) => (/401|403|로그인/.test((e && e.message) || "") ? "관리자 로그인이 필요해요 — 새로고침해서 다시 로그인해요" : (e && e.message) || "서버에 연결하지 못했어요");
  const poke = () => [700, 4000, 12000].forEach((ms) => setTimeout(() => { try { if (typeof lrPoke === "function") lrPoke(); } catch (_) {} }, ms));
  /* 서버가 돌려준 줄(저장한 줄 · 연결된 수강료 · 청구 항목)을 앱 사본에 바로 끼운다 */
  const apply = (rows) => { try { const r = (rows || []).filter((x) => x && x.id && x.db); if (r.length && typeof lrApplyRaw === "function" && lrApplyRaw(r, [])) { LR.need = true; LR.reqVer++; lrFlush(); } } catch (_) {} };
  const needLive = (close) => { if (close) close(); say("예시 화면이라 노션에 쓰지 않아요 — 실제 자료 연결(관리자 로그인)에서 써요"); };

  /* 청구 항목 줄 id: 실제 자료의 줄은 노션 id 그대로. 청구서에서 다시 만든 줄(ch-<청구서 id>-<번호>)은 그 청구서의 청구 항목 id 목록에서 찾는다 */
  const itemIdOf = (id) => {
    const s = String(id || ""); if (/^[0-9a-f-]{32,36}$/i.test(s)) return s;
    const m = /^ch-(.+)-(\d+)$/.exec(s); if (!m) return "";
    const bf = (DB.bookfees || []).find((b) => String(b.id) === m[1]); const v = bf && bf._lineIds && bf._lineIds[+m[2]];
    return v && /^[0-9a-f-]{32,36}$/i.test(String(v)) ? String(v) : "";
  };
  const pay = async (body, close, label, after) => {
    try { const out = await post(body); say(label(out)); apply([]); poke(); if (after) after(out); if (close) close(); return true; }
    catch (e) { say("결제 기록을 만들지 못했어요 — " + errText(e)); return false; }
  };

  /* ═════ 확인 창의 [생성] · [결제] 등(finance.js run) ═════ */
  window.finRun = (kind, ctx, close) => {
    if (!live()) return needLive(close);
    if (ctx._busy) return; ctx._busy = true; const done = () => { ctx._busy = false; };
    if (kind === "tuition-pay") {
      ctx.rid = ctx.rid || uuid();
      return pay({ action: "record-payment", requestId: ctx.rid, tuitionId: String(ctx.tuitionId) }, close, (o) => "수강료 결제 기록을 노션에 만들었어요" + (o && o.tuition && o.tuition["결제 관리"] ? " — " + o.tuition["결제 관리"] : "")).then(done, done);
    }
    if (kind === "charge-pay") {
      const itemId = itemIdOf(ctx.chargeId); if (!itemId) { done(); say("이 청구 줄은 아직 노션 청구 항목과 이어지지 않았어요 — 노션에서 [결제]를 눌러요"); return; }
      ctx.rid = ctx.rid || uuid();
      return pay({ action: "record-payment", requestId: ctx.rid, itemId }, close, (o) => "청구서 결제 기록을 노션에 만들었어요" + (o && o.item && o.item["결제 상태"] ? " — " + o.item["결제 상태"] : "")).then(done, done);
    }
    if (kind === "tuition-create") { /* 클래스 [월 수강료 생성] = 클래스 `요청` = class-tuition-create(수강료 기간이 비면 다음 달 · 월간 수업 총량이 비면 서버가 안 만듦) */
      if (window.LQ_ACT_NAME) window.LQ_ACT_NAME["class-tuition-create"] = "월 수강료 생성";
      return Promise.resolve(window.liveRequest("classes", [String(ctx.classId)], { 요청: "class-tuition-create" }, "월 수강료 생성")).then((ok) => { done(); if (ok && close) close(); }, (e) => { done(); say(errText(e)); });
    }
    if (kind === "etc-charge") {
      return Promise.resolve(window.liveRequest("classes", [String(ctx.classId)], { 요청: "class-etc-charge" }, "기타경비 청구")).then((ok) => { done(); if (ok && close) close(); }, (e) => { done(); say(errText(e)); });
    }
    if (kind === "bill-create") {
      const ids = (typeof lqActive === "function" ? lqActive(ctx.classId) : []).filter((id) => { const r = window.APP_RAW.raw["등록(학원) DB"].get(String(id)); const b = r && r.props && r.props["교재비"]; return !(Array.isArray(b) ? b.length : b); });
      if (!ids.length) { done(); say("교재비 청구서가 없는 수강 중 학생이 없어요"); return; }
      return post({ action: "save", changes: ids.map((id) => ({ op: "update", db: "등록(학원) DB", id, props: { "교재비 생성 상태": "⚪ 대기" } })) }).then((out) => {
        const bad = (out.results || []).filter((r) => !r.ok); apply((out.results || []).filter((r) => r.ok && r.row).map((r) => r.row)); poke(); done();
        say(bad.length ? `교재비 생성: ${bad.length}줄은 보내지 못했어요 — ${bad[0].error || "이유 없음"}` : `교재비 생성 요청을 ${ids.length}명 노션에 보냈어요 — 노션 자동화가 청구서를 만들어요(보통 몇 초 ~ 1분)`);
        if (!bad.length && close) close();
      }, (e) => { done(); say("교재비 생성 요청을 보내지 못했어요 — " + errText(e)); });
    }
    done(); say("이 단추는 아직 앱에서 노션에 쓰지 않아요 — 노션에서 눌러요");
  };

  /* ═════ 결제 줄 고치기 · 새 줄 · 담기 (표 안 단추) ═════ */
  const HOW = ["계좌이체", "현금", "카드", "기타"];
  const howList = (cur) => { const seen = new Set(HOW); const ex = (DB.pays || []).concat(DB.billPays || []).map((x) => x.how).filter(Boolean); [...ex, cur].forEach((h) => { if (h) seen.add(h); }); return [...seen]; };
  const opts = (list, cur, blank) => (blank ? '<option value="">고르기</option>' : "") + list.map((h) => `<option${h === cur ? " selected" : ""}>${E(h)}</option>`).join("");
  const dateOf = (v) => String(v || "").slice(0, 10);
  const fld = (label, html) => `<label class="finf"><span>${label}</span>${html}</label>`;
  /* 저장: results[0] — 끝나면 저장한 줄 · 연결 줄을 앱 사본에 끼움 */
  const save = async (change, close, what) => {
    try {
      const out = await post({ action: "save", changes: [change] }); const r = (out.results || [])[0] || {};
      if (!r.ok) { say(`${what}: 저장하지 못했어요 — ${r.conflict ? "노션에서 먼저 바뀐 줄이에요. 새로 받은 뒤 다시 해요" : r.error || "이유 없음"}`); return false; }
      const rows = [r.row].concat(r.linked || []); say(`${what}: 노션에 저장했어요`); if (close) close(); setTimeout(() => { apply(rows); poke(); }, 80); /* 창이 열려 있으면 자동 갱신이 끼우기를 미루므로 닫은 뒤에 끼운다 */ return true;
    } catch (e) { say(`${what}: 저장하지 못했어요 — ${errText(e)}`); return false; }
  };
  const num = (v) => Math.round(Number(String(v).replace(/[^\d.-]/g, "")));
  const editPay = (id, billPay) => {
    if (!live()) return needLive();
    const x = (billPay ? DB.billPays : DB.pays || []).find((z) => String(z.id) === String(id)); if (!x) return;
    const linkNote = billPay ? "청구 항목 결제 상태가 함께 바뀌어요" : x.tuitionIds && x.tuitionIds.length ? "수강료에 이어진 결제예요 — 금액을 고치면 수강료 결제 관리(🟢 · 🟠 · 🔴)가 바뀌어요" : "";
    modal(`<h2>${billPay ? "청구서 결제 줄 고치기" : "결제 줄 고치기"}</h2><div class="box"><div class="finrow"><span>${billPay ? "이름" : "결제"}</span><b>${E(x.name)}</b></div>`
      + fld("결제 금액", `<input id="fpA" type="number" min="1" step="1" value="${E(x.amount)}">`) + fld("결제일", `<input id="fpD" type="date" value="${E(dateOf(x.date))}">`)
      + fld(billPay ? "결제 방법" : "결제 수단", `<select id="fpH">${opts(howList(x.how), x.how, true)}</select>`)
      + (billPay ? "" : fld("비고", `<input id="fpM" type="text" value="${E(x.memo || "")}">`)) + `</div><div class="note finnote">${linkNote ? E(linkNote) + ". " : ""}실제 결제는 하지 않고 노션 기록만 고쳐요.</div>`
      + `<div class="actions"><span class="sp"></span><button class="btn" id="fnC">취소</button><button class="btn pri" id="fnO">노션에 저장</button></div>`, (m, close) => {
      m.querySelector("#fnC").onclick = close;
      m.querySelector("#fnO").onclick = async (ev) => {
        const amt = num(m.querySelector("#fpA").value); if (!(amt > 0)) { say("결제 금액은 1원 이상 정수로 넣어요"); return; }
        const props = { "결제 금액": amt }, d = m.querySelector("#fpD").value, h = m.querySelector("#fpH").value;
        if (d) props["결제일"] = d; if (h) props[billPay ? "결제 방법" : "결제 수단"] = h; if (!billPay) props["비고"] = m.querySelector("#fpM").value;
        ev.target.disabled = true; const ok = await save({ op: "update", db: billPay ? "청구 결제(학원) DB" : "결제(학원) DB", id: String(x.id), props }, close, billPay ? "청구서 결제 줄" : "결제 줄"); if (!ok) ev.target.disabled = false;
      };
    });
  };
  const newPay = () => {
    if (!live()) return needLive();
    modal(`<h2>결제 줄 넣기</h2><div class="box">` + fld("결제(이름)", `<input id="fpN" type="text" placeholder="예) 11월 임대료">`) + fld("구분", `<select id="fpK"><option>지출</option><option>매출</option></select>`)
      + fld("결제 금액", `<input id="fpA" type="number" min="1" step="1">`) + fld("결제일", `<input id="fpD" type="date" value="${E(typeof TODAY === "string" ? TODAY : "")}">`)
      + fld("결제 수단", `<select id="fpH">${opts(howList(""), "", true)}</select>`) + fld("비고", `<input id="fpM" type="text">`)
      + `</div><div class="note finnote">지출(임대료 · 교재 구입)이나 청구서 결제 합계를 매출로 옮겨 넣을 때 써요. 수강료 결제는 수강료 [결제]로 만들어요. 실제 결제는 하지 않고 노션에 기록만 해요.</div>`
      + `<div class="actions"><span class="sp"></span><button class="btn" id="fnC">취소</button><button class="btn pri" id="fnO">노션에 넣기</button></div>`, (m, close) => {
      m.querySelector("#fnC").onclick = close;
      m.querySelector("#fnO").onclick = async (ev) => {
        const name = m.querySelector("#fpN").value.trim(), amt = num(m.querySelector("#fpA").value), d = m.querySelector("#fpD").value, h = m.querySelector("#fpH").value;
        if (!name) { say("결제 이름을 넣어요"); return; } if (!(amt > 0)) { say("결제 금액은 1원 이상 정수로 넣어요"); return; } if (!d) { say("결제일을 넣어요"); return; } if (!h) { say("결제 수단을 골라요"); return; }
        const props = { 결제: name, "결제 금액": amt, 결제일: d, 구분: m.querySelector("#fpK").value, "결제 수단": h }, memo = m.querySelector("#fpM").value.trim(); if (memo) props["비고"] = memo;
        ev.target.disabled = true; const ok = await save({ op: "create", db: "결제(학원) DB", tmp: "tmp:" + uuid(), props }, close, "결제 줄"); if (!ok) ev.target.disabled = false;
      };
    });
  };
  const cart = (id) => {
    if (!live()) return needLive();
    if (typeof liveRequestDb === "function") liveRequestDb("bookfees", "청구서(학원) DB"); if (window.LQ_ACT_NAME) window.LQ_ACT_NAME["cart-progress-book"] = "담기";
    const b = (DB.bookfees || []).find((z) => String(z.id) === String(id)); if (!b) return;
    modal(`<h2>담기 — ${E(b.items || "청구서")}</h2><div class="box"><div class="finrow"><span>청구서</span><b>${E(b.items || "")}</b></div></div><div class="note finnote">노션 청구서 [담기]와 같아요 — 이 청구서의 교재를 진도관리에 담아요. 안내문은 보내지 않아요.</div><div class="actions"><span class="sp"></span><button class="btn" id="fnC">취소</button><button class="btn pri" id="fnO">담기</button></div>`, (m, close) => {
      m.querySelector("#fnC").onclick = close;
      m.querySelector("#fnO").onclick = async (ev) => { ev.target.disabled = true; try { const ok = await window.liveRequest("bookfees", [String(id)], { 요청: "cart-progress-book" }, "담기"); if (ok) close(); else ev.target.disabled = false; } catch (e) { ev.target.disabled = false; say(errText(e)); } };
    });
  };
  window.finAct = { pedit: (id) => editPay(id, false), bpedit: (id) => editPay(id, true), pnew: () => newPay(), cart };


  /* 결제 내역 탭 위 [＋ 결제 줄] 단추는 뺐다(대표 261124 "+결제줄 제거 — 나중에 + 활성화"). 넣기 창은 finAct.pnew 그대로 — 나중에 도구 줄 [+]에 붙임 */
})();
