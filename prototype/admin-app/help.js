// 도움말 글 한 곳(261119 출시 전 다듬기 2). 화면 본문에는 안내 문장을 두지 않고, 글은 (?) 아이콘 속(HELP(글))으로만 보인다.
// 새 도움말 글은 여기에 적고 화면에서는 HELPTX.이름 으로 가져다 쓴다(화면 코드에 글을 새로 박지 않는다).
// 말은 기준 8장(해요체 · 말 기준표)을 따르고, 노션 매뉴얼과 다르면 노션이 기준이다.
const HELPTX = {
  // 학생 > 할 일 창의 묶음별 설명
  stuTodo: {
    new: "등록이 아직 없는 학생이에요. 오래된 문의가 위, 14일 넘은 문의는 노란 글씨. 누르면 그 학생 창.",
    info: "이름·학년·학교·연락처 중 빈 것이 있는 학생이에요(연락처는 학생·어머니·아버지·기타가 하나도 없을 때, 종료 학생은 빼요). 누르면 빠진 첫 칸으로.",
    pre: "가장 최근 등록이 아직 시작 전인 학생이에요. 누르면 [등록] 탭."
  },
  // 수업 > 주간 · 월간 · 출결 현황 "보는 법"
  lv: {
    wk: "주간 수업 = 수업 일지예요. 클래스마다 한 줄, 요일마다 한 칸이고, 칸을 누르면 하루 수업 본문이 열려요. 블록: 흰 바탕 + 왼쪽 클래스 색 띠 = 정규 · 점선 테두리 = 보강 · 빗금 = 휴강 · 흐림 = 아직 생성 안 한 수업(위 [이 주 수업 생성]). 지난 수업 칸 = 노션 수업 수식과 같은 글 — 연필 학습 내용 · 클립 과제 안내, 막대 = 사람 체크 출석(초록 출석 · 파랑 보강 · 빨강 결석 · 빗금 미입력) · 체크 상자 과제 검사(초록 제출 · 노랑 일부 · 빨강 미제출) · 문서 평가 평균(0점 뺌). 막대에 마우스를 올리면 노션 글. 아직 할 수업 칸 = 체크 상자 검사할 과제(지난 수업 과제) · 사람들 학생 수. 오른쪽 위 [5|7] = 주말 넣기 · 빼기.",
    mon: "월간 수업 = 날짜마다 그날 수업이에요. 수업을 누르면 하루 수업 본문, 빈 곳이나 [+n개 더]를 누르면 그날 오늘 수업으로 가요. 날짜 오른쪽 위 % = 그날 출석률(출석 + 보강 ÷ 시작한 수업 학생, 빈 출결은 안 온 것으로 — 노션 출석률과 같음). 블록: 흰 바탕 + 클래스 색 띠 = 정규 · 점선 = 보강 · 빗금 = 휴강 · 흐림 = 아직 생성 안 한 수업. Ctrl + 휠 = 한 화면 주 수, [5|7] = 주말.",
    atm: "출결 현황 = 날짜마다 출석 · 결석 · 보강 · 미입력 수예요. 날짜를 누르면 그날 오늘 등원 학생으로 가요. 오른쪽 위 % = 그날 출석률(빈 출결은 안 온 것으로). Ctrl + 휠 = 한 화면 주 수, [5|7] = 주말."
  },
  // 시간표 화면 머리 (?)
  tt: "시즌마다 되풀이되는 주간 시간표예요(노션 시간표 메뉴 · 시간표(학원) DB). [표]는 노션 표 보기와 같은 열, [달력]은 빈 곳을 끌어 생성하고 블록을 끌어 옮겨요. 수업이 생성된 운영 중 시간표는 잠겨 있고, 자물쇠를 풀어 고치면 저장할 때 \"언제부터\" 물어요. [저장]해야 노션에 들어가요.",
  // 보강 오른쪽 창 아래 줄 (?)
  mkFoot: "카드를 끌어 날짜(새 보강)나 보강 블록에 놓아요",
  // 학교 > [학교 검색] 창(261123 대표 "학교 검색은 앱으로" — 옛 학교 검색 웹 화면을 옮김)
  schoolFind: "나이스에서 학교를 찾아 노션 학교에 넣어요. [학교 추가]는 새 학교 페이지를 만들고 학교 코드 · 주소 · 홈페이지 · 학교 구분까지 붙여요. 이미 있는 학교(학교 코드 없음)는 [연결할 학교]에서 고르거나 이름이 같으면 [학교 코드 연결]로 코드만 붙여요 — 이름과 학생 연결은 그대로예요. 코드가 붙으면 [학사일정 가져오기]를 할 수 있어요. 학교 정보 출처: 나이스 교육정보 개방 포털",
  schoolCal: "학교 코드가 있는 학교의 학사일정을 나이스에서 가져와 노션 일정에 넣어요(이미 있는 일정은 건너뜀). 서버가 이어서 하므로 몇 분 걸려요 — 끝나면 위 [동기화]로 앱에 보여요."
};
/* 도움말 그림(HELP(글, {img}))은 help/ 폴더 한 곳 — 예시 데이터 화면 캡처, 파일명 영문 */
const HELPIMG = { lvWeek: "help/lesson-journal.png", lvMonth: "help/lesson-month-chips.png", ttDrag: "help/timetable-calendar.png" };

