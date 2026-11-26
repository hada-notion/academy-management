/* 실제 자료 모드의 라이브러리(261123 대표 "모든걸 앱에서" — 옛 라이브러리 웹 화면에만 있던 것을 옮김). 서버 textbook-api는 그대로 부른다(live.js liveBookApi).
   - 책 찾기(오른쪽 창): [검색] search(국립중앙도서관, ISBN이면 그 책) → 고르면 detail(목차 → 단원 후보) → register(ISBN · 교보문고 표지)
                         [교보문고] 책 주소의 상품번호 → kyobo-book(교재명 · ISBN · 정가 · 출판사 · 목차) → register-custom. ISBN만 붙이면 search(ISBN)
                         [직접 등록] 지금 등록 창(live.js liveBookRegisterOpen)
   - 단원(교재 창 [단원] 탭): units로 받아 보이고, [단원 편집] 창 [고치기 | 붙여넣기 | 가져오기] 탭 — 이름 · 시작 고치기 · 삭제 · 추가 · 붙여넣기 · 가져오기(units-fetch, 교보문고 → 예스24) — [나누기]는 화면에서(단원 단계 lbUnitPick, 항목 164) → edit-units 한 번에(바로 노션)
   - 시리즈(라이브러리 [교재] 탭, 줄을 고르지 않았을 때 오른쪽 창 아래 [시리즈 관리]): series · edit-series(추가 · 이름 · 순서 · 삭제 — 교재가 0권인 시리즈만 삭제)
   실제 자료 모드가 아니면 아무것도 바꾸지 않는다(시제품 예시 목록 그대로). */
const LBK = { units: {}, series: null };
const lbKyoboCover = (isbn) => `https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/${isbn}.jpg`;
/* 즐겨찾기 [교재 가져오기](261123 — 옛 라이브러리 웹 화면 kyoboGrab 그대로). 교보문고 페이지에서 돌기 때문에 이 파일의 다른 함수·변수를 쓰지 않는다.
   구조화 데이터(schema.org Book) · 취소선 정가 · "기본정보" 쪽수 · "이 책의 시리즈" · "목차"(없으면 교보문고 목차 요청). 즐겨찾기 주소는 줄바꿈이 사라질 수 있어 함수 안에 // 주석을 두지 않는다. */
async function lbKyoboGrab(){
 const fail=m=>alert('교재 가져오기: '+m);
 const send=(json,msg)=>{const done=()=>alert(msg);const copy=()=>{const t=document.createElement('textarea');t.value=json;document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();if(ok)done();else prompt('아래 내용을 모두 복사(Ctrl+C)하세요.',json)};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(json).then(done,copy);else copy()};
 if(/^search\.kyobobook\.co\.kr$/.test(location.hostname)){
  const items=[...document.querySelectorAll('input.result_checkbox:checked')].map(c=>({pid:String(c.dataset.pid||''),isbn13:(/97[89]\d{10}/.exec(String(c.dataset.bid||''))||[''])[0],title:String(c.dataset.name||'').trim()})).filter(x=>/^S\d+$/.test(x.pid));
  if(!items.length)return fail('검색 결과에서 가져올 책을 체크한 뒤 눌러 주세요(한 번에 20권까지).');
  if(items.length>20)return fail('한 번에 20권까지 가져올 수 있어요. 지금 '+items.length+'권이 체크되어 있어요.');
  return send(JSON.stringify({hada:'books',v:1,source:'kyobo-list',items}),'체크한 '+items.length+'권을 복사했어요.\n\n하다 앱 라이브러리 [책 찾기] > [교보문고]에서 [가져온 정보 붙여넣기]를 누르세요. 정가·출판사·단원은 앱이 교보문고에서 한 권씩 채워요.');
 }
 const id=(/\/detail\/(S\d+)/.exec(location.pathname)||[])[1];
 if(!/(^|\.)kyobobook\.co\.kr$/.test(location.hostname)||!id)return fail('교보문고 책 상세 페이지나 검색 목록에서 눌러 주세요.');
 const ld=[...document.querySelectorAll('script[type="application/ld+json"]')].map(x=>{try{return JSON.parse(x.textContent)}catch(e){return null}}).flat().find(x=>x&&x['@type']==='Book');
 if(!ld)return fail('책 정보를 찾지 못했어요. 페이지를 새로고침한 뒤 다시 눌러 주세요.');
 const sec=n=>[...document.querySelectorAll('section')].find(x=>{const h=x.querySelector('h1,h2,h3,h4');return h&&h.textContent.replace(/\s+/g,'')===n});
 const clean=html=>{const t=document.createElement('textarea');t.innerHTML=String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|tr|h5|h6)>/gi,'\n').replace(/<[^>]+>/g,'');return t.value.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(l=>l&&!/^(펼치기|접기)$/.test(l)).join('\n')};
 const body=el=>{if(!el)return '';const c=el.cloneNode(true);c.querySelectorAll('h1,h2,h3,h4,button,script,style').forEach(x=>x.remove());return clean(c.innerHTML)};
 let pages=null;const info=sec('기본정보');
 if(info)for(const th of info.querySelectorAll('th'))if(/쪽수/.test(th.textContent)){const m=/([\d,]+)\s*쪽/.exec(th.nextElementSibling?th.nextElementSibling.textContent:'');if(m)pages=+m[1].replace(/,/g,'')}
 const sale=+((ld.offers||{}).price||0),del=document.querySelector('del,s,[class*="line-through"]'),list=del?+del.textContent.replace(/[^\d]/g,''):0;
 const sa=(sec('이책의시리즈')||document.createElement('i')).querySelector('a');
 let toc=body(sec('목차'));
 if(!toc)try{const j=await (await fetch('/api/gw/pdt/v2/product/component/'+id+'/middle')).json();toc=clean(((j.data||{}).middle||{}).contentTableList)}catch(e){}
 const data={hada:'book',v:1,source:'kyobo',url:location.origin+location.pathname,title:String(ld.name||'').trim(),isbn13:(/97[89]\d{10}/.exec(String(ld.isbn||'')+' '+String(ld.image||''))||[''])[0],cover:String(ld.image||'').split('?')[0].replace(/\/fit-in\/\d+x\d+\//,'/fit-in/458x0/'),publisher:String((ld.publisher||{}).name||'').trim(),
  price:list&&(!sale||list>=sale&&list<=sale*3)?list:sale,pages,series:sa?sa.textContent.trim():'',toc};
 const n=toc?toc.split('\n').length:0;
 send(JSON.stringify(data),'교재 정보를 복사했어요.\n'+data.title+'\n단원 '+(n?n+'줄':'없음(교보문고에 단원 목록이 없어요)')+'\n\n하다 앱 라이브러리 [책 찾기] > [교보문고]에서 [가져온 정보 붙여넣기]를 누르세요.');
}
const lbGrabHref = () => "javascript:" + encodeURIComponent("(" + lbKyoboGrab.toString() + ")()");
const lbErr = (e) => (e && e.status === 401) || (e && e.status === 403) ? "관리자 로그인이 필요해요 — 새로고침해서 다시 로그인해요" : (e && e.message) || "서버에 연결하지 못했어요";
const lbOpts = (k) => (DB.opts && Array.isArray(DB.opts[k]) ? DB.opts[k] : []);
/* 등록 뒤(원본 검수 261123): 서버가 노션에 직접 만든 교재는 노션 구독 알림이 오지 않아 앱 사본에 바로 안 들어온다 —
   라이브러리 DB만 [동기화](app-api run sync-copy)로 맞춘 뒤 다시 받는다. 저장 안 한 변경이 있으면 덮어쓰지 않게 안내만 */
