/* 실제 자료 모드의 라이브러리(261123 대표 "모든걸 앱에서" — 옛 라이브러리 웹 화면에만 있던 것을 옮김). 서버 textbook-api는 그대로 부른다(live.js liveBookApi).
   - 책 찾기(오른쪽 창): [검색] search(국립중앙도서관, ISBN이면 그 책) → 고르면 detail(목차 → 단원 후보) → register(ISBN · 교보문고 표지)
                         [교보문고] 책 주소의 상품번호 → kyobo-book(교재명 · ISBN · 정가 · 출판사 · 목차) → register-custom. ISBN만 붙이면 search(ISBN)
                         [직접 등록] 지금 등록 창(live.js liveBookRegisterOpen)
   - 단원(교재 창 [단원] 탭): units로 받아 보이고, [단원 편집] 창 한 화면(항목 167) — 왼쪽 단원 목록 글(붙여 넣기 · 가져오기 units-fetch, 교보문고 → 예스24) → 오른쪽 단원 줄(화면에서 단원 단계 lbUnitPick, 누른 줄만 밑줄 입력으로 고치기 · 끼우기 · 삭제) → edit-units 10개씩 묶어 여러 번(바로 노션, 진행 n/전체 · 중간 실패면 남은 것만 [다시 저장], 항목 165)
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
/* 단원 단계(261127 대표, 항목 164 — 단원 편집 > [단원 목록] 탭 [단원 목록 입력]): 글의 줄을 꼴로 단계에 묶고, 고른 단계 줄만 단원으로 넣는다.
   꼴 = 들여쓰기 · 앞 기호(- • ·) · [..] · 머리말 낱말(Stage · Part · Chapter · Lesson · Unit · Day · 단원 · 장 · 편 · 차시 …) · 번호 꼴(Ⅰ / 1. / 01 / 1-1 / 1.1 / ① / (1) / 가.).
   줄 이름은 적힌 그대로(앞에 없는 번호를 지어 붙이지 않음, 앞 기호만 뗌). 쪽 = 줄 끝 숫자 중 앞에 공백 2칸 이상 · 점선 · 탭 · / · "p." · 뒤 "쪽"이 있는 것,
   또는 그 단계 거의 모든 줄(80%) 끝에 커지는 숫자가 있을 때만 — "구동사 2" · "가정표현 4" 같은 이름 끝 숫자는 쪽이 아니다. 고른 줄에 쪽이 없으면 그 아래 줄의 첫 쪽.
   단계 순서 = 들여쓰기 → 꼴 깊이(Stage · Part · [..] < Chapter · Ⅰ · 단원 < Lesson · Unit · 1. < 1-1 < ① < 앞 기호) → 줄 수 적은 쪽 → 먼저 나온 쪽.
   기본 단계 = 이름이 겹치지 않는 단계 중 가장 깊은 것("Vocabulary 어휘"처럼 되풀이되는 하위 줄 단계는 빼고). 머리말 · 정답 · 차례 같은 번호 없는 줄은 뺀다.
   (항목 165) 번호 꼴 01 · 1 · 1. 은 한 단계(앞자리 0 · 뒤 마침표로 나누지 않음 — 같은 자리면 들여쓰기로만 나뉨). 번호 단계가 있으면 번호 없는 맨 앞 줄("서술형 Practice")은 "그 밖"으로 맨 뒤 · 기본에서 뺌.
   맨 앞 [부록 · 정답 · 해설 · 찾아보기] 줄 아래(다음 Chapter · Ⅰ · Part 같은 큰 머리 전까지)는 부록 — 기본은 빼고 [부록 줄도 넣기]로 넣음 */