/* ===== 도움말 부품 (?) — 관리앱-기준.md 9장 "도움말" =====
 * 한 구역(제목 있는 .box)에 (?)는 하나: 제목 옆. 구역 안 칸·줄의 (?)는 그리기 끝(helpMerge)에서 제목 (?) 속 "칸 설명"으로 합쳐진다.
 * 짧은 글(HELP_SHORT자 이하 · 칸 설명 · 그림 없음)은 마우스를 올리면 말풍선, 긴 글은 말풍선에 첫 문장 + "눌러서 자세히",
 * 누르면(또는 Enter) 도움말 창 — 제목 · 글 · 칸 설명 · 그림 · 알림톡 미리보기. */
const HELP_SHORT = 60;
function HELP(t, o) { o = o || {}; t = String(t || ""); const ex = (o.img ? ` data-img="${esc(o.img)}"` : "") + (o.alim ? ` data-alim="${esc(o.alim)}"` : "");
  return `<span class="qhelp" tabindex="0" role="button" aria-haspopup="dialog" aria-label="도움말: ${esc(t.slice(0, 80))}" data-help="${esc(t)}"${ex}>${IC("help")}</span>` }
const helpItems = q => { try { return JSON.parse(q.dataset.items || "[]") } catch (e) { return [] } };
const helpLong = q => !!(q.dataset.img || q.dataset.alim || helpItems(q).length || (q.dataset.help || "").length > HELP_SHORT);
function helpTipText(q) { const t = q.dataset.help || "", n = helpItems(q).length; if (!helpLong(q)) return t;
  const first = (t.match(/^.*?(요\.|다\.|요$|다$|[.!?](\s|$))/) || [t])[0].trim(); const s = first.length > 90 ? first.slice(0, 88) + "…" : first;
  return (s ? s + " " : "") + (n ? `· 칸 설명 ${n}개 ` : "") + "— 눌러서 자세히" }
function showTip(q) { hideTip(); if (document.getElementById("hpop")) return; const t = document.createElement("div"); t.id = "qtip"; t.textContent = helpTipText(q); document.body.appendChild(t);
  const r = q.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight; let x = Math.max(8, Math.min(r.left - 8, innerWidth - w - 8)), y = r.bottom + 6; if (y + h > innerHeight - 8) y = r.top - h - 6; t.style.left = x + "px"; t.style.top = y + "px" }
