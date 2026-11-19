/* 입력칸 모듈(field) — 261113 대표: 모든 입력칸 = 왼쪽 아이콘 + 왼쪽 정렬, 바깥 높이 40 (고르기 칸 HP.cls·HP.stu와 같은 틀)
   HF.text · memo · num · tel · select · day(요일 하나) · days(요일 여러 개) · date · time · datetime · dateRange · timeRange · color · sw(켜고 끄기) · seg(구분)
   공통 옵션: label, value, placeholder, disabled, req(필수 *), onChange(값)
   공통 동작: 마우스를 올리거나 입력 중이면 값이 있을 때 오른쪽 x(비우기) · 틀린 값은 빨간 테두리 + 칸 아래 12 글씨
   목록이 뜨는 칸(드롭다운·요일·날짜·시간·색): 칸과 같은 폭으로 칸 바로 아래 4 띄워 열림(달력·색판은 칸이 좁으면 최소 폭)(아래 자리가 모자라면 위), 한 번에 하나, 바깥 누름·Esc = 닫힘, ↑↓·Enter */
(function(){
const P='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const I={loader:P+'<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',chevc:P+'<circle cx="12" cy="12" r="10"/><path d="m8 10 4 4 4-4"/></svg>',plus:P+'<path d="M12 5v14M5 12h14"/></svg>',droplet:P+'<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',type:P+'<path d="M17 10H3M21 6H3M21 14H3M17 18H3"/></svg>',
  memo:P+'<path d="M17 10H3M21 6H3M21 14H3M17 18H3"/></svg>',
  hash:P+'<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
  tel:P+'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  list:P+'<circle cx="12" cy="12" r="10"/><polyline points="8 10 12 14 16 10"/></svg>',
  repeat:P+'<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  cal:P+'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock:P+'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  drop:P+'<path d="M12 2.7 17.7 8.3a8 8 0 1 1-11.3 0z"/></svg>',
  toggle:P+'<rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/></svg>',
  split:P+'<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  search:P+'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  x:P+'<path d="M18 6 6 18M6 6l12 12"/></svg>',
  more:P+'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  check:P+'<path d="M20 6 9 17l-5-5"/></svg>',
  left:P+'<path d="m15 18-6-6 6-6"/></svg>',
  right:P+'<path d="m9 18 6-6-6-6"/></svg>'};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const pad=n=>String(n).padStart(2,"0");
/* 261119: 앱 오늘(window.TODAY · HP.today)이 먼저, 없으면 이 컴퓨터 날짜(한국 시각) — toISOString은 UTC라 새벽 0~9시에 어제가 됐음 */
const TODAY=()=>(window.HP&&HP.today)||(typeof window.TODAY==="string"&&window.TODAY)||(()=>{const n=new Date(),p=v=>String(v).padStart(2,"0");return `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}`})();
const DOW="일월화수목금토";
const dw=iso=>DOW[new Date(iso+"T12:00:00").getDay()];
// 떠 있는 목록(한 번에 하나)
let OPEN=null;
function close(){if(OPEN){const o=OPEN;OPEN=null;o.pop.remove();o.box.classList.remove("open")}}
document.addEventListener("pointerdown",e=>{if(OPEN&&!OPEN.pop.contains(e.target)&&!OPEN.box.contains(e.target))close()},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&OPEN){e.preventDefault();e.stopImmediatePropagation();const b=OPEN.box;close();const f=b.querySelector("input")||b;f.focus()}});
function pop(box,build,cls){if(OPEN&&OPEN.box===box)return OPEN.pop;close();const p=document.createElement("div");p.className="hf-pop "+(cls||"");box.parentElement.appendChild(p);
  OPEN={pop:p,box};box.classList.add("open");p.style.width=Math.max(box.offsetWidth,128)+"px";build(p);/* 목록 글자가 잘리지 않게 = 글자만큼(최대 360) */p.style.width="max-content";const nat=Math.min(360,p.offsetWidth+2);p.style.width=Math.max(box.offsetWidth,p.querySelector("input")?208:128,nat)+"px";
  const r=box.getBoundingClientRect();let top=box.offsetTop+box.offsetHeight+4;
  const up=r.bottom+4+p.offsetHeight>innerHeight-8&&r.top-4-p.offsetHeight>8,op=p.offsetParent;
  if(up&&op===box.parentElement)p.style.bottom=(op.clientHeight-box.offsetTop+4)+"px";else p.style.top=(up?box.offsetTop-4-p.offsetHeight:top)+"px";p.style.left=box.offsetLeft+"px";p.style.width=Math.max(box.offsetWidth,p.querySelector("input")?208:128,nat)+"px";/* 417판: 검색 칸·편집(…)이 있는 목록은 208부터 *//* 293판(대표): 달력처럼 칸보다 넓은 창이 오른쪽 창·화면 밖으로 나가면 칸 오른쪽 끝에 맞춰 안쪽으로 */{const wr=(box.closest(".panel,#lp,#sp,.dlg,.mp-pn")||document.documentElement).getBoundingClientRect(),lim=Math.min(innerWidth,wr.right)-8,lo=Math.max(0,wr.left)+8,pr=p.getBoundingClientRect();if(pr.right>lim)p.style.left=(box.offsetLeft-(pr.right-lim))+"px";
    /* 261119 대표: 오른쪽 창 왼쪽 끝 밖으로도 나가지 않게(클래스 · 등록 진도 교재 고르기가 잘리던 것) — 넘치면 창 폭에 맞춰 줄임 */const p2=p.getBoundingClientRect();if(p2.left<lo){if(p2.width>lim-lo)p.style.width=(lim-lo)+"px";p.style.left=(parseFloat(p.style.left)+(lo-p2.left))+"px"}}return p}