const LBU_ROMAN = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ";
const LBU_WORD = new RegExp(`^(stage|part|chapter|lesson|unit|section|day|step|week|theme|module|round|session)\\s*(\\d{1,3}|[IVX]{1,5}|[${LBU_ROMAN}]+)(?=[\\s.:)\\]-]|$)`, "i");
const LBU_KO = /^(?:제\s*)?(\d{1,3})\s*(단원|장|편|부|강|차시|과|일차|회)(?=[\s.:)\]]|$)|^(단원|차시)\s*(\d{1,3})(?=[\s.:)\]]|$)/;
const LBU_SKIP = /(정답|해설|머리말|차례|목차|부록|이\s*책의|구성과\s*특징|찾아보기|학습\s*계획|index)/i;
const LBU_BACK = /^(부록|appendix|정답|해설|찾아보기|index)/i;
const LBU_OPEN = /^[[【〔〈《<]\s*/, LBU_CLOSE = /\s*[\]】〕〉》>]\s*$/;
function lbUnitShape(s) {
  let m;
  if ((m = s.match(LBU_OPEN))) { const inner = s.slice(m[0].length).replace(LBU_CLOSE, ""), sh = lbUnitShape(inner); return { key: "[" + sh.key, rank: Math.min(sh.rank, 0), label: sh.label || "[ ]", mark: sh.word ? sh.mark : inner, word: true }; }
  if ((m = s.match(LBU_WORD))) { const w = m[1].toLowerCase(); return { key: "w:" + w, rank: /^(stage|part|theme)$/.test(w) ? 0 : w === "chapter" ? 1 : 2, label: m[1], mark: m[0], word: true }; }
  if ((m = s.match(LBU_KO))) { const w = m[2] || m[3]; return { key: "k:" + w, rank: /^(편|부)$/.test(w) ? 0 : /^(장|단원)$/.test(w) ? 1 : 2, label: w, mark: m[0], word: true }; }
  if ((m = s.match(new RegExp(`^[${LBU_ROMAN}]+(?=[\\s.)]|$)|^[IVX]{1,5}[.)](?=\\s)`)))) return { key: "roman", rank: 1, label: "Ⅰ", mark: m[0] };
  if ((m = s.match(/^\d{1,3}((?:\s*-\s*\d{1,3})+)(?=[\s.)]|$)/))) { const d = (m[1].match(/-/g) || []).length; return { key: "n-n" + d, rank: 2 + d, label: "1" + "-1".repeat(d), mark: m[0] }; }
  if ((m = s.match(/^\d{1,3}((?:\.\d{1,3})+)(?=[\s)]|\.\s|$)/))) { const d = (m[1].match(/\./g) || []).length; return { key: "n.n" + d, rank: 2 + d, label: "1" + ".1".repeat(d), mark: m[0] }; }
  if ((m = s.match(/^\d{1,3}(?:\s*[.)]|(?=\s)|$)/))) return { key: "n", rank: 2, label: /^0\d/.test(m[0]) ? "01" : /[.)]/.test(m[0]) ? "1." : "1", mark: m[0] };
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
function lbUnitLevels(text, ap) {
  const lines = []; let inAp = false, apN = 0, blk = 0, gap = true;
  String(text || "").split(/\r?\n/).forEach((raw) => {
    if (!raw.trim()) { gap = true; return; }
    if (gap) { blk++; gap = false; }
    const lead = raw.match(/^[\s　]*/)[0], ind = lead.replace(/\t/g, "    ").replace(/　/g, "  ").length;
    let s = raw.slice(lead.length).trim(), bul = false;
    const bm = s.match(/^[-–—•·∙◦▪▫‣*ㆍ・○●□■▶▷>]+\s*/); if (bm && s.length > bm[0].length) { bul = true; s = s.slice(bm[0].length).trim(); }
    const sh = lbUnitShape(s);
    if (sh.key === "plain" && LBU_SKIP.test(s)) { if (!ind && !bul && LBU_BACK.test(s)) inAp = true; return; }
    if (inAp && !ind && !bul && sh.rank <= 1 && sh.key !== "plain") inAp = false;
    if (inAp) { apN++; if (!ap) return; }
    lines.push({ ind, bul, sh, pg: lbUnitPage(s), key: `${ind > 0 ? 1 : 0}|${bul ? 1 : 0}|${sh.key}`, blk, ap: inAp });
  });
  lbUnitNumSplit(lines);
  /* 번호 없는 줄이 같은 자리의 번호 줄(1. · Lesson 1 …) 단계 하나와 섞여 있고 더 큰 단계가 없으면 그 번호 줄 단계로 */
  const top = [...new Set(lines.filter((l) => l.key.startsWith("0|0|")).map((l) => l.key))], P0 = "0|0|plain";
  const peers = top.filter((k) => k !== P0);
  if (top.includes(P0) && peers.length === 1 && lines.find((l) => l.key === peers[0]).sh.rank === 2) lines.forEach((l) => { if (l.key === P0) l.key = peers[0]; });
  const by = new Map();
  lines.forEach((l, i) => { if (!by.has(l.key)) by.set(l.key, { key: l.key, first: i, lines: [], ind: l.ind, rank: l.bul ? 5 : l.sh.rank, sh: l.sh, bul: l.bul }); by.get(l.key).lines.push(l); });
  const other = by.has(P0) && [...by.values()].some((g) => g.key !== P0 && !g.bul && g.rank >= 2 && g.sh.key !== "plain");
  const levels = [...by.values()].sort((a, b) => (other && ((a.key === P0) - (b.key === P0))) || (a.ind > 0) - (b.ind > 0) || a.rank - b.rank || a.lines.length - b.lines.length || a.first - b.first);
  const seen = {};
  levels.forEach((g, d) => {
    g.depth = d;
    let lb = g.sh.label || (g.bul || g.ind > 0 ? "하위" : other ? "그 밖" : "이름만");
    if (seen[lb]) lb += " " + (d + 1);
    seen[lb] = 1; g.label = lb; g.count = g.lines.length;
    /* soft 쪽: 그 단계 줄의 80% 이상(2줄 이상)이 끝 숫자를 갖고, 숫자가 커지기만 하고, 1씩 느는 번호(1 · 2 · 3)가 아닐 때만 */
    const ps = g.lines.map((l) => (l.pg.hard != null ? l.pg.hard : l.pg.soft)).filter((v) => v != null);
    const inc = ps.every((v, k) => !k || v > ps[k - 1]), step1 = ps.length >= 3 && ps.every((v, k) => !k || v - ps[k - 1] === 1);
    const soft = ps.length >= 2 && ps.length >= Math.ceil(g.lines.length * 0.8) && inc && !step1;
    g.lines.forEach((l) => { l.depth = d; const sp = soft && l.pg.soft != null; l.name = sp ? l.pg.softName : l.pg.name; l.page = l.pg.hard != null ? l.pg.hard : sp ? l.pg.soft : null; });
  });
  const uniq = levels.filter((g) => !(other && g.key === P0) && new Set(g.lines.map((l) => l.name.toLowerCase())).size === g.lines.length);
  const def = uniq.length ? uniq[uniq.length - 1] : levels[0];
  return { lines, levels: levels.map((g) => ({ key: g.key, label: g.label, count: g.count, depth: g.depth })), def: def ? def.key : "", ap: apN };
}
/* 고른 단계 줄 → [{name, page}]. up = 윗 단계 이름 붙이기("Chapter 01 · Unit 01 영어문장 1형"), ap = 부록 줄도 넣기 */
function lbUnitPick(text, key, up, ap) {
  const L = lbUnitLevels(text, ap), ls = L.lines, k = L.levels.some((g) => g.key === key) ? key : L.def;
  const how = up === true ? "up" : up || "";
  const out = []; let par = null, pn = 0, cn = 0;
  ls.forEach((l, i) => {
    if (l.key !== k) return;
    let page = l.page, name = l.name, p = null;
    for (let j = i + 1; page == null && j < ls.length && ls[j].depth > l.depth; j++) page = ls[j].page;
    for (let j = i - 1; j >= 0; j--) if (ls[j].depth < l.depth) { p = ls[j]; break; }
    if (how === "up" && p) name = (p.sh.word && p.sh.mark ? p.sh.mark : p.name).replace(/[\s.:]+$/, "") + " · " + name;
    if (how === "num") {
      /* 번호 1-1.(261127 대표): <윗 단계 순번>-<그 안 순번>. <앞 번호 뗀 이름> — 윗 단계가 없으면 "<순번>. 이름" */
      if (p !== par) { par = p; pn += p ? 1 : 0; cn = 0; }
      cn++;
      const mk = l.sh.mark && l.sh.key !== "plain" && name.startsWith(l.sh.mark) ? l.sh.mark : "";
      const bare = name.slice(mk.length).replace(/^[\s.:)\]-]+/, "") || name;
      name = (p ? `${pn}-${cn}. ` : `${cn}. `) + bare;
    }
    out.push({ name: name.slice(0, 100), page });
  });
  return out;
}
/* 같은 숫자 꼴(1 · 01 · 1.) 줄 안에서 번호가 따로 매겨지는 두 줄기(대단원 1 · 2 · 3 과 단원 01 … 06 · 07 …)가 섞이면 짧게 되풀이되는 쪽을 윗 단계로(항목 167, 261127 대표).
   번호가 처음부터 끝까지 하나로 이어지면(1 · 2 · 3 …) 나누지 않는다. 같은 값이 두 줄기에 다 맞으면 신호로 고름: 빈 줄로 나뉜 덩어리의 첫 줄 = 윗 단계,
   0 채움(01) = 단원, 0 채움이 있는 덩어리의 한 자리 번호(1.) = 윗 단계. 윗 단계 줄은 맨 앞에서 시작하고 줄마다 아래에 단원 줄이 하나 이상 있어야 함 */
