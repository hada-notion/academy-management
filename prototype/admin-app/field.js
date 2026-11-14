/* 입력칸 모듈(field) — 261113 대표: 모든 입력칸 = 왼쪽 아이콘 + 왼쪽 정렬, 바깥 높이 40 (고르기 칸 HP.cls·HP.stu와 같은 틀)
   HF.text · memo · num · tel · select · day(요일 하나) · days(요일 여러 개) · date · time · datetime · dateRange · timeRange · color · sw(켜고 끄기) · seg(구분)
   공통 옵션: label, value, placeholder, disabled, req(필수 *), onChange(값)
   공통 동작: 마우스를 올리거나 입력 중이면 값이 있을 때 오른쪽 x(비우기) · 틀린 값은 빨간 테두리 + 칸 아래 12 글씨
   목록이 뜨는 칸(드롭다운·요일·날짜·시간·색): 칸과 같은 폭으로 칸 바로 아래 4 띄워 열림(달력·색판은 칸이 좁으면 최소 폭)(아래 자리가 모자라면 위), 한 번에 하나, 바깥 누름·Esc = 닫힘, ↑↓·Enter */
(function(){
const P='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const I={type:P+'<path d="M17 10H3M21 6H3M21 14H3M17 18H3"/></svg>',
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
  check:P+'<path d="M20 6 9 17l-5-5"/></svg>',
  left:P+'<path d="m15 18-6-6 6-6"/></svg>',
  right:P+'<path d="m9 18 6-6-6-6"/></svg>'};
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const pad=n=>String(n).padStart(2,"0");
const TODAY=()=>(window.HP&&HP.today)||new Date().toISOString().slice(0,10);
const DOW="일월화수목금토";
const dw=iso=>DOW[new Date(iso+"T12:00:00").getDay()];
// 떠 있는 목록(한 번에 하나)
let OPEN=null;
function close(){if(OPEN){const o=OPEN;OPEN=null;o.pop.remove();o.box.classList.remove("open")}}
document.addEventListener("pointerdown",e=>{if(OPEN&&!OPEN.pop.contains(e.target)&&!OPEN.box.contains(e.target))close()},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&OPEN){e.preventDefault();e.stopImmediatePropagation();const b=OPEN.box;close();const f=b.querySelector("input")||b;f.focus()}});
function pop(box,build,cls){if(OPEN&&OPEN.box===box)return OPEN.pop;close();const p=document.createElement("div");p.className="hf-pop "+(cls||"");box.parentElement.appendChild(p);
  OPEN={pop:p,box};box.classList.add("open");p.style.width=box.offsetWidth+"px";build(p);
  const r=box.getBoundingClientRect();let top=box.offsetTop+box.offsetHeight+4;
  const up=r.bottom+4+p.offsetHeight>innerHeight-8&&r.top-4-p.offsetHeight>8,op=p.offsetParent;
  if(up&&op===box.parentElement)p.style.bottom=(op.clientHeight-box.offsetTop+4)+"px";else p.style.top=(up?box.offsetTop-4-p.offsetHeight:top)+"px";p.style.left=box.offsetLeft+"px";p.style.width=box.offsetWidth+"px";return p}
