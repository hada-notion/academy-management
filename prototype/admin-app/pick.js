/* 고르기 칸 모듈(pick) — 클래스 칸 · 학생 칸 (261113 대표: 모듈 하나로 만들어 모든 화면에 똑같이 붙임)
   붙이는 법(기본 = 한 줄 모양 — 이름 · 학교 · 학년 ……… 정보, 좁으면 우선순위대로 숨김. one:false면 두 줄)
     HP.cls(칸을 넣을 요소, {value, classes, none, warn, onNew, onChange})
     HP.stu(칸을 넣을 요소, {value, students, groups, info, auto, find, onChange}) — find:true = 목록 아래 [거르기로 찾기](학년·빈 시간 거르기 창)
   동작(두 칸 공통)
     닫힌 칸 → 누르면 칸 폭 목록이 떠서 열림(아래 자리가 모자랄 때만 위로, 칸에 4px 붙음, 한 번에 하나)
     닫기 = 바깥 누름 · 빈 찾기 칸에서 Esc · (클래스) 고르면 닫힘
     목록 맨 아래 왼쪽 돋보기 줄 = 따로 뜨는 찾기 창(클래스: 종료된 클래스 찾기 / 학생: 다른 학생 찾기)
     학생은 고른 학생이 칸 아래에 쌓임(체크를 풀면 빠짐). auto = 클래스 수강생이 처음부터 쌓여 있는 곳(시간표)
   값·이름은 화면규칙 4장(용어) 그대로: 클래스 선택 · 학생 선택 · 학생 n명 · 더 고르기 · 클래스 없음 · 모두 넣기/빼기 */