function lbUnitNumSplit(lines) {
  const groups = new Map();
  lines.forEach((l) => { if (l.sh.key === "n" && !l.ap) { if (!groups.has(l.key)) groups.set(l.key, []); groups.get(l.key).push(l); } });
  const first = new Set(), seen = new Set(), bn = {};
  lines.forEach((l) => { bn[l.blk] = (bn[l.blk] || 0) + 1; if (!seen.has(l.blk)) { seen.add(l.blk); first.add(l); } });
  groups.forEach((ls) => {
    if (ls.length < 4) return;
    const val = (l) => parseInt(l.sh.mark, 10), pad = (l) => /^0\d/.test(l.sh.mark);
    if (ls.every((l, k) => !k || val(l) === val(ls[k - 1]) + 1)) return;
    const bpad = {}; ls.forEach((l) => { if (pad(l)) bpad[l.blk] = 1; });
    let up = 0, lo = 0; const U = new Set();
    for (const l of ls) {
      const v = val(l), cu = v === up + 1, cl = v === lo + 1;
      if (!cu && !cl) return;
      let toUp = cu;
      if (cu && cl) { const head = first.has(l) && bn[l.blk] > 1; toUp = pad(l) && !head ? false : head || (!pad(l) && v < 10 && !!bpad[l.blk]) || (!up && !lo); }
      if (toUp) { up = v; U.add(l); } else lo = v;
    }
    if (U.size < 2 || ls.length - U.size < U.size || !U.has(ls[0]) || U.has(ls[ls.length - 1]) || ls.some((l, k) => k && U.has(l) && U.has(ls[k - 1]))) return;
    U.forEach((l) => { l.key += "^"; l.sh = Object.assign({}, l.sh, { rank: 1 }); });
  });
}
const LBU_CHUNK = 10; /* 단원 저장 한 번(edit-units)에 보내는 줄 수 — 항목 165 */
const lbIsbn = (b) => { const s = String((b && b.isbn) || "").replace(/[-\s]/g, ""); return /^97[89]\d{10}$/.test(s) ? s : ""; };
/* 단원 편집 창(항목 167, 261127 대표 — 탭 없이 한 화면): 위 ISBN13 [가져오기] · 왼쪽 단원 목록 글 칸 · 오른쪽 단원 줄(저장될 줄 그대로) · 아래 단원 단계 / 단원 이름 · 부록 줄도 넣기 / 안내 · [취소] [저장].
   오른쪽 = 인라인 편집 목록(DESIGN 부품 기준표): 평소 글자 줄, 누른 줄만 밑줄 입력(이름 · 시작) + 줄 끝 [+](아래에 끼우기) · [×](삭제). Enter = 다음 줄, Esc = 그 줄 편집 끝(창은 안 닫힘, 항목 163).
   왼쪽 글(짧게 기다렸다) · 단계 · 이름 방식 · 부록 체크가 바뀌면 오른쪽 줄을 다시 만든다 — 오른쪽에서 손으로 고친 것이 있으면 먼저 묻는다(창 안 확인).
   이미 단원이 있으면 처음 오른쪽 = 기존 단원, 왼쪽 글의 첫 반영 때 [바꾸기 | 뒤에 붙이기]를 묻는다. 바꾸기 = 기존 단원과 새 줄을 순서대로 짝지어 고침(update, 연결 유지) · 남는 새 줄만 추가 · 남는 기존 줄만 삭제.
   저장 = edit-units 10개씩 묶음(항목 165) 그대로 */