// 칸 틀: 라벨(칸 위 12/600, 아래 4) · 칸(40) · 알림 글(칸 아래 12)
const shell=(host,o,inner,cls)=>{host.innerHTML=`<div class="hf ${o.disabled?"dis":""}">${o.label?`<span class="hf-lbl">${esc(o.label)}${o.req?' <i>*</i>':""}</span>`:""}<div class="hf-box ${cls||""}">${inner}</div><span class="hf-msg">${esc(o.help||"")}</span></div>`;return host.querySelector(".hf-box")};
const say=(host,t,err)=>{const m=host.querySelector(".hf-msg");m.textContent=t||"";host.querySelector(".hf").classList.toggle("err",!!(err&&t))};
const X=`<button type="button" class="hf-x" tabindex="-1" aria-label="비우기" title="비우기">${I.x}</button>`;
const has=(b,v)=>b.classList.toggle("has",!!v);
// 글자 입력 공통(text·num·tel·memo)
function typed(host,o,icon,attrs,fmt,check,cls){const tag=cls==="hf-memo"?"textarea":"input";
  const memo=tag==="textarea";const b=shell(host,o,`${memo||icon==="type"?"":I[icon]}<${tag} ${attrs||""} placeholder="${esc(o.placeholder||"")}" ${o.disabled?"disabled":""} ${tag==="input"?`value="${esc(o.value||"")}">`:`rows="1">${esc(o.value||"")}</textarea>`}${o.unit?`<span class="hf-unit">${esc(o.unit)}</span>`:""}${o.disabled||memo?"":X}`,cls);
  const i=b.querySelector(tag);const grow=()=>{if(memo&&i.scrollHeight>i.clientHeight)b.style.height=(b.offsetHeight+i.scrollHeight-i.clientHeight)+"px"};
  if(fmt&&i.value)i.value=fmt(i.value);has(b,i.value);setTimeout(grow);
  b.onpointerdown=e=>{if(e.target===b||e.target.closest("svg:not(.hf-x svg)")){e.preventDefault();i.focus()}};
  i.oninput=()=>{if(fmt){const n=fmt(i.value);if(n!==i.value)i.value=n}has(b,i.value);grow();say(host,o.help||"");o.onChange&&o.onChange(i.value)};
  i.onblur=()=>{if(check){const m=i.value&&check(i.value);say(host,m||o.help||"",!!m)}};
  const x=b.querySelector(".hf-x");if(x){x.onpointerdown=e=>e.preventDefault();x.onclick=()=>{i.value="";has(b,"");grow();say(host,o.help||"");i.focus();o.onChange&&o.onChange("")}}
  return {el:i,get value(){return i.value}}}
const text=(host,o={})=>typed(host,o,o.icon||"type",`maxlength="${o.max||100}" autocomplete="off"`);
const memo=(host,o={})=>typed(host,o,"memo",`maxlength="${o.max||1000}"`,null,null,"hf-memo");
const num=(host,o={})=>typed(host,o,"hash",'inputmode="numeric" autocomplete="off"',v=>{const d=v.replace(/[^\d]/g,"").replace(/^0+(?=\d)/,"");return o.comma===false?d:d.replace(/\B(?=(\d{3})+(?!\d))/g,",")},v=>{const n=+v.replace(/,/g,"");return o.max!=null&&n>o.max?`${o.max.toLocaleString()}${o.unit||""}까지 적을 수 있어요`:o.min!=null&&n<o.min?`${o.min}${o.unit||""}부터 적을 수 있어요`:""});
// 전화번호: 숫자만 넣으면 줄표가 자동(010-0000-0000 · 02-000-0000), 자리 수가 맞지 않으면 알림
const telFmt=v=>{const d=v.replace(/\D/g,"").slice(0,11);if(d.startsWith("02")){const t=d.slice(0,10);return t.length<3?t:t.length<6?t.slice(0,2)+"-"+t.slice(2):t.length<10?t.slice(0,2)+"-"+t.slice(2,5)+"-"+t.slice(5):t.slice(0,2)+"-"+t.slice(2,6)+"-"+t.slice(6)}
  return d.length<4?d:d.length<8?d.slice(0,3)+"-"+d.slice(3):d.length<11?d.slice(0,3)+"-"+d.slice(3,6)+"-"+d.slice(6):d.slice(0,3)+"-"+d.slice(3,7)+"-"+d.slice(7)};