(function(){
const ICON={search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  grip:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ban:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  user:'<svg class="hp-uic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const md=d=>d?d.slice(0,10).replace(/-/g,"."):"";
const today=()=>HP.today||new Date().toISOString().slice(0,10);
const gcls=g=>!g?"x":g[0]==="초"?"e":g[0]==="중"?"m":g[0]==="고"?"h":"x";
const COL={};const col=n=>COL[n]||(window.HP&&HP.colors&&HP.colors[n])||"var(--text-subtle)";
// 정보 줄의 클래스 = 색 점 + 이름(261113 대표 — 보강 카드처럼). "MM.DD 시작 · 그 밖에 A · B"면 앞 글은 그대로, 클래스만 점
const clsDots=L=>L.filter(Boolean).map(n=>`<span class="hp-cd"><span class="hp-dot" style="background:${col(n)}"></span>${esc(n)}</span>`).join("");
const noteHtml=(x,f)=>{if(f.note==null)return x.cls?clsDots(x.cls.split(" · ")):"클래스 없음";const m=f.note.match(/^(.*?)(?:\s·\s)?그 밖에 (.*)$/);
  return m?(m[1]?`<span class="hp-gp">${esc(m[1])}</span>`:"")+clsDots(m[2].split(" · ")):esc(f.note)};
// 끌 때 보이는 모양 = 그 카드 그대로(크기·사각형), 여러 장이면 오른쪽 위 숫자
const ghost=(e,c,n)=>{const r=c.getBoundingClientRect();const w=document.createElement("div");const box=c.closest(".hp");w.className=(box?box.className:"hp")+" hp-ghost";w.style.width=(r.width+10)+"px";
  const k=c.cloneNode(true);k.classList.remove("sel","dragging");w.appendChild(k);if(n>1){const b=document.createElement("span");b.className="hp-ghostn";b.textContent=n;w.appendChild(b)}
  document.body.appendChild(w);e.dataTransfer.setDragImage(w,Math.max(0,e.clientX-r.left),Math.max(0,e.clientY-r.top+10));setTimeout(()=>w.remove(),0)};
const gchip=g=>`<span class="hp-g ${gcls(g)}">${esc(g||"학년?")}</span>`;
const sgText=x=>{const sc=x.school||"",g=x.grade||"";if(!sc)return g||"학년?";if(!g)return sc+" ?";return sc.slice(-1)===g[0]?sc+g.slice(1):sc+" "+g};
const sgchip=x=>`<span class="hp-g ${gcls(x.grade)}" title="${esc((x.school||"학교 없음")+" · "+(x.grade||"학년 없음"))}">${esc(sgText(x))}</span>`;
let OPEN=null; // {pop, fld, close}
function shut(){if(OPEN){const o=OPEN;OPEN=null;o.pop.remove();o.fld.classList.remove("open");o.fld.setAttribute("aria-expanded","false");if(o.onClose)o.onClose()}}
document.addEventListener("pointerdown",e=>{if(!OPEN)return;if(OPEN.pop.contains(e.target)||OPEN.fld.contains(e.target)||e.target.closest(".hp-dim"))return;shut()},true);
addEventListener("scroll",e=>{if(OPEN&&!OPEN.pop.contains(e.target))place(OPEN)},true);addEventListener("resize",()=>{if(OPEN)place(OPEN)});
// 목록 자리(v46, 261113 밤 사용성 시험: 위로 열릴 때 칸을 덮고 화면 맨 위에 붙었음): 아래에 다 들어가면 아래, 아니면 위에 다 들어가면 위,
// 둘 다 모자라면 넓은 쪽에 그 높이만큼(안에서 스크롤). 위로 열 때는 아래 끝을 칸 위 4에 붙여, 찾기로 목록이 줄어도 칸에 붙어 있음. 칸은 절대 가리지 않음
// v47: 칸 아래 자리가 모자라면 칸이 든 창(스크롤 상자)을 먼저 올려 목록이 아래로 열리게(사용성 시험: 창 아래 칸에서 목록이 위로 열려 창 머리·도구를 가렸음)
function lift(fld,pop){const need=Math.min(420,pop.scrollHeight||pop.offsetHeight)+12;let r=fld.getBoundingClientRect();if(innerHeight-8-r.bottom>=need)return;
  let sc=fld.parentElement;while(sc&&sc!==document.body){const st=getComputedStyle(sc);if(/(auto|scroll)/.test(st.overflowY)&&sc.scrollHeight>sc.clientHeight+1)break;sc=sc.parentElement}if(!sc||sc===document.body)return;
  const sr=sc.getBoundingClientRect();const want=Math.min(r.top-sr.top-12,need-(innerHeight-8-r.bottom));const room=sc.scrollHeight-sc.clientHeight-sc.scrollTop;const d=Math.max(0,Math.min(want,room));if(d>0)sc.scrollTop+=d}
function place(o){if(!o.fld.isConnected){shut();return} /* v48: 칸이 다시 그려져 없어지면 목록도 닫음(사용성 시험: 형제자매 고른 뒤 왼쪽 위에 막대로 남았음) */const r=o.fld.getBoundingClientRect(),p=o.pop;p.style.width=r.width+"px";p.style.left=r.left+"px";p.style.maxHeight="420px";p.style.top="0px";p.style.bottom="auto";
  const nat=Math.min(420,p.scrollHeight||p.offsetHeight);const dn=innerHeight-8-(r.bottom+4),up=r.top-4-8;
  const below=nat<=dn||(nat>up&&dn>=up);const room=Math.max(120,below?dn:up);p.style.maxHeight=Math.min(420,room)+"px";
  if(below){p.style.top=(r.bottom+4)+"px"}else{p.style.top="auto";p.style.bottom=(innerHeight-r.top+4)+"px"}
  p.classList.toggle("up",!below);if(r.bottom<0||r.top>innerHeight)shut()}
function openPop(fld,build,onClose){if(OPEN&&OPEN.fld===fld){shut();return null}shut();const pop=document.createElement("div");pop.className="hp hp-pop"+(fld.closest(".hp-one")?" hp-one":"");pop.setAttribute("role","dialog");document.body.appendChild(pop);
  OPEN={pop,fld,onClose};fld.classList.add("open");fld.setAttribute("aria-expanded","true");build(pop);lift(fld,pop);place(OPEN);requestAnimationFrame(()=>OPEN&&OPEN.pop===pop&&place(OPEN));const i=pop.querySelector("input");if(i)i.focus({preventScroll:true});
  pop.addEventListener("keydown",e=>{if(e.key==="Escape"&&!(e.target.value)){e.preventDefault();e.stopPropagation();shut();const i=fld.querySelector("input");if(i)i.blur();else fld.focus()}});return pop}
const searchBox=ph=>`<label class="hp-search">${ICON.search}<input placeholder="${esc(ph)}" autocomplete="off"></label>`;
// 학생 카드 한 장(칸 아래 카드 · 할 일 목록 카드 같은 모양): 위 이름 · 오른쪽 학교·학년(+끝 단추) / 아래 정보
const cardSub=(x,f)=>{const g=noteHtml(x,f);return `<span class="sub">${f.sub?`<span class="r">${f.sub}</span>`:""}${f.warn?`<span class="w">${f.warn}</span>`:""}${g.trim()?`<span class="g">${g}</span>`:""}</span>`};
const cardHtml=(x,f,cls,tail,attr)=>`<div class="hp-card ${cls}" data-cid="${x.id}" tabindex="0" role="listitem" aria-label="${esc(x.name)} ${esc(x.school||"")} ${esc(x.grade||"")}" ${attr||""}><span class="nm">${ICON.user}${esc(x.name)}</span><span class="hp-rt"><span class="sc">${esc(x.school||"")}</span>${gchip(x.grade)}</span><span class="hp-slot">${tail||""}</span>${cardSub(x,f)}</div>`;
const live=(host,msg)=>{let L=host.querySelector(".hp-live");if(!L){L=document.createElement("div");L.className="hp-live";L.setAttribute("aria-live","polite");host.appendChild(L)}L.textContent="";setTimeout(()=>L.textContent=msg,30)};
// 따로 뜨는 찾기 창
function dialog(html,bind){shut();const d=document.createElement("div");d.className="hp hp-dim";d.innerHTML=`<div class="hp-dlg" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(d);
  const close=()=>d.remove();d.addEventListener("pointerdown",e=>{if(e.target===d)close()});d.addEventListener("keydown",e=>{if(e.key==="Escape"){e.stopPropagation();close()}});bind(d,close);const i=d.querySelector("input");if(i)i.focus()}

/* ───── 클래스 칸 ─────
   classes: [{id,name,color,teacher,count,open?,close?}]  none: 맨 위 "클래스 없음"(보강, 값 HP.NONE — 클래스처럼 칸에 들어가고 x로 비움)  warn(id)→노란 글씨(예: "목 13:00 시간표 있음" — 막지 않고 알림)
   onNew(): [새 클래스] → 만든 클래스 id를 돌려주면 그 칸에 들어감  onChange(id|null) */
// "클래스 없음"도 클래스처럼 고르는 값(HP.NONE) — 고르면 칸에 들어가고 x로 비움(261113 대표). 비어 있음(null) = "클래스 선택"
const NONE="__none";
function cls(host,o){const st={value:o.value??null};
  const byId=id=>o.classes.find(c=>c.id===id);o.classes.forEach(c=>{COL[c.name]=c.color});
  const ended=c=>c.close&&c.close<today(),soon=c=>c.open&&c.open>today();
  // 고른 클래스 = 학생 카드와 같은 카드 모양(261113 대표): 위 색 동그라미(아이콘 자리, 누르면 색판)·이름 · 오른쪽 칩 / 아래 강사·n명 · 오른쪽 세로 가운데 x
  const xBtn=()=>o.disabled?"":`<span class="hp-clr" data-clr title="비우기 (Delete)">${ICON.x}</span>`;
  const label=()=>{const c=st.value&&st.value!==NONE?byId(st.value):null;
    if(c)return `<span class="nm"><span class="hp-cdot" role="button" tabindex="-1" data-col title="${o.disabled||!window.HF?"클래스 색":"눌러서 클래스 색 바꾸기"}" style="background:${c.color}"></span>${esc(c.name)}</span><span class="hp-rt">${soon(c)?`<span class="hp-tag">${md(c.open).slice(5)} 개강</span>`:c.close&&!ended(c)?`<span class="hp-tag w">${md(c.close).slice(5)} 종료</span>`:""}</span><span class="hp-slot">${xBtn()}</span><span class="sub"><span class="g">${esc(c.teacher)} · ${c.count}명</span></span>`;
    if(st.value===NONE)return `<span class="nm"><span class="hp-cdot none"></span>클래스 없음</span><span class="hp-rt"></span><span class="hp-slot">${xBtn()}</span><span class="sub"><span class="g">여러 클래스 학생을 함께 넣어요</span></span>`;
    return `<span class="hp-ph">${esc(o.placeholder||"클래스 선택")}</span>`};
  // 칸 = 검색창(261113 대표 — Threads 검색처럼): 눌러 바로 글자 입력, 비었으면 묶음(운영 중·오픈 예정), 글자를 넣으면 종료된 클래스까지 함께 찾음
  host.innerHTML=`<div class="hp ${o.one!==false?"hp-one":""}"><label class="hp-fld hp-sfld" ${st.value?"hidden":""}>${ICON.search}<input placeholder="${esc(o.placeholder||"클래스 검색")}" autocomplete="off" role="combobox" aria-expanded="false" ${o.disabled?"disabled":""}></label><button type="button" class="hp-fld hp-cardfld" ${st.value?"":"hidden"} ${o.disabled?"disabled":""}>${label()}</button></div>`;
  const fld=host.querySelector(".hp-sfld"),card=host.querySelector(".hp-cardfld"),inp=fld.querySelector("input");
  const draw=()=>{card.innerHTML=label();const has=!!st.value;card.hidden=!has;fld.hidden=has;inp.value=""};
  const set=id=>{st.value=id;shut();draw();o.onChange&&o.onChange(id)};
  // 클래스 줄 = 2줄(학생 줄과 같은 틀): 위 = 색 점 · 이름 · 오른쪽 칩(종료·개강), 아래 = (노랑 같은 시간 시간표) · 강사 · n명
  const row=c=>{const w=o.warn&&o.warn(c.id);return `<div class="hp-c ${st.value===c.id?"on":""}" data-v="${c.id}" role="option"><span class="hp-dot ${soon(c)?"ring":""}" style="background:${c.color};color:${c.color}"></span><span class="hp-nm">${esc(c.name)}</span>${soon(c)?`<span class="hp-tag">${md(c.open).slice(5)} 개강</span>`:c.close&&!ended(c)?`<span class="hp-tag w">${md(c.close).slice(5)} 종료</span>`:"<span></span>"}<span class="sub">${w?`<span class="w">${esc(w)}</span>`:""}<span class="g">${esc(c.teacher)} · ${c.count}명</span></span></div>`};
  // 고른 클래스 비우기(261113 대표): 칸에 마우스를 올리면 오른쪽 끝에 x — 누르면 비움(보강은 "클래스 없음"), 칸에 포커스가 있을 때 Delete·Backspace도 같음
  card.addEventListener("click",e=>{if(e.target.closest("[data-clr]")){e.stopImmediatePropagation();set(null);inp.focus()}},true);
  // 색 동그라미를 누르면 바로 색판(261113 대표) — 고르면 그 클래스 색이 바뀜(onColor(클래스 id, 색))
  card.addEventListener("click",e=>{if(!e.target.closest("[data-col]")||o.disabled||!window.HF)return;e.stopImmediatePropagation();const c=byId(st.value);if(!c)return;
    const used={};o.classes.forEach(z=>{if(z.id!==c.id)used[z.color]=z.name});
    openPop(card,p=>{p.classList.add("hp-colpop");HF.palette(p,c.color,used,col=>{c.color=col;COL[c.name]=col;shut();card.innerHTML=label();o.onColor&&o.onColor(c.id,col);live(host,"클래스 색을 바꿨어요")})})},true);
  card.addEventListener("keydown",e=>{if((e.key==="Delete"||e.key==="Backspace")&&st.value&&!o.disabled){e.preventDefault();set(null);inp.focus()}});
  card.onclick=()=>{if(o.disabled)return;const c=byId(st.value);if(c)inp.placeholder=`${c.name} — 바꿀 클래스 검색`;card.hidden=true;fld.hidden=false;inp.focus()}; // v48: 바꾸는 중에도 지금 클래스 이름이 안내 글로 보임(사용성 시험: 누르면 지워진 것처럼 보였음). 고르지 않고 나가면 그대로 // 고른 카드를 누르면 다시 검색창(바꾸기)
  let hi=0,rows=[],L=null;
  const list=()=>{if(!L)return;const q=inp.value.trim().toLowerCase();const m=c=>!q||(c.name+" "+c.teacher).toLowerCase().includes(q);const live=o.classes.filter(c=>!ended(c)&&m(c));
    const run=live.filter(c=>!soon(c)),up=live.filter(soon),end=q?o.classes.filter(c=>ended(c)&&m(c)):[];const noneOk=o.none&&(!q||"클래스 없음".includes(q));
    L.innerHTML=(noneOk?`<div class="hp-c ${st.value===NONE?"on":""}" data-v="${NONE}" role="option"><span class="hp-dot" style="background:var(--brand-mid)"></span><span class="hp-nm">클래스 없음</span><span></span><span class="sub"><span class="g">여러 클래스 학생을 함께 넣어요</span></span></div>`:"")
      +(run.length?`<div class="hp-gh">운영 중</div>${run.map(c=>row(c)).join("")}`:"")+(up.length?`<div class="hp-gh">오픈 예정</div>${up.map(c=>row(c)).join("")}`:"")
      +(end.length?`<div class="hp-gh">종료된 클래스 <small>선택하면 다시 열지 물어요</small></div>${end.map(c=>`<div class="hp-c" data-v="${c.id}" data-end="1" role="option"><span class="hp-dot ring" style="color:${c.color}"></span><span class="hp-nm">${esc(c.name)}</span><span class="hp-tag w">${c.close.slice(2,4)}.${md(c.close).slice(5)} 종료</span><span class="sub"><span class="g">${esc(c.teacher)} · ${c.count}명</span></span></div>`).join("")}`:"")
      ||'<div class="hp-empty">맞는 클래스가 없어요</div>';
    rows=[...L.querySelectorAll("[data-v]")];hi=Math.min(hi,Math.max(0,rows.length-1));rows.forEach((r,i)=>{r.classList.toggle("hi",i===hi);r.onmousedown=e=>e.preventDefault();r.onclick=()=>pick(r)})};
  const pick=r=>{const id=r.dataset.v;if(r.dataset.end){const c=byId(id);if(!confirm(`${c.name}은(는) ${md(c.close)}에 끝난 클래스예요.\n종강일을 비우고 다시 열까요?`))return;c.close="";o.onReopen&&o.onReopen(id)}set(id)};
  const open=()=>{if(o.disabled||(OPEN&&OPEN.fld===fld))return;openPop(fld,pop=>{
    pop.innerHTML=`<div class="hp-list" role="listbox"></div>${o.onNew?`<div class="hp-foot"><span class="hp-sp"></span><button type="button" class="hp-link pri" data-new>${ICON.plus}새 클래스</button></div>`:""}`;
    L=pop.querySelector(".hp-list");hi=0;list();
    const nb=pop.querySelector("[data-new]");if(nb)nb.onclick=()=>{shut();const id=o.onNew(set);if(id)set(id)}},()=>{L=null;if(st.value&&!host.contains(document.activeElement))draw()})};
  inp.addEventListener("focus",open);inp.addEventListener("click",open);
  inp.oninput=()=>{open();hi=0;list()};
  inp.onkeydown=e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();open();hi=Math.max(0,Math.min(rows.length-1,hi+(e.key==="ArrowDown"?1:-1)));rows.forEach((r,i)=>r.classList.toggle("hi",i===hi));rows[hi]&&rows[hi].scrollIntoView({block:"nearest"})}
    else if(e.key==="Enter"&&rows[hi]){e.preventDefault();pick(rows[hi])}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();if(inp.value){inp.value="";list()}else{shut();inp.blur();if(st.value)draw()}}};
  inp.addEventListener("blur",()=>setTimeout(()=>{if(!OPEN&&st.value)draw()},120));
  function endedDialog(){const L0=o.classes.filter(ended).sort((a,b)=>b.close.localeCompare(a.close));const T=[...new Set(L0.map(c=>c.teacher))];
    dialog(`<h2>종료된 클래스 찾기</h2><div class="hp-bar">${searchBox("클래스·강사 찾기")}${T.length>1?`<select class="hp-sel"><option value="">강사 전체</option>${T.map(t=>`<option>${esc(t)}</option>`).join("")}</select>`:""}</div>
      <div class="hp-list"></div><div class="hp-act-row"><span class="hp-hint">누르면 다시 열지 묻고 그 칸에 들어가요</span><span class="hp-sp"></span><button type="button" class="hp-btn" data-x>닫기</button></div>`,(d,close)=>{
      const L=d.querySelector(".hp-list"),inp=d.querySelector("input"),sel=d.querySelector("select");
      const draw2=()=>{const q=inp.value.trim().toLowerCase(),t=sel?sel.value:"";const xs=L0.filter(c=>(!q||(c.name+" "+c.teacher).toLowerCase().includes(q))&&(!t||c.teacher===t));
        L.innerHTML=xs.length?`<div class="hp-gh">종료된 클래스 <span class="hp-n">${xs.length}</span></div>${xs.map(c=>`<div class="hp-c" data-v="${c.id}"><span class="hp-dot ring" style="color:${c.color}"></span><span class="hp-nm">${esc(c.name)}</span><span class="hp-tag w">${c.close.slice(2,4)}.${md(c.close).slice(5)} 종료</span><span class="sub"><span class="g">${esc(c.teacher)} · ${c.count}명</span></span></div>`).join("")}`:'<div class="hp-empty">맞는 클래스가 없어요</div>';
        L.querySelectorAll("[data-v]").forEach(r=>r.onclick=()=>{const c=byId(r.dataset.v);if(!confirm(`${c.name}은(는) ${md(c.close)}에 끝난 클래스예요.\n종강일을 비우고 다시 열까요?`))return;c.close="";o.onReopen&&o.onReopen(c.id);close();set(c.id)})};
      inp.oninput=draw2;if(sel)sel.onchange=draw2;d.querySelector("[data-x]").onclick=close;draw2()})}
  return {get value(){return st.value},set value(v){st.value=v;draw()}}}

/* ───── 학생 칸 ─────
   students: [{id,name,school,grade,cls?(등록 클래스, 둘째 줄 회색 — 없으면 "클래스 없음")}]  value: 고른 학생 id 배열
   groups(): 열린 목록 묶음 [{title, ids, act?}] — 순서대로(이미 나온 학생은 뒤 묶음에서 빠짐)
   info(id) → {sub(빨강: 결석 등), warn(노랑: 같은 시간 수업), note(회색: 등록 클래스), dis(못 고름)}
   auto: {title, ids} — 클래스 수강생이 처음부터 칸 아래에 쌓여 있음(체크로 빼기, [모두 넣기/빼기])
   searchTitle: 찾기 창 제목  onChange(ids)  onFind(지금 ids, add(ids)) = 목록 아래 [다른 학생 찾기]를 화면의 찾기 창으로(시제품 stuModal)
   클래스 칸: onNew(set) = [새 클래스](만든 뒤 set(id)) · onReopen(id) = 종료된 클래스를 다시 열었을 때 · onColor(id, 색) */
function stu(host,o){const st={value:[...(o.value||[])]};const S=id=>o.students.find(x=>x.id===id);const info=id=>(o.info&&o.info(id))||{};
  // 칸 = 검색창(261113 대표 — Threads 검색처럼): 비었으면 묶음(보강 대기·최근 결석 …), 글자를 넣으면 묶음 결과 + "그 밖의 학생"(모든 학생)
  host.innerHTML=`<div class="hp ${o.one!==false?"hp-one":""}"><label class="hp-fld hp-sfld">${ICON.search}<input placeholder="${esc(o.placeholder||"학생 검색 · 이름·학교")}" autocomplete="off" role="combobox" aria-expanded="false"></label><div class="hp-stackwrap"></div></div>`;
  const fld=host.querySelector(".hp-sfld"),inp=fld.querySelector("input"),SW=host.querySelector(".hp-stackwrap");let redrawPop=null;
  const on=id=>st.value.includes(id);
  const subHtml=(x,f)=>`<span class="sub">${f.sub?`<span class="r">${f.sub}</span>`:""}${f.warn?`<span class="w">${f.warn}</span>`:""}<span class="g">${noteHtml(x,f)}</span></span>`;
  const row=(x,checked)=>{const f=info(x.id);const dis=f.dis&&!checked;return `<div class="hp-s ${dis?"dis":""} ${checked?"on":""}" ${dis?"":`data-id="${x.id}" tabindex="0"`} role="option" aria-selected="${!!checked}" aria-disabled="${!!dis}" title="${esc(f.title||(dis?"고를 수 없어요":checked?"누르면 빼기":"누르면 넣기"))}"><span class="nm">${ICON.user}${esc(x.name)}</span><span class="hp-rt"><span class="sc">${esc(x.school||"")}</span>${gchip(x.grade)}</span><span class="hp-slot">${dis?"":checked?`<span class="hp-on">${ICON.check}</span><span class="hp-off">${ICON.x}</span>`:`<span class="hp-plus">${ICON.plus}</span>`}</span>${cardSub(x,f)}</div>`};
  const toggle=(id,v)=>{st.value=v?[...new Set([...st.value,id])]:st.value.filter(z=>z!==id);paint();o.onChange&&o.onChange(st.value.slice())};
  const pickRow=(r,fn)=>{r.onclick=()=>fn(r.dataset.id);r.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fn(r.dataset.id)}else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const F=[...r.closest(".hp-list").querySelectorAll(".hp-s[data-id]")];const nx=F[F.indexOf(r)+(e.key==="ArrowDown"?1:-1)];if(nx)nx.focus()}}};
  // 마우스로 넣으면 글자 칸에 그대로 머묾(이어서 입력), 키보드로 줄에 와서 넣었으면 그 줄에 머묾
  const bindRows=root=>root.querySelectorAll(".hp-s[data-id]").forEach(r=>pickRow(r,id=>{const k=r.dataset.id;const kb=document.activeElement===r;toggle(k,!on(k));if(kb){const again=root.querySelector(`.hp-s[data-id="${k}"]`);if(again)again.focus()}}));
  function paint(){const extra=o.auto?st.value.filter(id=>!o.auto.ids.includes(id)):st.value;const n=st.value.length;
    // 고른 학생 = 칸 아래 붙은 목록(261113 대표 — 떨어진 카드는 끌어서 어딘가에 놓을 때만): 줄 = 2줄 · 마우스 올리면 x · Delete = 빼기
    const card=(x,checked,grp)=>{const f=Object.assign({},info(x.id));if(grp&&f.note==null){const rest=(x.cls||"").split(" · ").filter(c=>c&&c!==grp);f.note=rest.length?"그 밖에 "+rest.join(" · "):""}const dis=f.dis&&!checked;return cardHtml(x,f,`${dis?"dis":""} ${checked?"":"off"} ${grp?"ingrp":""}`,checked?`<span class="hp-clr" data-rm="${x.id}" title="빼기 (Delete)">${ICON.x}</span>`:dis?"":`<span class="hp-clr hp-add" data-ad="${x.id}" title="다시 넣기">${ICON.plus}</span>`,"")};
    // 붙은 목록 안 구역(261113 대표): 구역 머리 = 한 테두리 안 옅은 줄(드롭다운 묶음 머리와 같음)
    const sec=(title,cnt,act,xs,on2,grp)=>`<div class="hp-gh">${title}${cnt!=null?` <span class="hp-n">${cnt}</span>`:""}${act||""}</div>${xs.map(x=>card(x,on2(x.id),grp)).join("")}`;
    let h="";if(o.auto){const ids=o.auto.ids,inN=ids.filter(on).length,all=inN===ids.filter(id=>!info(id).dis||on(id)).length&&inN>0;
      st.ord=[...(st.ord||[]).filter(id=>ids.includes(id)||on(id)),...ids,...st.value].filter((id,i,a)=>a.indexOf(id)===i&&(ids.includes(id)||on(id)));
      const mine=st.ord.filter(id=>ids.includes(id)).map(S).filter(Boolean),others=extra.map(S).filter(Boolean);
      h=`<div class="hp-sh">${esc(o.auto.title)} <span><b>${inN}</b>/${ids.length}</span>${others.length?`<span>· 다른 학생 <b>${others.length}</b></span>`:""}<button type="button" class="hp-link pri" data-all>${all?"모두 빼기":"모두 넣기"}</button></div><div class="hp-cards hp-attached" role="list">${others.length?sec(esc(o.auto.title),`${inN}/${ids.length}`,"",mine,on,o.auto.cls):mine.map(x=>card(x,on(x.id),o.auto.cls)).join("")}${others.length?sec("다른 학생 <small>넣으면 수강도 함께 생겨요</small>",others.length,"",others,()=>true):""}</div>`}
    else if(n){const xs=st.value.map(S).filter(Boolean);let body;
      if(o.stackGroup){const G=new Map();xs.forEach(x=>{const k=o.stackGroup(x)||"클래스 없음";if(!G.has(k))G.set(k,[]);G.get(k).push(x)});body=[...G.entries()].map(([k,L])=>sec(esc(k),L.length,"",L,()=>true,k)).join("")}
      else body=xs.map(x=>card(x,true)).join("");
      h=`<div class="hp-sh">고른 학생 <b>${n}</b><button type="button" class="hp-link pri" data-clear>모두 빼기</button></div><div class="hp-cards hp-attached" role="list">${body}</div>`}
    SW.innerHTML=h;bindRows(SW);
    const cb=SW.querySelector("[data-clear]");if(cb)cb.onclick=()=>{st.value=[];paint();live(host,"고른 학생을 모두 뺐어요");o.onChange&&o.onChange([])};
    // 키보드: Tab = 카드 · Alt+↑↓ = 한 칸씩 · Delete = 빼기 · 옮기면 "이름, n명 중 m번째로 이동했어요"를 읽어 줌
    const mv=(id,d)=>{const arr=(o.auto?st.ord:st.value).slice();const i=arr.indexOf(id),j=i+d;if(i<0||j<0||j>=arr.length)return;arr.splice(i,1);arr.splice(j,0,id);if(o.auto){st.ord=arr;st.value=arr.filter(on)}else st.value=arr;paint();
      const c=SW.querySelector(`[data-cid="${id}"]`);if(c)c.focus();live(host,`${S(id).name}, ${arr.length}명 중 ${j+1}번째로 이동했어요`);o.onChange&&o.onChange(st.value.slice())};
    SW.querySelectorAll(".hp-card").forEach(c=>c.onkeydown=e=>{const id=c.dataset.cid;if((e.key==="Delete"||e.key==="Backspace")&&on(id)){e.preventDefault();const nx=c.nextElementSibling||c.previousElementSibling;const nid=nx&&nx.dataset.cid;toggle(id,false);live(host,`${S(id).name}을(를) 뺐어요`);const f2=nid&&SW.querySelector(`[data-cid="${nid}"]`);(f2||fld).focus()}});
    // 빼기 = 카드에 마우스를 올리면 오른쪽 x(클래스 칸 비우기와 같음), 자동 칸에서 뺀 카드는 흐리게 남고 [넣기]
    SW.querySelectorAll("[data-rm]").forEach(b=>b.onclick=e=>{e.stopPropagation();toggle(b.dataset.rm,false)});
    SW.querySelectorAll("[data-ad]").forEach(b=>b.onclick=e=>{e.stopPropagation();toggle(b.dataset.ad,true)});
    // 끌어 순서 바꾸기(카드 통째)
    let dragId=null;SW.querySelectorAll(".hp-card").forEach(g=>{g.ondragstart=e=>{dragId=g.dataset.cid;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",dragId);setTimeout(()=>g.classList.add("ghost"),0)};g.ondragend=()=>{dragId=null;SW.querySelectorAll(".hp-card").forEach(c=>c.classList.remove("ghost","before","after"))}});
    SW.querySelectorAll(".hp-card").forEach(c=>{c.ondragover=e=>{if(!dragId)return;e.preventDefault();const r=c.getBoundingClientRect(),up=e.clientY<r.top+r.height/2;SW.querySelectorAll(".hp-card").forEach(z=>z.classList.remove("before","after"));if(c.dataset.cid!==dragId)c.classList.add(up?"before":"after")};
      c.ondrop=e=>{e.preventDefault();if(!dragId||c.dataset.cid===dragId)return;const up=c.classList.contains("before");const arr=(o.auto?st.ord:st.value).filter(id=>id!==dragId);let i=arr.indexOf(c.dataset.cid);if(!up)i++;arr.splice(i,0,dragId);
        if(o.auto){st.ord=arr;st.value=arr.filter(on)}else st.value=arr;const mid=dragId;dragId=null;paint();live(host,`${S(mid).name}, ${arr.length}명 중 ${arr.indexOf(mid)+1}번째로 이동했어요`);o.onChange&&o.onChange(st.value.slice())}});
    const ab=SW.querySelector("[data-all]");if(ab)ab.onclick=e=>{e.preventDefault();const ids=o.auto.ids;const all=ab.dataset.arm==="1"||ab.textContent==="모두 빼기";
      // v47: [모두 빼기]는 한 번 더 눌러야 함(사용성 시험: 운영 중 시간표 학생이 확인 없이 모두 빠졌음)
      if(all&&ab.dataset.arm!=="1"){const n=st.value.filter(id=>ids.includes(id)).length;ab.dataset.arm="1";ab.textContent=`${n}명 모두 빼기 — 한 번 더 누르기`;ab.classList.add("warn");setTimeout(()=>{if(ab.isConnected&&ab.dataset.arm==="1"){ab.dataset.arm="";ab.textContent="모두 빼기";ab.classList.remove("warn")}},3000);return}st.value=all?st.value.filter(id=>!ids.includes(id)):[...new Set([...st.value,...ids.filter(id=>!info(id).dis)])];paint();o.onChange&&o.onChange(st.value.slice())};
    if(redrawPop)redrawPop()}
  const open=()=>{if(OPEN&&OPEN.fld===fld)return;openPop(fld,pop=>{
    pop.innerHTML=`<div class="hp-list"></div>${o.onFind?`<div class="hp-foot"><button type="button" class="hp-link" data-find>${ICON.search}다른 학생 찾기</button></div>`:o.find?`<div class="hp-foot"><button type="button" class="hp-link" data-find>${ICON.search}거르기로 찾기</button></div>`:""}`;
    const L=pop.querySelector(".hp-list");
    redrawPop=()=>{const q=inp.value.trim().toLowerCase();const hit=x=>!q||(x.name+" "+(x.school||"")).toLowerCase().includes(q);const seen=new Set(o.auto?o.auto.ids:[]);const keep=L.scrollTop;
      const G=(typeof o.groups==="function"?o.groups():o.groups||[]).map(g=>{const xs=g.ids.filter(id=>!seen.has(id)).map(S).filter(x=>x&&hit(x));xs.forEach(x=>seen.add(x.id));return [g,xs]}).filter(([,xs])=>xs.length);
      if(q){const rest=o.students.filter(x=>!seen.has(x.id)&&hit(x));if(rest.length)G.push([{title:"그 밖의 학생"},rest.slice(0,50)])}
      L.innerHTML=G.map(([g,xs])=>`<div class="hp-gh">${g.title} <span class="hp-n">${xs.length}</span>${g.act?`<span class="hp-act"><button type="button" class="hp-link pri" data-grp="${xs.map(x=>x.id).join(",")}">${xs.every(x=>on(x.id))?"모두 넣음":"모두 넣기"}</button></span>`:""}</div>${xs.map(x=>row(x,on(x.id))).join("")}`).join("")||`<div class="hp-empty">${q?"맞는 학생이 없어요":"이름이나 학교를 입력해 찾아요"}</div>`;
      bindRows(L);L.querySelectorAll(".hp-s[data-id]").forEach(r=>r.addEventListener("mousedown",e=>e.preventDefault()));
      L.querySelectorAll("[data-grp]").forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=e=>{e.preventDefault();const ids=b.dataset.grp.split(",").filter(id=>!info(id).dis);st.value=[...new Set([...st.value,...ids])];paint();o.onChange&&o.onChange(st.value.slice())}});L.scrollTop=keep};
    redrawPop();const fb=pop.querySelector("[data-find]");if(fb)fb.onclick=()=>{if(o.onFind){shut();o.onFind(st.value.slice(),ids=>{st.value=[...new Set([...st.value,...ids])];paint();o.onChange&&o.onChange(st.value.slice())})}else findDialog()}},()=>{redrawPop=null})};
  inp.addEventListener("focus",open);inp.addEventListener("click",open);
  inp.oninput=()=>{open();redrawPop&&redrawPop()};
  inp.onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();if(inp.value){inp.value="";redrawPop&&redrawPop()}else{shut();inp.blur()}}
    else if(e.key==="ArrowDown"){e.preventDefault();open();const f=OPEN&&OPEN.pop.querySelector(".hp-s[data-id]");if(f)f.focus()}};
  function findDialog(){const grades=[...new Set(o.students.map(x=>x.grade).filter(Boolean))];const pk=new Set();
    dialog(`<h2>${esc(o.searchTitle||"학생 찾기")}</h2><div class="hp-bar">${searchBox("이름·학교 찾기")}<select class="hp-sel"><option value="">학년 전체</option>${grades.map(g=>`<option>${esc(g)}</option>`).join("")}</select></div>
      <div class="hp-list"></div><div class="hp-act-row"><span class="hp-hint" data-n>0명 선택</span><span class="hp-sp"></span><button type="button" class="hp-btn" data-x>취소</button><button type="button" class="hp-btn pri" data-ok disabled>넣기</button></div>`,(d,close)=>{
      const L=d.querySelector(".hp-list"),inp=d.querySelector("input"),sel=d.querySelector("select"),ok=d.querySelector("[data-ok]");
      const cnt=()=>{d.querySelector("[data-n]").textContent=`${pk.size}명 선택`;ok.disabled=!pk.size;ok.textContent=pk.size?`${pk.size}명 넣기`:"넣기"};
      const draw2=()=>{const q=inp.value.trim().toLowerCase(),g=sel.value;const xs=o.students.filter(x=>!on(x.id)&&(!q||(x.name+" "+(x.school||"")).toLowerCase().includes(q))&&(!g||x.grade===g));
        L.innerHTML=xs.length?`<div class="hp-gh">학생 <span class="hp-n">${xs.length}</span></div>${xs.map(x=>row(x,pk.has(x.id))).join("")}`:'<div class="hp-empty">맞는 학생이 없어요</div>';
        L.querySelectorAll(".hp-s[data-id]").forEach(r=>pickRow(r,id=>{pk.has(id)?pk.delete(id):pk.add(id);const k=id;draw2();cnt();const again=L.querySelector(`.hp-s[data-id="${k}"]`);if(again)again.focus()}))};
      inp.oninput=draw2;sel.onchange=draw2;d.querySelector("[data-x]").onclick=close;ok.onclick=()=>{close();st.value=[...new Set([...st.value,...pk])];paint();o.onChange&&o.onChange(st.value.slice())};draw2()})}
  paint();return {get value(){return st.value.slice()},set value(v){st.value=[...v];paint()}}}

/* ───── 할 일 목록 카드(보강 대기·시간표 없음·클래스 없음) ─────
   같은 학생 카드 모양(정보 줄 클래스 = 색 점 + 이름). 끌 때 보이는 모양 = 그 카드 그대로(여러 장이면 숫자). 누르기 = 고르기(연갈색), Shift+누르기 = 범위, 묶음 머리 [모두 선택]/[선택 해제], 키보드 Space = 고르기 · Shift+↑↓ = 범위 · ↑↓ = 이동
   끌기 = 고른 카드가 함께 끌림(끄는 모양 = 카드 그대로 + 숫자), dataTransfer "text/hp-stu" = 학생 id 쉼표 목록 → 받는 블록(화면)이 처리
   groups: [{title, ids, cls?, start?}] — cls(묶음이 클래스일 때 그 이름)를 주면 카드 아래 줄에서 그 클래스는 빼고 "그 밖에 …"만,
     start{학생 id: 수강 시작일} = 급한 정도(카드 왼쪽 띠: 지남 빨강 · 7일 안 노랑, 글은 마우스를 올리면) + 급한 순 정렬
   info(id) → {sub, warn, note}  onSelect(ids)  onDrag(e, ids) = 화면이 끌기를 받는 방식이 따로 있을 때(시제품 startStudentDrag)
   ids가 학생이 아닌 다른 키(등록 id 등)면 students에 그 키로 넣고 info로 표시 */
function cards(host,o){const S=id=>o.students.find(x=>x.id===id);const info=id=>(o.info&&o.info(id))||{};const sel=new Set();let anchor=null;
  // 수강 시작일(g.start[학생 id]) = 급한 정도: 지났으면 빨강 "11.01 시작 · 12일째 시간표 없음", 7일 안이면 노랑 "11.16 시작 · 3일 뒤", 그 뒤면 회색 "12.01 시작" — 급한 순으로 정렬
  const days=d=>Math.round((new Date(d+"T12:00:00")-new Date(today()+"T12:00:00"))/864e5);
  const sortG=g=>g.start?g.ids.slice().sort((a,b)=>(g.start[a]||"9").localeCompare(g.start[b]||"9")):g.ids;
  const lineG=(g,x)=>{const f=Object.assign({},info(x.id));const rest=g.cls?(x.cls||"").split(" · ").filter(c=>c&&c!==g.cls):null;const d=g.start&&g.start[x.id];
    if(d){const n=days(d),t=`${md(d).slice(5)} 시작`;if(n<=0)f.sub=f.sub||`${t} · ${-n?`${-n}일째`:"오늘부터"} 시간표 없음`;else if(n<=7)f.warn=f.warn||`${t} · ${n}일 뒤`;else if(f.note==null)f.note=t+(rest&&rest.length?" · 그 밖에 "+rest.join(" · "):"")}
    if(f.note==null&&rest)f.note=rest.length?"그 밖에 "+rest.join(" · "):"";if(f.note==="")f.note=" ";return f};
  const flat=()=>o.groups.flatMap(g=>sortG(g));
  const paint=()=>{const n=sel.size;const L=host.querySelector(".hp-live");
    host.innerHTML=`<div class="hp ${o.one!==false?"hp-one":""}"><div class="hp-sh hp-todo">${n?`<span><b>${n}</b>명 선택 · 시간표에 끌어 놓기</span><button type="button" class="hp-link pri" data-none>선택 해제</button>`:`<span>누르면 선택 · Shift 범위 · 시간표에 끌어 놓기</span>`}</div>
      ${o.groups.map((g,gi)=>{const all=g.ids.length&&g.ids.every(id=>sel.has(id));return `<div class="hp-sh hp-gsh">${g.title} <span class="hp-n">${g.ids.length}</span><button type="button" class="hp-link pri" data-ga="${gi}">${all?"선택 해제":"모두 선택"}</button></div><div class="hp-cards" role="listbox" aria-multiselectable="true">${sortG(g).map(S).filter(Boolean).map(x=>{const f=lineG(g,x);return cardHtml(x,f,`${sel.has(x.id)?"sel":""} ${g.cls?"ingrp":""} ${f.sub?"urg-r":f.warn?"urg-w":""}`,"",`draggable="true" aria-selected="${sel.has(x.id)}" ${f.sub||f.warn?`title="${esc(f.sub||f.warn)}"`:""}`)}).join("")}</div>`}).join("")}</div>`;
    if(L)host.appendChild(L);
    host.querySelectorAll(".hp-card").forEach(c=>{const id=c.dataset.cid;
      c.onclick=e=>{if(e.shiftKey&&anchor){const F=flat(),a=F.indexOf(anchor),b=F.indexOf(id);F.slice(Math.min(a,b),Math.max(a,b)+1).forEach(z=>sel.add(z))}else{sel.has(id)?sel.delete(id):sel.add(id);anchor=id}done(id)};
      c.onkeydown=e=>{const F=[...host.querySelectorAll(".hp-card")];const i=F.indexOf(c);
        if(e.key===" "){e.preventDefault();sel.has(id)?sel.delete(id):sel.add(id);anchor=id;done(id)}
        else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const nx=F[i+(e.key==="ArrowDown"?1:-1)];if(!nx)return;if(e.shiftKey){sel.add(id);sel.add(nx.dataset.cid);done(nx.dataset.cid)}else nx.focus()}};
      c.ondragstart=e=>{if(!sel.has(id)){sel.clear();sel.add(id);anchor=id}const ids=flat().filter(z=>sel.has(z));e.dataTransfer.setData("text/hp-stu",ids.join(","));e.dataTransfer.effectAllowed="copy";if(o.onDrag)o.onDrag(e,ids);
        ghost(e,c,ids.length);
        host.querySelectorAll(".hp-card").forEach(z=>{if(sel.has(z.dataset.cid))z.classList.add("sel","dragging")})};
      c.ondragend=()=>host.querySelectorAll(".hp-card").forEach(z=>z.classList.remove("dragging"))});
    host.querySelectorAll("[data-ga]").forEach(b=>b.onclick=()=>{const g=o.groups[+b.dataset.ga];const all=g.ids.every(id=>sel.has(id));g.ids.forEach(id=>all?sel.delete(id):sel.add(id));done()});
    const nb=host.querySelector("[data-none]");if(nb)nb.onclick=()=>{sel.clear();done()}};
  const done=focusId=>{paint();o.onSelect&&o.onSelect([...sel]);live(host,`${sel.size}명 골랐어요`);if(focusId){const c=host.querySelector(`[data-cid="${focusId}"]`);if(c)c.focus()}};
  paint();return {get selected(){return [...sel]},clear(){sel.clear();paint()},remove(ids){o.groups.forEach(g=>g.ids=g.ids.filter(id=>!ids.includes(id)));ids.forEach(id=>sel.delete(id));paint()}}}

/* ───── 보강(할 일 [보강] 탭 안, 261113 대표) ─────
   [보강 대기 n] [최근 결석] 두 탭.
   보강 대기 = 등록(학생+클래스) 하나에 카드 하나 — 한 학생이 두 클래스에서 빠졌으면 카드 두 장(영어 보강·수학 보강을 한 카드에 섞지 않음)
     떨어진 카드(끌어서 그 클래스 보강 수업에 놓기) · 이름 · 학교 · 학년 ……… 클래스(색 점) · 숫자 배지(보강해야 할 횟수) · 카드를 누르면 아래로 열림(아이콘 없음)
     열면 카드와 이어진 한 덩어리(위 학생 줄 = 진한 바탕, 결석 줄 = 흰 바탕) · 결석 줄 = 결석일(요일) · n일 전 ……… 상태 글 + 상태 아이콘(최근 결석과 같음, 필요 = 채운 갈색 / 없음 = 회색 테두리)
     기간 제한 없음 — 완료·보강 없음은 빠지고, 다 처리하면 카드도 빠짐
   최근 결석 = 기간(기본 4주, 2·4·8·12주) 안 결석을 주차 구역으로 묶은 붙은 목록(끌 수 없음)
     줄 = 이름 · 클래스 ……… 날짜 · 상태 아이콘(보강 필요 시계 · 보강 없음 x · 보강 예정 달력 · 보강 완료 체크) — 필요↔없음은 아이콘을 눌러 바꿈(실수로 보강 없음 한 것 되돌리기)
   보강 없음으로 바꾸면 그 줄 아래 사유 칸(한 줄, 커서가 바로 감 · 최근 결석 아이콘에 마우스를 올리면 사유)
   items: [{sid, cls, color, abs:[{id, d, st:"pre"|"need"|"re"|"pend"|"none"|"done", mk?, why?}]}]  onDecide(absId, "need"|"none")  onWhy(absId, 사유) */
function wait(host,o){const S=id=>o.students.find(x=>x.id===id);const st={tab:o.tab||"wait",weeks:o.weeks||4,open:new Set(o.open||[]),just:new Set()};
  const days=d=>Math.round((new Date(today()+"T12:00:00")-new Date(d+"T12:00:00"))/864e5);
  const dw=d=>"일월화수목금토"[new Date(d+"T12:00:00").getDay()];
  const key=it=>it.sid+"|"+it.cls;
  const waiting=a=>a.st==="pre"||a.st==="need"||a.st==="re";
  const stText=a=>a.st==="pend"?`보강 예정${a.mk?` · ${esc(a.mk)}`:""}`:a.st==="done"?"보강 완료":a.st==="none"?"보강 없음":"보강 필요";
  const absRow=a=>`<div class="hp-abs st-${a.st}"><span class="t"><span class="hp-ai">${ICON.cal}</span><b>${md(a.d)}(${dw(a.d)})</b> <span class="m">${days(a.d)?days(a.d)+"일 전":"오늘"}${a.st==="re"?" · 보강도 결석":""}</span></span><span class="hp-stt">${stText(a)}</span><span class="hp-slot">${icon(a)}</span>${a.st==="none"?`<label class="hp-why">${ICON.edit}<input data-why="${a.id}" value="${esc(a.why||"")}" placeholder="사유 입력 (예: 개인 사정)" title="보강 없음 사유 — 예: 개인 사정 · 다른 날 수업으로 대신함" maxlength="60" autocomplete="off"></label>`:""}</div>`;
  const icon=a=>{const m={pre:["clock","보강 필요(판단 전)","need"],need:["clock","보강 필요","need"],re:["clock","보강 필요(보강도 결석)","need"],none:["x","보강 없음","none"],pend:["cal","보강 예정"+(a.mk?` · ${a.mk}`:""),"pend"],done:["check","보강 완료","done"]}[a.st];
    const can=a.st!=="pend"&&a.st!=="done";return `<button type="button" class="hp-clr hp-sti s-${m[2]}" ${can?`data-flip="${a.id}"`:"disabled"} title="${esc(m[1])}${a.st==="none"&&a.why?` · 사유: ${esc(a.why)}`:""}${can?` — 누르면 ${a.st==="none"?"보강 필요로":"보강 없음으로"}`:""}" aria-label="${esc(m[1])}">${ICON[m[0]]}</button>`};
  const flip=id=>{const a=o.items.flatMap(it=>it.abs).find(z=>z.id===id);a.st=a.st==="none"?"need":"none";if(a.st==="none")st.just.add(id);o.onDecide&&o.onDecide(id,a.st);paint();live(host,a.st==="none"?"보강 없음으로 바꿨어요 · 사유를 입력할 수 있어요":"보강 필요로 바꿨어요");if(a.st==="none"){const i=host.querySelector(`[data-why="${id}"]`);if(i)i.focus()}};
  const waitView=()=>{const L=o.items.filter(it=>st.open.has(key(it))||it.abs.some(a=>a.st!=="none"&&a.st!=="done"));
    return `<div class="hp-sh hp-todo"><span>카드를 누르면 결석이 열려요 · 끌어서 그 클래스 보강 수업에 놓기</span></div><div class="hp-cards">${L.map(it=>{const x=S(it.sid);const all=it.abs.slice().sort((a,b)=>a.d.localeCompare(b.d));const n=all.filter(waiting).length;const op=st.open.has(key(it));
      return `<div class="hp-witem ${op?"open":""}"><div class="hp-card hp-wait" data-k="${esc(key(it))}" data-cid="${x.id}" tabindex="0" draggable="true" aria-expanded="${op}" title="누르면 결석 열기 · 끌어서 그 클래스 보강 수업에 놓기"><span class="nm">${ICON.user}${esc(x.name)}</span><span class="hp-rt"><span class="sc">${esc(x.school||"")}</span>${gchip(x.grade)}</span><span class="hp-wcls"><span class="hp-dot" style="background:${it.color}"></span>${esc(it.cls)}</span><span class="hp-slot">${n?`<span class="hp-n hp-wcount" title="보강 ${n}회 필요">${n}</span>`:`<span class="hp-wn" title="${all.some(a=>a.st==="pend")?"보강 예정":"보강 없음"}">${all.some(a=>a.st==="pend")?ICON.cal:""}</span>`}</span></div>
        ${op?`<div class="hp-absl">${all.filter(a=>(a.st!=="done"&&a.st!=="none")||st.just.has(a.id)).map(absRow).join("")}</div>`:""}</div>`}).join("")||'<div class="hp-empty">보강을 기다리는 결석이 없어요</div>'}</div>`};
  const recentView=()=>{const from=new Date(today()+"T12:00:00");from.setDate(from.getDate()-st.weeks*7);const f=from.toISOString().slice(0,10);
    const rows=o.items.flatMap(it=>it.abs.filter(a=>a.d>=f&&a.d<=today()).map(a=>({it,a}))).sort((p,q)=>q.a.d.localeCompare(p.a.d));
    const wk=d=>{const t=new Date(d+"T12:00:00");const mon=new Date(t);mon.setDate(t.getDate()-((t.getDay()+6)%7));const sun=new Date(mon);sun.setDate(mon.getDate()+6);const iso=x=>x.toISOString().slice(0,10);return [iso(mon),iso(sun)]};
    const G=new Map();rows.forEach(r=>{const [m2,s2]=wk(r.a.d);const k=m2;if(!G.has(k))G.set(k,{m:m2,s:s2,L:[]});G.get(k).L.push(r)});
    return `<div class="hp-sh hp-todo"><span>최근</span><select class="hp-sel hp-weeks" aria-label="기간">${[2,4,8,12].map(w=>`<option value="${w}" ${w===st.weeks?"selected":""}>${w}주</option>`).join("")}</select><span>결석 ${rows.length} · 아이콘을 눌러 보강 필요 ↔ 보강 없음</span></div>
      <div class="hp-cards hp-attached" role="list">${[...G.values()].map(g=>`<div class="hp-gh">${md(g.m).slice(5)} - ${md(g.s).slice(5)} <span class="hp-n">${g.L.length}</span></div>${g.L.map(({it,a})=>{const x=S(it.sid);return `<div class="hp-card hp-rec st-${a.st}" role="listitem"><span class="nm">${ICON.user}${esc(x.name)}</span><span class="hp-wcls"><span class="hp-dot" style="background:${it.color}"></span>${esc(it.cls)}</span><span class="hp-rd">${md(a.d).slice(5)}(${dw(a.d)})</span><span class="hp-slot">${icon(a)}</span></div>`}).join("")}`).join("")||'<div class="hp-empty">이 기간에 결석이 없어요</div>'}</div>`};
  const paint=()=>{const nWait=o.items.filter(it=>it.abs.some(waiting)).length;
    host.innerHTML=`<div class="hp"><div class="hp-tabs" role="tablist"><button type="button" role="tab" class="${st.tab==="wait"?"on":""}" data-tab="wait">보강 대기 <span class="hp-n">${nWait}</span></button><button type="button" role="tab" class="${st.tab==="recent"?"on":""}" data-tab="recent">최근 결석</button></div>${st.tab==="wait"?waitView():recentView()}</div>`;
    host.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{st.tab=b.dataset.tab;st.just.clear();paint()});
    const ws=host.querySelector(".hp-weeks");if(ws)ws.onchange=()=>{st.weeks=+ws.value;paint()};
    host.querySelectorAll(".hp-wait").forEach(c=>{const k=c.dataset.k;
      const tog=()=>{if(st.open.has(k)){st.open.delete(k);st.just.clear()}else st.open.add(k);paint();const c2=[...host.querySelectorAll(".hp-wait")].find(z=>z.dataset.k===k);if(c2)c2.focus({preventScroll:true})};
      c.onclick=tog;c.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();tog()}};
      c.ondragstart=e=>{const [sid,cls]=k.split("|");e.dataTransfer.setData("text/hp-stu",sid);e.dataTransfer.setData("text/hp-cls",cls);e.dataTransfer.effectAllowed="copy";ghost(e,c,1);if(o.onDrag)o.onDrag(e,[sid],cls)}});
    host.querySelectorAll("[data-dec]").forEach(b=>b.onclick=e=>{e.stopPropagation();flip(b.dataset.dec)});
    host.querySelectorAll("[data-why]").forEach(i=>{const a=o.items.flatMap(it=>it.abs).find(z=>z.id===i.dataset.why);i.onclick=e=>e.stopPropagation();i.onkeydown=e=>{e.stopPropagation();if(e.key==="Enter"||e.key==="Escape")i.blur()};i.oninput=()=>{a.why=i.value};i.onchange=()=>{a.why=i.value.trim();o.onWhy&&o.onWhy(a.id,a.why)}});
    host.querySelectorAll("[data-flip]").forEach(b=>b.onclick=e=>{e.stopPropagation();flip(b.dataset.flip)})};
  paint();return {repaint:paint}}

window.HP={cls,stu,cards,wait,shut,today:null,NONE};
})();