// 칸 틀: 라벨(칸 위 12/600, 아래 4) · 칸(40) · 알림 글(칸 아래 12)
/* 302판(대표): 알림톡으로 나가는 칸 = 칸 옵션 alim:"화면|칸" 하나 → 라벨 오른쪽 [알림톡 미리보기] 버튼, 누르면 칸 아래에 실제 알림톡 모양(입력하면 바로 바뀜). 모양·템플릿은 alim-preview.js 한 곳 */
const alimOf=o=>o&&o.alim&&window.ALIMV&&ALIMV.forField(o.alim);
function alimBind(host,o){const a=alimOf(o);if(!a)return;const bt=host.querySelector(".alv-btnq");if(!bt)return;let box=null;/* 307판(대표): 칸 아래 펼침 대신 팝업 — 좁은 창에서도 한눈에 */
  const cur=()=>{const i=host.querySelector("textarea,input");return i?i.value:""};const draw=()=>{if(box){if(!host.isConnected){shut();return}box.querySelector(".alv-popin").innerHTML=ALIMV.render(a[0],cur(),a[1],a[2])}};
  const place=()=>{if(!box)return;const r=bt.getBoundingClientRect(),w=box.offsetWidth,h=box.offsetHeight;let x=r.left-w-12;if(x<8)x=Math.min(innerWidth-w-8,Math.max(8,r.right-w));let y=Math.min(Math.max(8,r.top-40),innerHeight-h-8);if(x+w>r.left-4&&x<r.right){y=r.bottom+6;if(y+h>innerHeight-8)y=Math.max(8,r.top-h-6)}box.style.left=x+"px";box.style.top=y+"px"};
  const shut=()=>{if(!box)return;box.remove();box=null;bt.setAttribute("aria-expanded","false");removeEventListener("pointerdown",out,true);removeEventListener("keydown",esc1,true)};
  const out=e=>{if(box&&!box.contains(e.target)&&!bt.contains(e.target)&&!host.contains(e.target))shut()};const esc1=e=>{if(e.key==="Escape"&&box){e.stopPropagation();shut()}};
  bt.onpointerdown=e=>e.preventDefault();/* 누를 때 칸에서 커서가 떠나지 않게(떠나면 저장·다시 그리기로 버튼이 바뀜) */
  bt.onclick=e=>{e.preventDefault();e.stopPropagation();if(box){shut();return}box=document.createElement("div");box.className="alv-pop";box.innerHTML=`<div class="alv-poph"><b>알림톡 미리보기</b><span class="alv-pops">칸에 쓰면 바로 바뀌어요</span><button type="button" class="alv-popx" aria-label="닫기">${I.x}</button></div><div class="alv-popin"></div>`;document.body.appendChild(box);box.querySelector(".alv-popx").onclick=shut;bt.setAttribute("aria-expanded","true");draw();place();addEventListener("pointerdown",out,true);addEventListener("keydown",esc1,true)};
  host.addEventListener("input",()=>{draw();place()})}
/* 261118 대표("설명은 도움말 버튼으로 다 옮기자", 기준 "설명 글은 제목 옆 (?)에"): 칸 설명(help)은 이름 옆 (?)로 — 칸 밑 글 자리는 오류 · 확인 말만. 이름 없는 칸은 예전처럼 밑에 */
const helpTip=(o)=>o.help&&o.label&&typeof HELP==="function"?HELP(o.help):"";
const shell=(host,o,inner,cls)=>{const tip=helpTip(o);host._help=tip?o.help:null;host.innerHTML=`<div class="hf ${o.disabled?"dis":""}">${o.label?`<span class="hf-lbl">${esc(o.label)}${o.req?' <i>*</i>':""}${o.tipHtml||""}${tip}</span>`:""}<div class="hf-box ${cls||""}">${inner}</div><span class="hf-msg">${tip?"":esc(o.help||"")}</span></div>`;alimBind(host,o);return host.querySelector(".hf-box")};
const say=(host,t,err)=>{if(!err&&host._help&&t===host._help)t="";const m=host.querySelector(".hf-msg");m.textContent=t||"";host.querySelector(".hf").classList.toggle("err",!!(err&&t))};
const X=`<button type="button" class="hf-x" tabindex="-1" aria-label="비우기" title="비우기">${I.x}</button>`;
const has=(b,v)=>b.classList.toggle("has",!!v);
// 글자 입력 공통(text·num·tel·memo)
/* 261119 대표: 목록 규칙 = 노션과 같게 — 줄 첫머리 "- " · "* " → "  • ", "1. " → "  1. "(앞에 공백 2개), 목록 줄에서 Enter = 다음 점 · 다음 번호, 빈 목록 줄에서 Enter = 목록 끝. 모든 긴 글 칸(공용 memo) + 앱의 다른 textarea(HFLIST.bind) */
const HFLIST={bind(i){if(!i||i._hfl)return;i._hfl=1;i.addEventListener("keydown",e=>{if(e.isComposing)return;const v=i.value,s=i.selectionStart;if(s!==i.selectionEnd)return;const ls=v.lastIndexOf("\n",s-1)+1,line=v.slice(ls,s);
    const put=(a,b,txt)=>{e.preventDefault();i.value=v.slice(0,a)+txt+v.slice(b);const c=a+txt.length;i.setSelectionRange(c,c);i.dispatchEvent(new Event("input",{bubbles:true}))};
    if(e.key===" "){if(/^\s*[-*]$/.test(line))return put(ls,s,"  • ");const m=line.match(/^\s*(\d+)\.$/);if(m)return put(ls,s,`  ${m[1]}. `);return}
    if(e.key==="Enter"&&!e.shiftKey){const le=v.indexOf("\n",s),full=v.slice(ls,le<0?v.length:le);const b=full.match(/^  • (.*)$/),n=full.match(/^  (\d+)\. (.*)$/);
      if(b){if(!b[1].trim())return put(ls,le<0?v.length:le,"");return put(s,s,"\n  • ")}
      if(n){if(!n[2].trim())return put(ls,le<0?v.length:le,"");return put(s,s,`\n  ${+n[1]+1}. `)}}})}};