function lbUnitDialog(b) {
  const c = LBK.units[b.id];
  if (!c || !c.list) { toast("단원을 불러온 뒤에 편집해요"); lbUnitsLoad(b.id); return; }
  const mk = (u) => ({ id: u.id, name: u.name || "", page: u.page == null ? "" : String(u.page), name0: u.name || "", page0: u.page == null ? "" : String(u.page), uses: u.uses || 0, del: false });
  const baseRows = () => ((LBK.units[b.id] || c).list || []).map(mk);
  let rows = baseRows();
  const UU = unitParts(b), isbn = lbIsbn(b);
  /* mode: "" = 아직 왼쪽 글을 안 씀(기존 단원 그대로) · new = 단원 없는 교재 · replace · append. hand = 오른쪽에서 손으로 고침, hold = 왼쪽 글을 반영하지 않기로 함, ed = 편집 중인 줄 */
  const T = { mode: rows.length ? "" : "new", hand: false, hold: false, ed: -1, src: "", drawing: false };
  const LV = { key: "", nm: "", ap: false };
  const NM = [["", "그대로"], ["up", "윗 단계 이름 붙이기"], ["num", "번호 1-1."]];
  modal(`<h2>단원 편집${HELP(HELPTX.unitEdit)}</h2><div class="hint">${esc(b.name)}</div>
    <div class="row"><span class="hint">ISBN13 ${isbn ? esc(isbn) : "없음"}</span><span class="sp"></span><button type="button" class="btn" id="lbuGet" ${isbn ? 'title="온라인 서점(교보문고, 없으면 예스24)의 단원 목록을 왼쪽 글 칸에 채워요"' : 'disabled title="ISBN13을 먼저 넣어 주세요"'}>${IC("dl", "s")}가져오기</button></div>
    ${isbn ? "" : '<div class="hint warn" id="lbuNoIsbn">[가져오기]는 ISBN13이 있어야 해요 — 교재 창 [정보] 탭의 ISBN13 칸</div>'}
    <div class="lbugrid">
      <textarea class="inp bfta" id="lbuT" aria-label="단원 목록 글" placeholder="단원 목록을 붙여 넣거나 [가져오기]를 눌러요 — 한 줄에 하나, 끝 숫자는 시작 쪽&#10;1. 소인수분해 8&#10;2. 정수와 유리수 28&#10;3. 문자와 식 56"></textarea>
      <div class="lbupv" id="lbuV" role="region" aria-label="단원 줄">
        <div class="lbupvh"><span id="lbuVh">단원</span><span class="sp"></span><button type="button" class="btn sm" id="lbuSort" style="display:none" title="시작 쪽이 작은 단원부터 위로 — 쪽을 안 적은 줄은 맨 아래">${IC("aup", "s")}쪽 순서로 정렬</button></div>
        <div id="lbuR" role="list" aria-label="단원 줄 — 누르면 고쳐요"></div>
        <button type="button" class="lbuadd" id="lbuAdd">${IC("plus", "s")}단원 추가</button>
      </div>
    </div>
    <div class="row lburow" id="lbuLvR"><span class="hint lbulb">단원 단계</span><span class="vseg subseg" id="lbuLv" role="radiogroup" aria-label="단원으로 쓸 단계"></span></div>
    <div class="row lburow" id="lbuNmR"><span class="hint lbulb" data-nmh>단원 이름</span><span class="vseg subseg" id="lbuNm" data-nmh role="radiogroup" aria-label="단원 이름 붙이는 방식">${NM.map(([k, t]) => `<button type="button" role="radio" data-nm="${k}">${t}</button>`).join("")}</span><label class="hint lbuap" id="lbuApL"><input type="checkbox" id="lbuAp"> 부록 줄도 넣기</label></div>
    <p class="hint lbulm" id="lbuLM" aria-live="polite"></p>
    <p class="hint" id="lbuM"></p>
    ${isbn ? `<div class="lbulinks" id="lbuLinks"><span class="hint">서점 목차 직접 보기</span>${bookLinkInner(isbn)}</div>` : ""}
    <div class="actions"><span class="lbuprog" id="lbuP" role="progressbar" aria-label="단원 저장" aria-valuemin="0" hidden><span class="spinner" aria-hidden="true"></span><span class="t" aria-live="polite"></span><span class="bar"><i></i></span></span><span class="sp"></span><button class="btn" id="cc">취소</button><button class="btn pri" id="co">저장</button></div>`, (m, close) => {
    const dlg = m.querySelector(".dlg"); if (dlg) dlg.classList.add("lbuwide");
    const box = m.querySelector("#lbuR"), msg = m.querySelector("#lbuM"), lm = m.querySelector("#lbuLM"), ta = m.querySelector("#lbuT");
    const num = (v) => { const s = String(v || "").replace(/[^\d]/g, ""); return s ? +s : null; };
    const lmSet = (t) => { lm.textContent = [T.src, t].filter(Boolean).join(" · "); };
    const touch = () => { T.hand = true; };
    /* 창 안 확인(창 위에 한 겹 — 앱 팝업은 창을 하나만 띄우므로 단원 편집 창을 닫지 않게). 처음 커서는 [취소] */
    const ask = (title, body, btns) => {
      const a = document.createElement("div"); a.className = "lbuask";
      a.innerHTML = `<div class="lbuaskc" role="alertdialog" aria-modal="true" aria-labelledby="lbuAskT"><h3 id="lbuAskT">${title}</h3><p class="hint">${body}</p><div class="actions"><span class="sp"></span>${btns.map(([t, , p], k) => `<button type="button" class="btn${p ? " pri" : ""}" data-ak="${k}">${t}</button>`).join("")}</div></div>`;
      m.appendChild(a);
      a.querySelectorAll("[data-ak]").forEach((x) => (x.onclick = () => { a.remove(); btns[+x.dataset.ak][1](); }));
      setTimeout(() => { const f = a.querySelector('[data-ak="0"]'); if (f) f.focus(); }, 0);
    };
    /* ── 오른쪽 단원 줄 ── */
    const pgTxt = (r) => { const n = num(r.page); return n == null ? "" : esc(unitFmt(b, n)); };
    const edRow = (r, i) => `<div class="lbuer on${r.del ? " del" : ""}" role="listitem" data-i="${i}"><input class="lbuin nm" data-f="name" value="${esc(r.name)}" placeholder="단원 이름" autocomplete="off" aria-label="단원 이름" ${r.del ? "disabled" : ""}>${UU[0] ? `<span class="unu">${esc(UU[0])}</span>` : ""}<input class="lbuin pg" data-f="page" value="${esc(r.page)}" placeholder="시작" inputmode="numeric" autocomplete="off" aria-label="시작" ${r.del ? "disabled" : ""}>${UU[1] ? `<span class="unu">${esc(UU[1])}</span>` : ""}<button type="button" class="anb" data-addb="${i}" title="아래에 단원 추가" aria-label="이 단원 아래에 추가">${IC("plus", "s")}</button>${r.uses ? `<span class="hint lbuuse" title="시험 범위 등 다른 곳에 연결돼 삭제할 수 없어요">연결 ${r.uses}</span>` : `<button type="button" class="anb" data-del="${i}" title="${r.del ? "삭제 취소" : "이 단원 삭제"}" aria-label="${r.del ? "삭제 취소" : "이 단원 삭제"}">${IC(r.del ? "rotc" : "x", "s")}</button>`}</div>`;
    const draw = () => {
      T.drawing = true;
      const vis = rows.map((r, i) => [r, i]).filter(([r]) => !r.gone);
      box.innerHTML = vis.map(([r, i]) => (i === T.ed ? edRow(r, i) : `<div class="lbuer${r.del ? " del" : ""}" role="listitem" tabindex="0" data-i="${i}" title="${esc(r.name)}"><span class="nm${r.name.trim() ? "" : " none"}">${esc(r.name.trim() || "이름 없음")}</span><span class="pg${pgTxt(r) ? "" : " none"}" data-pgc>${pgTxt(r) || "—"}</span></div>`)).join("") || '<div class="hint lbuempty">왼쪽에 단원 목록을 붙여 넣거나 [가져오기]를 누르면 여기에 단원 줄이 생겨요</div>';
      T.drawing = false;
      const n = vis.filter(([r]) => !r.del).length, dn = rows.filter((r) => r.id && (r.del || r.gone)).length;
      m.querySelector("#lbuVh").textContent = `단원 ${n}개${dn ? ` · 저장하면 삭제 ${dn}개` : ""}`;
      orderNote();
      const e = box.querySelector(".lbuer.on"); if (e) bindEd(e);
    };
    /* 261126 대표: 줄 순서가 시작 쪽 순과 어긋날 때만 [쪽 순서로 정렬] — 쪽 빈 줄은 맨 아래, 같은 쪽은 원래 순서. 저장 값 · 서버 호출은 순서와 무관 */
    const orderNote = () => {
      const ps = rows.filter((r) => !r.del && !r.gone).map((r) => num(r.page)).filter((v) => v != null);
      m.querySelector("#lbuSort").style.display = ps.some((v, k) => k && v < ps[k - 1]) ? "" : "none";
    };
    const empty = (r) => r && !r.id && !r.name.trim() && !String(r.page).trim();
    const nextVis = (i) => { for (let k = i + 1; k < rows.length; k++) if (!rows[k].gone) return k; return -1; };
    /* 줄 하나만 편집: 떠나는 줄이 비어 있는 새 줄이면 뺀다 */
    const startEdit = (i, f) => {
      if (T.ed >= 0 && T.ed !== i && empty(rows[T.ed])) { rows.splice(T.ed, 1); if (T.ed < i) i--; }
      T.ed = i; draw();
      const e = box.querySelector(`.lbuer.on [data-f="${f || "name"}"]:not([disabled])`) || box.querySelector(".lbuer.on .anb");
      if (e) { e.focus(); if (e.setSelectionRange && e.value) e.setSelectionRange(e.value.length, e.value.length); }
      const on = box.querySelector(".lbuer.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    };
    const endEdit = (keep) => {
      if (T.ed < 0) return;
      const i = T.ed; if (empty(rows[i])) rows.splice(i, 1);
      T.ed = -1; draw();
      if (keep) { const r = box.querySelector(`.lbuer[data-i="${i}"]`); if (r) r.focus(); }
    };
    const addAt = (i) => { const cur = T.ed; rows.splice(i, 0, { name: "", page: "", del: false }); touch(); T.ed = cur >= i ? cur + 1 : cur; startEdit(i); };
    const bindEd = (e) => {
      e.querySelectorAll("input").forEach((inp) => {
        inp.oninput = () => { rows[T.ed][inp.dataset.f] = inp.value; touch(); if (inp.dataset.f === "page") orderNote(); };
        inp.onkeydown = (ev) => {
          if (ev.isComposing || ev.keyCode === 229) return;
          if (ev.key === "Enter") { ev.preventDefault(); const nx = nextVis(T.ed); if (nx >= 0) startEdit(nx, inp.dataset.f); else if (rows[T.ed].name.trim()) addAt(T.ed + 1); else endEdit(true); }
          else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); endEdit(true); }
        };
      });
      const ad = e.querySelector("[data-addb]"); if (ad) ad.onclick = () => addAt(T.ed + 1);
      const dl = e.querySelector("[data-del]");
      if (dl) dl.onclick = () => { const r = rows[T.ed]; touch(); if (!r.id) { rows.splice(T.ed, 1); T.ed = -1; draw(); } else { r.del = !r.del; draw(); const x = box.querySelector(".lbuer.on [data-del]"); if (x) x.focus(); } };
    };
    box.addEventListener("pointerdown", (ev) => {
      const r = ev.target.closest(".lbuer"); if (!r) return;
      const i = +r.dataset.i; if (i === T.ed) return;
      ev.preventDefault(); startEdit(i, ev.target.closest("[data-pgc]") ? "page" : "name");
    });
    box.addEventListener("keydown", (ev) => { const r = ev.target.closest && ev.target.closest(".lbuer:not(.on)"); if (r && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); startEdit(+r.dataset.i); } });
    box.addEventListener("focusout", (ev) => { if (T.drawing || T.ed < 0) return; const to = ev.relatedTarget; if (to && !box.contains(to) && !to.closest(".lbuask")) endEdit(); });
    m.addEventListener("pointerdown", (ev) => { if (T.ed < 0 || !ev.target.isConnected || ev.target.closest("#lbuR") || ev.target.closest(".lbuask")) return; endEdit(); });
    m.querySelector("#lbuAdd").onclick = () => { const nx = rows.length; addAt(nx); };
    m.querySelector("#lbuSort").onclick = () => {
      const pn = (r) => { const v = num(r.page); return v == null ? Infinity : v; };
      const keyed = rows.map((r, i) => ({ r, i, p: pn(r) }));
      keyed.sort((x, y) => (x.p === y.p ? x.i - y.i : x.p < y.p ? -1 : 1));
      rows = keyed.map((k) => k.r); T.ed = -1; touch(); draw();
    };
    /* ── 왼쪽 글 → 오른쪽 줄 ── */
    const pick = () => lbUnitPick(ta.value.slice(0, 20000), LV.key, LV.nm, LV.ap);
    const compose = () => {
      const bs = baseRows(), gr = pick().map((u) => ({ name: u.name, page: u.page == null ? "" : String(u.page), del: false }));
      if (T.mode === "append") {
        const have = new Set(bs.map((r) => r.name0)), add = gr.filter((r) => !have.has(r.name));
        return { rows: [...bs, ...add], note: gr.length > add.length ? `이미 있는 이름 ${gr.length - add.length}개는 넣지 않았어요` : "" };
      }
      /* 바꾸기(261127 대표): 기존 단원과 새 줄을 순서대로 짝지어 같은 단원을 고침(update — 학습 기록 · 시험 범위 연결 유지), 남는 새 줄만 추가, 남는 기존 줄만 삭제(연결된 단원은 서버가 거절 → 저장 뒤 안내) */
      const out = gr.map((r, k) => { const x = bs[k]; if (!x) return r; x.name = r.name; x.page = r.page; return x; });
      const rest = bs.slice(gr.length); rest.forEach((x) => { x.gone = true; out.push(x); });
      const kept = rest.filter((x) => x.uses).length;
      return { rows: out, note: [bs.length && gr.length ? `기존 단원 ${Math.min(bs.length, gr.length)}개는 순서대로 이름 · 시작을 고쳐요(연결 유지)` : "", rest.length ? `남는 기존 단원 ${rest.length}개는 저장할 때 삭제해요${kept ? `(다른 곳에 연결된 ${kept}개는 삭제되지 않아요)` : ""}` : ""].filter(Boolean).join(" · ") };
    };
    const apply = () => { const o = compose(); rows = o.rows; T.hand = false; T.hold = false; T.ed = -1; draw(); lmSet(o.note); };
    const hold = () => {
      T.hold = true;
      lm.innerHTML = `${T.src ? esc(T.src) + " · " : ""}왼쪽 글은 오른쪽에 반영하지 않았어요 <button type="button" class="lnk" id="lbuRe">오른쪽에 반영</button>`;
      m.querySelector("#lbuRe").onclick = () => { T.hold = false; reflect(); };
    };
    const reset = () => { rows = T.mode === "new" ? [] : baseRows(); if (T.mode !== "new") T.mode = ""; T.hand = false; T.hold = false; T.ed = -1; draw(); lmSet(""); };
    const guard = (fn, undo) => {
      if (!T.hand) return fn();
      ask("오른쪽에서 고친 내용이 바뀌어요", "왼쪽 글로 단원 줄을 다시 만들면 오른쪽에서 고친 이름 · 시작 · 추가 · 삭제가 없어져요. 다시 만들까요?", [["취소", undo || hold], ["다시 만들기", fn, 1]]);
    };
    const reflect = (undo) => {
      lvDraw();
      if (T.hold) return;
      if (!ta.value.trim()) { if (T.mode) guard(reset, undo); return; }
      if (T.mode) return guard(apply, undo);
      const n = baseRows().length;
      ask("기존 단원을 바꿀까요?", `이 교재에 단원 <b>${n}개</b>가 있어요. [바꾸기]는 왼쪽 글의 단원으로 바꿔요 — 기존 단원은 순서대로 이름 · 시작만 고쳐 그대로 이어 쓰고(학습 기록 · 시험 범위 연결 유지), 남는 새 줄은 추가 · 남는 기존 단원은 저장할 때 삭제해요. [뒤에 붙이기]는 기존 단원 뒤에 새 단원만 붙여요.${T.hand ? " 오른쪽에서 고친 내용은 없어져요." : ""}`,
        [["취소", undo || hold], ["뒤에 붙이기", () => { T.mode = "append"; apply(); }], ["바꾸기", () => { T.mode = "replace"; apply(); }, 1]]);
    };
    /* 단원 단계(항목 164) · 단원 이름 방식(항목 167): 단계가 둘 이상일 때만. 부록 체크는 부록 줄이 있을 때만 */
    const lvDraw = () => {
      const L = lbUnitLevels(ta.value.slice(0, 20000), LV.ap), seg = m.querySelector("#lbuLv");
      if (!L.levels.some((g) => g.key === LV.key)) LV.key = L.def;
      const many = L.levels.length > 1, apOn = !!(L.ap || LV.ap);
      if (!many) LV.nm = "";
      m.querySelector("#lbuLvR").style.display = many ? "" : "none";
      m.querySelector("#lbuNmR").style.display = many || apOn ? "" : "none";
      m.querySelectorAll("[data-nmh]").forEach((x) => (x.style.display = many ? "" : "none"));
      m.querySelector("#lbuApL").style.display = apOn ? "" : "none";
      seg.innerHTML = many ? L.levels.map((g) => `<button type="button" role="radio" data-lvk="${esc(g.key)}" class="${g.key === LV.key ? "on" : ""}" aria-checked="${g.key === LV.key}">${esc(g.label)} <span class="n">${g.count}</span></button>`).join("") : "";
      seg.querySelectorAll("[data-lvk]").forEach((x) => (x.onclick = () => { const old = LV.key; if (x.dataset.lvk === old) return; LV.key = x.dataset.lvk; reflect(() => { LV.key = old; lvDraw(); }); }));
      m.querySelectorAll("[data-nm]").forEach((x) => { const on = x.dataset.nm === LV.nm; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
    };
    m.querySelectorAll("[data-nm]").forEach((x) => (x.onclick = () => { const old = LV.nm; if (x.dataset.nm === old) return; LV.nm = x.dataset.nm; reflect(() => { LV.nm = old; lvDraw(); }); }));
    m.querySelector("#lbuAp").onchange = (ev) => { const old = LV.ap; LV.ap = ev.currentTarget.checked; reflect(() => { LV.ap = old; m.querySelector("#lbuAp").checked = old; lvDraw(); }); };
    let lvT = 0;
    ta.addEventListener("input", () => { T.src = ""; clearTimeout(lvT); lvT = setTimeout(() => reflect(), 300); });
    /* 가져오기: units-fetch(교보문고 → 예스24) 글을 왼쪽 글 칸에 그대로 — 칸에 글이 있으면 바꾸기 전에 물음 */
    m.querySelector("#lbuGet").onclick = (ev) => {
      if (!isbn) return;
      const btn = ev.currentTarget;
      const run = async () => {
        btn.disabled = true; lm.textContent = "온라인 서점에서 단원 목록을 받는 중…";
        try {
          const r = await liveBookApi({ action: "units-fetch", isbn13: isbn });
          if (r && r.found && String(r.text || "").trim()) {
            clearTimeout(lvT); ta.value = String(r.text); LV.key = ""; T.hold = false;
            T.src = `${r.source === "yes24" ? "예스24" : "교보문고"}에서 단원 목록을 가져왔어요 — 오른쪽 줄을 확인하고 [저장]을 눌러요`; lmSet("");
            reflect();
          } else lm.textContent = "이 ISBN으로 단원을 찾지 못했어요";
        } catch (e) { lm.textContent = lbErr(e); } finally { btn.disabled = false; }
      };
      if (ta.value.trim()) ask("글 칸을 바꿀까요?", "왼쪽 글 칸의 단원 목록을 온라인 서점에서 가져온 목록으로 바꿔요.", [["취소", () => {}], ["바꾸기", run, 1]]);
      else run();
    };
    lvDraw(); draw();
    m.querySelector("#cc").onclick = close;
    const ok = m.querySelector("#co");
    ok.onclick = async () => {
      if (T.ed >= 0) endEdit();
      const live = (r) => !r.del && !r.gone;
      const update = rows.filter((r) => r.id && live(r) && (r.name.trim() !== r.name0 || String(num(r.page) ?? "") !== r.page0)).map((r) => ({ id: r.id, name: r.name.trim(), page: num(r.page) }));
      const remove = rows.filter((r) => r.id && !live(r)).map((r) => r.id);
      const add = rows.filter((r) => !r.id && !r.del && r.name.trim() && r.sent !== r.name.trim()).map((r) => ({ name: r.name.trim(), page: num(r.page) }));
      if (update.some((u) => !u.name)) { msg.textContent = "이름이 빈 단원이 있어요 — 이름을 넣거나 [×]로 삭제해요"; startEdit(rows.findIndex((r) => r.id && live(r) && !r.name.trim())); return; }
      if (!update.length && !remove.length && !add.length) { close(); return; }
      /* 묶음 저장(항목 165): update → remove → add 순서 그대로 LBU_CHUNK개씩 edit-units 여러 번 — 묶음마다 "단원 저장 중 n/전체" + 막대.
         저장 중에는 창 안 단추 · 칸을 막음(취소 포함 — 창은 단추로만 닫히니 닫히지 않음). 성공한 묶음은 바로 rows에 반영(고침 = 원래 값 갱신 · 삭제 = 줄 뺌 · 추가 = 보낸 이름 기록).
         중간 실패 = 멈추고 노션 단원을 다시 읽어 맞춤(추가된 줄은 받은 id로 → 다음 저장 땐 고침 목록) → "n/전체까지 저장했어요" + [다시 저장] = 남은 것만 */
      const ops = [...update.map((u) => ["u", u]), ...remove.map((id) => ["r", id]), ...add.map((a) => ["a", a])];
      const total = ops.length, sum = { updated: 0, removed: 0, added: 0, blocked: 0 };
      const prog = m.querySelector("#lbuP"), ptx = prog.querySelector(".t"), pbar = prog.querySelector(".bar>i");
      const step = (n) => { ptx.textContent = `단원 저장 중 ${n}/${total}`; pbar.style.width = Math.round((n / total) * 100) + "%"; prog.setAttribute("aria-valuenow", String(n)); };
      const locked = [...m.querySelectorAll("button, input, textarea")].filter((x) => !x.disabled);
      locked.forEach((x) => (x.disabled = true)); box.classList.add("busy");
      ok.setAttribute("aria-busy", "true"); msg.textContent = ""; prog.setAttribute("aria-valuemax", String(total)); prog.hidden = false; step(0);
      const rowOf = (id) => rows.find((r) => r.id === id);
      let done = 0;
      try {
        for (let i = 0; i < total; i += LBU_CHUNK) {
          const part = ops.slice(i, i + LBU_CHUNK);
          const body = { action: "edit-units", bookId: b.id, update: part.filter((o) => o[0] === "u").map((o) => o[1]), remove: part.filter((o) => o[0] === "r").map((o) => o[1]), add: part.filter((o) => o[0] === "a").map((o) => o[1]) };
          const r = await liveBookApi(body);
          sum.updated += r.updated || 0; sum.removed += r.removed || 0; sum.added += r.added || 0; sum.blocked += (r.blocked || []).length;
          body.update.forEach((u) => { const x = rowOf(u.id); if (x) { x.name0 = u.name; x.page0 = u.page == null ? "" : String(u.page); } });
          body.remove.forEach((id) => { const k = rows.findIndex((x) => x.id === id && !live(x)); if (k >= 0 && !(r.blocked || []).length) rows.splice(k, 1); });
          body.add.forEach((a) => { const x = rows.find((z) => !z.id && z.sent !== a.name && z.name.trim() === a.name); if (x) x.sent = a.name; });
          done += part.length; step(done);
        }
        close();
        lbUnitsLoad(b.id, true);
        const parts = [sum.updated ? `고침 ${sum.updated}` : "", sum.removed ? `삭제 ${sum.removed}` : "", sum.added ? `추가 ${sum.added}` : ""].filter(Boolean).join(" · ");
        toast(`단원을 저장했어요${parts ? " — " + parts : ""}${sum.blocked ? ` · 연결돼 삭제하지 않은 단원 ${sum.blocked}개` : ""}`);
      } catch (e) {
        let fresh = false;
        /* 멈춘 묶음은 일부만 들어갔을 수 있어 노션 단원을 다시 읽어 rows를 맞춘다 — 못 읽으면 성공한 묶음까지만 반영한 그대로 */
        try {
          const list = (await liveBookApi({ action: "units", bookId: b.id })).units || [];
          LBK.units[b.id] = { list };
          const byId = new Map(list.map((u) => [u.id, u]));
          for (let k = rows.length - 1; k >= 0; k--) { const x = rows[k]; if (x.id && !byId.has(x.id)) rows.splice(k, 1); }
          const taken = new Set(rows.filter((x) => x.id).map((x) => x.id));
          rows.forEach((x) => {
            if (!x.id) { const u = list.find((z) => !taken.has(z.id) && (z.name || "") === x.name.trim()); if (!u) return; x.id = u.id; x.uses = u.uses || 0; taken.add(u.id); delete x.sent; }
            const u = byId.get(x.id); if (!u) return;
            x.name0 = u.name || ""; x.page0 = u.page == null ? "" : String(u.page); x.uses = u.uses || 0;
          });
          fresh = true;
        } catch (_) { /* 다시 읽기 실패 — 성공한 묶음만 반영 */ }
        locked.forEach((x) => (x.disabled = false)); box.classList.remove("busy");
        ok.removeAttribute("aria-busy"); ok.textContent = "다시 저장"; prog.hidden = true;
        draw();
        const left = rows.filter((x) => (x.id && !live(x)) || (x.id && live(x) && (x.name.trim() !== x.name0 || String(num(x.page) ?? "") !== x.page0)) || (!x.id && !x.del && x.name.trim() && x.sent !== x.name.trim())).length;
        const saved = Math.max(0, total - left);
        msg.textContent = `${saved}/${total}까지 저장했어요 — 나머지 ${left}개는 [다시 저장]을 눌러요 · ${lbErr(e)}`;
        if (fresh) { try { render(); } catch (_) {} } else lbUnitsLoad(b.id, true);
      }
    };
    setTimeout(() => { const t = m.querySelector(isbn && !rows.length ? "#lbuGet" : "#lbuT"); if (t) t.focus(); }, 0);
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
