/* 오른쪽 창 모듈(panel.js) — 창 하나 = 정의(spec) 하나. 그리는 함수는 여기 하나(앱·모듈 페이지 같이 씀).
 * 창 = { head:{icon | dot, name | nameHtml, draft, chipsHtml, state:{t,tone}, status:[{t,tone}], lock, help, notion, belong, info:[글]},
 *        tabs:[{id,label,n,disabled}], tab:"id",
 *        boxes:[{title, help, right:html, body:html | fields:[칸] | rows:[줄] | cards:html | mini:html}],
 *        foot:{del:true, undo:true, save:"클래스 저장", saveOn:false} }
 * 선택 전 = { todo:{groups:[{k,name,why,rows:[{t,sub}]}], on, summary:[[이름,값]], list:{name, rows:[{t,badge,tone,sub}], more}} }
 * 칸 = {k, label, type:"text|date|range|select|multi|num|tel|memo|seg|sw|color", value, items, help, tip}
 * 부품 이름은 앱 CSS와 같다(.phead .pinfo .sub / .ptabs .ptb / .box h3 / .hfgrid .hfpair / .ttrows .ttrow / .actions / .tdp). */
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = '<svg class="i s" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  const IC_ = {
    help: P + '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    right: P + '<path d="M5 12h14M12 5l7 7-7 7"/></svg>', rightc: P + '<path d="M9 18l6-6-6-6"/></svg>',
    ext: P + '<path d="M7 17 17 7M7 7h10v10"/></svg>', trash: P + '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    save: P + '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    undo: P + '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>', check: P + '<path d="M20 6 9 17l-5-5"/></svg>',
    search: P + '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'
  };
  const help = t => t ? `<span class="qhelp" tabindex="0" role="note" aria-label="${esc(t)}" data-help="${esc(t)}">${IC_.help}</span>` : "";
  const pill = s => `<span class="pill nc-${esc(s.tone || "gray")}">${esc(s.t)}</span>`;

  // 1. 머리 — 모든 창이 같은 틀(기준 4장 F1). 화면은 재료만 넘긴다.
  //   앞: icon(HTML) 또는 dot(색) · 이름: name(글) 또는 nameHtml(입력칸 등) · 칩: draft(작성 중) · chipsHtml(화면이 생성한 알약) · state{t,tone} · status[{t,tone}]
  //   자물쇠: lock(HTML) · help(글) · notion(단추에 붙일 속성 글자, 예: data-notion="students") · 2줄 belong(글) · 3줄 info[글…]
  function head(h) {
    h = h || {};
    const lead = h.dot ? `<span class="phi"><i class="cdot" style="background:${esc(h.dot)}"></i></span>` : h.icon ? `<span class="phi">${h.icon}</span>` : "";
    const nm = h.nameHtml != null ? `<span class="phn">${h.nameHtml}</span>` : `<span class="phn" title="${esc(h.name || "")}">${esc(h.name || "")}</span>`;
    const chips = (h.draft ? '<span class="pill w">작성 중</span>' : "") + (h.chipsHtml || "") + (h.state && h.state.t ? `<span class="spill nc-${esc(h.state.tone || "gray")} hstate">${esc(h.state.t)}</span>` : "") + (h.status || []).map(pill).join("") + (h.lock ? `<span class="hlock">${h.lock}</span>` : "") + help(h.help);
    const n = h.notion ? `<button type="button" class="hnot" ${h.notion} title="노션에서 열기" aria-label="노션에서 열기">${typeof IC === "function" ? IC("notion", "s") : "N"}</button>` : "";
    const info = (h.info || []).filter(t => t != null && t !== "").map((t, i) => `${i ? '<span class="phdot">·</span>' : ""}<small>${esc(t)}</small>`).join("");
    // 261118: tools(HTML) = 머리 오른쪽 위 작은 단추(노션 단추 앞) — 그 창 하나에 하나뿐인 동작(시간표 [수업 추가] 등)
    return `<div class="phead${lead ? "" : " noic"}"><div class="pt"><h2>${lead}${nm}${chips ? `<span class="hchips">${chips}</span>` : ""}<span class="hsp"></span>${h.tools || ""}${n}</h2><div class="pinfo">${h.belong ? esc(h.belong) : ""}</div><div class="sub">${info}</div></div></div>`;
  }
  // 1-1. 두 줄 이름은 가장 긴 줄만큼만 폭을 잡는다 — 칩이 이름 첫 줄 끝에서 늘 같은 간격에 오게(머리가 그려지거나 폭이 바뀔 때마다)
  function fitHeads() {
    document.querySelectorAll(".phead h2 .phn").forEach(nm => {
      if (nm.querySelector("input")) return;
      nm.style.width = "";
      const bx = nm.getBoundingClientRect(); if (!bx.width) return;
      const rg = document.createRange(); rg.selectNodeContents(nm);
      const rs = [...rg.getClientRects()].filter(q => q.top < bx.bottom - 2); if (!rs.length) return;
      const w = Math.max(...rs.map(q => q.right)) - bx.left;
      if (w < bx.width - 1) nm.style.width = Math.ceil(w) + 1 + "px";
    });
  }
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
    let t = 0; const later = () => { if (!t) t = requestAnimationFrame(() => { t = 0; fitHeads(); }); };
    const start = () => { new MutationObserver(later).observe(document.body, { childList: true, subtree: true }); addEventListener("resize", later); if (typeof ResizeObserver !== "undefined") { const ro = new ResizeObserver(later); new MutationObserver(() => document.querySelectorAll(".phead").forEach(e => { if (!e.__ro) { e.__ro = 1; ro.observe(e); } })).observe(document.body, { childList: true, subtree: true }); } later(); };
    document.body ? start() : addEventListener("DOMContentLoaded", start);
  }
  // 2. 탭 바(탭이 없는 창도 '정보' 하나로 같은 자리). 탭 = {id, label, n, todo, disabled, later, dot, mark}
  //    창 탭은 이름만 쓴다 — 숫자(n · 할 일 수)는 그리지 않는다(대표 261117 "탭 숫자 다 없애줘 … 없는 걸로 통일"). 숫자는 창 안 내용과 머리에서 본다.
  //    아직 못 쓰는 탭(later = 준비 중)은 보이지 않는다. 폭 = 글자 폭 + 사이 16, 넘치면 가로로 민다(기준 5장 F2).
  function tabs(ts, on, attr) {
    ts = (ts || []).filter(t => !t.later); ts = ts.length ? ts : [{ id: "info", label: "정보" }]; attr = attr || "ptab";
    return `<div class="ptabs" role="tablist">${ts.map(t => `<button type="button" class="ptb ${t.id === on ? "on" : ""}" data-${attr}="${esc(t.id)}" ${t.disabled ? "disabled" : ""}>${esc(t.label)}${t.dot || ""}${t.mark || ""}</button>`).join("")}</div>`;
  }
  // 3. 상자: 제목 + (?) + 오른쪽(링크·단추) + 내용
  function box(b) {
    let body = b.body || "";
    if (b.fields) body = `<div class="hfgrid">${b.fields.map((f, i) => f.type === "range" ? `<div class="hfh" data-pf="${i}"></div>` : `<div class="hfh" data-pf="${i}"></div>`).join("")}</div>`;
    if (b.rows) body = rows(b.rows);
    return `<div class="box"><h3>${esc(b.title || "")}${help(b.help)}<span class="sp"></span>${b.right || ""}</h3>${body}</div>`;
  }
  // 3-1. 정보 탭 상자 나누기: 칸 이름 목록을 [기본] + 묶음(secs: [{title, keys, hide, pre(row) 묶음 맨 위 HTML, right(row) 제목 오른쪽}])으로 나눠 상자 여러 개로. title 은 글자 또는 줄을 받아 글자를 돌려주는 함수
  function infoBoxes(keys, secs, row, helpText) {
    secs = secs || [];
    const inSec = new Set(secs.flatMap(z => z.keys));
    const grid = ks => `<div class="hfgrid">${ks.map(k => `<div class="hfh" data-hf="${esc(k)}"></div>`).join("")}</div>`;
    const main = keys.filter(k => !inSec.has(k));
    return (main.length ? box({ title: "기본", help: helpText, body: grid(main) }) : "") + secs.map(z => { const ks = z.keys.filter(k => keys.includes(k)); const pre = z.pre ? z.pre(row) : "", post = z.post ? z.post(row) : ""; /* post = 칸 뒤에 붙는 화면 재료(학생1 형제자매) */ return (ks.length || pre || post) && !z.hide ? box({ title: typeof z.title === "function" ? z.title(row) : z.title, help: z.help, right: z.right ? z.right(row) : "", body: pre + (ks.length ? grid(ks) : "") + post }) : ""; }).join("");
  }
  // 3-2. 한 줄에 두 칸(숫자 + 단위): pairs = [[앞 칸, 뒤 칸, 갈래]] — 갈래 "" = 뒤 칸 좁게([우선] 단추 비율), "half" = 반반
  function pairUp(root, pairs) {
    (pairs || []).forEach(([a, b, kind]) => { const ha = root.querySelector(`[data-hf="${a}"]`), hb = root.querySelector(`[data-hf="${b}"]`); if (ha && hb && !ha.closest(".qupair")) { const w = document.createElement("div"); w.className = "qupair " + (kind || ""); ha.parentNode.insertBefore(w, ha); w.append(ha, hb); } });
  }
  // 6-1. 상태별 묶음: groups = [{key, pill(알약 클래스), count, unit, canFold, fold, body(HTML)}] — 머리(알약 + 개수 + 접기 화살표) + 내용
  function groups(gs) {
    return `<div class="pgsecs">${gs.map(g => `<div class="pgsec"><button type="button" class="pgsh" data-pgfold="${esc(g.key)}" aria-expanded="${!g.fold}"><span class="spill ${esc(g.pill)}">${esc(g.key)}</span><span class="hint">${g.count}${esc(g.unit || "")}</span><span class="sp"></span>${g.canFold && typeof IC === "function" ? IC(g.fold ? "down" : "up", "s") : ""}</button>${g.fold ? "" : g.body || ""}</div>`).join("")}</div>`;
  }
  // 6-2. 교재 줄(두 줄): 제목 … 그룹|개별 알약 / 진도율 막대 · % · 최근 범위 · 덧글. 줄 앞에는 아무것도 두지 않는다. 누르면 창 안 이동(data-drill)
  //   rows = [{drill, title | titleHtml, modeHtml, pct(숫자 또는 ""), range, notes:[글자…], ro(다른 창 안의 요약 줄), attr(누를 때 속성 — 있으면 이동 대신 펼치기), on(펼친 줄), more(펼친 내용 HTML)}]
  function bookRows(rs) {
    return `<div class="ttrows">${rs.map(r => `<div class="ttrow${r.ro ? " ro" : ""}${r.on ? " on" : ""} bk2 dgo2" ${r.attr || `data-drill="${esc(r.drill)}"`} title="${r.attr ? (r.on ? "눌러서 접기" : "눌러서 펼치기") : "눌러서 이 진도 보기"}">${r.titleHtml != null ? `<span class="t">${r.titleHtml}</span>` : `<span class="t" title="${esc(r.title)}">${esc(r.title)}</span>`}${r.modeHtml || ""}<span class="l2">${r.pct !== "" && r.pct != null ? `<span class="pbar"><i style="width:${r.pct}%"></i></span><span class="r2">${r.pct}%</span>` : ""}${r.range ? `<span class="r2">${esc(r.range)}</span>` : ""}${(r.notes || []).filter(Boolean).map(t => `<span class="r2">${esc(t)}</span>`).join("")}</span>${r.more || ""}</div>`).join("")}</div>`;
  }
  // 6. 줄 목록: 이름 ……… 정보 · 꼬리표 ›
  //   줄 = {attr(누를 때 쓸 속성 글자, 예: data-gobook="id"), title(툴팁), cls(덧붙는 클래스), check{attr,on}(체크 줄), lead(앞 그림 HTML), dot(색), t(이름), sub(정보 글) | subHtml, tag(꼬리표), trail(뒤 알약 HTML), arrow(false = 이동 없음)}
  //   empty = 빈 목록 안내 글 · opt = {ro(보기만 하는 목록), emptyRow(빈 목록도 목록 틀 안의 한 줄로)}
  const ROW_STACK = 28;
  function rows(rs, empty, opt) {
    opt = opt || {};
    const arrow = typeof IC === "function" ? IC("right", "s") : IC_.rightc;
    if (!rs.length) return opt.emptyRow ? `<div class="ttrows${opt.ro ? " ro" : ""}"><div class="ttrow ro"><span class="t none">${esc(empty || "없음")}</span></div></div>` : `<div class="hint empty">${esc(empty || "아직 없어요")}</div>`;
    /* 이름 + 정보 글이 합쳐 길면(ROW_STACK자 넘음) 이름 = 첫 줄 · 정보 = 아래 줄(이름이 세 줄로 꺾이지 않게, 관리앱-기준.md "줄 목록 글") */
    const subTxt = r => r.subHtml != null ? String(r.subHtml).replace(/<[^>]*>/g, "") : r.sub != null ? String(r.sub) : "";
    return `<div class="ttrows${opt.ro ? " ro" : ""}">${rs.map(r => { const tag = r.check ? "label" : "div"; const st = !!(r.stack || (subTxt(r) && String(r.t || "").length + subTxt(r).length > ROW_STACK)); return `<${tag} class="ttrow${st ? " stack" : ""}${r.cls ? " " + esc(r.cls) : ""}"${r.attr ? " " + r.attr : r.go ? ` data-go="${esc(r.go)}"` : ""}${r.title ? ` title="${esc(r.title)}"` : ""}>${r.check ? `<input type="checkbox" ${r.check.attr || ""} ${r.check.on ? "checked" : ""}>` : ""}${r.lead || ""}${r.dot ? `<i class="cdot" style="background:${esc(r.dot)}"></i>` : ""}${st ? `<span class="tt2">` : ""}<span class="t">${esc(r.t)}</span>${r.subHtml != null ? `<span class="hint">${r.subHtml}</span>` : r.sub != null ? `<span class="hint">${esc(r.sub)}</span>` : ""}${st ? "</span>" : ""}${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}${r.trail || ""}${r.arrow === false || r.check ? "" : arrow}</${tag}>`; }).join("")}</div>`;
  }
  // 6-3. 반복 줄 칸(보기 ↔ 편집): 학생마다 · 항목마다 같은 칸이 줄로 반복되는 묶음(시험 성적 등). 기준 관리앱-기준.md 5장 "반복 줄 칸"
  //   평소 = 정돈된 글(머리줄에 칸 이름 한 번, 숫자 오른쪽 정렬, 빈 값 "—"), 묶음 머리 [ㅇㅇ 편집] → 모든 줄이 입력칸(같은 열 폭) · [취소] [✓ 편집 완료]
  //   spec = {key(편집 상태 열쇠), label(편집 단추 이름 앞말, 예: "성적"), cols:[{k, label, w(열 폭 px), num(숫자 = 오른쪽 정렬),
  //            view(row → 보기 글), edit(row → {attr, value, ph, mode(inputmode), items(고르기 목록)}) | 없으면 계산 칸(편집에서도 글)}],
  //           rows:[{id, data(칸 함수에 넘길 줄 자료), nameHtml, sub(이름 옆 흐린 글 HTML), draft}], nameLabel(첫 열 머리, 기본 "학생"), empty}
  //   always = 늘 편집 갈래(펼친 기록 카드처럼 열린 것 자체가 편집 상태인 곳 — 편집 단추 없음).