if(typeof window!=="undefined")window.HFLIST=HFLIST;
function typed(host,o,icon,attrs,fmt,check,cls){const tag=cls==="hf-memo"?"textarea":"input";
  const memo=tag==="textarea";const b=shell(host,o,`${memo||icon==="type"?"":o.pre?`<span class="hf-unit hf-pre">${esc(o.pre)}</span>`:icn(icon)}<${tag} ${attrs||""} placeholder="${esc(o.placeholder||"")}" ${o.disabled?"disabled":""} ${tag==="input"?`value="${esc(o.value||"")}">`:`rows="1">${esc(o.value||"")}</textarea>`}${o.unit?`<span class="hf-unit">${esc(o.unit)}</span>`:""}${o.disabled||memo?"":X}`,cls);
  const i=b.querySelector(tag);if(memo&&!o.disabled)HFLIST.bind(i);if(memo&&!o.disabled){const g=document.createElement("span");g.className="hf-grip";g.title="끌어서 높이 조절";b.appendChild(g);/* 291판(대표): 아래로만 늘림 — 아래 선 어디서든 잡고 끌기 */
    g.onpointerdown=e=>{e.preventDefault();g.setPointerCapture(e.pointerId);const y0=e.clientY,h0=i.offsetHeight;b.classList.add("drag");/* 351판(대표): 늘릴 때 창 스크롤도 같이 내려감(손잡이가 아래 단추 줄에 가리지 않게) */let sc=b.parentElement;while(sc&&!(sc.scrollHeight>sc.clientHeight&&/auto|scroll/.test(getComputedStyle(sc).overflowY)))sc=sc.parentElement;const s0=sc?sc.scrollTop:0;g.onpointermove=ev=>{i.style.height=Math.max(42,h0+ev.clientY-y0+(sc?sc.scrollTop-s0:0))+"px";if(sc){const ft=[...sc.children].find(c=>getComputedStyle(c).position==="sticky"&&c.getBoundingClientRect().top>sc.getBoundingClientRect().top+sc.clientHeight/2);const lim=(ft?ft.getBoundingClientRect().top:sc.getBoundingClientRect().bottom)-12,gb=g.getBoundingClientRect().bottom;if(gb>lim)sc.scrollTop+=gb-lim}};g.onpointerup=g.onpointercancel=()=>{g.onpointermove=null;b.classList.remove("drag")}}}
  const grow=()=>{if(memo&&i.scrollHeight>i.clientHeight)i.style.height=i.scrollHeight+"px"};/* 271판: 긴 글은 입력란 자체가 늘어남(손잡이로도) */
  if(fmt&&i.value)i.value=fmt(i.value);has(b,i.value);setTimeout(grow);
  b.onpointerdown=e=>{if(e.target===b||e.target.closest("svg:not(.hf-x svg)")){e.preventDefault();i.focus()}};
  i.oninput=()=>{if(fmt){const n=fmt(i.value);if(n!==i.value)i.value=n}has(b,i.value);grow();say(host,o.help||"");o.onChange&&o.onChange(i.value)};
  i.onblur=()=>{if(check){const m=i.value&&check(i.value);say(host,m||o.help||"",!!m)}};
  const x=b.querySelector(".hf-x");if(x){x.onpointerdown=e=>e.preventDefault();x.onclick=()=>{i.value="";has(b,"");grow();say(host,o.help||"");i.focus();/* 526판: 바뀜을 change로 듣는 칸(onChange 없이 쓰는 칸)도 × 비우기를 알게 */if(o.onChange)o.onChange("");else i.dispatchEvent(new Event("change",{bubbles:true}))}}
  return {el:i,get value(){return i.value}}}
const text=(host,o={})=>typed(host,o,o.icon||"type",`maxlength="${o.max||100}" autocomplete="off"`);
const memo=(host,o={})=>typed(host,o,"memo",`maxlength="${o.max||1000}"`,null,null,"hf-memo");
const num=(host,o={})=>typed(host,o,o.icon||(o.unit==="원"?"won":"hash"),o.signed?'inputmode="text" autocomplete="off"':'inputmode="numeric" autocomplete="off"',v=>{const neg=o.signed&&/^\s*[-−]/.test(v);const d=v.replace(/[^\d]/g,"").replace(/^0+(?=\d)/,"");return (neg?"-":"")+(o.comma===false?d:d.replace(/\B(?=(\d{3})+(?!\d))/g,","))}/* signed: 빼는 금액(조정)은 앞에 − 하나 */,v=>{const n=+v.replace(/,/g,"");return o.max!=null&&n>o.max?`${o.max.toLocaleString()}${o.unit||""}까지 적을 수 있어요`:o.min!=null&&n<o.min?`${o.min}${o.unit||""}부터 적을 수 있어요`:""});
// 전화번호: 숫자만 넣으면 줄표가 자동(010-0000-0000 · 02-000-0000), 자리 수가 맞지 않으면 알림
const telFmt=v=>{const d=v.replace(/\D/g,"").slice(0,11);if(d.startsWith("02")){const t=d.slice(0,10);return t.length<3?t:t.length<6?t.slice(0,2)+"-"+t.slice(2):t.length<10?t.slice(0,2)+"-"+t.slice(2,5)+"-"+t.slice(5):t.slice(0,2)+"-"+t.slice(2,6)+"-"+t.slice(6)}
  return d.length<4?d:d.length<8?d.slice(0,3)+"-"+d.slice(3):d.length<11?d.slice(0,3)+"-"+d.slice(3,6)+"-"+d.slice(6):d.slice(0,3)+"-"+d.slice(3,7)+"-"+d.slice(7)};