async function lbAfterAdd(okMsg) {
  if (dirtyCount() !== 0 || typeof window.liveReload !== "function") { toast(okMsg + " — 저장하지 않은 변경이 있어서 목록은 저장하고 [동기화]를 누르면 보여요"); return; }
  const c = window.LIVE;
  try {
    await appPostJson(String(c.url).replace(/\/+$/, "") + "/functions/v1/app-api", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": c.session, Authorization: "Bearer " + c.anonKey, apikey: c.anonKey }, body: JSON.stringify({ action: "run", name: "sync-copy", dbs: ["라이브러리(학원) DB"], full: true }) });
  } catch (_) { /* 못 맞춰도 다시 받기는 한다 — 안 보이면 [동기화] */ }
  await window.liveReload();
  toast(okMsg);
}

/* ───── 책 찾기 ───── */
function lbGrabBox(F) {
  return `<div class="bfgrab"><div class="row"><a class="btn pri" id="bfGrab" href="${esc(lbGrabHref())}" draggable="true" title="즐겨찾기 막대로 끌어다 놓아요">${IC("clip", "s")}교재 가져오기</a><button class="btn" id="bfPaste" ${F.busy ? "disabled" : ""}>가져온 정보 붙여넣기</button></div>
  <details class="bfgd"><summary class="hint">처음 한 번 준비 — 즐겨찾기에 단추 두기</summary><ol class="hint"><li>위 [교재 가져오기]를 브라우저 즐겨찾기 막대로 끌어다 놓아요(막대가 안 보이면 Ctrl+Shift+B).</li><li>교보문고 책 상세 페이지(또는 검색 목록에서 책을 체크한 뒤 최대 20권)에서 그 즐겨찾기를 눌러요.</li><li>여기로 돌아와 [가져온 정보 붙여넣기]를 눌러요. 정가 · 출판사 · 쪽수 · 단원까지 한 번에 들어와요.</li></ol></details>
  ${F.grabTa ? '<textarea class="inp bfta" id="bfGrabTa" placeholder="복사한 정보를 여기에 붙여 넣으세요(Ctrl+V)"></textarea>' : ""}</div><div class="hint bfor">단추가 안 되면 아래에 교보문고 주소나 ISBN을 붙여 넣어요.</div>`;
}
function lbFindHtml(st) {
  const F = st.bfind, T = F.T, n = F.picks.length;
  const has = (x) => x.registered || DB.books.some((b) => !b.del && x.isbn13 && b.isbn === x.isbn13);
  const row = (x, i) => `<label class="bfr ${has(x) ? "dis" : ""}"><input type="checkbox" data-bf="${i}" ${F.picks.includes(i) ? "checked" : ""} ${has(x) || F.busy ? "disabled" : ""}><span class="bfc">${x.cover ? `<img class="bkimg" alt="" referrerpolicy="no-referrer" src="${esc(x.cover)}" data-alt="${esc(x.altCover || "")}">` : '<span class="bkph"><i>표지 없음</i></span>'}</span><span class="bft"><b>${esc(x.title)}</b><span class="hint">${esc([x.publisher, x.author, x.price ? WON(x.price) : "", x.units ? `단원 ${x.units}개` : ""].filter(Boolean).join(" · "))}</span><span class="hint">${x.isbn13 ? "ISBN " + esc(x.isbn13) : "ISBN 없음"}${has(x) ? " · 이미 라이브러리에 있어요" : ""}${x.err ? " · 정보를 못 받았어요: " + esc(x.err) : ""}</span></span></label>`;
  const list = F.res.length ? `<div class="bfl">${F.res.map(row).join("")}</div>` : `<div class="hint bfe">${esc(F.msg || (T === "s" ? "책 이름 · 출판사 · ISBN으로 찾아요(국립중앙도서관). 예: 쎈 중등 수학" : "교보문고 책 상세 주소를 붙여 넣고 [가져오기]를 눌러요. ISBN 13자리도 돼요."))}</div>`;
  const body = T === "m"
    ? `<div class="hint">찾아도 없는 책 · 자체 교재는 직접 적어 등록해요(교재명 · 출판사 · 시리즈 · 가격 · 분량 · ISBN · 단원).</div><div class="row"><button class="btn" id="bfM">${IC("plus", "s")}직접 등록</button></div>`
    : `${T === "k" ? lbGrabBox(F) : ""}<div class="bfq">${T === "s" ? `<span class="searchbox">${IC("search")}<input class="inp" id="bfQ" placeholder="책 이름 · 출판사 · ISBN" value="${esc(F.q)}" autocomplete="off"></span>` : `<textarea class="inp bfta" id="bfQ" placeholder="교보문고 책 주소 또는 ISBN을 붙여 넣으세요(Ctrl+V)">${esc(F.q)}</textarea>`}<button class="btn" id="bfGo" ${F.busy ? "disabled" : ""}>${T === "s" ? "검색" : "가져오기"}</button></div>${F.busy ? `<div class="hint">${esc(F.busy)}</div>` : ""}${list}${F.res.length && F.msg ? `<div class="hint warn">${esc(F.msg)}</div>` : ""}`;
  return `${PANEL.head({ icon: IC("search"), name: "책 찾기", belong: "교재 추가" })}${PANEL.tabs([{ id: "s", label: "검색" }, { id: "k", label: "교보문고" }, { id: "m", label: "직접 등록" }], T, "bt")}
  <div class="box"><h3>${T === "s" ? "검색해서 추가" : T === "k" ? "교보문고에서 가져오기" : "직접 등록"}${HELP("고른 책을 노션 라이브러리에 바로 등록해요 — 교재명 · 출판사 · 시리즈 · 가격 · 분량 · ISBN · 표지(교보문고)와 단원 목록에서 나눈 단원까지. 단원 목록이 없으면 단원 없이 들어가요 — 교재 창 [단원] 탭 [단원 편집]에서 넣어요. 과목은 등록한 뒤 줄을 눌러 넣어요. 이미 라이브러리에 있는 책(같은 ISBN)은 고를 수 없어요.")}</h3>${body}</div>
  ${PANEL.foot({ back: { id: "bfX", label: "닫기" }, go: T === "m" ? null : { id: "bfAdd", icon: IC("plus", "s"), label: "라이브러리에 등록", off: !n || !!F.busy, count: n || "", title: "고른 책을 노션 라이브러리에 등록해요" } })}`;
}
function lbFindBind(p, st) {
  const F = st.bfind;
  const draw = () => { if (activeTab && activeTab.state === st && st.bfind === F) render(); };
  p.querySelectorAll("img[data-alt]").forEach((img) => { img.onerror = () => { const a = img.dataset.alt; img.removeAttribute("data-alt"); if (a) img.src = a; else img.replaceWith(Object.assign(document.createElement("span"), { className: "bkph", innerHTML: "<i>표지 없음</i>" })); }; });
  p.querySelectorAll("[data-bt]").forEach((x) => (x.onclick = () => { if (F.T === x.dataset.bt || F.busy) return; st.bfind = { T: x.dataset.bt, q: "", res: [], picks: [], msg: "" }; render(); const i = document.querySelector("#lp #bfQ"); if (i) i.focus(); }));
  const go = async () => {
    const inp = p.querySelector("#bfQ"), q = inp ? inp.value.trim() : "";
    F.q = q; F.picks = []; F.res = []; F.msg = "";
    if (!q) { F.msg = F.T === "s" ? "찾을 책 이름을 넣어요" : "교보문고 책 주소나 ISBN 13자리를 붙여 넣어요"; return draw(); }
    F.busy = F.T === "s" ? "찾는 중…" : "교보문고에서 가져오는 중…"; draw();
    try {
      const pid = (q.match(/\bS\d{9,15}\b/) || [])[0], isbn = (q.replace(/[-\s]/g, "").match(/97[89]\d{10}/) || [])[0];
      if (F.T === "k" && pid) {
        const r = await liveBookApi({ action: "kyobo-book", pid });
        const units = ((r.toc && r.toc.units) || []).filter((u) => u.include !== false).map((u) => ({ name: u.name, page: u.page }));
        F.res = [{ src: "kyobo", title: r.title || "", isbn13: r.isbn13 || "", price: r.price, publisher: r.publisher || "", cover: r.isbn13 ? lbKyoboCover(r.isbn13) : "", units: units.length, unitList: units }];
        if (!F.res[0].title) { F.res = []; F.msg = "교보문고에서 교재명을 받지 못했어요 — [직접 등록]으로 적어요"; }
      } else if (F.T === "k" && !isbn) {
        F.msg = "교보문고 책 상세 주소(product.kyobobook.co.kr/detail/S…)나 ISBN 13자리를 붙여 넣어요";
      } else {
        const r = await liveBookApi({ action: "search", query: F.T === "k" ? isbn : q });
        F.res = (r.books || []).map((b) => Object.assign({ src: "search" }, b));
        if (!F.res.length) F.msg = `"${q}"로 찾은 책이 없어요 — 다른 말로 찾거나 [교보문고] · [직접 등록]을 써요`;
      }
      if (F.T === "k" && F.res.length === 1 && !F.res[0].registered) F.picks = [0];
    } catch (e) { F.msg = lbErr(e); }
    F.busy = ""; draw();
    const i = document.querySelector("#lp #bfQ"); if (i) { i.focus(); if (i.setSelectionRange && F.T === "s") i.setSelectionRange(i.value.length, i.value.length); }
  };
  const grabFill = async (raw) => {
    let d = null; try { d = JSON.parse(String(raw || "").trim()); } catch (_) {}
    const bad = () => { F.grabTa = false; F.res = []; F.picks = []; F.msg = "교보문고에서 가져온 정보가 아니에요 — 교보문고 책 페이지에서 [교재 가져오기]를 다시 누른 뒤 붙여넣어요"; draw(); };
    if (!d || (d.hada !== "book" && d.hada !== "books")) return bad();
    F.grabTa = false; F.msg = ""; F.q = "";
    if (d.hada === "book") {
      if (!String(d.title || "").trim()) return bad();
      F.busy = "단원을 나누는 중…"; draw();
      let units = [], note = "";
      if (d.toc) { try { const r = await liveBookApi({ action: "parse", text: String(d.toc).slice(0, 20000) }); units = ((r.toc && r.toc.units) || []).filter((u) => u.include !== false).map((u) => ({ name: u.name, page: u.page })); } catch (e) { note = "단원 목록을 나누지 못했어요 — 단원 없이 들어가요. " + lbErr(e); } }
      else note = "교보문고에 단원 목록이 없어서 단원 없이 들어가요 — 교재 창 [단원] 탭 [단원 편집]에서 넣어요";
      const isbn = /^97[89]\d{10}$/.test(String(d.isbn13)) ? String(d.isbn13) : "";
      F.res = [{ src: "kyobo", title: String(d.title).trim().slice(0, 200), isbn13: isbn, price: +d.price > 0 ? Math.round(+d.price) : null, publisher: String(d.publisher || ""), cover: isbn ? lbKyoboCover(isbn) : /^https:\/\/contents\.kyobobook\.co\.kr\//.test(String(d.cover || "")) ? String(d.cover) : "", units: units.length, unitList: units }];
      F.msg = note; F.busy = "";
      if (!F.res[0].registered && !DB.books.some((b) => !b.del && isbn && b.isbn === isbn)) F.picks = [0];
      return draw();
    }
    const items = (Array.isArray(d.items) ? d.items : []).filter((x) => /^S\d{9,15}$/.test(String(x && x.pid))).slice(0, 20);
    if (!items.length) return bad();
    const mine = (F.res = items.map((x) => { const isbn = /^97[89]\d{10}$/.test(String(x.isbn13)) ? String(x.isbn13) : ""; return { src: "kyobo", pid: String(x.pid), title: String(x.title || "").trim().slice(0, 200), isbn13: isbn, price: null, publisher: "", cover: isbn ? lbKyoboCover(isbn) : "", units: 0, unitList: [] }; }));
    F.picks = []; let ok = 0;
    for (let k = 0; k < mine.length; k++) {
      if (st.bfind !== F || F.res !== mine) return;
      F.busy = `${k + 1}/${mine.length}권 정가 · 출판사 · 단원을 교보문고에서 가져오는 중…`; draw();
      const z = mine[k];
      try {
        const r = await liveBookApi({ action: "kyobo-book", pid: z.pid });
        if (!z.title) z.title = r.title || "";
        if (!z.isbn13 && r.isbn13) { z.isbn13 = r.isbn13; z.cover = lbKyoboCover(r.isbn13); }
        z.price = r.price || null; z.publisher = r.publisher || "";
        z.unitList = ((r.toc && r.toc.units) || []).filter((u) => u.include !== false).map((u) => ({ name: u.name, page: u.page })); z.units = z.unitList.length;
        ok++;
      } catch (e) { z.err = lbErr(e); }
    }
    if (st.bfind !== F) return;
    F.picks = mine.map((z, i) => i).filter((i) => !mine[i].err && !(mine[i].isbn13 && DB.books.some((b) => !b.del && b.isbn === mine[i].isbn13)));
    F.busy = ""; F.msg = ok === mine.length ? `${ok}권 정보를 채웠어요 — 확인하고 [라이브러리에 등록]을 눌러요` : `${mine.length}권 중 ${ok}권만 채웠어요 — 못 채운 책은 교재명 · 표지만 있어요(책 상세 페이지에서 한 권씩 가져와요)`;
    draw();
  };
  const gp = p.querySelector("#bfPaste");
  if (gp) gp.onclick = async () => {
    let t = ""; try { t = await navigator.clipboard.readText(); } catch (_) {}
    if (t && t.trim().startsWith("{")) return grabFill(t);
    F.grabTa = true; F.msg = ""; draw(); const ta = document.querySelector("#lp #bfGrabTa"); if (ta) ta.focus();
  };
  const gt = p.querySelector("#bfGrabTa");
  if (gt) { gt.addEventListener("paste", (e) => { e.preventDefault(); grabFill(e.clipboardData.getData("text")); }); gt.addEventListener("input", () => { if (gt.value.trim().endsWith("}")) grabFill(gt.value); }); }
  const gl = p.querySelector("#bfGrab");
  if (gl) gl.onclick = (e) => { e.preventDefault(); toast("[교재 가져오기]는 여기서 누르지 않고, 즐겨찾기 막대로 끌어다 놓은 뒤 교보문고 책 페이지에서 눌러요"); };
  const g = p.querySelector("#bfGo");
  if (g) { g.onclick = go; const inp = p.querySelector("#bfQ"); if (inp && F.T === "s") inp.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(); } }; }
  p.querySelectorAll("[data-bf]").forEach((c) => (c.onchange = () => { const i = +c.dataset.bf; F.picks = c.checked ? [...F.picks, i] : F.picks.filter((z) => z !== i); const l = p.querySelector(".bfl"), sc = l ? l.scrollTop : 0; render(); const l2 = document.querySelector("#lp .bfl"); if (l2) l2.scrollTop = sc; }));
  const x = p.querySelector("#bfX"); if (x) x.onclick = () => { if (F.busy) return; st.bfind = null; panelOpen = false; render(); };
  const mk = p.querySelector("#bfM"); if (mk) mk.onclick = () => liveBookRegisterOpen("교재");
  const add = p.querySelector("#bfAdd");
  if (add) add.onclick = async () => {
    const items = F.picks.map((i) => F.res[i]).filter(Boolean);
    if (!items.length || F.busy) return;
    const fail = [];
    let ok = 0, noCover = 0;
    for (let k = 0; k < items.length; k++) {
      const z = items[k];
      F.busy = `${k + 1}/${items.length}권 등록 중… ${z.title}`; draw();
      try {
        if (z.src === "kyobo") {
          const body = { action: "register-custom", title: z.title, units: z.unitList || [], kind: "교재" };
          if (z.isbn13) { body.isbn13 = z.isbn13; body.cover = lbKyoboCover(z.isbn13); }
          if (z.price) body.price = z.price;
          if (z.publisher && lbOpts("pub").includes(z.publisher)) body.publisher = z.publisher; /* 노션 출판사 선택지에 있을 때만(없으면 비워 둠) */
          const o = await liveBookApi(body); if (o && o.cover === false) noCover++;
        } else {
          let units = [];
          try { const d = await liveBookApi({ action: "detail", isbn13: z.isbn13 }); units = ((d.toc && d.toc.units) || []).filter((u) => u.include !== false).map((u) => ({ name: u.name, page: u.page })); } catch (_) { /* 목차를 못 받으면 단원 없이 */ }
          const o = await liveBookApi({ action: "register", isbn13: z.isbn13, title: z.title, cover: "kyobo", units }); if (o && o.cover === false) noCover++;
        }
        z.registered = true; ok++;
      } catch (e) { fail.push(`${z.title}: ${e.status === 409 ? "이미 라이브러리에 있어요" : lbErr(e)}`); }
    }
    F.busy = ""; F.picks = [];
    if (fail.length) { F.msg = `${ok}권 등록 · ${fail.length}권 못 함 — ${fail.join(" / ")}`; draw(); }
    else { st.bfind = null; panelOpen = false; render(); }
    if (ok) await lbAfterAdd(`${ok}권을 라이브러리에 등록했어요 — 과목은 줄을 눌러 넣어요${noCover ? ` · 표지를 못 찾은 ${noCover}권은 표지 없이 넣었어요(교재 창 [표지]에서 올려요)` : ""}`);
  };
}

/* ───── 단원(교재 창 [단원] 탭) ───── */
function lbUnitsLoad(id, force) {
  const c = LBK.units[id];
  if (c && (c.loading || (c.list && !force))) return;
  LBK.units[id] = { loading: true, list: c && c.list, err: "" };
  liveBookApi({ action: "units", bookId: id }).then((r) => { LBK.units[id] = { list: r.units || [] }; }, (e) => { LBK.units[id] = { list: c && c.list, err: lbErr(e) }; }).then(() => { try { render(); } catch (_) {} });
}
function lbUnitBox(b) {
  if (!window.LIVE || !window.LIVE.loaded) return lbUnitBox0(b);
  if (!b || !b.id || (typeof appsIsId === "function" && !appsIsId(b.id))) return '<div class="box"><h3>단원</h3><div class="hint">노션에 등록한 뒤에 단원을 넣어요</div></div>';
  const c = LBK.units[b.id];
  if (!c) setTimeout(() => lbUnitsLoad(b.id), 0);
  const us = (c && c.list) || [];
  const rows = c && c.list ? (us.length ? `<div class="unrows">${us.map((u) => `<div class="unrow"><span class="unt">${esc(u.name || "이름 없음")}</span><span class="unv">${u.page != null ? esc(unitFmt(b, u.page)) : ""}${u.uses ? ` <span class="hint" title="시험 범위 등 다른 곳에 연결돼 삭제할 수 없어요">연결 ${u.uses}</span>` : ""}</span></div>`).join("")}</div>` : '<div class="hint">아직 단원이 없어요 — [단원 편집]에서 붙여 넣거나 가져와요</div>') : `<div class="hint">${c && c.err ? esc(c.err) : "단원을 불러오는 중…"}</div>`;
  /* 261126 대표(B안): 머리 단추는 [단원 편집] 하나 — 창 안 [고치기 | 붙여넣기 | 가져오기] 탭 */
  return `<div class="box"><h3>단원 <span class="hint">${c && c.list ? us.length + "개" : ""}</span>${HELP(HELPTX.unitBox)}<span class="sp"></span><button class="lnk" data-lbu="edit" data-bk="${esc(b.id)}">${IC("pen", "s")}단원 편집</button></h3>${rows}${c && c.err && c.list ? `<div class="hint warn">${esc(c.err)}</div>` : ""}</div>`;
}
/* 단원 단계(261127 대표, 항목 164 — 단원 편집 > 붙여넣기 · 가져오기 [나누기]): 글의 줄을 꼴로 단계에 묶고, 고른 단계 줄만 단원으로 넣는다.
   꼴 = 들여쓰기 · 앞 기호(- • ·) · [..] · 머리말 낱말(Stage · Part · Chapter · Lesson · Unit · Day · 단원 · 장 · 편 · 차시 …) · 번호 꼴(Ⅰ / 1. / 01 / 1-1 / 1.1 / ① / (1) / 가.).
   줄 이름은 적힌 그대로(앞에 없는 번호를 지어 붙이지 않음, 앞 기호만 뗌). 쪽 = 줄 끝 숫자 중 앞에 공백 2칸 이상 · 점선 · 탭 · / · "p." · 뒤 "쪽"이 있는 것,
   또는 그 단계 거의 모든 줄(80%) 끝에 커지는 숫자가 있을 때만 — "구동사 2" · "가정표현 4" 같은 이름 끝 숫자는 쪽이 아니다. 고른 줄에 쪽이 없으면 그 아래 줄의 첫 쪽.
   단계 순서 = 들여쓰기 → 꼴 깊이(Stage · Part · [..] < Chapter · Ⅰ · 단원 < Lesson · Unit · 1. < 1-1 < ① < 앞 기호) → 줄 수 적은 쪽 → 먼저 나온 쪽.
   기본 단계 = 이름이 겹치지 않는 단계 중 가장 깊은 것("Vocabulary 어휘"처럼 되풀이되는 하위 줄 단계는 빼고). 머리말 · 정답 · 차례 같은 번호 없는 줄은 뺀다 */
const LBU_ROMAN = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ";
const LBU_WORD = new RegExp(`^(stage|part|chapter|lesson|unit|section|day|step|week|theme|module|round|session)\\s*(\\d{1,3}|[IVX]{1,5}|[${LBU_ROMAN}]+)(?=[\\s.:)\\]-]|$)`, "i");
const LBU_KO = /^(?:제\s*)?(\d{1,3})\s*(단원|장|편|부|강|차시|과|일차|회)(?=[\s.:)\]]|$)|^(단원|차시)\s*(\d{1,3})(?=[\s.:)\]]|$)/;
const LBU_SKIP = /(정답|해설|머리말|차례|목차|부록|이\s*책의|구성과\s*특징|찾아보기|학습\s*계획|index)/i;
const LBU_OPEN = /^[[【〔〈《<]\s*/, LBU_CLOSE = /\s*[\]】〕〉》>]\s*$/;
function lbUnitShape(s) {
  let m;
  if ((m = s.match(LBU_OPEN))) { const inner = s.slice(m[0].length).replace(LBU_CLOSE, ""), sh = lbUnitShape(inner); return { key: "[" + sh.key, rank: Math.min(sh.rank, 0), label: sh.label || "[ ]", mark: sh.word ? sh.mark : inner, word: true }; }
  if ((m = s.match(LBU_WORD))) { const w = m[1].toLowerCase(); return { key: "w:" + w, rank: /^(stage|part|theme)$/.test(w) ? 0 : w === "chapter" ? 1 : 2, label: m[1], mark: m[0], word: true }; }
  if ((m = s.match(LBU_KO))) { const w = m[2] || m[3]; return { key: "k:" + w, rank: /^(편|부)$/.test(w) ? 0 : /^(장|단원)$/.test(w) ? 1 : 2, label: w, mark: m[0], word: true }; }
  if ((m = s.match(new RegExp(`^[${LBU_ROMAN}]+(?=[\\s.)]|$)|^[IVX]{1,5}[.)](?=\\s)`)))) return { key: "roman", rank: 1, label: "Ⅰ", mark: m[0] };
  if ((m = s.match(/^\d{1,3}((?:\s*-\s*\d{1,3})+)(?=[\s.)]|$)/))) { const d = (m[1].match(/-/g) || []).length; return { key: "n-n" + d, rank: 2 + d, label: "1" + "-1".repeat(d), mark: m[0] }; }
  if ((m = s.match(/^\d{1,3}((?:\.\d{1,3})+)(?=[\s)]|\.\s|$)/))) { const d = (m[1].match(/\./g) || []).length; return { key: "n.n" + d, rank: 2 + d, label: "1" + ".1".repeat(d), mark: m[0] }; }
  if ((m = s.match(/^0\d{1,2}(?=[\s.)]|$)/))) return { key: "0n", rank: 2, label: "01", mark: m[0] };
  if ((m = s.match(/^\d{1,3}(?:\s*[.)]|(?=\s))/))) return { key: "n", rank: 2, label: "1.", mark: m[0] };
  if ((m = s.match(/^[A-Z][.)](?=\s)/))) return { key: "A", rank: 2, label: "A.", mark: m[0] };
  if ((m = s.match(/^[①-⑳]/))) return { key: "circ", rank: 4, label: "①", mark: m[0] };
  if ((m = s.match(/^\(\d{1,3}\)/))) return { key: "paren", rank: 4, label: "(1)", mark: m[0] };
  if ((m = s.match(/^[가-하]\s*[.)](?=\s)/))) return { key: "ga", rank: 4, label: "가.", mark: m[0] };
  return { key: "plain", rank: 2, label: "", mark: "" };
}
/* 줄 끝 쪽: 확실한 꼴(공백 2칸 이상 · 점선 · / · | · p. · 쪽)은 hard, 한 칸 띄운 숫자는 soft(그 단계 거의 모든 줄일 때만 쪽) */
function lbUnitPage(s) {
  const ok = (t, p) => /[가-힣a-z]/i.test(t) && p >= 1 && p <= 2000;
  let m = s.match(/^(.*?\S)(?:\s*[.·…‥_]{2,}\s*|\s*[/|]\s*|\s{2,}|\s*(?=[pP]\.?\s*\d))(?:[pP]\.?\s*)?(\d{1,4})\s*(?:쪽|p)?$/) || s.match(/^(.*?\S)\s*(\d{1,4})\s*쪽$/);
  if (m && ok(m[1], +m[2])) return { name: m[1].replace(/[\s.·…‥_/|-]+$/, ""), hard: +m[2], soft: null };
  m = s.match(/^(.*?\S)\s(\d{1,4})$/);
  if (m && ok(m[1], +m[2])) return { name: s, hard: null, soft: +m[2], softName: m[1] };
  return { name: s, hard: null, soft: null };
}
function lbUnitLevels(text) {
  const lines = [];
  String(text || "").split(/\r?\n/).forEach((raw) => {
    if (!raw.trim()) return;
    const lead = raw.match(/^[\s　]*/)[0], ind = lead.replace(/\t/g, "    ").replace(/　/g, "  ").length;
    let s = raw.slice(lead.length).trim(), bul = false;
    const bm = s.match(/^[-–—•·∙◦▪▫‣*ㆍ・○●□■▶▷>]+\s*/); if (bm && s.length > bm[0].length) { bul = true; s = s.slice(bm[0].length).trim(); }
    const sh = lbUnitShape(s);
    if (sh.key === "plain" && LBU_SKIP.test(s)) return;
    lines.push({ ind, bul, sh, pg: lbUnitPage(s), key: `${ind > 0 ? 1 : 0}|${bul ? 1 : 0}|${sh.key}` });
  });
  /* 번호 없는 줄이 같은 자리의 번호 줄(1. · Lesson 1 …) 단계 하나와 섞여 있고 더 큰 단계가 없으면 그 번호 줄 단계로 */
  const top = [...new Set(lines.filter((l) => l.key.startsWith("0|0|")).map((l) => l.key))], P0 = "0|0|plain";
  const peers = top.filter((k) => k !== P0);
  if (top.includes(P0) && peers.length === 1 && lines.find((l) => l.key === peers[0]).sh.rank === 2) lines.forEach((l) => { if (l.key === P0) l.key = peers[0]; });
  const by = new Map();
  lines.forEach((l, i) => { if (!by.has(l.key)) by.set(l.key, { key: l.key, first: i, lines: [], ind: l.ind, rank: l.bul ? 5 : l.sh.rank, sh: l.sh, bul: l.bul }); by.get(l.key).lines.push(l); });
  const levels = [...by.values()].sort((a, b) => (a.ind > 0) - (b.ind > 0) || a.rank - b.rank || a.lines.length - b.lines.length || a.first - b.first);
  const seen = {};
  levels.forEach((g, d) => {
    g.depth = d;
    let lb = g.sh.label || (g.bul || g.ind > 0 ? "하위" : "이름만");
    if (seen[lb]) lb += " " + (d + 1);
    seen[lb] = 1; g.label = lb; g.count = g.lines.length;
    /* soft 쪽: 그 단계 줄의 80% 이상(2줄 이상)이 끝 숫자를 갖고, 숫자가 커지기만 하고, 1씩 느는 번호(1 · 2 · 3)가 아닐 때만 */
    const ps = g.lines.map((l) => (l.pg.hard != null ? l.pg.hard : l.pg.soft)).filter((v) => v != null);
    const inc = ps.every((v, k) => !k || v > ps[k - 1]), step1 = ps.length >= 3 && ps.every((v, k) => !k || v - ps[k - 1] === 1);
    const soft = ps.length >= 2 && ps.length >= Math.ceil(g.lines.length * 0.8) && inc && !step1;
    g.lines.forEach((l) => { l.depth = d; const sp = soft && l.pg.soft != null; l.name = sp ? l.pg.softName : l.pg.name; l.page = l.pg.hard != null ? l.pg.hard : sp ? l.pg.soft : null; });
  });
  const uniq = levels.filter((g) => new Set(g.lines.map((l) => l.name.toLowerCase())).size === g.lines.length);
  const def = uniq.length ? uniq[uniq.length - 1] : levels[0];
  return { lines, levels: levels.map((g) => ({ key: g.key, label: g.label, count: g.count, depth: g.depth })), def: def ? def.key : "" };
}
/* 고른 단계 줄 → [{name, page}]. up = 윗 단계 이름 붙이기("Chapter 01 · Unit 01 영어문장 1형") */
function lbUnitPick(text, key, up) {
  const L = lbUnitLevels(text), ls = L.lines, k = L.levels.some((g) => g.key === key) ? key : L.def;
  const out = [];
  ls.forEach((l, i) => {
    if (l.key !== k) return;
    let page = l.page, name = l.name;
    for (let j = i + 1; page == null && j < ls.length && ls[j].depth > l.depth; j++) page = ls[j].page;
    if (up) for (let j = i - 1; j >= 0; j--) if (ls[j].depth < l.depth) { const p = ls[j]; name = (p.sh.word && p.sh.mark ? p.sh.mark : p.name).replace(/[\s.:]+$/, "") + " · " + name; break; }
    out.push({ name: name.slice(0, 100), page });
  });
  return out;
}
const lbIsbn = (b) => { const s = String((b && b.isbn) || "").replace(/[-\s]/g, ""); return /^97[89]\d{10}$/.test(s) ? s : ""; };
/* 단원 편집 창(261126 대표 B안): [고치기 | 붙여넣기 | 가져오기] 탭 하나 창. 고친 줄(rows)은 탭을 옮겨도 그대로, [저장]은 창 아래 하나(edit-units 한 번).
   처음 탭: 단원 있으면 고치기 · 없고 ISBN13 있으면 가져오기 · 둘 다 없으면 붙여넣기. 붙여넣기 · 가져오기의 [나누기]는 parse 그대로 → 고치기 탭 아래에 붙는다(같은 이름 건너뜀) */