//   편집 상태는 화면이 아니라 이 부품이 들고 있다(RG). 취소용 사본은 화면이 rgridReg(key, {snap, restore})로 넘긴다.
  const RG = {}, RGF = {};
  function rgridOn(key) { return !!RG[key]; }
  function rgridReg(key, f) { RGF[key] = f; }
  function rgridHead(key, label, opt) {
    opt = opt || {}; const ic = (n) => (typeof IC === "function" ? IC(n, "s") : "");
    if (opt.off) return "";
    return RG[key] ? `<button type="button" class="lnk" data-rgx="${esc(key)}" title="편집을 시작하기 전 값으로 되돌려요">취소</button><button type="button" class="btn sm pri rgok" data-rgok="${esc(key)}" title="입력칸을 닫아요 — 노션에는 [저장]으로 들어가요">${ic("check")}편집 완료</button>`
      : `<button type="button" class="btn icon rged" data-rged="${esc(key)}" aria-label="${esc(label)} 편집" title="${esc(label)} 편집 — 칸을 한꺼번에 편집해요">${ic("pen")}</button>`;/* 편집 = 연필 아이콘만(대표 261124 "편집같은거는 아이콘만"), 이름은 마우스를 올리면 */
  }
  function rgrid(s) {
    const ed = !!s.always || !!RG[s.key], cols = s.cols || [];
    /* 칸 폭 = 최소 폭(c.w) 보장 + 창이 넓어지면 이름 2 : 칸 1로 같이 늘어남(창을 넓혀도 칸이 그대로 좁던 것) */
    const tpl = `minmax(72px,2fr) ${cols.map(c => `minmax(${c.w || 56}px,1fr)`).join(" ")}`;
    const cell = (c, r) => {
      const cls = `rgc${c.num ? " num" : ""}`;
      if (ed && c.edit) {
        const e = c.edit(r.data) || {}; const v = e.value == null ? "" : e.value;
        if (e.items) return `<select class="inp rgi ${cls}" ${e.attr || ""} aria-label="${esc(e.aria || c.label)}"><option value="">${esc(e.ph || c.label)}</option>${e.items.map(o => `<option ${String(o) === String(v) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        return `<input class="inp rgi ${cls}" ${e.attr || ""} value="${esc(v)}" placeholder="${esc(e.ph || c.label)}" inputmode="${esc(e.mode || "numeric")}" autocomplete="off" aria-label="${esc(e.aria || c.label)}">`;
      }
      const t = c.view ? c.view(r.data) : ""; const none = t == null || t === "";
      return `<span class="${cls}${none ? " none" : ""}">${none ? "—" : t}</span>`;
    };
    if (!(s.rows || []).length) return s.empty ? `<div class="hint">${esc(s.empty)}</div>` : "";
    return `<div class="rgrid${ed ? " ed" : ""}" data-rgrid="${esc(s.key)}" style="--rgcols:${tpl}"><div class="rgrow rgh"><span class="rgn">${esc(s.nameLabel || "학생")}</span>${cols.map(c => `<span class="rgc${c.num ? " num" : ""}">${esc(ed && c.editLabel ? c.editLabel : c.label)}</span>`).join("")}</div>${s.rows.map(r => `<div class="rgrow${r.draft ? " draft" : ""}"><span class="rgn"><span class="rgnt">${r.nameHtml}</span>${r.sub ? `<small class="rgns">${r.sub}</small>` : ""}</span>${cols.map(c => cell(c, r)).join("")}</div>`).join("")}</div>`;
  }
  // 편집 단추 · 완료 · 취소 · Enter(아래 줄 같은 칸으로) — 창 어디서든 한 곳에서 묶음
  document.addEventListener("click", ev => {
    const t = ev.target && ev.target.closest ? ev.target.closest("[data-rged],[data-rgok],[data-rgx]") : null; if (!t) return;
    ev.preventDefault(); ev.stopPropagation();
    const d = t.dataset, key = d.rged || d.rgok || d.rgx, f = RGF[key] || {};
    if (d.rged != null) { RG[key] = { snap: f.snap ? f.snap() : null }; }
    else if (d.rgx != null) { const s = RG[key]; delete RG[key]; if (s && s.snap != null && f.restore) { f.restore(s.snap); if (typeof window.commit === "function") { window.commit(); return; } } }
    else { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); delete RG[key]; }
    if (typeof window.render === "function") window.render();
    if (d.rged != null) setTimeout(() => { const i = document.querySelector(`[data-rgrid="${CSS.escape(key)}"] .rgi`); if (i) { i.focus(); if (i.select) i.select(); } }, 0);
  }, true);
  document.addEventListener("keydown", ev => {
    const i = ev.target; if (!i || !i.classList || !i.classList.contains("rgi") || ev.isComposing) return;
    const g = i.closest(".rgrid"); if (!g) return;
    if (ev.key === "Escape") { const b = document.querySelector(`[data-rgx="${CSS.escape(g.dataset.rgrid)}"]`); if (b) { ev.preventDefault(); ev.stopPropagation(); b.click(); } return; }
    if (ev.key !== "Enter" || i.tagName === "SELECT") return;
    ev.preventDefault(); const row = i.closest(".rgrow"), idx = [...row.querySelectorAll(".rgi")].indexOf(i), rows = [...g.querySelectorAll(".rgrow:not(.rgh)")], nx = rows[rows.indexOf(row) + 1];
    const to = nx && nx.querySelectorAll(".rgi")[idx];
    i.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => { const all = document.querySelectorAll(`[data-rgrid="${CSS.escape(g.dataset.rgrid)}"] .rgrow:not(.rgh)`), r2 = all[rows.indexOf(row) + 1]; const t2 = r2 && r2.querySelectorAll(".rgi")[idx]; if (t2) { t2.focus(); if (t2.select) t2.select(); } else if (!to) { const ok = document.querySelector(`[data-rgok="${CSS.escape(g.dataset.rgrid)}"]`); if (ok) ok.focus(); } }, 30);
  }, true);
  // 10. 아래 단추줄: 삭제 ……… 되돌리기 · ○○ 저장
  // 아래 줄 재료: 줄 창 = del · undo · save(+ ids, count) / 작업 창 = hint · back{id,label} · go{id,label,icon,off,title,count}
  /* 창 아래 줄: [삭제] · [ㅇㅇ 저장]은 모든 창에 되풀이되는 기능이라 아이콘 단추(이름은 마우스를 올리면, 대표 261124 "반복적으로 나타나는 기능 저장 편집 등은 아이콘으로"). 보내기 · 생성 같은 일은 글자 그대로 */
  function foot(f) {
    if (!f) return "";
    const id = f.ids || {}, ic = Object.assign({}, IC_, f.icons || {}); const at = (k, t) => `${id[k] ? ` id="${id[k]}"` : ""}${t ? ` title="${esc(t)}"` : ""}`;
    return `<div class="actions">${f.hint ? (typeof HELP === "function" ? HELP(f.hint) : `<span class="hint">${esc(f.hint)}</span>`) : ""}${f.del ? `<button class="btn danger icon fic" type="button" aria-label="${esc(f.delLabel || "삭제")}"${at("del", (f.delLabel || "삭제") + " — " + (f.delTitle || "이 줄 삭제(저장 전까지 되돌릴 수 있어요)"))}${f.delOff ? " disabled" : ""}>${f.delIcon != null && f.delIcon !== "" ? f.delIcon : ic.trash}</button>` : ""}${f.back ? `<button class="btn" type="button"${f.back.id ? ` id="${esc(f.back.id)}"` : ""}>${esc(f.back.label || "취소")}</button>` : ""}${f.left || ""}<span class="sp"></span>${f.extra || ""}${f.undo ? `<button class="btn icon" type="button"${at("undo", f.undoTitle || "저장 상태로 되돌리기")}>${ic.undo}</button>` : ""}${f.save ? `<button class="btn big icon fic ${f.primary ? "pri" : "rowsave"}" type="button" aria-label="${esc(f.save)}"${at("save", f.save + " — " + (f.saveTitle || "이 줄에서 고친 것만 바로 저장해요. 다른 줄까지 모두 저장하려면 위 [저장]을 눌러요"))} ${f.saveOn ? "" : "disabled"}>${ic.save}${f.count ? `<span class="cnt">${esc(f.count)}</span>` : ""}</button>` : ""}${f.go ? `<button class="btn pri big" type="button"${f.go.id ? ` id="${esc(f.go.id)}"` : ""}${f.go.title ? ` title="${esc(f.go.title)}"` : ""}${f.go.off ? " disabled" : ""}>${f.go.icon || ""}${esc(f.go.label)}${f.go.count ? ` <span class="cnt">${esc(f.go.count)}</span>` : ""}</button>` : ""}</div>`;
  }
  // 9. 선택 전 = 할 일 창
  // 9. 선택 전 = 할 일 창(299판 연결: 앱 todoPanel도 이 함수 하나로 그림)
  //  groups:[{k,name,why,rows:[{id,html}|{t,sub}]}], on, summary:[[이름,값html,cls]], list:{name,rows:[{id,html}],moreHtml|more}, ro, empty
  function todo(t) {
    const ic = n => (typeof IC === "function" && typeof FEATHER !== "undefined" && FEATHER[n]) ? IC(n, "s") : (n === "check" ? IC_.check : IC_.rightc);
    const ra = t.rowAttr || "todosel", ta = t.tabAttr || "todok";
    const rowH = r => `<button type="button" class="tdr" ${r.id != null ? `data-${ra}="${esc(r.id)}"` : ""}>${r.html != null ? r.html : `${esc(r.t)} <small class="hint">${esc(r.sub || "")}</small>`}${ic("rightc")}</button>`;
    const groups = (t.groups || []).map(g => Object.assign({}, g, { rows: g.rows || [] })), has = groups.filter(g => g.rows.length);
    const L = t.list, more = L ? (L.moreHtml != null ? L.moreHtml : (L.more ? `<button type="button" class="tdmore">${IC_.search}${esc(L.more)}</button>` : "")) : "";
    const list = L && (L.rows.length || more) ? `<div class="tdlist"><div class="tdh2">${esc(L.name)} <span class="hint">${L.rows.length}</span></div><div class="tdl">${L.rows.map(rowH).join("")}</div>${more}</div>` : "";
    // 윗부분 = 기본 창과 같은 머리 · 탭 바(기준 4장 "할 일"). 머리 재료: icon(화면 아이콘) · belong(화면 이름) — 화면이 넘긴다.
    const foot = t.footHtml || "", total = has.reduce((a, g) => a + g.rows.length, 0);
    // 고른 탭의 설명(왜 할 일인지)은 길어서 머리 3줄(한 줄 · 넘치면 …)에 두지 않고 본문 첫 줄에 둔다
    // 머리 3줄 = 요약 숫자(이름 값 · 이름 값). 요약이 없어도 줄은 비워 두어 탭 바가 기본 창과 같은 높이에서 시작한다
    const plain = v => String(v == null ? "" : v).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    const sumInfo = (t.summary || []).map(([n, v]) => `${n} ${plain(v)}`.trim()).filter(Boolean);
    // 261119 대표: 선택 전 공용 창 = 탭 두 개 [현황] [할 일] — 현황 = 늘 있는 값(요약 · 다가오는 것), 할 일 = 마무리 안 된 것(건수는 머리 알약, 묶음은 안쪽 칩)
    const vw = t.view === "todo" ? "todo" : "sta", vtabs = [{ id: "sta", label: "현황" }, { id: "todo", label: "할 일" }];
    const bl = String(t.belong || ""), bi = bl.indexOf(" · "), top = () => head({ icon: t.icon, name: bi > 0 ? bl.slice(0, bi) : (bl || "현황"), status: total ? [{ t: total + "건", tone: "yellow" }] : [], help: t.help, belong: bi > 0 ? bl.slice(bi + 3) : "", info: sumInfo.length ? sumInfo : [" "] }) + tabs(vtabs, vw, "todov");
    const none = txt => `<div class="tdnone">${ic("check")}${esc(txt)}</div>`;
    const sumRows = (t.summary || []).filter(([n]) => n).map(([n, v, c]) => `<div class="tdsr ${c || ""}"><span>${esc(n)}</span><b>${v == null ? "" : v}</b></div>`).join("");
    if (vw === "sta") return `${top()}<div class="pbody"><div class="tdp">${sumRows ? `<div class="tdsum">${sumRows}</div>` : ""}${list}${!sumRows && !list ? none(t.empty || "보여 줄 현황이 아직 없어요") : ""}</div></div>${foot}`;
    if ((!groups.length && t.empty) || (!has.length && !t.keepTabs)) return `${top()}<div class="pbody"><div class="tdp">${none(t.empty || "지금 할 일이 없어요")}</div></div>${foot}`;
    const shown = t.keepTabs ? groups : has; // 할 일이 있는 묶음만(고정 묶음 화면은 모두)
    const on = shown.find(g => g.k === t.on) || has[0] || shown[0], max = t.max || 60;
    // 261119 도움말 정리: 묶음 설명(왜 할 일인지)은 본문 글이 아니라 (?) 아이콘 속
    const whyH = on.why ? (typeof HELP === "function" ? HELP(on.why) : "") : "";
    const chips = shown.length > 1 ? `<div class="tdsubs">${shown.map(g => `<button type="button" class="tdsb ${g.k === on.k ? "on" : ""}" data-${ta}="${esc(g.k)}">${esc(g.name)} <small>${g.rows.length}</small></button>`).join("")}${whyH ? `<span class="sp"></span>${whyH}` : ""}</div>` : (whyH ? `<div class="tdsubs"><span class="sp"></span>${whyH}</div>` : "");
    return `${top()}<div class="pbody"><div class="tdp">${chips}<div class="tdl">${on.rows.slice(0, max).map(rowH).join("") || none("할 일이 없어요")}${on.rows.length > max ? `<div class="hint">외 ${on.rows.length - max}건 — 표의 필터 알약으로 모두 봐요</div>` : ""}</div></div></div>${foot}`;
  }
  // 칸 붙이기(입력칸 모듈 field.js)
  function mountFields(root, boxes) {
    if (!window.HF) return;
    (boxes || []).forEach((b, bi) => (b.fields || []).forEach((f, i) => {
      const host = root.querySelectorAll(".box")[bi] && root.querySelectorAll(".box")[bi].querySelector(`[data-pf="${i}"]`); if (!host) return;
      const o = { label: f.label, help: f.help, value: f.value, tipHtml: f.tip ? help(f.tip) : "", alim: f.alim };
      const T = f.type || "text";
      if (T === "range") HF.dateRange(host, Object.assign(o, { value: f.value || ["", ""] }));
      else if (T === "trange") HF.timeRange(host, Object.assign(o, { value: f.value || ["", ""] }));
      else if (T === "select") HF.select(host, Object.assign(o, { items: f.items || [] }));
      else if (T === "multi") HF.select(host, Object.assign(o, { items: f.items || [] }));
      else if (HF[T]) HF[T](host, Object.assign(o, T === "seg" || T === "sw" ? { items: f.items } : {}));
      else HF.text(host, o);
    }));
  }
  // 전체 창
  function render(el, spec) {
    if (spec.todo) { el.innerHTML = todo(spec.todo); return el }
    el.innerHTML = `${head(spec.head)}${tabs(spec.tabs, spec.tab)}<div class="pbody">${(spec.boxes || []).map(box).join("")}</div>${foot(spec.foot)}`;
    mountFields(el, spec.boxes); return el;
  }
  window.PANEL = { head, fitHeads, tabs, box, infoBoxes, pairUp, groups, bookRows, rows, rgrid, rgridHead, rgridOn, rgridReg, foot, todo, render, mountFields, help, pill, IC: IC_, esc };
})();