const tel=(host,o={})=>typed(host,Object.assign({placeholder:"010-0000-0000"},o),o.icon||"tel",'inputmode="tel" autocomplete="off"',telFmt,v=>{const d=v.replace(/\D/g,"");return (d.startsWith("01")?d.length===11||(d.length===10&&!d.startsWith("010")):d.length>=9&&d.length<=11)?"":"번호 자리 수를 확인해 주세요"});
// 목록에서 하나 고르기(드롭다운): 항목이 9개 이상이면 위에 검색 칸
/* 299판: 아이콘 이름 → field.js 그림, 없으면 규칙 파일 아이콘 사전(FEATHER) */const UI_ICONS=new Set(["list","chevc","x","more","check","search","plus","type","left","right","toggle","split","drop","memo"]);/* 300판(연결): 뜻 아이콘은 규칙 파일 사전(FEATHER)이 먼저 — 표 열 머리와 같은 그림. 칸 조작 아이콘만 field.js 것 */
const FE={cal:"calendar",tel:"phone",clock:"clock",hash:"hash",repeat:"repeat",/* 고르기 칸 아이콘은 규칙 파일 한 곳(ICON_SELECT). calc = 자동 계산 칸(고르기 아님) */loader:(typeof ICON_SELECT!=="undefined"?ICON_SELECT:"loader"),calc:"loader"};
const icn=k=>{const g=typeof FEATHER!=="undefined"?FEATHER[FE[k]||k]:null;return !UI_ICONS.has(k)&&g?P+g+"</svg>":(I[k]||I.list)};
function list(p,items,cur,onPick,o){let addK="";p.innerHTML=`${(items.length>8||(o&&o.add))&&!(o&&o.keepFocus)?`<label class="hf-q">${I.search}<input placeholder="${o&&o.add?"검색 또는 추가":"검색"}" autocomplete="off"></label>`:""}<div class="hf-list" role="listbox" tabindex="-1"></div>`;
  const L=p.querySelector(".hf-list"),q=p.querySelector(".hf-q input");let act=Math.max(0,items.findIndex(x=>x.v===cur)),xs=items;
  const draw=()=>{const k=q?q.value.trim():"";xs=items.filter(x=>!k||x.t.includes(k));addK=o&&o.add&&k&&!items.some(x=>x.t===k)?k:"";act=Math.max(0,Math.min(act,xs.length-1+(addK?1:0)));
    L.innerHTML=xs.map((x,i)=>`<div class="hf-opt ${x.v===cur?"on":""} ${i===act?"act":""}" data-i="${i}" role="option" aria-selected="${x.v===cur}">${x.color?`<span class="hf-dot" style="background:${x.color}"></span>`:""}<span class="t">${x.cls?`<span class="spill ${esc(x.cls)}">${esc(x.t)}</span>`:esc(x.t)}</span>${x.sub?`<small>${esc(x.sub)}</small>`:""}<span class="ck">${x.v===cur?I.check:""}</span>${o&&o.edit?`<button type="button" class="hf-del" data-edit="${i}" tabindex="-1" aria-label="이름 · 색 · 삭제" title="이름 · 색 · 삭제">${I.more}</button>`:o&&o.del?`<button type="button" class="hf-del" data-del="${i}" tabindex="-1" aria-label="이 항목 삭제" title="이 항목 삭제">${I.x}</button>`:""}</div>`).join("")+(addK?`<div class="hf-opt hf-add ${act===xs.length?"act":""}" data-add role="option"><span class="t">+ ‘${esc(addK)}’ 생성</span></div>`:"")||'<div class="hf-none">찾는 항목이 없어요</div>';
    {const ad=L.querySelector("[data-add]");if(ad){ad.onpointerdown=e=>e.preventDefault();ad.onclick=()=>o.add(addK)}}
    L.querySelectorAll("[data-edit]").forEach(d=>{d.onpointerdown=e=>{e.preventDefault();e.stopPropagation()};d.onclick=e=>{e.stopPropagation();o.edit(xs[+d.dataset.edit])}});
    L.querySelectorAll("[data-del]").forEach(d=>{d.onpointerdown=e=>{e.preventDefault();e.stopPropagation()};d.onclick=e=>{e.stopPropagation();o.del(xs[+d.dataset.del])}});
    L.querySelectorAll(".hf-opt:not(.hf-add)").forEach(r=>{r.onpointerdown=e=>e.preventDefault();r.onclick=()=>onPick(xs[+r.dataset.i]);r.onmousemove=()=>{if(act!==+r.dataset.i){act=+r.dataset.i;L.querySelectorAll(".hf-opt").forEach((z,j)=>z.classList.toggle("act",j===act))}}});
    const a=L.querySelector(".act");/* 250판: 목록 안에서만 움직임(바깥 창이 따라 내려가지 않게) */if(a){const lr=L.getBoundingClientRect(),ar=a.getBoundingClientRect();if(ar.top<lr.top)L.scrollTop-=lr.top-ar.top;else if(ar.bottom>lr.bottom)L.scrollTop+=ar.bottom-lr.bottom}};
  const key=e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const n=xs.length+(addK?1:0);if(!n)return;act=(act+(e.key==="ArrowDown"?1:-1)+n)%n;draw()}else if(e.key==="Enter"){e.preventDefault();if(xs[act])onPick(xs[act]);else if(addK)o.add(addK)}};
  draw();if(q){q.oninput=()=>{act=0;draw()};q.onkeydown=key;setTimeout(()=>q.focus())}else if(!o||!o.keepFocus){L.onkeydown=key;setTimeout(()=>L.focus({preventScroll:true}))}return key}
function select(host,o={}){const items=(o.items||[]).map(x=>typeof x==="string"?{v:x,t:x}:x);let v=o.value??null;
  const b=shell(host,o,`${icn(o.icon||(typeof iconRule==="function"&&iconRule(o.label,"select"))||"list")}<span class="hf-val"></span>${o.disabled||o.clear===false?"":X}`,"hf-btn");if(!o.disabled)b.tabIndex=0;b.setAttribute("role","combobox");
  const show=()=>{const it=items.find(x=>x.v===v);b.querySelector(".hf-val").innerHTML=it?`${it.color?`<span class="hf-dot" style="background:${it.color}"></span>`:""}${it.cls?`<span class="spill ${esc(it.cls)}">${esc(it.t)}</span>`:esc(it.t)}`:`<span class="ph">${esc(o.placeholder||"선택")}</span>`;has(b,it)};
  const set=x=>{v=x;show();o.onChange&&o.onChange(v)};
  const open=()=>{if(o.disabled)return;if(OPEN&&OPEN.box===b){close();return}pop(b,p=>list(p,items,v,x=>{set(x.v);close();b.focus()},o.onAdd||o.onDel||o.onEdit?{add:o.onAdd&&(t=>{close();o.onAdd(t)}),del:o.onDel&&(x=>{close();o.onDel(x)}),edit:o.onEdit&&(x=>{close();o.onEdit(x)})}:undefined))};
  b.onclick=e=>{if(e.target.closest(".hf-x"))return;open()};
  b.onkeydown=e=>{if(["Enter"," ","ArrowDown"].includes(e.key)){e.preventDefault();open()}else if((e.key==="Delete"||e.key==="Backspace")&&o.clear!==false){set(null)}};
  const x=b.querySelector(".hf-x");if(x)x.onclick=e=>{e.stopPropagation();set(null);b.focus()};
  show();return {get value(){return v},set value(z){v=z;show()}}}
const day=(host,o={})=>select(host,Object.assign({icon:"repeat",placeholder:"요일",items:"월화수목금토일".split("").map(d=>({v:d,t:d+"요일"}))},o));
// 요일 여러 개: 칸 안 요일 단추(누르면 켜고 끄기, 켜짐 = 갈색 채움)
function days(host,o={}){const v=new Set(o.value||[]);
  const b=shell(host,o,`${icn(o.icon||"repeat")}<span class="hf-days">${"월화수목금토일".split("").map(d=>`<button type="button" data-d="${d}" ${o.disabled?"disabled":""}>${d}</button>`).join("")}</span><span class="hf-cnt"></span>`,"hf-daysbox");
  const show=()=>{b.querySelectorAll("[data-d]").forEach(x=>{const on=v.has(x.dataset.d);x.classList.toggle("on",on);x.setAttribute("aria-pressed",on)});b.querySelector(".hf-cnt").textContent=v.size?`주 ${v.size}회`:"요일 선택"};
  b.querySelectorAll("[data-d]").forEach(x=>x.onclick=()=>{const d=x.dataset.d;v.has(d)?v.delete(d):v.add(d);show();o.onChange&&o.onChange("월화수목금토일".split("").filter(z=>v.has(z)))});
  show();return {get value(){return "월화수목금토일".split("").filter(z=>v.has(z))}}}
