/* 재무 3메뉴를 노션 메뉴 셋과 1:1로(261123 대표 · 노션 재무 구조 2안 — 노션 재무결과.md):
   수강료(만들고 알리기) 탭 4 = 클래스별 수강료 생성 · 다음 달 수강료 확인 · 수강료 발송함 · 다음 달 수강료 안내
   청구서(만들고 알리기) 탭 7 = 클래스 · 교재비 · 재료비 · 기타경비 · 전체 · 청구 줄 · 기타경비 목록
   결제 · 손익(옛 손익 분석) 탭 5 = 수강료 납부 · 청구서 납부 · 결제 내역 · 청구서 결제 · 그래프(칩 [손익 | 매출 | 지출 | 모두])
   이 파일은 화면 틀 · 탭 · 보기 · 그래프 · 확인 창만 정한다(서버를 몰라도 되는 것). 노션에 쓰는 쪽(결제 줄 · 생성 · 담기)은 window.finRun(종류, 값)이 정해지면 그쪽으로 간다 — 없으면 "서버 연결 전"이라고 알린다.
   발송(일괄 전송 · 안내문 전송)은 앱에 넣지 않는다(보기 · 상태만). */
(function () {
  if (typeof LISTS === "undefined" || typeof DB === "undefined") return;
  const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (_) { return d; } };
  const mm = (m) => +String(m).slice(5, 7);
  const nextM = () => mShift(thisM(), 1);
  const alive = (a) => (a || []).filter((x) => !x.del);
  const klass = () => alive(DB.classes).filter((c) => !(c.close && String(c.close) < TODAY));
  const enrolled = (c) => alive(DB.enrolls).filter((e) => e.classId === c.id && !(e.end && String(e.end) < TODAY) && safe(() => enStat(e), "") !== "end");
  const stuName = (id) => safe(() => nmStu(id), "");
  const clsName = (id) => safe(() => nmCls(id), "");
  const tuName = (t) => `${stuName(t.studentId)} · ${clsName(t.classId)} ${t.month}`;
  const etcSum = (t) => safe(() => tuEtc(t).reduce((a, z) => a + z.amt, 0), 0);
  const btn = (k, id, label, extra) => `@h:<button type="button" class="btn sm" data-fin="${k}" data-id="${esc(id)}" ${extra || ""}>${label}</button>`;
  const pill = (tone, t) => `@s:nc-${tone}|${t}`;
  const isLive = () => !!(window.LIVE && window.LIVE.loaded && window.APP_RAW);
  const base = (b, o) => Object.assign({}, b, { subs: null, filters: [], ftabs: null, noAdd: 1, noDel: true, byMonth: null, note: null, infoX: null }, o);

  /* ═════ 수강료 — 탭 4 ═════ */
  const T = LISTS.tuition;
  const tuNext = () => alive(DB.tuition).filter((t) => t.month === nextM());
  const sameSent = (t) => alive(DB.tuition).some((z) => z.studentId === t.studentId && z.month === t.month && z.sent);
  LISTS.tuition.subs = [["g", "클래스별 수강료 생성"], ["c", "다음 달 수강료 확인"], ["x", "수강료 발송함"], ["n", "다음 달 수강료 안내"]];
  LISTS.tuition.ftabs = null;
  /* ① 클래스별 수강료 생성 — 클래스(학원) DB, 운영 중 클래스. [월 수강료 생성]은 클래스마다 */
  LISTS.tuition_g = base(T, {
    title: "수강료", coll: "classes", unit: "개", ph: "클래스 검색", fields: [], ro: true, head: (c) => esc(c.name),
    help: "다음 달 수강료를 클래스마다 만들어요(노션 [월 수강료 생성]과 같아요). 수강료 · 월간 수업 총량 · 단위는 클래스 청구 설정에서 정해요. 월간 수업 총량이 비어 있으면 그 클래스는 만들지 않아요. 안내문은 보내지 않아요.",
    rows: () => klass(), empty: "운영 중인 클래스가 없어요",
    cols: [["클래스명", (c) => c.name], ["학생수", (c) => enrolled(c).length + "명"], ["수강료", (c) => (c.fee ? WON(c.fee) : "—")], ["월간 수업 총량", (c) => (c.qty ? String(c.qty) : "!비어 있음")], ["단위", (c) => c.unit || "—"],
      ["수강료 기간", () => nextM() + " (다음 달)"],
      ["해당월 수강료 생성 내역", (c) => { const n = enrolled(c).length, k = alive(DB.tuition).filter((t) => t.classId === c.id && t.month === nextM()).length; return `${mm(nextM())}월 ${k}/${n}${n && k >= n ? " ✅" : ""}`; }],
      ["실시간 처리 상태", () => "—"],
      ["월 수강료 생성", (c) => btn("gen", c.id, "월 수강료 생성", c.qty ? "" : "disabled title=\"월간 수업 총량이 비어 있으면 만들지 않아요\"")]],
  });
  /* ③(노션 ② 자리) 다음 달 수강료 확인 — 수강료 DB, 청구기간 = 다음 달. 실제 수업량 · 청구금액 조정 · 사유 · 메모를 고친다 */
  LISTS.tuition_c = base(T, {
    rows: () => tuNext(), byMonth: null, ro: false, empty: `${mm(nextM())}월 수강료가 아직 없어요 — [클래스별 수강료 생성]에서 만들어요`,
    help: "다음 달 수강료를 확인하고 조정해요. 결석 · 중도 등록은 실제 수업량을, 이번 달만 더하거나 뺄 때는 청구금액 조정과 사유를 넣어요. 청구금액 = 클래스 수강료 × 실제 수업량 ÷ 월간 수업 총량 + 조정. 반별 생성이 ⏳ 1/2처럼 보이면 빠진 반에서 [월 수강료 생성]을 눌러요.",
    cols: [["청구명", (t) => tuName(t)], ["등록", (t) => clsName(t.classId)], ["반별 생성", (t) => safe(() => tuByCls(t), "—")], ["실제 수업량", (t) => t.qty + "/" + (t.full || 8) + safe(() => clsQU(cls(t.classId)), ""), "qty"], ["단위", (t) => safe(() => cls(t.classId).unit, "—") || "—"],
      ["청구금액 조정", (t) => (t.adj ? WON(t.adj) : "—"), "adj"], ["청구금액", (t) => WON(safe(() => tuFee(t), 0))], ["메모", (t) => t._memo || "—", "_memo"]],
    fields: (T.fields || []).filter((f) => ["qty", "adj", "why", "_memo"].includes(f[0])),
  });
  /* ② 수강료 발송함 — 알림톡 발송함 DB, 구분 = 수강료, 기간이 오늘 이후. 보기 · 상태만(일괄 전송은 노션에서) */
  LISTS.tuition_x = base(T, {
    title: "수강료", coll: "tuition", unit: "개", ph: "발송함 검색", fields: [], ro: true, head: (g) => esc(clsName(g.classId) + " " + g.month), empty: "다음 달 이후 수강료 발송함이 없어요",
    help: "클래스 · 달마다 수강료 발송함이 하나예요. 일괄 전송은 노션 [수강료 발송함]에서 해요(앱은 상태만 보여 줘요). 두 반 이상 다니는 학생은 한 통으로 나가요.",
    rows: () => { const m = new Map(); alive(DB.tuition).filter((t) => t.month > thisM()).forEach((t) => { const k = t.classId + "|" + t.month; if (!m.has(k)) m.set(k, { id: "tx" + k, classId: t.classId, month: t.month, n: 0, sent: 0 }); const g = m.get(k); g.n++; if (t.sent) g.sent++; }); return [...m.values()].sort((a, b) => b.month.localeCompare(a.month) || clsName(a.classId).localeCompare(clsName(b.classId), "ko")); },
    cols: [["이름", (g) => `${clsName(g.classId)} ${mm(g.month)}월 수강료`], ["클래스", (g) => clsName(g.classId)], ["기간", (g) => g.month], ["진행 상황", (g) => `${g.sent}/${g.n} 보냄`], ["일괄 전송", () => "노션에서"], ["실시간 처리 상태", (g) => (g.sent >= g.n ? pill("green", "✅ 모두 보냄") : g.sent ? pill("yellow", "⏳ 일부 보냄") : pill("gray", "⏳ 대기"))]],
  });
  /* ④ 다음 달 수강료 안내 — 수강료 DB, 다음 달. 안내문 전송 · 전송 내역 · 실시간 처리상태 · 같은 달 보냄(보기만) */
  LISTS.tuition_n = base(T, {
    fields: [], ro: true, rows: () => tuNext(), byMonth: null, empty: `${mm(nextM())}월 수강료가 아직 없어요`,
    help: "다음 달 수강료 안내 상태예요. 한 학생만 다시 보낼 때는 노션 수강료 페이지의 [안내문 전송]을 써요(앱은 발송하지 않아요).",
    cols: [["청구명", (t) => tuName(t)], ["등록", (t) => clsName(t.classId)], ["청구금액", (t) => WON(safe(() => tuFee(t), 0))], ["안내문 전송", (t) => (t.sent ? pill("green", "✅ 완료") : pill("gray", "⚪ 대기"))], ["전송 내역", (t) => (t.sent ? "전송 완료" : "—")], ["실시간 처리상태", (t) => (t.sent ? "✅ 완료" : "—")], ["같은 달 보냄", (t) => (sameSent(t) ? "✓" : "—")]],
  });

  /* ═════ 청구서 — 탭 7 ═════ */
  const B = LISTS.bill;
  LISTS.bill.subs = [["g", "클래스"], ["b", "교재비"], ["m", "재료비"], ["e", "기타경비"], ["a", "전체"], ["l", "청구 줄"], ["c", "기타경비 목록"]];
  LISTS.bill_g = base(B, {
    title: "청구서", coll: "classes", unit: "개", ph: "클래스 검색", fields: [], ro: true, head: (c) => esc(c.name), rows: () => klass(), empty: "운영 중인 클래스가 없어요",
    help: "청구서는 클래스에서 시작해요. [교재비 생성]은 수강 중인 등록 가운데 청구서가 없는 학생마다 한 장씩 만들고(교재를 배부하지는 않아요), [기타경비 청구]는 한 번 받는 기타경비를 학생마다 청구해요. 안내문은 보내지 않아요.",
    cols: [["클래스명", (c) => c.name], ["학생수", (c) => enrolled(c).length + "명"],
      ["교재비 생성 여부", (c) => { const es = enrolled(c), miss = es.filter((e) => !alive(DB.bookfees).some((b) => b.studentId === e.studentId && b.classId === c.id)).length; return es.length ? (miss ? pill("yellow", `청구서 없는 학생 ${miss}명`) : pill("green", "모두 있음")) : "—"; }],
      ["교재비 생성 · 기타경비 청구", (c) => btn("bill", c.id, "교재비 생성") + btn("etc", c.id, "기타경비 청구").slice(3)]],
  });
  /* [담기] — 청구서 한 줄의 교재를 진도관리에 담아요(노션 청구서 [담기]) */
  ["bill_b"].forEach((k) => { if (LISTS[k] && LISTS[k].cols) LISTS[k] = Object.assign({}, LISTS[k], { cols: [...LISTS[k].cols, ["담기", (x) => btn("cart", x.id, "담기")]] }); });
  if (LISTS.bill_l) LISTS.bill_l = Object.assign({}, LISTS.bill_l, { title: "청구서", cols: [...LISTS.bill_l.cols.filter((c) => c[0] !== "결제"), ["결제금액", (x) => (x.paidOn ? WON(x.amount) : "—")], ["결제 상태", (x) => (x.paidOn ? "🟢결제 완료" : "!미납")]] });

  /* ═════ 결제 · 손익 — 탭 7 ═════ */
  const P = LISTS.profit, C = LISTS.costs;
  const dueTu = () => alive(DB.tuition).filter((t) => t.pay !== "완료");
  const payRows = () => {
    const der = alive(DB.tuition).filter((t) => t.paidOn && (t.pay === "완료" || t.pay === "과오납" || +t.got)).map((t) => ({ id: "tp" + t.id, name: tuName(t), kind: "매출", date: t.paidOn, how: t.how || "", amount: +t.got || safe(() => tuAmt(t), 0), memo: "수강료", _der: 1 }));
    return [...der, ...alive(DB.costs)].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  };
  const monthRows = () => safe(() => P.rows(), []).slice().reverse(); /* 오래된 달 → 지금 */
  LISTS.profit.subs = [["t", "수강료 납부"], ["q", "청구서 납부"], ["c", "결제 내역"], ["r", "청구서 결제"], ["g", "그래프"]];
  LISTS.profit.title = "결제 · 손익";
  LISTS.profit.ftabs = null;
  /* 수강료 납부 — 수강료 DB, 청구기간 = 고른 달, 결제 관리가 결제 완료가 아닌 것 */
  LISTS.profit_t = base(T, {
    title: "결제 · 손익", fields: [], ro: true, rows: () => dueTu(), byMonth: (t) => t.month, empty: "이 달에 아직 다 안 낸 수강료가 없어요",
    help: "아직 다 안 낸 수강료예요. [결제]는 노션 수강료의 [결제] 버튼과 같아요 — 청구금액 + 매달 기타경비 금액 전액으로 결제 기록 한 줄을 만들고 이 수강료에 이어요. 일부만 받았거나 더 받았으면 결제 내역에서 금액을 고쳐요. 실제 결제나 알림톡은 하지 않아요.",
    note: (rows) => (rows.length ? `${rows.length}건 · 남은 ${WON(rows.reduce((a, t) => a + safe(() => tuAmt(t), 0) - (+t.got || 0), 0))}` : "다 냈어요"),
    cols: [["결제 관리", (t) => (t.pay === "과오납" ? pill("orange", "🟠 과오납") : pill("red", "🔴 미납"))], ["청구명", (t) => tuName(t)], ["청구금액", (t) => WON(safe(() => tuFee(t), 0))], ["기타경비 금액", (t) => (etcSum(t) ? WON(etcSum(t)) : "—")], ["결제금액", (t) => (+t.got ? WON(+t.got) : "—")], ["결제 수단", (t) => t.how || "—"], ["결제", (t) => btn("pay", t.id, "결제")]],
  });
  /* 청구서 납부 — 청구 항목 DB, 결제 상태가 결제 완료가 아닌 것(교습비 줄은 청구 항목이 아님) */
  LISTS.profit_q = base(LISTS.charges, {
    title: "결제 · 손익", fields: [], ro: true, roRow: () => true, infoX: null, fieldsOf: null,
    /* 실제 자료: 노션 청구 항목 줄 그대로(줄 id = 노션 id — [결제]가 그 줄에 결제를 이어요). 예시: 청구서에서 다시 만든 줄 */
    rows: () => { if (isLive() && Array.isArray(DB._appvCharges)) return DB._appvCharges.filter((x) => !x.del && x.kind !== "교습비" && !x.paidOn); safe(() => chargesSync()); return alive(DB.charges).filter((x) => x.kind !== "교습비" && !x.paidOn); }, byMonth: (x) => x.month, empty: "이 달에 아직 다 안 낸 청구 줄이 없어요",
    help: "아직 다 안 낸 청구서 줄이에요(교재비 · 재료비 · 기타경비). [결제]는 청구 결제에 한 줄을 만들어요. 알림톡은 보내지 않아요.",
    note: (rows) => (rows.length ? `${rows.length}줄 · ${WON(rows.reduce((a, x) => a + (+x.amount || 0), 0))}` : "다 냈어요"),
    cols: [["이름", (x) => `${stuName(x.studentId)} · ${x.name || x.item || ""}`], ["등록", (x) => clsName(x.classId)], ["청구 월", (x) => x.month || "—"], ["종류", (x) => x.kind], ["교재비 금액", (x) => WON(x.amount)], ["결제금액", () => "—"], ["결제", (x) => btn("cpay", x.id, "결제")]],
  });
  /* 결제 내역 — 결제 DB 이번 달, 구분 필터. [＋ 결제 줄]로 지출 · 청구서 결제 매출을 넣는다 */
  LISTS.profit_c = base(C, {
    title: "결제 · 손익", noAdd: 0, rows: () => (isLive() && Array.isArray(DB.pays) ? DB.pays.filter((x) => !x.del) : payRows()), byMonth: (x) => (typeof mKey === "function" ? mKey(x.date) : String(x.date).slice(0, 7).replace("-", ".")), roRow: (r) => !!r._der,
    help: "그 달 결제 기록이에요(노션 결제(학원) DB). [＋ 결제 줄]로 지출(임대료 · 교재 구입)이나 청구서 결제를 매출로 옮겨 넣고, 줄을 눌러 결제일 · 수단 · 금액 · 비고를 고쳐요. 수강료 [결제]로 생긴 줄은 수강료 칸에서 고쳐요.",
    cols: [["결제일", (x) => D10(x.date), "date"], ["결제", (x) => x.name, "name"], ["구분", (x) => (x.kind === "지출" ? pill("red", "지출") : pill("blue", "매출")), "kind"], ["결제 수단", (x) => x.how || "—", "how"], ["결제 금액", (x) => WON(x.amount), "amount"], ["비고", (x) => x.memo || "—", "memo"], ["결제 줄 고치기", (x) => (isLive() && !x._der ? btn("pedit", x.id, "고치기") : "")]],
    ftabs: [["지출", "지출", (x) => x.kind === "지출"], ["매출", "매출", (x) => x.kind === "매출"]], note: (rows) => `매출 ${WON(rows.filter((x) => x.kind === "매출").reduce((a, x) => a + x.amount, 0))} · 지출 ${WON(rows.filter((x) => x.kind === "지출").reduce((a, x) => a + x.amount, 0))}`,
    fields: C.fields, blank: () => ({ id: uid("co"), name: "새 결제", kind: "지출", date: TODAY, how: "카드", amount: 0, memo: "" }),
  });
  /* 청구서 결제 — 청구 결제 DB, 고른 달 결제일. 합계 줄(이 합계를 결제 내역에 매출 한 줄로 옮긴다) */
  LISTS.profit_r = base(LISTS.charges, {
    title: "결제 · 손익", fields: [], ro: true, roRow: () => true, infoX: null, fieldsOf: null,
    rows: () => { if (isLive() && Array.isArray(DB.billPays)) return DB.billPays.filter((x) => !x.del).map((x) => ({ id: x.id, studentId: x.studentId, classId: x.classId, name: x.book || x.name, _n: x.name, paidOn: x.date, amount: x.amount, how: x.how, kind: "청구 결제" })).sort((a, b) => String(b.paidOn).localeCompare(String(a.paidOn))); safe(() => chargesSync()); return alive(DB.charges).filter((x) => x.kind !== "교습비" && x.paidOn).map((x) => Object.assign({}, x, { id: "cr" + x.id })).sort((a, b) => String(b.paidOn).localeCompare(String(a.paidOn))); },
    byMonth: (x) => String(x.paidOn).slice(0, 7).replace("-", "."), empty: "이 달 청구서 결제가 없어요",
    help: "청구서(교재비 · 재료비 · 기타경비)로 받은 결제예요(노션 청구 결제(학원) DB). 이 합계는 결제 내역의 손익에 자동으로 들어가지 않아요 — 달 끝에 결제 내역에 매출로 한 줄 넣어요.",
    note: (rows) => `합계 ${WON(rows.reduce((a, x) => a + (+x.amount || 0), 0))} · ${rows.length}건`,
    cols: [["이름", (x) => x._n || `${stuName(x.studentId)} · ${x.name || x.item || ""}`], ["결제상태", () => "🟢결제 완료"], ["결제일", (x) => D10(x.paidOn)], ["교재", (x) => x.name || x.item || "—"], ["결제 방법", (x) => x.how || "—"], ["결제 금액", (x) => WON(x.amount)], ["결제 줄 고치기", (x) => (isLive() && x._n !== undefined ? btn("bpedit", x.id, "고치기") : "")]],
  });
  /* 그래프 = 한 탭, 칩 [손익 | 매출 | 지출 | 모두](대표 261123 — 노션은 보기 3개 그대로, 앱만 칩 한 탭). 결제 DB 월별 선 그래프 + 고른 칩에 맞춘 달별 표 */
  const SER = { p: { name: "손익", tone: "green", pick: (r) => r.net }, s: { name: "매출", tone: "blue", pick: (r) => r.tu + r.ot }, x: { name: "지출", tone: "red", pick: (r) => r.out } };
  const GM = [["p", "손익"], ["s", "매출"], ["x", "지출"], ["a", "모두"]];
  const chart = (series, labels, title) => {
    const all = series.flatMap((s) => s.vals), W = 760, H = 210, L = 64, R = 16, Tp = 16, Bt = 30, n = labels.length, hi = Math.max(0, ...all), lo = Math.min(0, ...all), span = hi - lo || 1;
    const y = (v) => Tp + (1 - (v - lo) / span) * (H - Tp - Bt), x = (i) => L + (n > 1 ? i * (W - L - R) / (n - 1) : 0);
    const fm = (v) => (Math.abs(v) >= 10000 ? Math.round(v / 10000).toLocaleString("ko-KR") + "만" : String(Math.round(v)));
    const grid = [0, 1, 2, 3].map((k) => { const v = lo + span * k / 3; return `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="fcg"/><text x="${L - 8}" y="${y(v) + 4}" class="fct" text-anchor="end">${fm(v)}</text>`; }).join("");
    const zero = lo < 0 ? `<line x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}" class="fcz"/>` : "";
    const lines = series.map((s) => `<polyline points="${s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")}" class="fcl t-${s.tone}"/>` + s.vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="fcd t-${s.tone}"><title>${labels[i]} ${s.name} ${WON(v)}</title></circle>`).join("")).join("");
    const xl = labels.map((l, i) => (n <= 13 || i % 2 === 0 ? `<text x="${x(i)}" y="${H - 8}" class="fct" text-anchor="middle">${mm(l)}월</text>` : "")).join("");
    const lg = series.length > 1 ? `<span class="fcleg">${series.map((s) => `<i class="t-${s.tone}"></i>${s.name}`).join("")}</span>` : "";
    return `<div class="finchart"><div class="fch"><b>${title}</b><small>월별 · 결제 금액 합계</small>${lg}</div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${title} 월별 그래프">${grid}${zero}${lines}${xl}</svg></div>`;
  };
  LISTS.profit_g = base(P, {
    title: "결제 · 손익", cal: true, coll: "profit", ro: true, rows: () => [], fields: [], help: "결제(학원) DB를 달마다 모아 선 그래프로 봐요. 칩으로 손익 · 매출 · 지출을 고르고, [모두]는 세 줄을 겹쳐 봐요(노션은 보기 셋, 앱은 칩 한 탭 — 결과는 같아요). 숫자는 [결제 내역]에서 고쳐요.",
    calFn: (Lx, st) => {
      const gm = (st && st.gm) || "p", keys = gm === "a" ? ["s", "x", "p"] : [gm], rs = monthRows().slice(-12), labels = rs.map((r) => r.m);
      const chips = `<div class="vseg subseg finchips" role="group" aria-label="그래프 고르기">${GM.map(([k, t]) => `<button type="button" data-fin="gmode" data-id="${k}" class="${gm === k ? "on" : ""}" aria-pressed="${gm === k}">${t}</button>`).join("")}</div>`;
      const th = keys.map((k) => `<th class="n">${SER[k].name}</th>`).join(""), tr = rs.slice().reverse().map((r) => `<tr><td>${r.m}</td>${keys.map((k) => `<td class="n">${r.any ? WON(SER[k].pick(r)) : "—"}</td>`).join("")}</tr>`).join("");
      const title = gm === "a" ? "손익 · 매출 · 지출" : SER[gm].name;
      return `<div class="finwrap">${chips}${chart(keys.map((k) => ({ name: SER[k].name, tone: SER[k].tone, vals: rs.map(SER[k].pick) })), labels, title)}<table class="t finsum"><thead><tr><th>달</th>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
    },
  });

  /* ═════ 단추 확인 창 — 노션에 있는 값만(생성 내역 · 실시간 처리 상태 · 수강료 기간 · 금액) ═════ */
  const run = (kind, ctx, close) => {
    if (typeof window.finRun === "function") { try { return window.finRun(kind, ctx, close); } catch (e) { toast(String(e.message || e)); return; } }
    close(); toast("노션에 쓰는 연결은 다음 단계에서 켜요 — 지금은 확인 창까지만 보여요");
  };
  const dlg = (title, rows, note, okLabel, kind, ctx) => modal(`<h2>${title}</h2><div class="box">${rows.map(([k, v]) => `<div class="finrow"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div><div class="note finnote">${note}</div><div class="actions"><span class="sp"></span><button class="btn" id="fnC">취소</button><button class="btn pri" id="fnO">${okLabel}</button></div>`, (m, close) => { m.querySelector("#fnC").onclick = close; m.querySelector("#fnO").onclick = () => run(kind, ctx, close); });
  const act = {
    gen: (c) => { const n = enrolled(c).length, k = alive(DB.tuition).filter((t) => t.classId === c.id && t.month === nextM()).length; dlg(`월 수강료 생성 — ${esc(c.name)}`, [["수강료 기간", `${nextM()} <small>(비우면 다음 달)</small>`], ["해당월 수강료 생성 내역", `${mm(nextM())}월 ${k}/${n}`], ["월간 수업 총량", c.qty ? `${c.qty} ${esc(c.unit || "")}` : "비어 있음"]], "수강 중인 등록마다 수강료 줄을 노션에 만들어요. 안내문은 보내지 않아요. 월간 수업 총량이 비어 있으면 만들지 않아요.", "월 수강료 생성", "tuition-create", { classId: c.id }); },
    pay: (t) => { const amt = safe(() => tuFee(t), 0), etc = etcSum(t); dlg("결제", [["수강료", esc(tuName(t))], ["청구금액", WON(amt)], ["매달 기타경비 금액", etc ? WON(etc) : "—"], ["결제 기록 금액", WON(amt + etc)]], "노션 결제 기록 한 줄을 만들고 이 수강료에 이어요. 실제 결제나 알림톡은 하지 않아요. 일부만 받았으면 만든 뒤 결제 내역에서 금액을 고쳐요.", "결제 기록 만들기", "tuition-pay", { tuitionId: t.id }); },
    cpay: (x) => dlg("청구서 결제", [["청구 줄", esc(`${stuName(x.studentId)} · ${x.name || x.item || ""}`)], ["금액", WON(x.amount)]], "청구 결제에 결제 한 줄을 남겨요. 실제 결제나 알림톡은 하지 않아요.", "결제 기록 만들기", "charge-pay", { chargeId: x.id }),
    bill: (c) => { const es = enrolled(c), miss = es.filter((e) => !alive(DB.bookfees).some((b) => b.studentId === e.studentId && b.classId === c.id)).length; dlg(`교재비 생성 — ${esc(c.name)}`, [["수강 중 등록", es.length + "명"], ["청구서 없는 학생", miss + "명"]], "수강 중인 등록 가운데 청구서가 없는 학생마다 한 장씩 만들어요. 교재를 배부하지는 않고, 안내문도 보내지 않아요.", "교재비 생성", "bill-create", { classId: c.id }); },
    etc: (c) => dlg(`기타경비 청구 — ${esc(c.name)}`, [["수강 중 등록", enrolled(c).length + "명"], ["붙은 기타경비", alive(DB.etcs).filter((e) => (e.classIds || []).includes(c.id)).length + "개"]], "한 번 받기로 한 기타경비를 학생마다 청구서로 만들어요. 같은 달 · 같은 기타경비는 다시 눌러도 두 번 만들어지지 않아요. 안내문은 보내지 않아요.", "기타경비 청구", "etc-charge", { classId: c.id }),
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-fin]"); if (!b || b.disabled) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.fin, id = b.dataset.id;
    if (k === "gmode") { if (activeTab) { activeTab.state.gm = id; render(); } return; }
    if (window.finAct && window.finAct[k]) { window.finAct[k](id, b); return; }
    const row = k === "pay" ? DB.tuition.find((x) => x.id === id) : k === "cpay" ? DB.charges.concat(DB._appvCharges || []).find((x) => x.id === id) : DB.classes.find((x) => x.id === id);
    if (row && act[k]) act[k](row);
  }, true);
  /* 결제 내역은 처음 열 때 구분 전체(노션 결제 내역은 구분 필터가 비어 있음) */
  document.addEventListener("click", (e) => { const s = e.target.closest && e.target.closest("#view [data-sub=\"c\"]"); if (s && typeof curScr === "function" && curScr() === "profit" && activeTab) activeTab.state.ft = "all"; }, true);
})();