function hideTip() { const t = document.getElementById("qtip"); if (t) t.remove() }
/* 도움말 창: (?) 옆에 뜨는 창. 닫기 = ✕ · Esc · 바깥 누르기 */
function helpClose() { const p = document.getElementById("hpop"); if (!p) return; const q = p._q; p.remove(); removeEventListener("pointerdown", helpOut, true); removeEventListener("keydown", helpEsc, true); if (q && q.isConnected) { q.setAttribute("aria-expanded", "false"); q.focus({ preventScroll: true }) } }
function helpOut(e) { const p = document.getElementById("hpop"); if (p && !p.contains(e.target) && !(p._q && p._q.contains(e.target))) helpClose() }
function helpEsc(e) { if (e.key === "Escape" && document.getElementById("hpop")) { e.stopPropagation(); e.preventDefault(); helpClose() } }
/* 창 제목 = (?)가 붙은 이름(구역 제목 · 칸 이름 · 표 머리). 이름이 없는 자리(위 줄)는 바로 앞 켜진 나눔 단추(주간 수업 등), 그것도 없으면 화면 이름 */
const helpName = e => { const c = e.cloneNode(true); c.querySelectorAll(".qhelp,button,.btn,.hint,small,.pill,.spill,.cnt,input,select,.sp,svg").forEach(x => x.remove()); return c.textContent.trim().replace(/\s+/g, " ").slice(0, 40) };
const helpTitle = q => { const h = q.closest("h3,h2,h4,h1,.hf-lbl,label,th"); if (h && helpName(h)) return helpName(h);
  for (let e = q.previousElementSibling; e; e = e.previousElementSibling) { const on = [...e.querySelectorAll(".on,[aria-pressed=true],[aria-selected=true]")].pop() || (e.matches(".on") ? e : null); if (on && on.textContent.trim()) return on.textContent.trim().replace(/\s+/g, " ").slice(0, 40) }
  const t = document.querySelector(".pg-ttl h1,#view h1,.ttl h1"); return (t && helpName(t)) || "도움말" };
/* 글 = 문장마다 한 줄(긴 글이 한 덩어리로 보이지 않게). 문장 끝 = "요." "다." 뒤 띄어쓰기 */
const helpPara = t => String(t || "").split(/\n+/).flatMap(x => x.split(/(?<=[요다]\.)\s+(?=\S)/)).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join("");
function helpOpen(q) { const was = document.getElementById("hpop"); if (was && was._q === q) { helpClose(); return } helpClose(); hideTip();
  const items = helpItems(q), al = q.dataset.alim && window.ALIMV && ALIMV.forField(q.dataset.alim), ttl = helpTitle(q);
  const p = document.createElement("div"); p.id = "hpop"; p.className = "hpop" + (q.dataset.img || helpItems(q).some(x => x.img) ? " wide" : ""); p.setAttribute("role", "dialog"); p.setAttribute("aria-label", ttl + " 도움말"); p._q = q;
  p.innerHTML = `<div class="hpop-h">${IC("help", "s")}<b>${esc(ttl)}</b><button type="button" class="hpop-x" aria-label="닫기">${IC("x", "s")}</button></div><div class="hpop-b">${helpPara(q.dataset.help)}`
    + (q.dataset.img ? `<figure class="hpop-img"><img src="${esc(q.dataset.img)}" alt="${esc(ttl)} 예시 화면"></figure>` : "")
    + (items.length ? `<dl class="hpop-items">${items.map(x => `<dt>${esc(x.l || "칸")}</dt><dd>${helpPara(x.t)}${x.img ? `<figure class="hpop-img"><img src="${esc(x.img)}" alt="${esc(x.l || "")} 예시 화면"></figure>` : ""}${x.alim && window.ALIMV && ALIMV.forField(x.alim) ? `<div class="hpop-alim">${ALIMV.render(ALIMV.forField(x.alim)[0], "", ALIMV.forField(x.alim)[1], ALIMV.forField(x.alim)[2])}</div>` : ""}</dd>`).join("")}</dl>` : "")
    + (al ? `<div class="hpop-alim">${ALIMV.render(al[0], "", al[1], al[2])}</div>` : "") + `</div>`;
  document.body.appendChild(p); q.setAttribute("aria-expanded", "true"); p.querySelector(".hpop-x").onclick = helpClose;
  const r = q.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight; let x = r.left - w - 12; if (x < 8) x = Math.min(innerWidth - w - 8, Math.max(8, r.left - 8)); let y = Math.min(Math.max(8, r.top - 12), innerHeight - h - 8);
  if (x < r.right && x + w > r.left) { y = r.bottom + 6; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6) } p.style.left = x + "px"; p.style.top = y + "px";
  p.querySelectorAll("img").forEach(im => im.addEventListener("load", () => { const hh = p.offsetHeight; if (parseFloat(p.style.top) + hh > innerHeight - 8) p.style.top = Math.max(8, innerHeight - hh - 8) + "px" }));
  addEventListener("pointerdown", helpOut, true); addEventListener("keydown", helpEsc, true); setTimeout(() => p.querySelector(".hpop-x").focus({ preventScroll: true }), 0) }