// 달력(작게): 머리 "2026년 11월" ‹ › · 오늘 = 테두리, 고른 날 = 갈색 채움, 일 빨강 · 토 파랑, 아래 [오늘]
function cal(p,cur,onPick,o){let base=(cur||TODAY()).slice(0,7);
  const draw=()=>{const [y,m]=base.split("-").map(Number);const first=(new Date(y,m-1,1).getDay()+6)%7,n=new Date(y,m,0).getDate(); // 163판: 월요일 시작(시간표 주와 같음, 시제품 달력과 같음)
    let h=`<div class="hf-calh"><button type="button" class="hf-ib" data-m="-1" aria-label="앞 달">${I.left}</button><b>${y}년 ${m}월</b><button type="button" class="hf-ib" data-m="1" aria-label="다음 달">${I.right}</button></div><div class="hf-cal">${"월화수목금토일".split("").map((d,i)=>`<span class="dw ${i===5?"sat":i===6?"sun":""}">${d}</span>`).join("")}${"<span></span>".repeat(first)}`;
    for(let d=1;d<=n;d++){const iso=`${y}-${pad(m)}-${pad(d)}`,wd=(new Date(y,m-1,d).getDay());const off=o&&((o.min&&iso<o.min)||(o.max&&iso>o.max));h+=`<button type="button" data-d="${iso}" class="${iso===cur?"on":""} ${iso===TODAY()?"today":""} ${wd===0?"sun":wd===6?"sat":""}" ${off?"disabled":""}>${d}</button>`}
    p.innerHTML=h+`</div><div class="hf-calf"><button type="button" class="hf-link" data-t>오늘</button></div>`;
    p.querySelectorAll("button").forEach(x=>x.onpointerdown=e=>e.preventDefault());
    p.querySelectorAll("[data-m]").forEach(x=>x.onclick=()=>{const t=new Date(y,m-1+ +x.dataset.m,1);base=`${t.getFullYear()}-${pad(t.getMonth()+1)}`;draw()});
    p.querySelectorAll("[data-d]").forEach(x=>x.onclick=()=>onPick(x.dataset.d));p.querySelector("[data-t]").onclick=()=>onPick(TODAY())};draw()}