function lbUnitDialog(b, tab0) {
  const c = LBK.units[b.id];
  if (!c || !c.list) { toast("단원을 불러온 뒤에 편집해요"); lbUnitsLoad(b.id); return; }
  const rows = c.list.map((u) => ({ id: u.id, name: u.name || "", page: u.page == null ? "" : String(u.page), name0: u.name || "", page0: u.page == null ? "" : String(u.page), uses: u.uses || 0, del: false }));
  const UU = unitParts(b), isbn = lbIsbn(b);
  const T = { tab: tab0 || (rows.length ? "edit" : isbn ? "fetch" : "paste"), raw: "", src: "" };
  const TABS = [["edit", "고치기"], ["paste", "붙여넣기"], ["fetch", "가져오기"]];
  modal(`<h2>단원 편집${HELP(HELPTX.unitEdit)}</h2><div class="hint">${esc(b.name)}</div>
    <div class="row"><span class="vseg subseg" id="lbuTabs" role="tablist" aria-label="단원 편집 방법">${TABS.map(([k, t]) => `<button type="button" role="tab" data-ut="${k}">${t}</button>`).join("")}</span></div>
    <div data-up="edit">
      <div class="unrows" id="lbuR" style="max-height:46vh;overflow:auto"></div>
      <button type="button" class="pgaddc ln" id="lbuAdd">${IC("plus", "s")}단원 추가</button>
      <div class="row" id="lbuO" style="display:none"><button type="button" class="btn sm" id="lbuSort" title="시작 쪽이 작은 단원부터 위로 — 쪽을 안 적은 줄은 맨 아래">${IC("aup", "s")}쪽 순서로 정렬</button></div>
    </div>
    <div data-up="paste" hidden>
      <textarea class="inp bfta tall" id="lbuT" aria-label="단원 목록" placeholder="단원 목록을 붙여 넣어 주세요 — 한 줄에 하나, 끝 숫자는 시작 쪽&#10;1. 소인수분해 8&#10;2. 정수와 유리수 28&#10;3. 문자와 식 56"></textarea>
      <div class="row lburow"><span class="hint" data-lvh="T">단원 단계</span><span class="vseg subseg" data-lv="T" role="radiogroup" aria-label="단원으로 쓸 단계"></span><label class="hint" style="white-space:nowrap" data-lvh="T"><input type="checkbox" data-lvup="T"> 윗 단계 이름 붙이기</label><span class="sp"></span><button type="button" class="btn" id="lbuSplit">나누기</button></div>
    </div>
    <div data-up="fetch" hidden>
      <div class="row"><span class="hint">ISBN13 ${isbn ? esc(isbn) : "없음"}</span><span class="sp"></span><button type="button" class="btn" id="lbuGet" ${isbn ? "" : 'disabled title="ISBN13을 먼저 넣어 주세요"'}>${IC("dl", "s")}가져오기</button></div>
      ${isbn ? "" : '<div class="hint warn" id="lbuNoIsbn">ISBN13을 먼저 넣어 주세요 — 교재 창 [정보] 탭의 ISBN13 칸</div>'}
      <textarea class="inp bfta tall" id="lbuF" aria-label="가져온 단원 목록" placeholder="${isbn ? "[가져오기]를 누르면 온라인 서점의 단원 목록이 여기에 들어와요 — 고친 뒤 [나누기]" : ""}" ${isbn ? "" : "disabled"}></textarea>
      <div class="row lburow"><span class="hint" data-lvh="F">단원 단계</span><span class="vseg subseg" data-lv="F" role="radiogroup" aria-label="단원으로 쓸 단계"></span><label class="hint" style="white-space:nowrap" data-lvh="F"><input type="checkbox" data-lvup="F" ${isbn ? "" : "disabled"}> 윗 단계 이름 붙이기</label><span class="sp"></span><button type="button" class="btn" id="lbuSplitF" ${isbn ? "" : "disabled"}>나누기</button></div>
    </div>
    <p class="hint" id="lbuM"></p>
    <div class="actions"><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">저장</button></div>`, (m, close) => {
    const box = m.querySelector("#lbuR"), msg = m.querySelector("#lbuM");
    const show = (k) => {
      T.tab = k;
      m.querySelectorAll("[data-ut]").forEach((x) => { const on = x.dataset.ut === k; x.classList.toggle("on", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
      m.querySelectorAll("[data-up]").forEach((x) => { x.hidden = x.dataset.up !== k; });
    };
    m.querySelectorAll("[data-ut]").forEach((x) => (x.onclick = () => { msg.textContent = ""; show(x.dataset.ut); }));
    const draw = () => {
      box.innerHTML = rows.map((r, i) => `<div class="unrow ed${r.del ? " sdel" : ""}" data-i="${i}"><input class="inp unn" data-f="name" value="${esc(r.name)}" placeholder="단원 이름 (예: 1. 소인수분해)" autocomplete="off" aria-label="단원 이름" ${r.del ? "disabled" : ""}>${UU[0] ? `<span class="unu">${esc(UU[0])}</span>` : ""}<input class="inp unp" data-f="page" value="${esc(r.page)}" placeholder="시작" inputmode="numeric" autocomplete="off" aria-label="시작" ${r.del ? "disabled" : ""}>${UU[1] ? `<span class="unu">${esc(UU[1])}</span>` : ""}<button type="button" class="anb" data-addb="${i}" title="아래에 추가" aria-label="이 단원 아래에 추가">${IC("plus", "s")}</button>${r.uses ? `<span class="hint" title="다른 곳에 연결돼 삭제할 수 없어요">연결 ${r.uses}</span>` : `<button type="button" class="anb" data-del="${i}" title="${r.del ? "삭제 취소" : "이 단원 삭제"}">${IC(r.del ? "rotc" : "x", "s")}</button>`}</div>`).join("") || '<div class="hint">단원이 없어요</div>';
      box.querySelectorAll("input").forEach((inp) => { inp.oninput = () => { const r = rows[+inp.closest("[data-i]").dataset.i]; r[inp.dataset.f] = inp.value; }; });
      box.querySelectorAll("[data-del]").forEach((x) => (x.onclick = () => { const i = +x.dataset.del, r = rows[i]; if (!r.id) rows.splice(i, 1); else r.del = !r.del; draw(); }));
      box.querySelectorAll("[data-addb]").forEach((x) => (x.onclick = () => { const i = +x.dataset.addb; rows.splice(i + 1, 0, { name: "", page: "", del: false }); draw(); const l = box.querySelectorAll(".unn")[i + 1]; if (l) { l.focus(); l.scrollIntoView({ block: "nearest" }); } }));
      box.querySelectorAll('input[data-f="page"]').forEach((inp) => inp.addEventListener("input", orderNote));
      orderNote();
    };
    /* 261126 대표: 줄 순서가 시작 쪽 순과 어긋날 때만 [쪽 순서로 정렬] 단추 — 누르면 시작 쪽 오름차순(쪽 빈 줄은 맨 아래, 같은 쪽은 원래 순서). 저장 값 · 서버 호출은 그대로 */
    const orderNote = () => {
      const ps = rows.filter((r) => !r.del).map((r) => { const s = String(r.page || "").replace(/[^\d]/g, ""); return s ? +s : null; }).filter((v) => v != null);
      const o = m.querySelector("#lbuO"); if (o) o.style.display = ps.some((v, k) => k && v < ps[k - 1]) ? "" : "none";
    };
    m.querySelector("#lbuSort").onclick = () => {
      const pn = (r) => { const s = String(r.page || "").replace(/[^\d]/g, ""); return s ? +s : Infinity; };
      const keyed = rows.map((r, i) => ({ r, i, p: pn(r) }));
      keyed.sort((a, b) => (a.p === b.p ? a.i - b.i : a.p < b.p ? -1 : 1));
      rows.splice(0, rows.length, ...keyed.map((k) => k.r)); draw();
    };
    draw(); show(T.tab);
    m.querySelector("#lbuAdd").onclick = () => { rows.push({ name: "", page: "", del: false }); draw(); const l = box.querySelectorAll(".unn"); if (l.length) l[l.length - 1].focus(); box.scrollTop = box.scrollHeight; };
    /* 단원 단계(항목 164): 글 칸마다 단계 나눔 단추(이름 + 줄 수) — 단계가 둘 이상일 때만. 고른 단계는 글을 고쳐도 그 꼴이 남아 있으면 그대로 */
    const LV = { T: { key: "", up: false }, F: { key: "", up: false } };
    const lvDraw = (w) => {
      const ta = m.querySelector(w === "F" ? "#lbuF" : "#lbuT"), L = lbUnitLevels(ta.value), seg = m.querySelector(`[data-lv="${w}"]`);
      if (!L.levels.some((g) => g.key === LV[w].key)) LV[w].key = L.def;
      const many = L.levels.length > 1;
      seg.style.display = many ? "" : "none"; m.querySelectorAll(`[data-lvh="${w}"]`).forEach((x) => (x.style.display = many ? "" : "none"));
      seg.innerHTML = many ? L.levels.map((g) => `<button type="button" role="radio" data-lvk="${esc(g.key)}" class="${g.key === LV[w].key ? "on" : ""}" aria-checked="${g.key === LV[w].key}">${esc(g.label)} <span class="n">${g.count}</span></button>`).join("") : "";
      seg.querySelectorAll("[data-lvk]").forEach((x) => (x.onclick = () => { LV[w].key = x.dataset.lvk; lvDraw(w); }));
    };
    ["T", "F"].forEach((w) => {
      m.querySelector(w === "F" ? "#lbuF" : "#lbuT").addEventListener("input", () => lvDraw(w));
      m.querySelector(`[data-lvup="${w}"]`).onchange = (ev) => { LV[w].up = ev.currentTarget.checked; };
      lvDraw(w);
    });
    /* 나누기(붙여넣기 · 가져오기 공용): 고른 단계 줄만 이름 그대로(lbUnitPick, 서버 parse 안 부름) → 지금 줄 뒤에 붙이고(같은 이름 건너뜀) [고치기] 탭으로 */
    const split = async (ta, btn) => {
      const t = ta.value; if (!t.trim()) { msg.textContent = "나눌 단원 목록이 없어요"; return; }
      btn.disabled = true; msg.textContent = "";
      try {
        const w = ta.id === "lbuF" ? "F" : "T", got = lbUnitPick(t.slice(0, 20000), LV[w].key, LV[w].up);
        const have = new Set(rows.filter((z) => !z.del).flatMap((z) => [z.name.trim(), z.name0 || ""])); /* 서버와 같이: 지금 이름 + 노션에 있는 원래 이름은 새로 만들지 않음 */
        const add = got.filter((u) => !have.has(u.name));
        add.forEach((u) => rows.push({ name: u.name, page: u.page == null ? "" : String(u.page), del: false }));
        if (add.length) { ta.value = ""; if (ta.id === "lbuF") T.raw = ""; lvDraw(w); }
        draw(); show("edit"); box.scrollTop = box.scrollHeight;
        msg.textContent = add.length ? `${add.length}개 단원으로 나눴어요 — 확인하고 [저장]을 눌러요` : "새로 추가할 단원이 없어요(같은 이름은 건너뜀)";
      } catch (e) { msg.textContent = lbErr(e); } finally { btn.disabled = false; }
    };
    m.querySelector("#lbuSplit").onclick = (ev) => split(m.querySelector("#lbuT"), ev.currentTarget);
    m.querySelector("#lbuSplitF").onclick = (ev) => split(m.querySelector("#lbuF"), ev.currentTarget);
    /* 가져오기: units-fetch(교보문고 → 예스24) 글을 칸에 그대로 채움 — 단원으로 쓸 단계는 아래 단계 나눔 단추로 */
    const fill = () => { const f = m.querySelector("#lbuF"); if (T.raw) { f.value = T.raw; LV.F.key = ""; lvDraw("F"); } };
    m.querySelector("#lbuGet").onclick = async (ev) => {
      if (!isbn) return;
      const btn = ev.currentTarget; btn.disabled = true; msg.textContent = "온라인 서점에서 단원 목록을 받는 중…";
      try {
        const r = await liveBookApi({ action: "units-fetch", isbn13: isbn });
        if (r && r.found && String(r.text || "").trim()) {
          T.raw = String(r.text); T.src = r.source === "yes24" ? "예스24" : "교보문고"; fill();
          msg.textContent = `${T.src}에서 단원 목록을 가져왔어요 — 고친 뒤 [나누기]를 눌러요`;
        } else msg.textContent = "이 ISBN으로 단원을 찾지 못했어요";
      } catch (e) { msg.textContent = lbErr(e); } finally { btn.disabled = false; }
    };
    m.querySelector("#cc").onclick = close;
    const ok = m.querySelector("#co");
    ok.onclick = async () => {
      const num = (v) => { const s = String(v || "").replace(/[^\d]/g, ""); return s ? +s : null; };
      const update = rows.filter((r) => r.id && !r.del && (r.name.trim() !== r.name0 || String(num(r.page) ?? "") !== r.page0)).map((r) => ({ id: r.id, name: r.name.trim(), page: num(r.page) }));
      const remove = rows.filter((r) => r.id && r.del).map((r) => r.id);
      const add = rows.filter((r) => !r.id && r.name.trim()).map((r) => ({ name: r.name.trim(), page: num(r.page) }));
      if (update.some((u) => !u.name)) { show("edit"); msg.textContent = "이름이 빈 단원이 있어요 — 이름을 넣거나 [x]로 삭제해요"; return; }
      if (!update.length && !remove.length && !add.length) { close(); return; }
      ok.disabled = true; ok.textContent = "저장 중…"; msg.textContent = "";
      try {
        const r = await liveBookApi({ action: "edit-units", bookId: b.id, update, remove, add });
        close();
        lbUnitsLoad(b.id, true);
        const parts = [r.updated ? `고침 ${r.updated}` : "", r.removed ? `삭제 ${r.removed}` : "", r.added ? `추가 ${r.added}` : ""].filter(Boolean).join(" · ");
        toast(r.ok === false ? r.error : `단원을 저장했어요${parts ? " — " + parts : ""}${r.blocked && r.blocked.length ? ` · 연결돼 삭제하지 않은 단원 ${r.blocked.length}개` : ""}`);
      } catch (e) { ok.disabled = false; ok.textContent = "저장"; msg.textContent = lbErr(e); }
    };
    setTimeout(() => { const t = T.tab === "paste" ? m.querySelector("#lbuT") : T.tab === "fetch" ? m.querySelector(isbn ? "#lbuGet" : "[data-ut='paste']") : m.querySelector(".unn"); if (t) t.focus(); }, 0);
  });
}
document.addEventListener("click", (e) => {
  const x = e.target.closest && e.target.closest("[data-lbu]");
  if (!x || !window.LIVE) return;
  const b = DB.books.find((z) => z.id === x.dataset.bk);
  if (b) lbUnitDialog(b);
});

/* ───── 시리즈 관리 ───── */
/* 노션은 서버가 바꿨다 — 화면 값과 "불러온 값" 기준(APPS_BASE · SAVEDC)을 같이 맞춰 [저장] 숫자에 잡히지 않게 한다. 고치던 줄(작성 중)은 값만 바꾼다 */
function lbSeriesRenamed(from, to) {
  DB.books.forEach((b) => {
    if (b.series !== from) return;
    b.series = to;
    try { const sv = SAVEDC.books && SAVEDC.books.get(b.id); if (sv) { const o = JSON.parse(sv); if (o.series === from) { o.series = to; SAVEDC.books.set(b.id, JSON.stringify(o)); } } } catch (_) {}
    try { const k = "books:" + b.id; if (APPS_BASE.has(k)) { const o = JSON.parse(APPS_BASE.get(k)); if (o["시리즈"] === from) { o["시리즈"] = to; APPS_BASE.set(k, JSON.stringify(o)); } } } catch (_) {}
  });
  try { lastSnap = snapshot(); } catch (_) {}
}
function lbSeriesDialog() {
  const S = { list: null, dup: [], busy: false, msg: "", sure: null };
  modal(`<h2>시리즈 관리${HELP("노션 라이브러리 DB [시리즈] 선택지예요. 교재 창의 [시리즈] 칸에서 골라요. 이름을 바꾸면 그 시리즈 교재가 모두 같이 바뀌어요. 순서는 위아래 화살표로, 삭제는 그 시리즈 교재가 0권일 때만 돼요. 누르면 바로 노션에 들어가요.")}</h2>
    <div class="unrows" id="lbsR" style="max-height:50vh;overflow:auto"><div class="hint">시리즈를 불러오는 중…</div></div>
    <div class="row"><input class="inp" id="lbsN" placeholder="새 시리즈 이름" maxlength="100" autocomplete="off" style="flex:1"><button class="btn" id="lbsAdd">${IC("plus", "s")}추가</button></div>
    <p class="hint" id="lbsM"></p>
    <div class="actions"><span class="sp"></span><button class="btn pri" id="cc">닫기</button></div>`, (m, close) => {
    const box = m.querySelector("#lbsR"), msg = m.querySelector("#lbsM");
    const used = (name) => DB.books.filter((b) => !b.del && b.series === name).length;
    const draw = () => {
      msg.textContent = S.msg || (S.dup.length ? `노션 선택지 중 id가 겹친 것: ${S.dup.join(", ")} — 바꾸면 노션이 정리해요` : "");
      if (!S.list) return;
      box.innerHTML = S.list.length ? S.list.map((o, i) => `<div class="unrow ed" data-i="${i}"><input class="inp unn" value="${esc(o.name)}" aria-label="시리즈 이름" ${S.busy ? "disabled" : ""}><span class="hint">교재 ${used(o.name)}권</span><button type="button" class="anb" data-mv="-1" title="위로" ${i === 0 || S.busy ? "disabled" : ""}>${IC("aup", "s")}</button><button type="button" class="anb" data-mv="1" title="아래로" ${i === S.list.length - 1 || S.busy ? "disabled" : ""}>${IC("adn", "s")}</button><button type="button" class="anb${S.sure === o.id ? " danger" : ""}" data-rm title="${S.sure === o.id ? "한 번 더 누르면 삭제" : "이 시리즈 삭제"}" ${used(o.name) || S.busy ? "disabled" : ""}>${IC(S.sure === o.id ? "trash" : "x", "s")}</button></div>`).join("") : '<div class="hint">시리즈가 없어요 — 아래에서 추가해요</div>';
      box.querySelectorAll("[data-i]").forEach((row) => {
        const i = +row.dataset.i, o = S.list[i], inp = row.querySelector("input");
        const commitName = () => { const n = inp.value.replace(/\s+/g, " ").trim(); if (!n || n === o.name) { inp.value = o.name; return; } run({ op: "rename", id: o.id, name: n }, `'${o.name}' → '${n}'`, o.name, n); };
        inp.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); inp.blur(); } else if (e.key === "Escape") { inp.value = o.name; inp.blur(); } };
        inp.onblur = commitName;
        row.querySelectorAll("[data-mv]").forEach((x) => (x.onclick = () => { const j = i + +x.dataset.mv, ord = S.list.map((z) => z.id); [ord[i], ord[j]] = [ord[j], ord[i]]; run({ op: "order", order: ord }, "순서를 바꿨어요"); }));
        const rm = row.querySelector("[data-rm]"); if (rm) rm.onclick = () => { if (S.sure !== o.id) { S.sure = o.id; return draw(); } S.sure = null; run({ op: "remove", id: o.id }, `'${o.name}'을(를) 삭제했어요`); };
      });
    };
    const apply = (r) => { S.list = r.series || []; S.dup = r.duplicates || []; if (DB.opts) DB.opts.series = S.list.map((o) => o.name); };
    const run = async (body, done, from, to) => {
      if (S.busy) return; S.busy = true; S.msg = "노션에 넣는 중…"; draw();
      try {
        const res = await liveBookApi(Object.assign({ action: "edit-series" }, body));
        apply(res);
        /* 원본 검수 261123: 서버가 ok로 답해도 노션이 이름을 안 바꾼 때가 있다 — 돌아온 목록에 새 이름이 있을 때만 바뀐 것으로 */
        if (from && to && !(res.series || []).some((o) => o.name === to)) { S.msg = "노션이 이름 바꾸기를 받지 않았어요 — 노션 라이브러리 DB [시리즈] 칸에서 직접 바꿔요"; }
        else { if (from && to) lbSeriesRenamed(from, to); S.msg = ""; toast(done); }
      } catch (e) { S.msg = lbErr(e); }
      S.busy = false; draw(); try { render(); } catch (_) {}
    };
    const addBtn = m.querySelector("#lbsAdd"), nIn = m.querySelector("#lbsN");
    addBtn.onclick = () => { const n = nIn.value.replace(/\s+/g, " ").trim(); if (!n) { nIn.focus(); return; } nIn.value = ""; run({ op: "add", name: n }, `시리즈 '${n}'을(를) 추가했어요`); };
    nIn.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addBtn.click(); } };
    m.querySelector("#cc").onclick = close;
    liveBookApi({ action: "series" }).then((r) => { apply(r); draw(); }, (e) => { S.list = []; S.msg = lbErr(e); draw(); });
  });
}

/* 실제 자료 모드에서 한 번 바꿔 끼운다(live.js liveHooks가 부름) */
let lbUnitBox0 = null;
function liveBookHooks() {
  bookFindOpen = () => { const st = activeTab.state; st.bfind = { T: "s", q: "", res: [], picks: [], msg: "" }; st.sel = null; panelOpen = true; render(); setTimeout(() => { const i = document.querySelector("#lp #bfQ"); if (i) i.focus(); }, 0); };
  bookFindHtml = lbFindHtml;
  bookFindBind = lbFindBind;
  LISTS.books_b.add = LISTS.books.add = () => bookFindOpen();
  LISTS.books_b.addLabel = "교재 추가";
  LISTS.books_b.acts = [...(LISTS.books_b.acts || []).filter((a) => a.id !== "lbSeries"), { id: "lbSeries", icon: "layers", plain: true, name: "시리즈 관리", n: () => 1, tip: () => "시리즈 관리 — 노션 [시리즈] 선택지 추가 · 이름 · 순서 · 삭제", run: () => lbSeriesDialog() }];
  if (!lbUnitBox0) { lbUnitBox0 = bookUnitBox; bookUnitBox = lbUnitBox; }
}