document.addEventListener("mouseover", e => { const q = e.target.closest && e.target.closest(".qhelp"); if (q) showTip(q) });
document.addEventListener("mouseout", e => { const q = e.target.closest && e.target.closest(".qhelp"); if (q && !q.contains(e.relatedTarget)) hideTip() });
document.addEventListener("focusin", e => { if (e.target.classList && e.target.classList.contains("qhelp")) showTip(e.target) });
document.addEventListener("focusout", e => { if (e.target.classList && e.target.classList.contains("qhelp")) hideTip() });
/* 누르기: 다른 동작(칸 열기 · 줄 고르기 · 단추)으로 번지지 않게 먼저 잡는다 */
document.addEventListener("click", e => { const q = e.target.closest && e.target.closest(".qhelp"); if (!q) return; e.preventDefault(); e.stopPropagation(); helpOpen(q) }, true);
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("qhelp")) { e.preventDefault(); e.stopPropagation(); helpOpen(e.target) } }, true);
/* 합치기: 그리기 끝마다. 구역 = 제목(h3) 있는 .box(안쪽 .box는 그 구역이 따로). 표 · 떠 있는 창 · 고르기 목록 안 (?)는 그 자리의 것이라 두고,
 * 한 이름(칸 이름 · 제목)에 (?)가 둘 이상이면 하나로. 칸 설명 이름 = 칸 이름(라벨), 없으면 그 줄 글 */
function helpMerge(root) { root = root || document;
  const skip = q => q.closest("table,.modal,.dlg,.hp-pop,.hpop,.alv-pop,#qtip,.tdr,.phead");
  const lblOf = q => { const h = q.closest(".hf-lbl,label,.lbl,.rlab,h4,.hf-swl"); const host = h || q.parentElement; const c = host.cloneNode(true); c.querySelectorAll(".qhelp,i,button,.btn,input,select,textarea").forEach(x => x.remove()); return c.textContent.trim().replace(/\s+/g, " ").slice(0, 30) };
  const add = (dst, src) => { const it = helpItems(dst); const own = helpItems(src); it.push({ l: lblOf(src), t: src.dataset.help || "", img: src.dataset.img || undefined, alim: src.dataset.alim || undefined }); own.forEach(x => it.push(x)); dst.dataset.items = JSON.stringify(it.filter(x => x.t || x.img || x.alim)); src.remove() };
  // 1) 한 이름 안 (?) 여럿 → 첫 것에 합침(글은 이어 붙이고, 알림톡 · 그림은 옮김)
  root.querySelectorAll(".hf-lbl,h3,h2,h4,label,.lbl").forEach(h => { const qs = [...h.querySelectorAll(":scope>.qhelp,:scope>span>.qhelp")]; if (qs.length < 2) return; const d = qs[0];
    qs.slice(1).forEach(s => { d.dataset.help = [d.dataset.help, s.dataset.help].filter(Boolean).join("\n"); if (!d.dataset.alim && s.dataset.alim) d.dataset.alim = s.dataset.alim; if (!d.dataset.img && s.dataset.img) d.dataset.img = s.dataset.img; s.remove() }) });
  // 2) 구역 안 (?) → 구역 제목 (?) 속 칸 설명
  root.querySelectorAll(".box").forEach(box => { const h = box.querySelector(":scope>h3"); if (!h || skip(box)) return;
    const own = [...box.querySelectorAll(".qhelp")].filter(q => !h.contains(q) && !skip(q) && q.closest(".box") === box); if (!own.length) return;
    let d = h.querySelector(".qhelp"); if (!d) { const sp = h.querySelector(".sp"); const html = HELP(""); sp ? sp.insertAdjacentHTML("beforebegin", html) : h.insertAdjacentHTML("beforeend", html); d = h.querySelector(".qhelp") }
    own.forEach(q => add(d, q)); d.setAttribute("aria-label", "도움말: " + (d.dataset.help || helpTitle(d)).slice(0, 80)) }) }
/* 그리기 뒤에 따로 붙는 칸(창 탭 · 입력칸 부품 · 서버 값 받은 뒤)도 같은 규칙 — (?)가 새로 들어오면 그 자리에서(그리기 전) 합친다 */
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.classList.contains("qhelp") || n.querySelector(".qhelp"))) { helpMerge(document); return } })
  .observe(document.documentElement, { childList: true, subtree: true });