const dotted=s=>{const d=s.replace(/\D/g,"").slice(0,8);return d.length<5?d:d.length<7?d.slice(0,4)+"."+d.slice(4):d.slice(0,4)+"."+d.slice(4,6)+"."+d.slice(6)};
const toIso=s=>{const d=s.replace(/\D/g,"");if(d.length!==8)return null;const iso=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`;const t=new Date(iso+"T12:00:00");return isNaN(t)||t.toISOString().slice(0,10)!==iso?null:iso};
const colon=s=>{const d=s.replace(/\D/g,"").slice(0,4);return d.length<3?d:d.slice(0,2)+":"+d.slice(2)};
const okT=s=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const times=o=>{const [a,b]=[(o&&o.from)||"07:00",(o&&o.to)||"23:00"].map(t=>+t.slice(0,2)*60+ +t.slice(3));const st=(o&&o.step)||30,L=[];for(let m=a;m<=b;m+=st)L.push({v:pad(Math.floor(m/60))+":"+pad(m%60),t:pad(Math.floor(m/60))+":"+pad(m%60)});return L};
// 날짜 자리 = 늘 같은 폭(날짜 + 요일, 적는 중·빈 칸·날짜만·날짜 시간 모두 같음) · 날짜·시간 칸 하나 = 글자로 바로 적기(숫자만 넣으면 . : 자동) + 누르면 달력·시간 목록
function dt(host,o,parts){const vals={d:o.value?o.value.slice(0,10):"",t:o.value&&o.value.length>10?o.value.slice(11,16):(o.time||"")};if(parts==="t")vals.t=o.value||"";
  const seg=k=>k==="d"?`<span class="hf-dwrap ${o.dow===false?"nodw":""}"><input class="hf-d" data-k="d" inputmode="numeric" placeholder="YYYY.MM.DD" value="${vals.d?vals.d.replace(/-/g,"."):""}" ${o.disabled?"disabled":""}>${o.dow!==false?`<span class="hf-dw"></span>`:""}</span>`:`<input class="hf-t" data-k="t" inputmode="numeric" placeholder="HH:mm" value="${esc(vals.t)}" ${o.disabled?"disabled":""}>`;
  const b=shell(host,o,`${icn(o.icon||(parts==="t"?"clock":"cal"))}${parts.split("").map(seg).join(parts.length>1?'<span class="hf-sep"></span>':"")}${o.disabled?"":X}`,"hf-dt hf-"+parts);
  const out=()=>parts==="dt"?(vals.d&&vals.t?vals.d+" "+vals.t:vals.d||""):parts==="d"?vals.d:vals.t;
  const show=()=>{const w=b.querySelector(".hf-dw");if(w)w.textContent=vals.d?`(${dw(vals.d)})`:"";has(b,vals.d||vals.t)};
  const fire=()=>{show();o.onChange&&o.onChange(out())};
  const opener=i=>{const k=i.dataset.k;pop(b,p=>{if(k==="d")cal(p,vals.d,d=>{vals.d=d;i.value=d.replace(/-/g,".");say(host,o.help||"");fire();close();const nx=b.querySelector(".hf-t");if(nx&&!vals.t){nx.focus()}else i.blur()},o);
      else{const key=list(p,times(o),vals.t,x=>{vals.t=x.v;i.value=x.v;say(host,o.help||"");fire();close();i.blur()},{keepFocus:true});i.onkeydown=e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp")key(e);else if(e.key==="Enter"){e.preventDefault();commit(i);close();i.blur()}}}},k==="d"?"hf-calpop":"hf-tpop")};
  const commit=i=>{const k=i.dataset.k;if(!i.value){vals[k]="";fire();return true}
    if(k==="d"){const iso=toIso(i.value);if(!iso){say(host,"날짜를 YYYY.MM.DD로 입력해 주세요",true);return false}vals.d=iso;i.value=iso.replace(/-/g,".")}
    else{let t=i.value;if(/^\d{1,2}$/.test(t))t=pad(t)+":00";if(!okT(t)){say(host,"시간을 HH:mm으로 입력해 주세요",true);return false}vals.t=t;i.value=t}
    say(host,o.help||"");fire();return true};
  b.querySelectorAll("input").forEach(i=>{const k=i.dataset.k;
    i.onfocus=()=>{if(OPEN&&OPEN.box===b&&OPEN.kind!==k)close();if(!OPEN){opener(i);OPEN.kind=k}};
    i.onclick=()=>{if(!OPEN){opener(i);OPEN.kind=k}};
    i.oninput=()=>{i.value=k==="d"?dotted(i.value):colon(i.value);if(k==="d"){const w=b.querySelector(".hf-dw");if(w){const iso=toIso(i.value);w.textContent=iso?`(${dw(iso)})`:""}}has(b,b.querySelector(".hf-d")?.value||b.querySelector(".hf-t")?.value)};
    if(k==="d")i.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();if(commit(i)){close();i.blur()}}};
    i.onblur=()=>setTimeout(()=>{if(document.activeElement!==i)commit(i)},120)});
  b.onpointerdown=e=>{if(e.target===b||(e.target.closest("svg")&&!e.target.closest(".hf-x"))){e.preventDefault();b.querySelector("input").focus()}};
  const x=b.querySelector(".hf-x");if(x){x.onpointerdown=e=>e.preventDefault();x.onclick=()=>{vals.d="";vals.t="";b.querySelectorAll("input").forEach(i=>i.value="");close();say(host,o.help||"");fire()}}
  show();return {get value(){return out()}}}
const date=(host,o={})=>dt(host,o,"d");
const time=(host,o={})=>dt(host,o,"t");
const datetime=(host,o={})=>dt(host,o,"dt");
// 기간 = 두 칸 사이 "-" · 끝이 시작보다 앞이면 알림
/* 261118 대표: 두 칸 = 이름도 두 개("시작일 - 종료일" 한 이름 → 시작일 · 종료일). 이름은 o.labels:[앞,뒤], 없으면 o.label을 " - "로 나눔, 못 나누는 시간 범위는 시작 시간 · 종료 시간. 설명(?) · 필수(*)는 앞 이름에 */
function rangeLabels(o,fn){if(Array.isArray(o.labels))return o.labels;const l=String(o.label||"");const p=l.split(/\s+[-–~]\s+/);if(p.length===2)return p;if(fn===time)return ["시작 시간","종료 시간"];return [l,""]}
function range(host,o,fn){const tip=helpTip(o);const [la,lb]=rangeLabels(o,fn);const lbl=(t,first)=>t||first?`<span class="hf-lbl">${esc(t)}${first?`${o.req?' <i>*</i>':""}${o.tipHtml||""}${tip}`:""}</span>`:"";
  host.innerHTML=`<div class="hf"><div class="hf-range two"><div class="hf-rc">${lbl(la,true)}<div></div></div><div class="hf-rc">${lbl(lb,false)}<div></div></div></div><span class="hf-msg">${tip?"":esc(o.help||"")}</span></div>`;
  const [A,B]=host.querySelectorAll(".hf-rc>div");const v=[...(o.value||["",""])];
  const chk=()=>{const m=v[0]&&v[1]&&v[1]<v[0]?(fn===time?"끝 시간이 시작보다 앞이에요":"끝 날짜가 시작보다 앞이에요"):"";const s=host.querySelector(".hf>.hf-msg");s.textContent=m||(tip?"":o.help)||"";host.querySelector(".hf").classList.toggle("err",!!m);o.onChange&&o.onChange(v.slice())};
  fn(A,Object.assign({},o,{label:"",help:"",tipHtml:"",value:v[0],placeholder:"",onChange:x=>{v[0]=x;chk()}}));fn(B,Object.assign({},o,{label:"",help:"",tipHtml:"",value:v[1],onChange:x=>{v[1]=x;chk()}}));return {get value(){return v.slice()}}}
const dateRange=(host,o={})=>range(host,Object.assign({dow:false},o),date);
const timeRange=(host,o={})=>range(host,o,time);
// 색: 칸 = 왼쪽 아이콘 자리에 고른 색 동그라미(16, 안 골랐으면 무지개 동그라미) + 이름 · x/Delete = 비우기, 누르면 색판(6칸 × 2줄, 다른 클래스가 쓰는 색은 마우스를 올리면 클래스 이름)
// 클래스 색 저장(261113 대표): 노션 클래스 DB [색](선택 칸, 노션 10색) + [색 코드](글자 칸, 직접 고른 색만). 노션 화면의 클래스 구분은 이모지 그대로 — 색은 앱이 읽는 저장용
// 앱이 읽는 순서: 색 코드가 있으면 그 색, 없으면 [색]의 노션 색 이름 → 아래 앱 색
const COLORS=[["빨강","#E5484D","red"],["주황","#F0A35E","orange"],["노랑","#E8C547","yellow"],["초록","#5BBF8A","green"],["파랑","#7FA6D9","blue"],["보라","#B794F6","purple"],["분홍","#E88FB5","pink"],["갈색","#B08D6E","brown"],["회색","#A3A3A3","gray"],["기본","#CFC8BE","default"]];
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const nearest=h=>{const a=rgb(h);return COLORS.slice().sort((x,y)=>{const d=c=>rgb(c[1]).reduce((t,v,i)=>t+(v-a[i])**2,0);return d(x)-d(y)})[0]};
// 노션에 쓸 값: {색: 노션 색 이름, 색코드: 직접 고른 색일 때만 "#RRGGBB"}
const toNotion=h=>{if(!h)return {색:"",색코드:""};const k=COLORS.find(x=>x[1]===h);return k?{색:k[0],색코드:""}:{색:nearest(h)[0],색코드:h}};
const cname=c=>{const k=COLORS.find(x=>x[1]===c);return k?k[0]:"직접 고른 색"};
function palette(p,v,used,onPick){used=used||{};const custom=!!v&&!COLORS.some(x=>x[1]===v);
  p.innerHTML=`<div class="hf-sw">${COLORS.map(([n,c])=>`<button type="button" data-c="${c}" class="${c===v?"on":""}" style="background:${c}" title="${n}${used[c]?" · "+esc(used[c])+"에서 씀":""}" aria-label="${n}">${c===v?I.check:used[c]?'<i></i>':""}</button>`).join("")}<label class="hf-custom ${custom?"on":""}" title="다른 색 직접 고르기" ${custom?`style="--cv:${v}"`:""}>${custom?I.check:""}<input type="color" value="${custom?v:"#8A6A4F"}" aria-label="다른 색 직접 고르기"></label></div><div class="hf-swn">${v?cname(v)+(custom?` · 노션에는 ${nearest(v)[0]}`:""):"색 선택"}${Object.keys(used).length?' · 흰 점 = 다른 클래스가 쓰는 색':""}</div>`;
  p.querySelectorAll("[data-c]").forEach(x=>{x.onclick=()=>onPick(x.dataset.c);x.onmouseenter=()=>p.querySelector(".hf-swn").textContent=x.title});
  const L=p.querySelector(".hf-custom"),ci=L.querySelector("input");L.onmouseenter=()=>p.querySelector(".hf-swn").textContent="다른 색 직접 고르기 — 목록에 없는 색";ci.onchange=()=>onPick(ci.value.toUpperCase())}