const tel=(host,o={})=>typed(host,Object.assign({placeholder:"010-0000-0000"},o),"tel",'inputmode="tel" autocomplete="off"',telFmt,v=>{const d=v.replace(/\D/g,"");return (d.startsWith("01")?d.length===11||(d.length===10&&!d.startsWith("010")):d.length>=9&&d.length<=11)?"":"번호 자리 수를 확인해 주세요"});
// 목록에서 하나 고르기(드롭다운): 항목이 9개 이상이면 위에 찾기 칸
function list(p,items,cur,onPick,o){let addK="";p.innerHTML=`${(items.length>8||(o&&o.add))&&!(o&&o.keepFocus)?`<label class="hf-q">${I.search}<input placeholder="${o&&o.add?"찾거나 새로 적기":"찾기"}" autocomplete="off"></label>`:""}<div class="hf-list" role="listbox" tabindex="-1"></div>`;
  const L=p.querySelector(".hf-list"),q=p.querySelector(".hf-q input");let act=Math.max(0,items.findIndex(x=>x.v===cur)),xs=items;
  const draw=()=>{const k=q?q.value.trim():"";xs=items.filter(x=>!k||x.t.includes(k));addK=o&&o.add&&k&&!items.some(x=>x.t===k)?k:"";act=Math.max(0,Math.min(act,xs.length-1+(addK?1:0)));
    L.innerHTML=xs.map((x,i)=>`<div class="hf-opt ${x.v===cur?"on":""} ${i===act?"act":""}" data-i="${i}" role="option" aria-selected="${x.v===cur}">${x.color?`<span class="hf-dot" style="background:${x.color}"></span>`:""}<span class="t">${esc(x.t)}</span>${x.sub?`<small>${esc(x.sub)}</small>`:""}<span class="ck">${x.v===cur?I.check:""}</span>${o&&o.del?`<button type="button" class="hf-del" data-del="${i}" tabindex="-1" aria-label="이 항목 삭제" title="이 항목 삭제">${I.x}</button>`:""}</div>`).join("")+(addK?`<div class="hf-opt hf-add ${act===xs.length?"act":""}" data-add role="option"><span class="t">+ ‘${esc(addK)}’ 생성</span></div>`:"")||'<div class="hf-none">찾는 항목이 없어요</div>';
    {const ad=L.querySelector("[data-add]");if(ad){ad.onpointerdown=e=>e.preventDefault();ad.onclick=()=>o.add(addK)}}
    L.querySelectorAll("[data-del]").forEach(d=>{d.onpointerdown=e=>{e.preventDefault();e.stopPropagation()};d.onclick=e=>{e.stopPropagation();o.del(xs[+d.dataset.del])}});
    L.querySelectorAll(".hf-opt:not(.hf-add)").forEach(r=>{r.onpointerdown=e=>e.preventDefault();r.onclick=()=>onPick(xs[+r.dataset.i]);r.onmousemove=()=>{if(act!==+r.dataset.i){act=+r.dataset.i;L.querySelectorAll(".hf-opt").forEach((z,j)=>z.classList.toggle("act",j===act))}}});
    const a=L.querySelector(".act");if(a)a.scrollIntoView({block:"nearest"})};
  const key=e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();const n=xs.length+(addK?1:0);if(!n)return;act=(act+(e.key==="ArrowDown"?1:-1)+n)%n;draw()}else if(e.key==="Enter"){e.preventDefault();if(xs[act])onPick(xs[act]);else if(addK)o.add(addK)}};
  draw();if(q){q.oninput=()=>{act=0;draw()};q.onkeydown=key;setTimeout(()=>q.focus())}else if(!o||!o.keepFocus){L.onkeydown=key;setTimeout(()=>L.focus({preventScroll:true}))}return key}
