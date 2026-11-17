/* 모듈 페이지 '아이콘 규칙' 칸(300판): 규칙 파일(hada-rules.js)을 그대로 읽어 그린다 — 여기서 아이콘을 정하지 않는다 */
(function () {
  const host = document.getElementById("hic"); if (!host) return;
  const reTxt = re => String(re).slice(1, -1).replace(/\\/g, "").replace(/^\^\(?|\)?\$$/g, "").replace(/\$\|\^/g, "|");
  const T = (title, rows) => `<div class="mp-cell"><span class="lab">${title}</span><div class="panel mp-pn" style="padding-top:12px"><div class="ttrows">${rows.map(([ic, a, b]) => `<div class="ttrow"><span style="display:inline-flex;width:22px">${IC(ic)}</span><span class="t">${PANEL.esc(a)}</span><span class="hint">${PANEL.esc(b || "")}</span></div>`).join("")}</div></div></div>`;
  const menuRows = MENU.flatMap(g => g[1].filter(x => !x[0].startsWith("ext:")).map(x => [x[2], x[1], g[0]]));
  const linkRows = MENU_LINK.map(([re, k]) => [k[0] === "@" ? k.slice(1) : menuIcon(k), reTxt(re).split("|").slice(0, 4).join(" · "), k[0] === "@" ? "" : "→ " + (MENU.flatMap(g => g[1]).find(x => x[0] === k) || [0, ""])[1]]);
  const exRows = ICON_EXC.map(([re, k]) => [k, reTxt(re).split("|").join(" · "), "예외"]);
  const typeRows = [[iconRule("", "date"), "날짜 칸", "○○일 · 날짜 · 기간"], [iconRule("", "tel"), "전화 칸", "연락처 · 전화"], [iconRule("", "days"), "요일 칸", ""], ["hash", "숫자 칸", ""], ["list", "고르기 기본", "⌄"]];
  host.innerHTML = T("① 칸 이름 예외(가장 먼저)", exRows) + T("② 메뉴와 연결된 칸 = 메뉴 아이콘", linkRows) + T("③ 칸 종류", typeRows) + T("메뉴(아이콘의 기준)", menuRows);
})();
