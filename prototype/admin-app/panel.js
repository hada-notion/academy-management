/* 오른쪽 창 모듈(panel.js) — 창 하나 = 정의(spec) 하나. 그리는 함수는 여기 하나(앱·모듈 페이지 같이 씀).
 * 창 = { head:{name, nameInput, dot, status:[{t,tone}], info:[글], badges:[html], links:[{t,act}]},
 *        tabs:[{id,label,n,disabled}], tab:"id",
 *        boxes:[{title, help, right:html, body:html | fields:[칸] | rows:[줄] | cards:html | mini:html}],
 *        foot:{del:true, undo:true, save:"클래스 저장", saveOn:false} }
 * 선택 전 = { todo:{groups:[{k,name,why,rows:[{t,sub}]}], on, summary:[[이름,값]], list:{name, rows:[{t,badge,tone,sub}], more}} }
 * 칸 = {k, label, type:"text|date|range|select|multi|num|tel|memo|seg|sw|color", value, items, help, tip}
 * 부품 이름은 앱 CSS와 같다(.phead .pinfo .sub / .ptabs .ptb / .box h3 / .hfgrid .hfpair / .ttrows .ttrow / .actions / .tdp). */
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const P = '<svg class="i s" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  const IC = {
    help: P + '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    right: P + '<path d="M5 12h14M12 5l7 7-7 7"/></svg>', rightc: P + '<path d="M9 18l6-6-6-6"/></svg>',
    ext: P + '<path d="M7 17 17 7M7 7h10v10"/></svg>', trash: P + '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    save: P + '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    undo: P + '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>', check: P + '<path d="M20 6 9 17l-5-5"/></svg>',
    search: P + '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'
  };
  const help = t => t ? `<span class="qhelp" tabindex="0" role="note" aria-label="${esc(t)}" data-help="${esc(t)}">${IC.help}</span>` : "";
  const pill = s => `<span class="pill nc-${esc(s.tone || "gray")}">${esc(s.t)}</span>`;

  // 1. 머리 3줄: 이름 + 상태 배지 / 정보 + 기타 배지 / 바로 가기
  function head(h) {
    h = h || {};
    const name = h.nameInput ? `<input class="hname" value="${esc(h.name || "")}" placeholder="${esc(h.nameInput)}">` : esc(h.name || "");
    const l1 = h.nameHtml != null ? h.nameHtml : `<span class="phn">${h.dot ? `<i class="cdot" style="background:${esc(h.dot)}"></i>` : ""}${name}</span>${(h.status || []).map(pill).join("")}${help(h.help)}`;
    const l2 = h.infoHtml != null ? h.infoHtml : (h.info || []).map((t, i) => `${i ? '<span class="phdot">·</span>' : ""}<small>${esc(t)}</small>`).join("") + (h.badges || []).join("");
    const l3 = h.linksHtml != null ? h.linksHtml : (h.links || []).map((x, i) => `${i ? " · " : ""}<a class="link" href="#" data-act="${esc(x.act || "")}">${esc(x.t)} ${IC.ext}</a>`).join("");
    return `<div class="phead"><div class="pt"><h2>${l1}</h2><div class="pinfo">${l2}</div><div class="sub">${l3}</div></div>${h.right ? `<span class="pright">${h.right}</span>` : ""}</div>`;
  }
  // 2. 탭 바(탭이 없는 창도 '정보' 하나로 같은 자리)
  function tabs(ts, on, attr) {
    ts = ts && ts.length ? ts : [{ id: "info", label: "정보" }]; attr = attr || "ptab";
    return `<div class="ptabs" role="tablist">${ts.map(t => `<button type="button" class="ptb ${t.id === on ? "on" : ""}" data-${attr}="${esc(t.id)}" ${t.disabled ? "disabled" : ""}>${esc(t.label)}${t.n != null && t.n !== "" ? ` <span class="sm">${esc(t.n)}</span>` : ""}</button>`).join("")}</div>`;
  }
  // 3. 상자: 제목 + (?) + 오른쪽(링크·단추) + 내용
  function box(b) {
    let body = b.body || "";
    if (b.fields) body = `<div class="hfgrid">${b.fields.map((f, i) => f.type === "range" ? `<div class="hfh" data-pf="${i}"></div>` : `<div class="hfh" data-pf="${i}"></div>`).join("")}</div>`;
    if (b.rows) body = rows(b.rows);
    return `<div class="box"><h3>${esc(b.title || "")}${help(b.help)}<span class="sp"></span>${b.right || ""}</h3>${body}</div>`;
  }
  // 6. 줄 목록: 이름 ……… 정보 · 꼬리표 ›
  function rows(rs) {
    return rs.length ? `<div class="ttrows">${rs.map(r => `<div class="ttrow" ${r.go ? `data-go="${esc(r.go)}"` : ""}>${r.dot ? `<i class="cdot" style="background:${esc(r.dot)}"></i>` : ""}<span class="t">${esc(r.t)}</span>${r.sub ? `<span class="hint">${esc(r.sub)}</span>` : ""}${r.tag ? `<span class="tag">${esc(r.tag)}</span>` : ""}${IC.rightc}</div>`).join("")}</div>` : `<div class="hint">아직 없어요</div>`;
  }
  // 10. 아래 단추줄: 삭제 ……… 되돌리기 · ○○ 저장
  function foot(f) {
    if (!f) return "";
    const id = f.ids || {}, ic = f.icons || IC; const at = (k, t) => `${id[k] ? ` id="${id[k]}"` : ""}${t ? ` title="${esc(t)}"` : ""}`;
    return `<div class="actions">${f.del ? `<button class="btn danger" type="button"${at("del", f.delTitle || "이 줄 삭제(저장 전까지 되돌릴 수 있어요)")}>${ic.trash}삭제</button>` : ""}<span class="sp"></span>${f.undo ? `<button class="btn icon" type="button"${at("undo", f.undoTitle || "저장 상태로 되돌리기")}>${ic.undo}</button>` : ""}${f.save ? `<button class="btn big rowsave" type="button"${at("save", f.saveTitle || "이 줄에서 고친 것만 바로 저장해요. 다른 줄까지 모두 저장하려면 위 [저장]을 눌러요")} ${f.saveOn ? "" : "disabled"}>${ic.save}${esc(f.save)}</button>` : ""}</div>`;
  }
  // 9. 선택 전 = 할 일 창
  function todo(t) {
    const has = (t.groups || []).filter(g => g.rows && g.rows.length); const on = (t.groups || []).find(g => g.k === t.on && g.rows.length) || has[0];
    const sum = t.summary && t.summary.length ? `<div class="tdsum">${t.summary.map(([n, v, c]) => `<div class="tds ${c || ""}"><span>${esc(n)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : "";
    const list = t.list && t.list.rows.length ? `<div class="tdlist"><div class="tdh2">${esc(t.list.name)} <span class="hint">${t.list.rows.length}</span></div><div class="tdl">${t.list.rows.map(r => `<button type="button" class="tdr"><span class="tdr2"><span class="tdr2a">${r.dot ? `<i class="cdot" style="background:${esc(r.dot)}"></i>` : ""}<b>${esc(r.t)}</b>${r.badge ? pill({ t: r.badge, tone: r.tone }) : ""}</span><span class="tdr2b">${esc(r.sub || "")}</span></span>${IC.rightc}</button>`).join("")}</div>${t.list.more ? `<button type="button" class="tdmore">${IC.search}${esc(t.list.more)}</button>` : ""}</div>` : "";
    if (!has.length) return `<div class="tdp"><div class="tdh">${IC.check}지금 할 일이 없어요</div>${sum}${list}</div>`;
    return `<div class="tdp"><div class="tdh">할 일 <span class="hint">${has.reduce((a, g) => a + g.rows.length, 0)}건</span></div><div class="tdtabs">${t.groups.map(g => `<button type="button" class="tdt ${g === on ? "on" : ""}" ${g.rows.length ? "" : "disabled"}>${esc(g.name)} <span class="n">${g.rows.length}</span></button>`).join("")}</div>${on.why ? `<div class="tdwhy">${esc(on.why)}</div>` : ""}<div class="tdl">${on.rows.map(r => `<button type="button" class="tdr">${esc(r.t)} <small class="hint">${esc(r.sub || "")}</small>${IC.rightc}</button>`).join("")}</div>${sum}${list}</div>`;
  }
  // 칸 붙이기(입력칸 모듈 field.js)
  function mountFields(root, boxes) {
    if (!window.HF) return;
    (boxes || []).forEach((b, bi) => (b.fields || []).forEach((f, i) => {
      const host = root.querySelectorAll(".box")[bi] && root.querySelectorAll(".box")[bi].querySelector(`[data-pf="${i}"]`); if (!host) return;
      const o = { label: f.label, help: f.help, value: f.value, tipHtml: f.tip ? help(f.tip) : "" };
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
  window.PANEL = { head, tabs, box, rows, foot, todo, render, mountFields, help, pill, IC, esc };
})();
