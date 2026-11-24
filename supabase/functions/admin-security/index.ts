import { SecurityError,securityEnabled,securityRpc,sha256,randomToken,validatePassword,hashPassword,verifyPassword,nextRecommended,ensureInitialized,fixedWebhookKey,SECURITY_WEBHOOK_ROUTES } from '../_shared/adminSecurity.ts';
import { NOTION_API,NOTION_TOKEN,NOTION_VERSION } from '../_shared/constants.ts';
import { normalizeBareDbTitle } from '../_shared/dbNames.ts';
import { narrowSameName,rootTitle } from '../_shared/appCopy.ts';
import { EXTERNAL_KEYS,isExternalKeyName,externalKeyRpc,forgetExternalKeys,externalKey } from '../_shared/externalKeys.ts';
import { testExternalKey } from '../_shared/externalKeyCheck.ts';
import { teacherRpc,normalizePhone,TEACHER_DB,TEACHER_MENU_DB,teacherMenuAccess,teacherLeft,TEACHER_LEFT_MSG } from '../_shared/teacherAccess.ts';
import { listApp } from '../_shared/appCopy.ts';
import { getPage } from '../_shared/notionClient.ts';
// 관리자 설정을 열 때 연결 확인 결과를 다시 쓰는 시간(1안 10분 — 2안 하루 한 번 · 3안 매번은 결과 문서). 확인 못 함은 1분 뒤 다시.
export const KEY_RECHECK_MS=10*60*1000,KEY_RECHECK_UNKNOWN_MS=60*1000;
// While security is disabled the function only answers with a fixed 503 message and no secrets, so the
// browser must be able to read it for the legacy-login fallback even before ADMIN_ALLOWED_ORIGINS is set.
function cors(req:Request,enforceOrigin:boolean):Record<string,string> {
  const origin=req.headers.get('Origin')??'';
  const allowed=(Deno.env.get('ADMIN_ALLOWED_ORIGINS')??'').split(',').map(x=>x.trim()).filter(Boolean);
  if(enforceOrigin&&origin&&!allowed.includes(origin))throw new SecurityError(403,'허용되지 않은 관리 페이지입니다.');
  return {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'content-type, x-admin-key, authorization, apikey','Access-Control-Allow-Methods':'POST, OPTIONS'};
}
// Links for the webhook checklist: each academy's own "(학원)" databases, found through its Notion
// integration so no per-academy configuration is needed. Normalized title (no spaces, no trailing "DB")
// -> database URL; trashed sources are skipped. When the same title is visible more than once (two 관 in one Notion
// workspace, v2.8.0 item 107) it is narrowed to this academy's DB by the app's rule (Secrets id, then the same top page
// as the registration DB); if that does not leave exactly one, no link is made for that title.
export type LinkCand={title:string,ds:string,dbId:string,edited:string};
export type Narrow=(found:Map<string,string[]>)=>Promise<{map:Map<string,string[]>,problems:Map<string,string>}>;
export async function chooseDbLinks(cands:LinkCand[],narrow:Narrow=narrowSameName):Promise<Record<string,string>> {
  const byTitle=new Map<string,LinkCand[]>();for(const c of cands){const l=byTitle.get(c.title)??[];l.push(c);byTitle.set(c.title,l);}
  const multi=new Map<string,string[]>();for(const [t,l] of byTitle)if(l.length>1)multi.set(t,l.map(c=>c.ds));
  const r=multi.size?await narrow(multi):{map:new Map<string,string[]>(),problems:new Map<string,string>()};
  const out:Record<string,string>={};
  for(const [t,l] of byTitle){
    let pick=l[0];
    if(l.length>1){const ids=r.map.get(t);if(!ids||ids.length!==1){console.warn('[admin-security] same-name DB, no link:',t,r.problems.get(t)??'');continue;}pick=l.find(c=>c.ds===ids[0])??l[0];}
    out[t]=`https://www.notion.so/${pick.dbId}`;
  }
  return out;
}
export async function notionDatabaseLinks(narrow:Narrow=narrowSameName):Promise<Record<string,string>> {
  if(!NOTION_TOKEN)return {};
  const cands:LinkCand[]=[];let cursor:string|undefined;
  for(let page=0;page<5;page++){
    const res=await fetch(`${NOTION_API}/search`,{method:'POST',headers:{Authorization:`Bearer ${NOTION_TOKEN}`,'Notion-Version':NOTION_VERSION,'Content-Type':'application/json'},
      body:JSON.stringify({filter:{property:'object',value:'data_source'},page_size:100,...(cursor?{start_cursor:cursor}:{})}),signal:AbortSignal.timeout(10000)});
    if(!res.ok){console.error('notion search failed',res.status);break;}
    const data=await res.json();
    for(const r of data.results??[]){
      if(r.in_trash||r.archived)continue;
      const title=normalizeBareDbTitle((r.title??[]).map((t:any)=>t.plain_text??'').join('').replace(/\s+/g,'').replace(/DB$/i,'')); // 관 꼬리표("학생(스터디)")도 "(학원)"으로 보고 링크 키를 만든다(v2.8.0 항목 102)
      const id=String(r.parent?.database_id??'').replace(/-/g,'');
      if(!title.includes('(학원)')||!/^[0-9a-f]{32}$/.test(id))continue;
      cands.push({title,ds:String(r.id??''),dbId:id,edited:String(r.last_edited_time)});
    }
    if(!data.has_more||!data.next_cursor)break;cursor=data.next_cursor;
  }
  return await chooseDbLinks(cands,narrow);
}
// The Views API needs a newer Notion-Version than the rest of the code base.
const VIEWS_VERSION='2026-03-11';
async function notionGet(path:string):Promise<any>{
  for(let attempt=0;attempt<3;attempt++){
    const res=await fetch(`${NOTION_API}${path}`,{headers:{Authorization:`Bearer ${NOTION_TOKEN}`,'Notion-Version':VIEWS_VERSION},signal:AbortSignal.timeout(10000)});
    if(res.status===429){await new Promise(r=>setTimeout(r,Math.min(5,Number(res.headers.get('Retry-After'))||1)*1000));continue;}
    if(!res.ok){console.error('notion views failed',res.status);return null;}
    return await res.json();
  }
  return null;
}
// URL of the database view named "웹훅등록" (the view that gathers the webhook buttons), or ''.
export async function webhookViewUrl(dbId:string):Promise<string>{
  let cursor='';
  for(let page=0;page<3;page++){
    const list=await notionGet(`/views?database_id=${dbId}&page_size=100${cursor?`&start_cursor=${encodeURIComponent(cursor)}`:''}`);
    if(!list)return '';
    for(const ref of list.results??[]){
      const id=String(ref.id??'').replace(/-/g,'');if(!/^[0-9a-f]{32}$/.test(id))continue;
      const view=await notionGet(`/views/${id}`);
      if(view&&String(view.name??'').replace(/\s+/g,'')==='웹훅등록')return `https://www.notion.so/${dbId}?v=${id}`;
    }
    if(!list.has_more||!list.next_cursor)break;cursor=list.next_cursor;
  }
  return '';
}
// (v2.8.0 항목 80) The checklist uses the new DB names; an academy that has not renamed its DBs yet
// (v2.8.0 항목 55·71) still has the old titles, so each new name also finds its old titles (normalized, no spaces).
export const OLD_DB_TITLES:Record<string,string[]>={'진도관리(학원)':['진도교재(학원)'],'청구서(학원)':['청구(학원)','교재비(학원)'],'청구항목(학원)':['교재배부(학원)'],'청구결제(학원)':['교재결제(학원)']};
export function pickDbLink(dbs:Record<string,string>,name:string):string{return dbs[name]??(OLD_DB_TITLES[name]??[]).map(o=>dbs[o]).find(Boolean)??'';}
// Database and "웹훅등록" view links for the requested checklist DB names, three DBs at a time.
export async function buildNotionLinks(names:string[]):Promise<{name:string,db:string,view:string}[]>{
  const dbs=await notionDatabaseLinks();const wanted=names.filter(n=>pickDbLink(dbs,n));const out:{name:string,db:string,view:string}[]=[];let next=0;
  const worker=async()=>{while(next<wanted.length){const name=wanted[next++];const db=pickDbLink(dbs,name);out.push({name,db,view:await webhookViewUrl(db.slice(-32))});}};
  await Promise.all([worker(),worker(),worker()]);
  return out;
}
export async function handleAdminSecurity(req:Request):Promise<Response> {
  let headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store'};
  try {
    headers=cors(req,securityEnabled());if(req.method==='OPTIONS')return new Response('ok',{headers});
    if(req.method!=='POST')throw new SecurityError(405,'POST 요청만 지원합니다.');
    if(!securityEnabled())throw new SecurityError(503,'관리자 보안 기능의 최초 서버 설정이 필요합니다.');
    const raw=await req.text();if(raw.length>4096)throw new SecurityError(413,'요청이 너무 큽니다.');
    let b:any;try{b=JSON.parse(raw);}catch{throw new SecurityError(400,'요청 형식이 올바르지 않습니다.');}
    if(!b||typeof b!=='object'||Array.isArray(b))throw new SecurityError(400,'요청 형식이 올바르지 않습니다.');
    const result=(value:unknown)=>new Response(JSON.stringify(value),{headers});
    // Public status: never says whether the initial password is still active.
    if(b.action==='status'){await ensureInitialized();return result({ready:true,webhook_key_weak:fixedWebhookKey().length<32});}
    // Persistent global buckets; independent of spoofable browser IP headers.
    if(['login','change','webhook-start','webhook-cancel'].includes(b.action))await securityRpc('limit',{bucket:'security-'+b.action,max:60,seconds:3600});
    if(b.action==='webhook-links'&&b.refresh===true)await securityRpc('limit',{bucket:'security-webhook-links',max:10,seconds:3600});
    const session=req.headers.get('x-admin-key')??'';
    if(b.action==='login'){
      await ensureInitialized();
      const info=await securityRpc('owner');
      const ok=await verifyPassword(b.password,info.password_hash??'');
      // The initial password may only open the settings page to change it.
      if(ok&&info.must_change&&b.scope!=='settings')throw new SecurityError(409,'초기 비밀번호 상태입니다. 관리자 설정 페이지에서 비밀번호를 먼저 변경해 주세요.');
      const token=randomToken();
      await securityRpc('login',{verified:ok,version:info.version,token_hash:await sha256(token),kind:b.scope==='kiosk'?'kiosk':'admin'});
      return result({session:token,must_change:!!info.must_change});
    }
    if(b.action==='logout'){if(session)await securityRpc('logout',{session_hash:await sha256(session)});return result({ok:true});}
    if(b.action==='profile'){
      const state=await securityRpc('profile',{session_hash:await sha256(session)});
      const next=nextRecommended(state.changed_at);
      return result({changed_at:state.changed_at,recommended_at:next,change_due:Date.now()>=Date.parse(next),must_change:!!state.must_change});
    }
    if(b.action==='change'){
      const ctx=await securityRpc('profile',{session_hash:await sha256(session)});
      if(!await verifyPassword(b.current_password,ctx.password_hash))throw new SecurityError(401,'현재 비밀번호가 올바르지 않습니다.');
      const password=validatePassword(b.new_password);
      if(password===b.current_password)throw new SecurityError(400,'현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
      const internalKey=randomToken();
      const response=await securityRpc('change',{session_hash:await sha256(session),expected_version:ctx.version,password_hash:await hashPassword(password),internal_key:internalKey,internal_hash:await sha256(internalKey)});
      return result({ok:true,changed_at:response.changed_at,message:'변경 완료. 모든 기존 로그인 세션이 해제되었습니다.'});
    }
    // Webhook key rotation. The new key is returned once, on start, because the owner must paste it into
    // Notion; it is never stored in readable form and cannot be fetched again.
    if(b.action==='webhook-status'){
      const st=await securityRpc('webhook-status',{session_hash:await sha256(session)});
      const usage=(Array.isArray(st.usage)?st.usage:[]).filter((u:any)=>SECURITY_WEBHOOK_ROUTES.has(u.route));
      return result({rotating:!!st.rotating,started_at:st.started_at,changed_at:st.changed_at,weak:!st.changed_at&&fixedWebhookKey().length<32,usage,checks:st.checks??{}});
    }
    if(b.action==='root-title'){
      // Page title for the settings tab: the top Notion page title (e.g. "하다 학원관리 v2.0(스터디)"); null when unreadable.
      await securityRpc('webhook-status',{session_hash:await sha256(session)}); // session check
      return result({rootTitle:await rootTitle()});
    }
    if(b.action==='webhook-links'){
      // Cached per academy; searching Notion (databases and their views) only on first use or refresh.
      const sessionHash=await sha256(session);
      await securityRpc('webhook-status',{session_hash:sessionHash}); // session check and must_change block
      let cached=await securityRpc('links-get',{session_hash:sessionHash});
      if(b.refresh===true||!Object.keys(cached.links??{}).length){
        const names=(Array.isArray(b.names)?b.names:[]).filter((n:unknown)=>typeof n==='string'&&n.length<=64).slice(0,60);
        await securityRpc('links-set',{session_hash:sessionHash,links:await buildNotionLinks(names)});
        cached=await securityRpc('links-get',{session_hash:sessionHash});
      }
      return result({links:cached.links??{},updated_at:cached.updated_at});
    }
    if(b.action==='webhook-check'){
      if(typeof b.item!=='string')throw new SecurityError(400,'항목 형식 오류');
      const response=await securityRpc('webhook-check',{session_hash:await sha256(session),item:b.item,checked:b.checked===true});
      return result({ok:true,checked_at:response.checked_at});
    }
    if(b.action==='webhook-start'||b.action==='webhook-cancel'){
      const sessionHash=await sha256(session);
      const ctx=await securityRpc('profile',{session_hash:sessionHash});
      if(!await verifyPassword(b.current_password,ctx.password_hash))throw new SecurityError(401,'현재 비밀번호가 올바르지 않습니다.');
      if(b.action==='webhook-cancel'){await securityRpc('webhook-cancel',{session_hash:sessionHash});return result({ok:true});}
      const key=randomToken(24);
      const response=await securityRpc('webhook-start',{session_hash:sessionHash,webhook_hash:await sha256(key)});
      return result({ok:true,key,started_at:response.started_at});
    }
    if(b.action==='webhook-finish'){
      const response=await securityRpc('webhook-finish',{session_hash:await sha256(session),force:b.force===true});
      if(response.needs_confirm)return new Response(JSON.stringify({error:'최근 7일 안에 이전 키로 호출된 버튼이 있습니다. 지금 완료하면 그 버튼은 동작하지 않습니다.',needs_confirm:true}),{status:409,headers});
      return result({ok:true,changed_at:response.changed_at});
    }
    // (강사계정 261123) 강사 로그인 · 비밀번호 바꾸기 · 로그아웃. 강사 세션은 원장 세션 표에 들어가지 않는다(hada_teacher_command).
    if(b.action==='teacher-login'){
      await securityRpc('limit',{bucket:'security-teacher-login',max:120,seconds:3600});
      const phone=normalizePhone(b.phone);const fail=()=>new SecurityError(401,'아이디 또는 비밀번호가 올바르지 않아요.');
      const acc=phone?await teacherRpc('account',{phone}):{found:false};
      if(!acc.found){await hashPassword(String(b.password??'').slice(0,128));throw fail();} // 없는 번호도 같은 시간 · 같은 말
      // 첫 비밀번호(번호)는 하이픈 · 공백을 넣어 쳐도 같은 번호로 본다. 바꾼 비밀번호는 그대로 비교.
      const ok=await verifyPassword(acc.must_change?(normalizePhone(b.password)||b.password):b.password,acc.password_hash);
      const token=randomToken();
      // 노션 계정(강사 DB 사람 칸)은 앱 사본에 없으므로(SKIP_PROPS) 로그인 때 노션에서 한 번 읽어 세션에 둔다 — 메뉴 권한(편집허용) 대조용.
      let users:string[]=[];
      if(ok){
        let left=false;
        try{const page=await getPage(acc.teacher_id);users=((page?.properties?.['노션 계정']?.people)??[]).map((u:any)=>String(u?.id??'')).filter(Boolean).slice(0,20);left=teacherLeft(page?.properties?.['퇴사일']?.date);}catch(e){console.error('[admin-security] teacher notion account',(e as Error).message.slice(0,80));}
        // (대표 261124) 퇴사일이 지난 강사는 번호 · 비밀번호가 맞아도 세션을 만들지 않는다(틀린 비밀번호가 아니므로 잠금 횟수에는 넣지 않음).
        if(left)throw new SecurityError(403,TEACHER_LEFT_MSG);
        // (대표 261123 "편집허용 · 댓글허용에도 해당 강사가 없으면 로그인이 안되게") 번호 · 비밀번호가 맞아도 볼 메뉴가 하나도 없으면 세션을 만들지 않는다.
        // 틀린 비밀번호가 아니므로 잠금 횟수에는 넣지 않는다(login을 부르지 않음).
        if(!teacherMenuAccess(await listApp(TEACHER_MENU_DB as any),users).menus.length)throw new SecurityError(403,'아직 볼 수 있는 메뉴가 없어요 — 원장에게 노션 메뉴관리 권한을 요청하세요.');
      }
      await teacherRpc('login',{teacher_id:acc.teacher_id,verified:ok,version:acc.version,token_hash:await sha256(token),notion_users:users});
      return result({session:token,role:'teacher',must_change:!!acc.must_change,name:acc.name});
    }
    if(b.action==='teacher-profile'){
      const t=await teacherRpc('session',{session_hash:await sha256(session)});
      return result({role:'teacher',name:t.name,must_change:!!t.must_change});
    }
    if(b.action==='teacher-change'){
      await securityRpc('limit',{bucket:'security-teacher-change',max:60,seconds:3600});
      const sessionHash=await sha256(session);
      const t=await teacherRpc('session',{session_hash:sessionHash});
      if(!await verifyPassword(b.current_password,t.password_hash))throw new SecurityError(401,'현재 비밀번호가 올바르지 않아요.');
      const password=validatePassword(b.new_password);
      if(password===b.current_password)throw new SecurityError(400,'현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
      if(password.replace(/\D/g,'')===t.phone||password===t.phone)throw new SecurityError(400,'휴대폰 번호와 다른 비밀번호를 정해 주세요.');
      const r=await teacherRpc('change',{session_hash:sessionHash,expected_version:t.version,password_hash:await hashPassword(password)});
      // 앱이 새 비밀번호로 바로 다시 로그인할 수 있게 자기 아이디(번호)를 돌려준다(이 세션의 강사 본인 것만).
      return result({ok:true,changed_at:r.changed_at,phone:t.phone,message:'바꿨어요. 새 비밀번호로 다시 로그인해요.'});
    }
    if(b.action==='teacher-logout'){if(session)await teacherRpc('logout',{session_hash:await sha256(session)});return result({ok:true});}
    // 원장만: 강사 앱 계정 목록 · 켜기 · 끄기 · 첫 비밀번호로 되돌리기. 원장 세션(초기 비밀번호 상태 아님)만 — 강사 세션은 profile에서 401.
    if(['teachers-status','teacher-enable','teacher-disable','teacher-reset'].includes(b.action)){
      const ctx=await securityRpc('profile',{session_hash:await sha256(session)});
      if(ctx.must_change)throw new SecurityError(409,'초기 비밀번호 상태입니다. 관리자 비밀번호를 먼저 바꿔 주세요.');
      const rows=await listApp(TEACHER_DB as any);
      const id32=(v:unknown)=>String(v??'').replace(/-/g,'').toLowerCase();
      // 같은 번호 강사(노션 강사 DB 안): 이 번호들은 켜거나 되돌리지 못하게 막는다.
      const count=new Map<string,number>();for(const r of rows as any[]){const ph=normalizePhone(r.props?.['연락처']);if(ph)count.set(ph,(count.get(ph)??0)+1);}
      if(b.action==='teachers-status'){
        const acc=await teacherRpc('list');const byId=new Map((acc.accounts??[]).map((a:any)=>[a.teacher_id,a]));
        // 메뉴 권한(편집허용 · 댓글허용): 노션 계정은 사본에 없어 강사 페이지를 읽는다(3개씩). 못 읽으면 null(모름).
        const menuRows=await listApp(TEACHER_MENU_DB as any);const perm=new Map<string,{menus:number,edit:number}|null>();
        const ids=(rows as any[]).map((r)=>id32(r.id)).slice(0,60);let next=0;
        await Promise.all([0,1,2].map(async()=>{while(next<ids.length){const id=ids[next++];try{const page=await getPage(id);
          const users=((page?.properties?.['노션 계정']?.people)??[]).map((u:any)=>String(u?.id??'')).filter(Boolean);
          const m=teacherMenuAccess(menuRows,users);perm.set(id,{menus:m.menus.length,edit:m.editMenus.length});}catch(_){perm.set(id,null);}}}));
        return result({teachers:(rows as any[]).map((r)=>{const id=id32(r.id),ph=normalizePhone(r.props?.['연락처']),a:any=byId.get(id);
          return {teacher_id:id,name:String(r.props?.['이름']??''),phone:ph,phone_raw:String(r.props?.['연락처']??''),duplicate:!!ph&&(count.get(ph)??0)>1,
            menu:perm.get(id)??null,
            account:a?{enabled:!!a.enabled,must_change:!!a.must_change,locked:!!a.locked,locked_until:a.locked_until,changed_at:a.changed_at,phone:a.phone}:null};})});
      }
      await securityRpc('limit',{bucket:'security-teacher-admin',max:120,seconds:3600});
      const id=id32(b.teacher_id);if(!/^[0-9a-f]{32}$/.test(id))throw new SecurityError(400,'강사를 골라 주세요.');
      if(b.action==='teacher-disable'){await teacherRpc('disable',{teacher_id:id});return result({ok:true});}
      const row:any=(rows as any[]).find((r)=>id32(r.id)===id);
      if(!row)throw new SecurityError(404,'노션 강사 DB에서 그 강사를 찾지 못했어요. [동기화] 뒤 다시 해 주세요.');
      const phone=normalizePhone(row.props?.['연락처']);
      if(!phone)throw new SecurityError(400,'노션 강사 DB 연락처에 휴대폰 번호(010-0000-0000)를 먼저 넣어 주세요.');
      if((count.get(phone)??0)>1)throw new SecurityError(409,'같은 휴대폰 번호인 강사가 노션 강사 DB에 둘 이상이에요. 연락처를 먼저 고쳐 주세요.');
      const data={teacher_id:id,phone,name:String(row.props?.['이름']??'').slice(0,80),password_hash:await hashPassword(phone)};
      await teacherRpc(b.action==='teacher-enable'?'enable':'reset',data);
      return result({ok:true});
    }
    // (v2.8.0, 261123 키 자동 등록) 외부 키: 관리 앱 [관리자 설정]에서 넣으면 Vault에 저장 → 함수가 Vault 먼저 · 없으면 Secret.
    // 값은 되돌려 주지 않는다(응답에는 있음 · 바꾼 날 · 확인 결과 · Secret에도 있는지만). 초기 비밀번호 상태에서는 막는다.
    if(['keys-status','key-set','key-test','key-clear'].includes(b.action)){
      const ctx=await securityRpc('profile',{session_hash:await sha256(session)});
      if(ctx.must_change)throw new SecurityError(409,'초기 비밀번호 상태입니다. 관리자 비밀번호를 먼저 바꿔 주세요.');
      if(b.action!=='keys-status'){
        await securityRpc('limit',{bucket:'security-keys',max:30,seconds:3600});
        if(!isExternalKeyName(b.name))throw new SecurityError(400,'지원하지 않는 키입니다.');
      }
      const store=async(action:string,data:Record<string,unknown>={})=>{try{return await externalKeyRpc(action,data);}catch(e){
        const st=(e as {status?:number}).status;if(st&&st<500&&st!==404)throw new SecurityError(st,(e as Error).message);
        console.error('[admin-security] external key store',action,(e as Error).message.slice(0,80));
        throw new SecurityError(503,'키 저장소에 연결하지 못했습니다. 업데이트(마이그레이션)가 적용됐는지 확인해 주세요.');}};
      // 연결 상태(대표 261123 "누르지 않아도 바로"): 키마다 지금 쓰는 키의 출처(app · secret · 없음)와 마지막 확인 결과.
      // check=true(관리자 설정을 열 때)면 결과가 없거나 오래됐을 때만 상대 서버에 한 번 묻는다 — 10분(확인 못 함은 1분) 안이면 다시 씀.
      const view=async(st:any,check:boolean,force:string|null)=>{
        const out:Record<string,unknown>={};
        await Promise.all(EXTERNAL_KEYS.map(async(n)=>{
          const app=!!st.keys?.[n],secret=!!Deno.env.get(n),source=app?'app':secret?'secret':'';
          let c=st.checks?.[n]??null;if(c&&c.source!==source)c=null;
          let state:string|null=source?(c?.state??null):'none',checked_at:string|null=source?(c?.checked_at??null):null;
          const age=c?Date.now()-Date.parse(c.checked_at):Infinity,ttl=c?.state==='unknown'?KEY_RECHECK_UNKNOWN_MS:KEY_RECHECK_MS;
          if(source&&((check&&!(age<ttl))||force===n)){
            const key=await externalKey(n);
            if(key){state=await testExternalKey(n,key);const w=await store('checked',{name:n,source,state}).catch(()=>null);checked_at=w?.checked_at??new Date().toISOString();}
          }
          out[n]={app,changed_at:st.keys?.[n]?.changed_at??null,secret,source,state,checked_at};
        }));
        return Object.fromEntries(EXTERNAL_KEYS.map((n)=>[n,out[n]])); // 화면 줄 순서 그대로
      };
      if(b.action==='keys-status')return result({keys:await view(await store('status'),b.check===true,null)});
      const name=b.name as (typeof EXTERNAL_KEYS)[number];
      if(b.action==='key-set'){
        if(typeof b.value!=='string'||!/^[!-~]{8,256}$/.test(b.value))throw new SecurityError(400,'키 형식이 올바르지 않습니다. 받은 키를 앞뒤 공백 없이 그대로 붙여 넣어 주세요.');
        const saved=await store('set',{name,value:b.value});forgetExternalKeys();
        const test=await testExternalKey(name,b.value);
        await store('checked',{name,source:'app',state:test}).catch(()=>null);
        return result({ok:true,changed_at:saved.changed_at,test});
      }
      if(b.action==='key-test'){
        // [연결 확인]: 지금 함수가 쓰는 키(앱에서 넣은 값 먼저, 없으면 Secret)로 바로 다시 확인한다.
        forgetExternalKeys();const keys:any=await view(await store('status'),false,name);const k=keys[name];
        return result({test:k.source?k.state:null,source:k.source,checked_at:k.checked_at});
      }
      await store('clear',{name});forgetExternalKeys();
      return result({ok:true,secret:!!Deno.env.get(name)});
    }
    throw new SecurityError(400,'지원하지 않는 작업입니다.');
  }catch(e){const status=e instanceof SecurityError?e.status:503;return new Response(JSON.stringify({error:e instanceof SecurityError?e.message:'처리하지 못했습니다. 서버 연결 상태를 확인해 주세요.'}),{status,headers});}
}
Deno.serve(handleAdminSecurity);