function select(host,o={}){const items=(o.items||[]).map(x=>typeof x==="string"?{v:x,t:x}:x);let v=o.value??null;
  const b=shell(host,o,`${I[o.icon||"list"]}<span class="hf-val"></span>${o.disabled||o.clear===false?"":X}`,"hf-btn");if(!o.disabled)b.tabIndex=0;b.setAttribute("role","combobox");
  const show=()=>{const it=items.find(x=>x.v===v);b.querySelector(".hf-val").innerHTML=it?`${it.color?`<span class="hf-dot" style="background:${it.color}"></span>`:""}${esc(it.t)}`:`<span class="ph">${esc(o.placeholder||"선택")}</span>`;has(b,it)};
  const set=x=>{v=x;show();o.onChange&&o.onChange(v)};
  const open=()=>{if(o.disabled)return;if(OPEN&&OPEN.box===b){close();return}pop(b,p=>list(p,items,v,x=>{set(x.v);close();b.focus()},o.onAdd||o.onDel?{add:o.onAdd&&(t=>{close();o.onAdd(t)}),del:o.onDel&&(x=>{close();o.onDel(x)})}:undefined))};
  b.onclick=e=>{if(e.target.closest(".hf-x"))return;open()};
  b.onkeydown=e=>{if(["Enter"," ","ArrowDown"].includes(e.key)){e.preventDefault();open()}else if((e.key==="Delete"||e.key==="Backspace")&&o.clear!==false){set(null)}};
  const x=b.querySelector(".hf-x");if(x)x.onclick=e=>{e.stopPropagation();set(null);b.focus()};
  show();return {get value(){return v},set value(z){v=z;show()}}}
const day=(host,o={})=>select(host,Object.assign({icon:"repeat",placeholder:"요일",items:"월화수목금토일".split("").map(d=>({v:d,t:d+"요일"}))},o));
// 요일 여러 개: 칸 안 요일 단추(누르면 켜고 끄기, 켜짐 = 갈색 채움)
function days(host,o={}){const v=new Set(o.value||[]);
  const b=shell(host,o,`${I.repeat}<span class="hf-days">${"월화수목금토일".split("").map(d=>`<button type="button" data-d="${d}" ${o.disabled?"disabled":""}>${d}</button>`).join("")}</span><span class="hf-cnt"></span>`,"hf-daysbox");
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
  const b=shell(host,o,`${I[parts==="t"?"clock":"cal"]}${parts.split("").map(seg).join(parts.length>1?'<span class="hf-sep"></span>':"")}${o.disabled?"":X}`,"hf-dt hf-"+parts);
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
function range(host,o,fn){host.innerHTML=`<div class="hf">${o.label?`<span class="hf-lbl">${esc(o.label)}${o.req?' <i>*</i>':""}</span>`:""}<div class="hf-range"><div></div><span class="hf-dash">-</span><div></div></div><span class="hf-msg"></span></div>`;
  const [A,B]=host.querySelectorAll(".hf-range>div");const v=[...(o.value||["",""])];
  const chk=()=>{const m=v[0]&&v[1]&&v[1]<v[0]?(fn===time?"끝 시간이 시작보다 앞이에요":"끝 날짜가 시작보다 앞이에요"):"";const s=host.querySelector(".hf>.hf-msg");s.textContent=m;host.querySelector(".hf").classList.toggle("err",!!m);o.onChange&&o.onChange(v.slice())};
  fn(A,Object.assign({},o,{label:"",value:v[0],placeholder:"",onChange:x=>{v[0]=x;chk()}}));fn(B,Object.assign({},o,{label:"",value:v[1],onChange:x=>{v[1]=x;chk()}}));return {get value(){return v.slice()}}}
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
  p.innerHTML=`<div class="hf-sw">${COLORS.map(([n,c])=>`<button type="button" data-c="${c}" class="${c===v?"on":""}" style="background:${c}" title="${n}${used[c]?" · "+esc(used[c])+"에서 씀":""}" aria-label="${n}">${c===v?I.check:used[c]?'<i></i>':""}</button>`).join("")}<label class="hf-custom ${custom?"on":""}" title="다른 색 직접 고르기" ${custom?`style="--cv:${v}"`:""}>${custom?I.check:""}<input type="color" value="${custom?v:"#8A6A4F"}" aria-label="다른 색 직접 고르기"></label></div><div class="hf-swn">${v?cname(v)+(custom?` ${v} · 노션에는 ${nearest(v)[0]}`:""):"색 선택"}${Object.keys(used).length?' · 흰 점 = 다른 클래스가 쓰는 색':""}</div>`;
  p.querySelectorAll("[data-c]").forEach(x=>{x.onclick=()=>onPick(x.dataset.c);x.onmouseenter=()=>p.querySelector(".hf-swn").textContent=x.title});
  const L=p.querySelector(".hf-custom"),ci=L.querySelector("input");L.onmouseenter=()=>p.querySelector(".hf-swn").textContent="다른 색 직접 고르기 — 목록에 없는 색";ci.onchange=()=>onPick(ci.value.toUpperCase())}