function color(host,o={}){let v=o.value||null;const used=o.used||{};
  const b=shell(host,o,`<span class="hf-ci"></span><span class="hf-val"></span>${o.disabled||o.clear===false?"":X}`,"hf-btn hf-colbox");if(!o.disabled)b.tabIndex=0;
  const show=()=>{const c=COLORS.find(x=>x[1]===v);const ci=b.querySelector(".hf-ci");ci.style.background=v||"";ci.classList.toggle("empty",!v);ci.innerHTML=v?"":I.droplet;/* 289판: 비면 물방울(입력칸 기준표) */b.querySelector(".hf-val").innerHTML=v?(c?c[0]:"직접 고른 색"):`<span class="ph">${esc(o.placeholder||"색 선택")}</span>`;b.title=v&&!c?v:"";/* 261119 대표: 색은 늘 색 칩으로, 코드 글자는 마우스를 올릴 때만 */has(b,v)};
  const open=()=>{if(o.disabled)return;if(OPEN&&OPEN.box===b){close();return}pop(b,p=>palette(p,v,used,c=>{v=c;show();close();b.focus();o.onChange&&o.onChange(v)}),"hf-swpop")};
  const set=c=>{v=c;show();o.onChange&&o.onChange(v)};b.onclick=e=>{if(e.target.closest(".hf-x"))return;open()};b.onkeydown=e=>{if(["Enter"," ","ArrowDown"].includes(e.key)){e.preventDefault();open()}else if((e.key==="Delete"||e.key==="Backspace")&&o.clear!==false)set(null)};
  const x=b.querySelector(".hf-x");if(x)x.onclick=e=>{e.stopPropagation();close();set(null);b.focus()};show();return {get value(){return v}}}
// 켜고 끄기: 칸 안 왼쪽 글 · 오른쪽 스위치(칸 어디를 눌러도 바뀜)
function sw(host,o={}){let v=!!o.value;/* 288판 A안(대표): 이름 ……… 켜짐/꺼짐 · 스위치 한 줄, 테두리 없음. 줄 아무 데나 누르면 바뀜 */
  host.innerHTML=`<div class="hf hf-sw1 ${o.disabled?"dis":""}"><span class="hf-lbl hf-swl">${esc(o.label||"")}${o.req?' <i>*</i>':""}${o.tipHtml||""}</span><div class="hf-swrow" ${o.disabled?"":'tabindex="0"'} role="switch" aria-label="${esc(o.label||"")}"><span class="hf-swst"></span><span class="hf-tg"></span></div>${o.help?`<span class="hf-msg">${esc(o.help)}</span>`:""}</div>`;const b=host.querySelector(".hf-swrow");
  const show=()=>{b.classList.toggle("on",v);b.setAttribute("aria-checked",v);b.querySelector(".hf-swst").textContent=v?(o.on||"켜짐"):(o.off||"꺼짐")};const tg=e=>{if(o.disabled||(e&&e.target.closest(".qhelp")))return;v=!v;show();o.onChange&&o.onChange(v)};
  b.onclick=tg;{const l=host.querySelector(".hf-swl");if(l)l.onclick=tg}/* 319판: 이름 눌러도 바뀜 */b.onkeydown=e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();tg()}};show();return {get value(){return v}}}
// 구분(2~4개 중 하나, 시제품 [정규|휴강]과 같은 모양): 칸 전체 = 옅은 바탕 칸 나눔(아이콘·테두리 없음), 고른 칸 = 흰 바탕 + 그림자 + 그 항목 색 글(colors{항목: 색}, 없으면 갈색)
/* 386판(대표 "나눔 단추에도 그룹·개별 아이콘과 색"): 그룹 = 여러 사람·파랑 / 개별 = 한 사람·갈색 — 모든 나눔 단추 공통(modePill과 같은 말) */
/* 402판(대표): 나눔 단추 아이콘 한 곳 — 색은 그룹·개별·사용 중만, 나머지는 기본 */function segKind(x){return /^그룹/.test(x)?["users","var(--info-ink,#1D5BBF)"]:/^개별/.test(x)?["user","var(--success-ink,#0F7B4E)"]:x==="교재"?["bookc",""]:x==="프로그램"?["package",""]:x==="사용 중"?["chkc","var(--success-ink,#0F7B4E)"]:x==="미사용"?["slash",""]:null}
function seg(host,o={}){let v=o.value??o.items[0];const b=shell(host,o,`<span class="hf-seg">${o.items.map(x=>`<button type="button" data-v="${esc(x)}" ${o.disabled?"disabled":""} ${o.colors&&o.colors[x]?`style="--on:${o.colors[x]}"`:segKind(x)&&segKind(x)[1]?`style="--on:${segKind(x)[1]}"`:""}>${segKind(x)&&typeof IC==="function"?IC(segKind(x)[0],"s"):""}${esc(x)}</button>`).join("")}</span>`,"hf-segbox");
  const show=()=>b.querySelectorAll("[data-v]").forEach(x=>{x.classList.toggle("on",x.dataset.v===v);x.setAttribute("aria-pressed",x.dataset.v===v)});
  b.querySelectorAll("[data-v]").forEach(x=>x.onclick=()=>{v=x.dataset.v;show();o.onChange&&o.onChange(v)});show();return {get value(){return v}}}
