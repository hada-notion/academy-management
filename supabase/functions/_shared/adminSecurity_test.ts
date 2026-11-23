import { SecurityError, authorizeKey, hashPassword, verifyPassword, validatePassword, sha256, equalSecret, nextRecommended, randomToken, INITIAL_PASSWORD, SECURITY_WEBHOOK_ROUTES } from './adminSecurity.ts';
import { WEBHOOK_ROUTES } from './webhookRoutes.ts';
function assert(v:unknown,m='assertion failed'){if(!v)throw new Error(m);}
function rejects(fn:()=>unknown){try{fn();}catch(e){assert(e instanceof SecurityError);return;}throw new Error('expected rejection');}
Deno.env.set('SB_URL','https://mock.supabase.co');Deno.env.set('SB_SERVICE_ROLE_KEY','test-only-service');Deno.env.set('ADMIN_ALLOWED_ORIGINS','https://admin.example.test');Deno.env.set('ADMIN_SECRET','test-only-webhook-key-0123456789abcdef');Deno.env.set('NOTION_TOKEN','test-only-notion');
const originalServe=Deno.serve;(Deno as any).serve=()=>({});
const {handleAdminSecurity,notionDatabaseLinks,webhookViewUrl,chooseDbLinks}=await import('../admin-security/index.ts');(Deno as any).serve=originalServe;
async function withFetch(fn:(action:string,data:any,url:string)=>unknown,run:()=>Promise<void>){const old=fetch;globalThis.fetch=(async(input:any,init:any)=>{const b=init?.body?JSON.parse(init.body):{};return new Response(JSON.stringify(await fn(b.p_action,b.p_data,String(input))),{headers:{'Content-Type':'application/json'}});}) as typeof fetch;try{await run();}finally{globalThis.fetch=old;Deno.env.delete('ADMIN_SECURITY_ENABLED');}}
const request=(body:any,origin='https://admin.example.test',key='')=>new Request('https://mock.supabase.co/functions/v1/admin-security',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify(body)});
const ready={initialized:true,password_set:true};
Deno.test('password hash is salted and validates correct password only',async()=>{const p='Long passphrase test';const a=await hashPassword(p),b=await hashPassword(p);assert(a!==b);assert(await verifyPassword(p,a));assert(!await verifyPassword(p+'!',a));assert(!await verifyPassword(p,'bad'));});
Deno.test('password policy: 8-128 chars, no surrounding spaces, never the initial password',()=>{rejects(()=>validatePassword(INITIAL_PASSWORD));rejects(()=>validatePassword('short7!'));rejects(()=>validatePassword(' eight88 '));rejects(()=>validatePassword('x'.repeat(129)));assert(validatePassword('eight888')==='eight888');});
Deno.test('three-month reminder clamps month ends',()=>{assert(nextRecommended('2026-01-31T12:00:00.000Z')==='2026-04-30T12:00:00.000Z');});
Deno.test('random tokens and constant-time compare',()=>{assert(/^[0-9a-f]{64}$/.test(randomToken()));assert(equalSecret('a','a'));assert(!equalSecret('a','b'));assert(!equalSecret('a','aa'));});
Deno.test('legacy mode preserves valid old credentials',async()=>{Deno.env.delete('ADMIN_SECURITY_ENABLED');assert(await authorizeKey(request({}),'legacy','legacy'));assert(!await authorizeKey(request({}),'bad','legacy'));assert(!await authorizeKey(request({}),'',''));});
for(const [kind,route,expected] of [['webhook','generate-classes',true],['webhook','toggle-report-link',true],['webhook','notion-router',true],['session','notion-router',false],['webhook','sync-registration-textbook/create-individual',true],['webhook','sync-registration-textbook/create-class',true],['webhook','sync-textbook-distribution/from-cart',true],['webhook','sync-textbook-distribution/from-cart/queue/',true],['webhook','process-sync-queue/send-report',false],['session','generate-classes/kiosk-checkin',false],['kiosk','kiosk-checkin',true],['kiosk','list-students?kiosk=1',true],['kiosk','list-students',false],['kiosk','get-legal-document-data',false],['kiosk','admin-security',false],['kiosk','generate-classes',false],['webhook','school-api',false],['webhook','get-legal-document-data',false],['webhook','admin-security',false],['session','kiosk-checkin',true],['session','toggle-report-link',false],['session','sync-school-calendar',true],['kiosk','sync-school-calendar',false],['none','sync-school-calendar',false],['webhook','sync-school-calendar',true],['session','school-api',true],['session','textbook-api',true],['webhook','textbook-api',false],['session','get-legal-document-data',true],['session','generate-classes',false],['internal','process-sync-queue',true],['none','generate-classes',false]] as const){Deno.test(`credential scope ${kind} -> ${route}: ${expected}`,()=>withFetch(()=>({kind}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=new Request(`https://mock.supabase.co/functions/v1/${route}`);assert(await authorizeKey(r,'test-only','')===expected);}));}
Deno.test('route name is the function even without the /functions/v1 prefix',()=>withFetch(()=>({kind:'webhook'}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');assert(await authorizeKey(new Request('http://edge.local/sync-registration-textbook/create-class'),'test-only',''));assert(!await authorizeKey(new Request('http://edge.local/process-sync-queue/send-report'),'test-only',''));}));
Deno.test('an appended /functions/v1/<route> cannot borrow another route scope',()=>withFetch(()=>({kind:'kiosk'}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  for(const url of ['http://edge.local/cascade-delete/functions/v1/kiosk-checkin','http://edge.local/list-students/functions/v1/kiosk-checkin','https://mock.supabase.co/functions/v1/cascade-delete/functions/v1/kiosk-checkin','https://mock.supabase.co/functions/v1/cascade-delete/functions/v1/list-students?kiosk=1'])assert(!await authorizeKey(new Request(url),'test-only',''),url);
  assert(await authorizeKey(new Request('http://edge.local/kiosk-checkin'),'test-only',''));}));
Deno.test('first webhook after activation initializes the owner state, then authorizes',()=>{let inits=0,auth=0;return withFetch(async(action,data)=>{if(action==='authorize')return {kind:auth++===0?'uninitialized':'webhook'};if(action==='status')return {initialized:false,password_set:false};if(action==='init'){inits++;assert(await verifyPassword(INITIAL_PASSWORD,data.password_hash));assert(data.webhook_hash===await sha256('test-only-webhook-key-0123456789abcdef'));assert(data.internal_hash===await sha256(data.internal_key));return {ok:true};}return {};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');assert(await authorizeKey(new Request('https://mock.supabase.co/functions/v1/generate-classes'),'test-only',''));assert(inits===1&&auth===2);});});
Deno.test('status initializes once and never reveals password state or keys',()=>{const calls:string[]=[];return withFetch((action)=>{calls.push(action);if(action==='status')return ready;return {ok:true,internal_key:'not-to-return'};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=await handleAdminSecurity(request({action:'status'}));const data=await r.json();assert(r.status===200);assert(Object.keys(data).sort().join(',')==='ready,webhook_key_weak');assert(data.webhook_key_weak===false);assert(!calls.includes('init'));});});
Deno.test('missing webhook key stops initialization',()=>{const saved=Deno.env.get('ADMIN_SECRET');Deno.env.delete('ADMIN_SECRET');return withFetch((action)=>action==='status'?{initialized:false,password_set:false}:{ok:true},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');try{assert((await handleAdminSecurity(request({action:'status'}))).status===503);}finally{Deno.env.set('ADMIN_SECRET',saved!);}});});
Deno.test('initial password opens only the settings page; kiosk and documents get 409 without a session',async()=>{const initialHash=await hashPassword(INITIAL_PASSWORD);const logins:string[]=[];await withFetch((action,data)=>{if(action==='status')return ready;if(action==='owner')return {password_hash:initialHash,version:1,must_change:true};if(action==='login'){logins.push(data.kind+':'+data.verified);return data.verified?{ok:true}:{error:'비밀번호가 올바르지 않습니다.',status:401};}return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  for(const scope of ['kiosk',undefined]){const r=await handleAdminSecurity(request({action:'login',password:INITIAL_PASSWORD,scope}));assert(r.status===409);}
  const s=await handleAdminSecurity(request({action:'login',password:INITIAL_PASSWORD,scope:'settings'}));const data=await s.json();assert(s.status===200&&data.must_change===true&&/^[0-9a-f]{64}$/.test(data.session));
  const w=await handleAdminSecurity(request({action:'login',password:'wrong-password',scope:'kiosk'}));assert(w.status===401&&!(await w.json()).session);
  assert(logins.join()==='admin:true,kiosk:false');});});
Deno.test('kiosk login after the change requests a kiosk session; others stay admin',async()=>{const hash=await hashPassword('changed-pass');const kinds:string[]=[];await withFetch((action,data)=>{if(action==='status')return ready;if(action==='owner')return {password_hash:hash,version:2,must_change:false};if(action==='login'){kinds.push(data.kind);return {ok:true};}return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');for(const scope of ['kiosk',undefined,'root','settings'])await handleAdminSecurity(request({action:'login',password:'changed-pass',scope}));assert(kinds.join()==='kiosk,admin,admin,admin');});});
Deno.test('change requires the current password and a new valid password',async()=>{const hash=await hashPassword('current-pass');const changes:any[]=[];await withFetch((action,data)=>{if(action==='profile')return {password_hash:hash,changed_at:'2026-01-31T12:00:00Z',version:3,must_change:false};if(action==='change'){changes.push(data);return {ok:true,changed_at:'2026-10-12T00:00:00Z'};}return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  assert((await handleAdminSecurity(request({action:'change',current_password:'wrong',new_password:'new-password'},undefined,'s'))).status===401);
  for(const bad of [INITIAL_PASSWORD,'short','current-pass'])assert((await handleAdminSecurity(request({action:'change',current_password:'current-pass',new_password:bad},undefined,'s'))).status===400,bad);
  assert(changes.length===0);
  const ok=await handleAdminSecurity(request({action:'change',current_password:'current-pass',new_password:'new-password'},undefined,'s'));const body=await ok.text();
  assert(ok.status===200&&changes.length===1&&changes[0].expected_version===3);
  assert(await verifyPassword('new-password',changes[0].password_hash)&&changes[0].internal_hash===await sha256(changes[0].internal_key));
  assert(!body.includes(changes[0].internal_key)&&!body.includes('new-password'));});});
Deno.test('webhook rotation start needs the password and returns the new key once, sending only its hash',async()=>{const hash=await hashPassword('current-pass');const calls:any[]=[];await withFetch((action,data)=>{calls.push([action,data]);if(action==='profile')return {password_hash:hash,changed_at:'2026-01-31T12:00:00Z',version:3,must_change:false};if(action==='webhook-start')return {ok:true,started_at:'2026-10-13T00:00:00Z'};return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  assert((await handleAdminSecurity(request({action:'webhook-start',current_password:'wrong'},undefined,'s'))).status===401);
  assert(!calls.some(([a])=>a==='webhook-start'));
  const r=await handleAdminSecurity(request({action:'webhook-start',current_password:'current-pass'},undefined,'s'));const data=await r.json();
  assert(r.status===200&&/^[0-9a-f]{48}$/.test(data.key));
  const start=calls.find(([a])=>a==='webhook-start')![1];
  assert(start.webhook_hash===await sha256(data.key)&&!JSON.stringify(start).includes(data.key)&&start.session_hash===await sha256('s'));
  assert(calls.some(([a,d])=>a==='limit'&&d.bucket==='security-webhook-start'));});});
Deno.test('webhook rotation cancel needs the password; finish asks for confirmation on recent old-key calls',async()=>{const hash=await hashPassword('current-pass');const calls:any[]=[];await withFetch((action,data)=>{calls.push([action,data]);if(action==='profile')return {password_hash:hash,version:3,must_change:false};if(action==='webhook-finish')return data.force?{ok:true,changed_at:'2026-10-13T00:00:00Z'}:{ok:false,needs_confirm:true};return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  assert((await handleAdminSecurity(request({action:'webhook-cancel',current_password:'wrong'},undefined,'s'))).status===401);
  assert((await handleAdminSecurity(request({action:'webhook-cancel',current_password:'current-pass'},undefined,'s'))).status===200);
  const pending=await handleAdminSecurity(request({action:'webhook-finish'},undefined,'s'));assert(pending.status===409&&(await pending.json()).needs_confirm===true);
  assert((await handleAdminSecurity(request({action:'webhook-finish',force:'yes'},undefined,'s'))).status===409); // only boolean true forces
  assert((await handleAdminSecurity(request({action:'webhook-finish',force:true},undefined,'s'))).status===200);});});
Deno.test('webhook status lists only webhook routes and flags a short initial key',()=>withFetch(()=>({rotating:true,started_at:'2026-10-13T00:00:00Z',changed_at:null,usage:[{route:'send-report',key:'old',calls:2,last_at:'2026-10-13T01:00:00Z'},{route:'admin-security',key:'old',calls:1,last_at:'2026-10-13T01:00:00Z'}]}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const saved=Deno.env.get('ADMIN_SECRET')!;Deno.env.set('ADMIN_SECRET','short');try{const data=await (await handleAdminSecurity(request({action:'webhook-status'},undefined,'s'))).json();assert(data.rotating===true&&data.weak===true);assert(data.usage.length===1&&data.usage[0].route==='send-report');}finally{Deno.env.set('ADMIN_SECRET',saved);}}));
Deno.test('authorize sends the function name so rotation calls can be counted',async()=>{const seen:any[]=[];await withFetch((action,data)=>{if(action==='authorize')seen.push(data);return {kind:'webhook'};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');assert(await authorizeKey(new Request('https://mock.supabase.co/functions/v1/sync-registration-textbook/create-class'),'test-only',''));assert(seen[0].route==='sync-registration-textbook');await authorizeKey(new Request('https://mock.supabase.co/functions/v1/not-a-webhook-route'),'test-only','');assert(seen[1].route==='');});});
Deno.test('Notion DB links: same-name DBs (two 관) are narrowed to this academy, ambiguous ones get no link (item 107)',async()=>{
  const c=(title:string,ds:string,dbId:string):any=>({title,ds,dbId,edited:'2026-10-01T00:00:00Z'});
  const cands=[c('클래스(학원)','ds-study','a'.repeat(32)),c('클래스(학원)','ds-start','b'.repeat(32)),c('시즌(학원)','se-1','c'.repeat(32)),c('시즌(학원)','se-2','d'.repeat(32)),c('학생(학원)','st-1','e'.repeat(32))];
  // narrow: 클래스는 이 학원 것(스타트) 하나로 좁혀지고, 시즌은 모호함
  const links=await chooseDbLinks(cands,async()=>({map:new Map([['클래스(학원)',['ds-start']]]),problems:new Map([['시즌(학원)','모호']])}));
  assert(JSON.stringify(links)===JSON.stringify({'클래스(학원)':'https://www.notion.so/'+'b'.repeat(32),'학생(학원)':'https://www.notion.so/'+'e'.repeat(32)}),JSON.stringify(links));
  let asked=0;await chooseDbLinks([c('학생(학원)','x','1'.repeat(32))],async()=>{asked++;return {map:new Map(),problems:new Map()};});
  assert(asked===0,'unique titles are not narrowed');});
Deno.test('Notion DB links: academy databases only, trashed skipped, same name narrowed by the injected rule, paginated',async()=>{const old=fetch;const bodies:any[]=[];
  const ds=(title:string,db:string,edited:string,extra:any={})=>({object:'data_source',id:'ds-'+db.slice(0,2),title:[{plain_text:title}],parent:{type:'database_id',database_id:db},last_edited_time:edited,...extra});
  const pages=[{results:[ds('등록(학원) DB','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z'),ds('등록(학원) DB','22222222222222222222222222222222','2026-10-05T00:00:00Z'),ds('출석(학원) DB','33333333333333333333333333333333','2026-10-01T00:00:00Z',{in_trash:true})],has_more:true,next_cursor:'c2'},
    {results:[ds('알림톡 발송함(학원) DB','44444444444444444444444444444444','2026-10-01T00:00:00Z'),ds('패치·이슈 관리 DB','55555555555555555555555555555555','2026-10-01T00:00:00Z'),ds('교재결제(학원) DB','not-an-id','2026-10-01T00:00:00Z')],has_more:false}];
  globalThis.fetch=(async(_u:any,init:any)=>{const b=JSON.parse(init.body);bodies.push(b);return new Response(JSON.stringify(pages[bodies.length-1]));}) as typeof fetch;
  try{const links=await notionDatabaseLinks(async(m)=>({map:new Map([...m].map(([k,v])=>[k,[v[1]]])),problems:new Map()})); // 이 학원 것 = 두 번째(ds-22)로 좁혀졌다고 가정
    assert(JSON.stringify(links)===JSON.stringify({'등록(학원)':'https://www.notion.so/22222222222222222222222222222222','알림톡발송함(학원)':'https://www.notion.so/44444444444444444444444444444444'}),JSON.stringify(links));
    assert(bodies[0].filter.value==='data_source'&&bodies[1].start_cursor==='c2');}finally{globalThis.fetch=old;}});
Deno.test('webhook view link: finds the view named 웹훅등록 with the views API version',async()=>{const old=fetch;const seen:any[]=[];const db='2'.repeat(32),v1='3'.repeat(32),v2='4'.repeat(32);
  globalThis.fetch=(async(u:any,init:any)=>{const url=String(u);seen.push([url,init.headers['Notion-Version']]);
    if(url.includes('/views?'))return new Response(JSON.stringify({results:[{object:'view',id:v1},{object:'view',id:v2}],has_more:false}));
    if(url.endsWith('/views/'+v1))return new Response(JSON.stringify({id:v1,name:'수강정보'}));
    return new Response(JSON.stringify({id:v2,name:'웹훅 등록'}));}) as typeof fetch;
  try{assert(await webhookViewUrl(db)===`https://www.notion.so/${db}?v=${v2}`);assert(seen.every(([,v])=>v==='2026-03-11')&&seen[0][0].includes('database_id='+db));
    globalThis.fetch=(async()=>new Response('{}',{status:404})) as typeof fetch;assert(await webhookViewUrl(db)==='');}finally{globalThis.fetch=old;}});
Deno.test('webhook links need a valid admin session',()=>withFetch((action)=>action==='webhook-status'?{error:'다시 로그인해 주세요.',status:401}:{ok:true},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');assert((await handleAdminSecurity(request({action:'webhook-links'},undefined,'bad'))).status===401);}));
// 261123: 옛 관리자 설정 웹 화면(체크리스트 원본)을 없앰 — 연결표(webhookRoutes.ts)가 원본. 연결표의 함수는 모두 웹훅 키로 지키는 경로, 항목 ID는 고유.
Deno.test('webhook route table only uses key-protected webhook routes with unique item ids',()=>{const routes=[...new Set(WEBHOOK_ROUTES.map(r=>r.fn))];
  assert(routes.length>0&&routes.every(r=>r!=='notion-router'&&SECURITY_WEBHOOK_ROUTES.has(r)),'every WEBHOOK_ROUTES function must be in SECURITY_WEBHOOK_ROUTES');
  const ids=WEBHOOK_ROUTES.map(r=>r.id);assert(ids.length>=30&&new Set(ids).size===ids.length&&ids.every(id=>/^[a-z0-9-]{1,64}$/.test(id)),'route item ids must be unique');});
Deno.test('webhook checks pass only boolean true and links refresh is rate limited',async()=>{const calls:any[]=[];await withFetch((action,data)=>{calls.push([action,data]);if(action==='links-get')return {links:{'등록(학원)':{db:'https://www.notion.so/'+'a'.repeat(32),view:null}},updated_at:'2026-10-13T00:00:00Z'};return {ok:true,checked_at:'2026-10-13T00:00:00Z'};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  assert((await handleAdminSecurity(request({action:'webhook-check',item:'reg-end',checked:'yes'},undefined,'s'))).status===200);
  assert(calls.find(([a])=>a==='webhook-check')[1].checked===false);
  assert((await handleAdminSecurity(request({action:'webhook-check',item:5},undefined,'s'))).status===400);
  const cached=await (await handleAdminSecurity(request({action:'webhook-links',names:['등록(학원)']},undefined,'s'))).json();
  assert(cached.links['등록(학원)']&&!calls.some(([a])=>a==='links-set'),'cached links must not search Notion again');
  assert(!calls.some(([a,d])=>a==='limit'&&d.bucket==='security-webhook-links'));});});
Deno.test('profile returns the reminder and must_change, never the password hash',()=>withFetch(()=>({password_hash:'private-hash',changed_at:'2026-01-31T12:00:00Z',version:1,must_change:true}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=await handleAdminSecurity(request({action:'profile'},undefined,'session'));const data=await r.json();assert(!JSON.stringify(data).includes('private-hash'));assert(data.must_change===true);assert(data.recommended_at==='2026-04-30T12:00:00.000Z');}));
Deno.test('disabled server returns explicit setup message',async()=>{Deno.env.delete('ADMIN_SECURITY_ENABLED');assert((await handleAdminSecurity(request({action:'status'}))).status===503);});
Deno.test('disabled server stays readable by legacy login even before allowed origins are configured',async()=>{
  const saved=Deno.env.get('ADMIN_ALLOWED_ORIGINS');Deno.env.delete('ADMIN_ALLOWED_ORIGINS');Deno.env.delete('ADMIN_SECURITY_ENABLED');
  try{
    const pre=await handleAdminSecurity(new Request('https://mock.supabase.co/functions/v1/admin-security',{method:'OPTIONS',headers:{Origin:'https://admin.example.test'}}));
    assert(pre.status===200&&pre.headers.get('Access-Control-Allow-Origin')==='https://admin.example.test');
    const r=await handleAdminSecurity(request({action:'login',password:'legacy-key'}));
    assert(r.status===503&&r.headers.get('Access-Control-Allow-Origin')==='https://admin.example.test');
    assert((await r.json()).error==='관리자 보안 기능의 최초 서버 설정이 필요합니다.');
    // Enabling security without configured origins must still reject browsers.
    Deno.env.set('ADMIN_SECURITY_ENABLED','true');
    assert((await handleAdminSecurity(request({action:'status'}))).status===403);
  }finally{Deno.env.delete('ADMIN_SECURITY_ENABLED');if(saved!==undefined)Deno.env.set('ADMIN_ALLOWED_ORIGINS',saved);}
});
Deno.test('unapproved origin is rejected before storage',async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');assert((await handleAdminSecurity(request({action:'status'},'https://evil.example'))).status===403);Deno.env.delete('ADMIN_SECURITY_ENABLED');});
Deno.test('authentication storage failure never falls back to old key',async()=>{const old=fetch;globalThis.fetch=async()=>new Response('no',{status:500});Deno.env.set('ADMIN_SECURITY_ENABLED','true');let failed=false;try{await authorizeKey(request({}),'legacy','legacy');}catch{failed=true;}finally{globalThis.fetch=old;Deno.env.delete('ADMIN_SECURITY_ENABLED');}assert(failed);});
Deno.test('request sizes are bounded and removed email actions are rejected',()=>withFetch(()=>ready,async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');for(const action of ['invalid','setup-send','setup-complete','change-send','change-complete'])assert((await handleAdminSecurity(request({action}))).status===400,action);assert((await handleAdminSecurity(request({action:'status',extra:'x'.repeat(5000)}))).status===413);}));
Deno.test('admin sessions open the class room; the removed class session kind opens nothing',()=>withFetch((_a,data)=>({kind:data?.candidate===undefined?'none':(globalThis as any).__kind}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  for(const [kind,route,expected] of [['session','class-room',true],['class','class-room',false],['class','kiosk-checkin',false],['kiosk','class-room',false],['webhook','class-room',false]] as const){
    (globalThis as any).__kind=kind;assert(await authorizeKey(new Request('https://mock.supabase.co/functions/v1/'+route),'test-only','')===expected,kind+' '+route);}}));
Deno.test('class room logs in with the admin password; class-set is gone',async()=>{const hash=await hashPassword('owner-pass-1');const logins:any[]=[];await withFetch((action,data)=>{if(action==='status')return ready;if(action==='owner')return {password_hash:hash,version:5,must_change:false};if(action==='login'){logins.push(data);return data.verified?{ok:true}:{error:'비밀번호가 올바르지 않습니다.',status:401};}if(action.startsWith('class-'))throw new Error('class actions were removed');return {ok:true};},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');
  const r=await handleAdminSecurity(request({action:'login',password:'owner-pass-1'}));const data=await r.json();assert(r.status===200&&/^[0-9a-f]{64}$/.test(data.session));
  const legacy=await handleAdminSecurity(request({action:'login',password:'owner-pass-1',scope:'class'}));assert(legacy.status===200,'an old class-room page still gets a normal admin session');
  assert(logins.map(l=>l.kind).join()==='admin,admin');
  assert((await handleAdminSecurity(request({action:'class-set',current_password:'owner-pass-1',class_password:'class-pass-1'},undefined,'s'))).status===400);});});

Deno.test('webhook DB links: new checklist names also find the old DB titles (v2.8.0 item 80)',async()=>{const {pickDbLink}=await import('../admin-security/index.ts');
  const u=(c:string)=>'https://www.notion.so/'+c.repeat(32);
  assert(pickDbLink({'청구서(학원)':u('a'),'교재비(학원)':u('b')},'청구서(학원)')===u('a'),'new title wins');
  assert(pickDbLink({'교재비(학원)':u('b')},'청구서(학원)')===u('b'));
  assert(pickDbLink({'청구(학원)':u('c')},'청구서(학원)')===u('c'));
  assert(pickDbLink({'교재배부(학원)':u('d')},'청구항목(학원)')===u('d'));
  assert(pickDbLink({'교재결제(학원)':u('e')},'청구결제(학원)')===u('e'));
  assert(pickDbLink({'진도교재(학원)':u('f')},'진도관리(학원)')===u('f'));
  assert(pickDbLink({},'청구서(학원)')==='');});
// ---------- (v2.8.0 항목 113) 외부 키: Vault 먼저 · 없으면 Secret, 열면 연결 상태가 보임(10분 다시 씀), 값은 어디에도 안 나감 ----------
{
const ek=await import('./externalKeys.ts');
const {neisRows}=await import('./neisSchool.ts');
const {searchTitle}=await import('./bookSources.ts');
const {KEY_RECHECK_MS}=await import('../admin-security/index.ts');
const FAKE='TEST-ONLY-FAKE-KEY-0000',FAKE2='TEST-ONLY-FAKE-KEY-1111',ENVK='TEST-ONLY-SECRET-KEY-9999';
// Vault 흉내: hada_external_key RPC만 받는다. 상대 서버(나이스 · 도서관)는 goodKey면 맞음, 아니면 틀림(down이면 500).
function fakeServer(vault:Record<string,{value:string,changed_at:string}>,opts:{down?:boolean,goodKey?:string,sourceDown?:boolean}={},checks:Record<string,any>={}){
  const seen:{url:string,body:string,auth:string}[]=[];
  const fn=(async(input:any,init:any)=>{const url=String(input),body=String(init?.body??''),auth=String(init?.headers?.Authorization??'');seen.push({url,body,auth});
    const j=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
    const good=opts.goodKey??'';
    if(url.includes('/rpc/hada_external_key')){if(opts.down)return new Response('x',{status:404});const b=JSON.parse(body),d=b.p_data??{};
      if(b.p_action==='read')return j({keys:Object.fromEntries(Object.entries(vault).map(([k,v])=>[k,v.value]))});
      if(b.p_action==='status')return j({keys:Object.fromEntries(Object.entries(vault).map(([k,v])=>[k,{changed_at:v.changed_at}])),checks});
      if(b.p_action==='set'){vault[d.name]={value:d.value,changed_at:'2026-11-23T05:00:00Z'};delete checks[d.name];return j({ok:true,changed_at:'2026-11-23T05:00:00Z'});}
      if(b.p_action==='checked'){checks[d.name]={source:d.source,state:d.state,checked_at:new Date().toISOString()};return j({ok:true,checked_at:checks[d.name].checked_at});}
      if(b.p_action==='clear'){delete vault[d.name];delete checks[d.name];return j({ok:true});}
      return j({error:'x',status:400});}
    if(url.includes('/rpc/hada_security_command')){const b=JSON.parse(body);if(b.p_action==='profile')return j({password_hash:'x',changed_at:'2026-11-01T00:00:00Z',version:2,must_change:opts.goodKey==='MUST'});return j({ok:true});}
    if(url.startsWith('https://open.neis.go.kr/')){if(opts.sourceDown)return j({},500);const k=new URL(url).searchParams.get('KEY');return k===good?j({schoolInfo:[{head:[{list_total_count:1},{RESULT:{CODE:'INFO-000'}}]},{row:[{SCHUL_NM:'예시중학교'}]}]}):j({RESULT:{CODE:'ERROR-290',MESSAGE:'인증키가 유효하지 않습니다.'}});}
    if(url.startsWith('https://www.nl.go.kr/')){if(opts.sourceDown)return j({},500);const k=new URL(url).searchParams.get('cert_key');return k===good?j({docs:[]}):j({RESULT:'ERROR',ERR_CODE:'011',ERR_MESSAGE:'유효하지 않은 인증키 값입니다.'});}
    return j({},404);}) as typeof fetch;
  return {fn,seen};
}
async function withServer(srv:{fn:typeof fetch},run:()=>Promise<void>){const old=fetch,logs:string[]=[];const oc={e:console.error,w:console.warn,l:console.log};
  const cap=(...a:unknown[])=>{logs.push(a.map(String).join(' '));};console.error=cap;console.warn=cap;console.log=cap;
  globalThis.fetch=srv.fn;ek.forgetExternalKeys();
  try{await run();}finally{globalThis.fetch=old;console.error=oc.e;console.warn=oc.w;console.log=oc.l;ek.forgetExternalKeys();Deno.env.delete('ADMIN_SECURITY_ENABLED');for(const n of [...ek.EXTERNAL_KEYS,'KAKAO_REST_KEY'])Deno.env.delete(n);}
  return logs;}
const noValue=(s:string)=>{for(const v of [FAKE,FAKE2,ENVK])assert(!s.includes(v),'value leaked: '+s.slice(0,200));assert(!/FAKE-KEY|SECRET-KEY/.test(s),'partial leak');};
const outside=(srv:{seen:{url:string}[]})=>srv.seen.filter(s=>!s.url.includes('/rpc/')).length;
Deno.test('external key: only NEIS and NL (Kakao removed in item 113)',()=>{assert(ek.EXTERNAL_KEYS.join()==='NEIS_API_KEY,NL_CERT_KEY');assert(!ek.isExternalKeyName('KAKAO_REST_KEY'));});
Deno.test('external key: Vault value first, Secret when Vault has none, Secret when the store is down',async()=>{
  const logs1=await withServer(fakeServer({NEIS_API_KEY:{value:FAKE,changed_at:'x'}}),async()=>{Deno.env.set('NEIS_API_KEY',ENVK);assert(await ek.externalKey('NEIS_API_KEY')===FAKE);assert(await ek.externalKeySource('NEIS_API_KEY')==='app');});
  await withServer(fakeServer({}),async()=>{Deno.env.set('NEIS_API_KEY',ENVK);assert(await ek.externalKey('NEIS_API_KEY')===ENVK);assert(await ek.externalKeySource('NEIS_API_KEY')==='secret');assert(await ek.externalKey('NL_CERT_KEY')==='');});
  const logs3=await withServer(fakeServer({},{down:true}),async()=>{Deno.env.set('NEIS_API_KEY',ENVK);assert(await ek.externalKey('NEIS_API_KEY')===ENVK);});
  for(const l of [...logs1,...logs3])noValue(l);});
Deno.test('external key: short cache, one store read per burst, a new key is used after the cache is cleared',async()=>{
  const vault:Record<string,any>={NL_CERT_KEY:{value:FAKE,changed_at:'x'}};const srv=fakeServer(vault);
  await withServer(srv,async()=>{await Promise.all([ek.externalKey('NL_CERT_KEY'),ek.externalKey('NEIS_API_KEY'),ek.externalKey('NL_CERT_KEY')]);
    assert(srv.seen.filter(s=>s.url.includes('hada_external_key')).length===1);
    vault.NL_CERT_KEY.value=FAKE2;assert(await ek.externalKey('NL_CERT_KEY')===FAKE,'cached within window');
    ek.forgetExternalKeys();assert(await ek.externalKey('NL_CERT_KEY')===FAKE2,'next request reads the new key');assert(ek.CACHE_MS<=5000);});});
Deno.test('NEIS and book search use the Vault key (Secret also set); book search never calls Kakao',async()=>{
  const srv=fakeServer({NEIS_API_KEY:{value:FAKE,changed_at:'x'},NL_CERT_KEY:{value:FAKE,changed_at:'x'}},{goodKey:FAKE});
  await withServer(srv,async()=>{for(const n of [...ek.EXTERNAL_KEYS,'KAKAO_REST_KEY'])Deno.env.set(n,ENVK);
    assert((await neisRows('schoolInfo',{SCHUL_NM:'예시'})).length===1);await searchTitle('예시 교재');
    const ext=srv.seen.filter(s=>!s.url.includes('/rpc/'));
    assert(ext.some(s=>new URL(s.url).searchParams.get('KEY')===FAKE));assert(ext.some(s=>new URL(s.url).searchParams.get('cert_key')===FAKE));
    assert(!ext.some(s=>s.url.includes('kakao')),'no Kakao call');assert(!ext.some(s=>s.url.includes(ENVK)),'Secret not used when Vault has a key');});});
Deno.test('NEIS and book search still work with Secret only (academies that never used the app keys)',async()=>{
  const srv=fakeServer({},{goodKey:ENVK});
  await withServer(srv,async()=>{for(const n of ek.EXTERNAL_KEYS)Deno.env.set(n,ENVK);
    assert((await neisRows('schoolInfo',{SCHUL_NM:'예시'})).length===1);await searchTitle('예시 교재');
    assert(outside(srv)===2&&srv.seen.filter(s=>!s.url.includes('/rpc/')).every(s=>s.url.includes(ENVK)));});});
const call=async(body:any,bodies:string[])=>{const r=await handleAdminSecurity(request(body,'https://admin.example.test','test-session'));const t=await r.text();bodies.push(t);return {status:r.status,data:JSON.parse(t)};};
Deno.test('admin keys: opening the page checks each key once and shows the state; within 10 minutes it reuses the result',async()=>{
  const vault:Record<string,any>={},checks:Record<string,any>={};const srv=fakeServer(vault,{goodKey:ENVK},checks);const bodies:string[]=[];
  const logs=await withServer(srv,async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');Deno.env.set('NEIS_API_KEY',ENVK);
    let s=await call({action:'keys-status',check:true},bodies);assert(s.status===200);
    assert(Object.keys(s.data.keys).join()==='NEIS_API_KEY,NL_CERT_KEY','no Kakao row');
    assert(s.data.keys.NEIS_API_KEY.source==='secret'&&s.data.keys.NEIS_API_KEY.state==='ok'&&s.data.keys.NEIS_API_KEY.checked_at,'secret key checked on open');
    assert(s.data.keys.NL_CERT_KEY.source===''&&s.data.keys.NL_CERT_KEY.state==='none','no key = none');
    assert(outside(srv)===1,'one outside call (NEIS only)');
    s=await call({action:'keys-status',check:true},bodies);assert(s.data.keys.NEIS_API_KEY.state==='ok'&&outside(srv)===1,'reused within 10 minutes');
    s=await call({action:'keys-status'},bodies);assert(s.data.keys.NEIS_API_KEY.state==='ok'&&outside(srv)===1,'plain status never calls outside');
    checks.NEIS_API_KEY.checked_at=new Date(Date.now()-KEY_RECHECK_MS-1000).toISOString();
    s=await call({action:'keys-status',check:true},bodies);assert(outside(srv)===2,'checked again after 10 minutes');
    let r=await call({action:'key-set',name:'NEIS_API_KEY',value:FAKE},bodies);assert(r.status===200&&r.data.test==='wrong'&&r.data.changed_at);
    s=await call({action:'keys-status',check:true},bodies);assert(s.data.keys.NEIS_API_KEY.source==='app'&&s.data.keys.NEIS_API_KEY.state==='wrong'&&outside(srv)===3,'saved app key: result from the save, no extra call');
    r=await call({action:'key-test',name:'NEIS_API_KEY'},bodies);assert(r.data.test==='wrong'&&r.data.source==='app'&&outside(srv)===4,'[연결 확인] always asks again');
    r=await call({action:'key-clear',name:'NEIS_API_KEY'},bodies);assert(r.data.ok&&r.data.secret===true&&!vault.NEIS_API_KEY);
    s=await call({action:'keys-status',check:true},bodies);assert(s.data.keys.NEIS_API_KEY.source==='secret'&&s.data.keys.NEIS_API_KEY.state==='ok'&&outside(srv)===5,'after delete: back to Secret, checked again');
    assert(await ek.externalKey('NEIS_API_KEY')===ENVK);
    r=await call({action:'key-set',name:'NL_CERT_KEY',value:ENVK},bodies);assert(r.data.test==='ok');
    for(const bad of [{action:'key-set',name:'KAKAO_REST_KEY',value:FAKE},{action:'key-set',name:'NOTION_TOKEN',value:FAKE},{action:'key-set',name:'NEIS_API_KEY',value:' '+FAKE},{action:'key-set',name:'NEIS_API_KEY',value:'short'},{action:'key-set',name:'NEIS_API_KEY',value:FAKE+'\n'},{action:'key-set',name:'NEIS_API_KEY'}]){const x=await call(bad,bodies);assert(x.status===400,JSON.stringify(bad).slice(0,40));}});
  for(const t of [...bodies,...logs])noValue(t);});
Deno.test('admin keys: other side down shows "unknown" and is asked again after a minute, not ten',async()=>{
  const checks:Record<string,any>={};const bodies:string[]=[];
  await withServer(fakeServer({},{sourceDown:true},checks),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');Deno.env.set('NL_CERT_KEY',ENVK);
    const s=await call({action:'keys-status',check:true},bodies);assert(s.data.keys.NL_CERT_KEY.state==='unknown');
    checks.NL_CERT_KEY.checked_at=new Date(Date.now()-61000).toISOString();
    const t=await call({action:'keys-status',check:true},bodies);assert(t.data.keys.NL_CERT_KEY.checked_at!==checks.x,'re-asked');assert(Date.now()-Date.parse(t.data.keys.NL_CERT_KEY.checked_at)<5000);});
  for(const t of bodies)noValue(t);});
Deno.test('admin keys: blocked on the initial password and without a session; store down gives a plain message',async()=>{
  await withServer(fakeServer({},{goodKey:'MUST'}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=await handleAdminSecurity(request({action:'key-set',name:'NEIS_API_KEY',value:FAKE},'https://admin.example.test','s'));assert(r.status===409);noValue(await r.text());});
  await withServer({fn:(async(input:any)=>String(input).includes('hada_security_command')?new Response(JSON.stringify({error:'다시 로그인해 주세요.',status:401})):new Response('{}')) as typeof fetch},async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=await handleAdminSecurity(request({action:'keys-status',check:true}));assert(r.status===401);});
  const logs=await withServer(fakeServer({},{down:true}),async()=>{Deno.env.set('ADMIN_SECURITY_ENABLED','true');const r=await handleAdminSecurity(request({action:'key-set',name:'NEIS_API_KEY',value:FAKE},'https://admin.example.test','s'));assert(r.status===503);const t=await r.text();noValue(t);assert(/키 저장소/.test(t));});
  for(const l of logs)noValue(l);});
}
// (v2.8.0, 261123 대표 "0000 비밀번호로 예시 데이터 비우기 / 한번 진행하고 나면 막히도록") 초기 비밀번호 세션은 예시 데이터 비우기만 더 받는다.
// 가짜 서버: SQL(hada_security_command)은 실제 규칙대로 — must_change면 authorize는 늘 none, profile은 관리자 세션만(키오스크 거절).
{
  const {handleClearExampleData}=await (async()=>{const old=Deno.serve;(Deno as any).serve=()=>({});try{return await import('../clear-example-data/index.ts');}finally{(Deno as any).serve=old;}})();
  const {authorizeInitialSetup,INITIAL_SETUP_ROUTES,SECURITY_BROWSER_ROUTES}=await import('./adminSecurity.ts');
  const INIT=('a'.repeat(64)),KIOSK=('b'.repeat(64)),FAKE_WS='예시 학원';
  type World={mustChange:boolean,flag:any,writes:any[],queued:any[],rpc:string[]};
  const world=(over:Partial<World>={}):World=>({mustChange:true,flag:null,writes:[],queued:[],rpc:[],...over});
  async function sessionsOf(){return {admin:await sha256(INIT),kiosk:await sha256(KIOSK)};}
  async function withWorld(w:World,run:()=>Promise<void>){
    const s=await sessionsOf();const old=fetch;
    globalThis.fetch=(async(input:any,init:any)=>{
      const url=String(input),method=init?.method??'GET',body=init?.body?JSON.parse(init.body):null,j=(v:unknown,st=200)=>new Response(JSON.stringify(v),{status:st,headers:{'Content-Type':'application/json'}});
      if(url.includes('/rpc/hada_security_command')){
        const a=body.p_action,d=body.p_data??{};w.rpc.push(a);
        if(a==='internal')return j({internal_key:'f'.repeat(64)});
        if(a==='authorize'){if(w.mustChange)return j({kind:'none'});if(d.candidate===s.admin)return j({kind:'session'});if(d.candidate===s.kiosk)return j({kind:'kiosk'});return j({kind:'none'});}
        if(d.session_hash!==s.admin)return j({error:'다시 로그인해 주세요.',status:401});
        if(a==='profile')return j({password_hash:'x',changed_at:'2026-11-23T00:00:00Z',version:1,must_change:w.mustChange});
        if(a.startsWith('webhook-')&&w.mustChange)return j({error:'초기 비밀번호를 먼저 변경해 주세요.',status:409});
        return j({ok:true});
      }
      if(url.includes('/rest/v1/hada_setup_flags')){
        if(method==='GET')return j(w.flag?[{value:w.flag,updated_at:'2026-11-23T00:00:00Z'}]:[]);
        w.writes.push(body);const v=Array.isArray(body)?body[0].value:body.value;
        if(method==='PATCH'){if(w.flag?.state!=='running')return j([]);w.flag=v;return j([{}]);}
        w.flag=v;return new Response(null,{status:201});
      }
      if(url.includes('/rest/v1/sync_queue')){w.queued.push(body);return new Response(null,{status:201});}
      if(url.includes('/users/me'))return j({bot:{workspace_name:FAKE_WS}});
      if(url.includes('/search'))return j({results:[],has_more:false});
      if(url.includes('/functions/v1/process-sync-queue'))return j({ok:true});
      return j({});
    }) as typeof fetch;
    try{Deno.env.set('ADMIN_SECURITY_ENABLED','true');await run();await new Promise(r=>setTimeout(r,20));}finally{globalThis.fetch=old;Deno.env.delete('ADMIN_SECURITY_ENABLED');}
  }
  const clear=(body:any,key=INIT)=>handleClearExampleData(new Request('https://mock.supabase.co/functions/v1/clear-example-data',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':key},body:JSON.stringify(body)}));
  const opts={sanitizeOps:false,sanitizeResources:false};
  Deno.test({...opts,name:'0000 session: example clear state · start · stop are open (workspace name still required)',fn:()=>{const w=world();return withWorld(w,async()=>{
    const st=await clear({action:'state'});const sd=await st.json();assert(st.status===200&&sd.canStart===true&&sd.flag===null,JSON.stringify(sd));
    const bad=await clear({action:'start',workspace:'다른 이름',dbs:['출석(학원) DB']});assert(bad.status===400&&w.writes.length===0&&w.queued.length===0);
    const ok=await clear({action:'start',workspace:FAKE_WS,dbs:['출석(학원) DB']});const od=await ok.json();assert(ok.status===200&&od.state==='running'&&w.queued.length===1,JSON.stringify(od));
    // (261123 안A) 0000은 고르지 못한다: 출석 하나만 보내도 비울 DB 전부(남기는 칸 keep 없음), state · status는 full:true
    assert(Array.isArray(od.keep)&&od.keep.length===0,'0000 start keeps nothing: '+JSON.stringify(od.keep));assert(sd.full===true);
    const fs0=await (await clear({action:'status'})).json();assert(fs0.full===true,JSON.stringify(fs0));
    const stop=await clear({action:'stop'});assert(stop.status===200&&(await stop.json()).flag.state==='stopped');
    assert(w.rpc.includes('profile'));});}});
  Deno.test({...opts,name:'0000 session: no other route or admin action opens',fn:()=>{const w=world();return withWorld(w,async()=>{
    for(const route of [...SECURITY_BROWSER_ROUTES].filter(r=>r!=='clear-example-data').concat(['generate-classes','process-sync-queue','send-report','toggle-report-link','admin-security'])){
      const r=new Request(`https://mock.supabase.co/functions/v1/${route}`);
      assert(!await authorizeKey(r,INIT,''),'authorizeKey '+route);assert(!await authorizeInitialSetup(r,INIT),'initial '+route);}
    assert(INITIAL_SETUP_ROUTES.size===1&&INITIAL_SETUP_ROUTES.has('clear-example-data'));
    for(const body of [{action:'keys-status'},{action:'key-set',name:'NEIS_API_KEY',value:'test-only-value-123'},{action:'key-test',name:'NEIS_API_KEY'},{action:'key-clear',name:'NEIS_API_KEY'},{action:'webhook-status'},{action:'webhook-links'},{action:'root-title'},{action:'webhook-check',item:'x',checked:true},{action:'webhook-finish'}]){
      const r=await handleAdminSecurity(request(body,'https://admin.example.test',INIT));assert(r.status===409,body.action+' '+r.status);}
    // 비밀번호 바꾸기 길(profile)은 그대로 열려 있다.
    assert((await handleAdminSecurity(request({action:'profile'},'https://admin.example.test',INIT))).status===200);});}});
  Deno.test({...opts,name:'0000 path is closed to kiosk sessions, unknown tokens, legacy mode and changed passwords',fn:async()=>{
    const w=world();await withWorld(w,async()=>{
      for(const key of [KIOSK,'c'.repeat(64),'','0000','not-hex-'+'a'.repeat(56)]){const r=await clear({action:'state'},key);assert(r.status===401,key+' '+r.status);}
      // 64자리 hex가 아닌 값은 서버에 묻지도 않는다(profile은 KIOSK · 'c'… 두 번만).
      assert(w.rpc.filter(a=>a==='profile').length===2,w.rpc.join());});
    // 비밀번호를 정한 뒤(must_change=false): 0000 길은 닫히고 보통 관리자 세션 규칙만 남는다.
    const after=world({mustChange:false});await withWorld(after,async()=>{const r=new Request('https://mock.supabase.co/functions/v1/clear-example-data');assert(!await authorizeInitialSetup(r,INIT));assert((await clear({action:'state'},KIOSK)).status===401);const st=await (await clear({action:'state'})).json();assert(st.full===false);
      // 새 비밀번호로 로그인한 관리자는 지금처럼 고른다(출석만 → 나머지는 keep)
      const ok=await (await clear({action:'start',workspace:FAKE_WS,dbs:['출석(학원) DB']})).json();assert(ok.keep.length>0&&!ok.keep.includes('출석(학원) DB'),JSON.stringify(ok.keep));
      assert((await (await clear({action:'status'})).json()).full===undefined);});
    Deno.env.delete('ADMIN_SECURITY_ENABLED');assert(!await authorizeInitialSetup(new Request('https://mock.supabase.co/functions/v1/clear-example-data'),INIT));}});
  Deno.test({...opts,name:'after one finished clear (done) or on a running academy (locked), start is refused for 0000 and for a changed password',fn:async()=>{
    for(const state of ['done','locked']){
      for(const mustChange of [true,false]){
        const w=world({mustChange,flag:{state,done:12,finishedAt:'2026-11-23T00:00:00Z'}});
        await withWorld(w,async()=>{
          const st=await (await clear({action:'state'})).json();assert(st.canStart===false,state);
          const r=await clear({action:'start',workspace:FAKE_WS,dbs:['출석(학원) DB']});assert(r.status===409,`${state} ${mustChange} ${r.status}`);
          assert(w.queued.length===0&&w.writes.length===0&&w.flag.state===state);});
      }
    }}});
}