function color(host,o={}){let v=o.value||null;const used=o.used||{};
  const b=shell(host,o,`<span class="hf-ci"></span><span class="hf-val"></span>${o.disabled||o.clear===false?"":X}`,"hf-btn hf-colbox");if(!o.disabled)b.tabIndex=0;
  const show=()=>{const c=COLORS.find(x=>x[1]===v);const ci=b.querySelector(".hf-ci");ci.style.background=v||"";ci.classList.toggle("empty",!v);b.querySelector(".hf-val").innerHTML=v?(c?c[0]:`직접 고른 색 <small class="hf-hex">${esc(v)}</small>`):`<span class="ph">${esc(o.placeholder||"색 선택")}</span>`;has(b,v)};
  const open=()=>{if(o.disabled)return;if(OPEN&&OPEN.box===b){close();return}pop(b,p=>palette(p,v,used,c=>{v=c;show();close();b.focus();o.onChange&&o.onChange(v)}),"hf-swpop")};
  const set=c=>{v=c;show();o.onChange&&o.onChange(v)};b.onclick=e=>{if(e.target.closest(".hf-x"))return;open()};b.onkeydown=e=>{if(["Enter"," ","ArrowDown"].includes(e.key)){e.preventDefault();open()}else if((e.key==="Delete"||e.key==="Backspace")&&o.clear!==false)set(null)};
  const x=b.querySelector(".hf-x");if(x)x.onclick=e=>{e.stopPropagation();close();set(null);b.focus()};show();return {get value(){return v}}}
// 켜고 끄기: 칸 안 왼쪽 글 · 오른쪽 스위치(칸 어디를 눌러도 바뀜)
function sw(host,o={}){let v=!!o.value;const b=shell(host,o,`${I.toggle}<span class="hf-val">${esc(o.text||"")}</span><span class="hf-tg" role="switch"></span>`,"hf-btn hf-swbox");if(!o.disabled)b.tabIndex=0;
  const show=()=>{b.classList.toggle("on",v);b.querySelector(".hf-tg").setAttribute("aria-checked",v)};const tg=()=>{if(o.disabled)return;v=!v;show();o.onChange&&o.onChange(v)};
  b.onclick=tg;b.onkeydown=e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();tg()}};show();return {get value(){return v}}}
// 구분(2~4개 중 하나, 시제품 [정규|휴강]과 같은 모양): 칸 전체 = 옅은 바탕 칸 나눔(아이콘·테두리 없음), 고른 칸 = 흰 바탕 + 그림자 + 그 항목 색 글(colors{항목: 색}, 없으면 갈색)
function seg(host,o={}){let v=o.value??o.items[0];const b=shell(host,o,`<span class="hf-seg">${o.items.map(x=>`<button type="button" data-v="${esc(x)}" ${o.disabled?"disabled":""} ${o.colors&&o.colors[x]?`style="--on:${o.colors[x]}"`:""}>${esc(x)}</button>`).join("")}</span>`,"hf-segbox");
  const show=()=>b.querySelectorAll("[data-v]").forEach(x=>{x.classList.toggle("on",x.dataset.v===v);x.setAttribute("aria-pressed",x.dataset.v===v)});
  b.querySelectorAll("[data-v]").forEach(x=>x.onclick=()=>{v=x.dataset.v;show();o.onChange&&o.onChange(v)});show();return {get value(){return v}}}
window.HF={palette,toNotion,text,memo,num,tel,select,day,days,date,time,datetime,dateRange,timeRange,color,sw,seg,close,COLORS};
})();