// 여러 개 고르기(288판, 앱 hfMulti와 같은 모양): 누르면 체크 목록 · 9개 이상이거나 새로 적기면 위에 찾기 · 아래 n개 선택 [비우기][닫기]
function multi(host,o={}){const ii=k=>(I[k]||"").replace("<svg","<svg class=\"i s\"");const items=(o.items||[]).map(x=>typeof x==="string"?{v:x,t:x}:x);const v=new Set(o.value||[]);/* 292판: 앱 여러 개 고르기(hfMulti)와 같은 모양·반응 */
  const b=shell(host,o,`${icn(o.icon||(typeof iconRule==="function"&&iconRule(o.label,"multi"))||"chevc")}<span class="hf-val"></span>`,"hf-btn hfm");if(!o.disabled)b.tabIndex=0;b.setAttribute("role","combobox");
  const show=()=>{const a=items.filter(x=>v.has(x.v));b.querySelector(".hf-val").innerHTML=a.length?a.map(x=>`<span class="hfm-c ${esc(x.cls||"")}">${esc(x.t)}</span>`).join(""):`<span class="ph">${esc(o.placeholder||"선택")}</span>`;b.classList.toggle("has",a.length>0)};
  const ch=()=>{show();o.onChange&&o.onChange(items.filter(x=>v.has(x.v)).map(x=>x.v))};
  const open=()=>{if(o.disabled)return;if(OPEN&&OPEN.box===b){close();return}pop(b,p=>{let q="";
    const draw=()=>{const sc=(p.querySelector(".tsl")||{}).scrollTop||0,ps=p.scrollTop;/* 311판: 다시 그려도 목록 스크롤 그대로(체크할 때 맨 위로 튀던 것) */p.innerHTML=`${o.onAdd||items.length>10?`<span class="searchbox mlq">${ii("search")}<input class="inp" id="mlQ" placeholder="${o.onAdd?"검색 또는 추가":"검색"}" autocomplete="off" maxlength="30" aria-label="검색"></span>`:""}<div class="tsl">${items.map(x=>`<label class="ck2 tso ${v.has(x.v)?"on":""}"><input type="checkbox" value="${esc(x.v)}" ${v.has(x.v)?"checked":""}><b class="${x.cls?"spill "+esc(x.cls):""}">${esc(x.t)}</b>${o.onEdit?`<button type="button" class="mldel" data-mledit="${esc(x.v)}" title="이름 · 색 · 삭제">${ii("more")}</button>`:o.onDel?`<button type="button" class="mldel" data-mldel="${esc(x.v)}" title="이 항목 삭제">${ii("x")}</button>`:""}</label>`).join("")}</div>${o.onAdd?`<button type="button" class="mlnew" id="mlAdd" hidden></button>`:""}<div class="tsf"><span class="lb">${v.size}개 선택</span><span class="sp"></span>${v.size?`<button type="button" class="btn" id="mlClr" data-clr>비우기</button>`:""}<button type="button" class="btn pri" id="mlOk" data-ok>${ii("check")}닫기</button></div>`;{const l=p.querySelector(".tsl");if(l)l.scrollTop=sc;p.scrollTop=ps}
      p.querySelectorAll(".tso input").forEach(c=>c.onchange=()=>{const k=items.find(x=>String(x.v)===c.value).v;c.checked?v.add(k):v.delete(k);ch();draw()});
      const clr=p.querySelector("[data-clr]");if(clr)clr.onclick=()=>{v.clear();ch();draw()};p.querySelector("[data-ok]").onclick=()=>{close();b.focus()};
      p.querySelectorAll("[data-mledit]").forEach(d=>d.onclick=e=>{e.preventDefault();e.stopPropagation();const x=d.dataset.mledit;close();o.onEdit(x)});p.querySelectorAll("[data-mldel]").forEach(d=>d.onclick=e=>{e.preventDefault();e.stopPropagation();const x=d.dataset.mldel;close();o.onDel(x)});
      const mq=p.querySelector(".mlq input");if(mq){mq.value=q;const ad=p.querySelector(".mlnew");const ft=()=>{q=mq.value.trim();p.querySelectorAll(".tso").forEach(l=>{l.hidden=!!q&&!l.textContent.includes(q)&&!l.querySelector("input").checked});if(ad){const ex=items.some(x=>x.t===q);ad.hidden=!q||ex;ad.innerHTML=ii("plus")+"<span>‘"+esc(q)+"’ 생성</span>"}};ft();mq.oninput=ft;
        const go=()=>{const t=q;if(!t||!ad||ad.hidden)return;close();o.onAdd(t)};if(ad)ad.onclick=go;mq.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();go()}else if(e.key==="Escape"){close();b.focus()}};setTimeout(()=>{mq.focus();mq.setSelectionRange(q.length,q.length)})}};
    p.classList.add("mlpop");draw()})};
  b.onclick=open;b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "||e.key==="ArrowDown"){e.preventDefault();open()}};
  show();return {get value(){return items.filter(x=>v.has(x.v)).map(x=>x.v)}}}
// 검색 칸(288판): 돋보기 + 글자 → 아래 결과 줄(두 글자부터). o.find(글자) = [{t, sub, v}] · o.onPick(줄)
function search(host,o={}){const b=shell(host,o,`${I.search}<input placeholder="${esc(o.placeholder||"검색")}" autocomplete="off" value="${esc(o.value||"")}">${X}`,"hf-srch");const i=b.querySelector("input");
  const L=document.createElement("div");L.className="hf-res";b.after(L);const min=o.min||2;
  const draw=()=>{const k=i.value.trim();has(b,k);if(k.length<min){L.innerHTML=k?`<div class="hf-none">${min}글자부터 찾아요</div>`:"";return}const rs=(o.find?o.find(k):[]);
    L.innerHTML=rs.length?rs.map((r,j)=>`<div class="hf-ri" data-j="${j}"><span class="t">${esc(r.t)}</span><small>${esc(r.sub||"")}</small></div>`).join(""):`<div class="hf-none">찾는 것이 없어요</div>`;
    L.querySelectorAll(".hf-ri").forEach(d=>d.onclick=()=>{const r=rs[+d.dataset.j];i.value=r.t;L.innerHTML="";has(b,1);o.onPick&&o.onPick(r)})};
  b.onpointerdown=e=>{if(e.target===b||e.target.closest("svg:not(.hf-x svg)")){e.preventDefault();i.focus()}};i.oninput=draw;
  const x=b.querySelector(".hf-x");x.onpointerdown=e=>e.preventDefault();x.onclick=()=>{i.value="";draw();i.focus()};draw();return {el:i,get value(){return i.value}}}

/* 304판(연결): 고르기 단추 칸 — 모양은 고르기 칸과 같고, 펼치는 목록은 화면이 onOpen(칸)으로 정함(등록 카드 시간표·교재 등) */
function pick(host,o={}){const b=shell(host,o,`${icn(o.icon||(typeof iconRule==="function"&&iconRule(o.label,"select"))||"list")}<span class="hf-val">${o.valueHtml||`<span class="ph">${esc(o.placeholder||"선택")}</span>`}</span>`,"hf-btn");if(!o.disabled)b.tabIndex=0;Object.assign(b.dataset,o.data||{});
  const go=()=>{if(!o.disabled&&o.onOpen)o.onOpen(b)};b.onclick=go;b.onkeydown=e=>{if(["Enter"," ","ArrowDown"].includes(e.key)){e.preventDefault();go()}};has(b,!!o.valueHtml);return b}
window.HF={palette,toNotion,text,memo,num,tel,select,multi,search,pick,day,days,date,time,datetime,dateRange,timeRange,color,sw,seg,close,COLORS};
})();
