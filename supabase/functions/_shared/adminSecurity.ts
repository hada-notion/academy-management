// Server-only owner authentication. Never return internal or webhook keys to a browser.
export const SECURITY_WEBHOOK_ROUTES = new Set([
  'cascade-delete','create-assignment','create-class-reports','create-learning-record','fill-record-units','fix-attendance',
  'generate-classes',
  'send-report','send-daily-report','send-lesson-notice','send-monthly-notice','send-schedule-notice','send-tuition-notice',
  'send-textbook-notice','send-inquiry-receipt',
  'sync-attendance','sync-class-report-cache','sync-class-room-copy','sync-dashboard-link',
  'sync-registration-textbook','sync-report-cache',
  'sync-school-calendar','sync-textbook-distribution','toggle-report-link',
  // (2.8, 261118) 시험정보 [시험 기간 연결].
  'link-exam-period',
  // (v2.8.0, 261111) 웹훅 길잡이: 모든 Notion 버튼·자동화가 같은 주소로 보내면 기존 함수로 넘긴다(관리자 설정 체크리스트 항목은 아님).
  'notion-router',
]);
// Only routes a logged-in admin page actually calls (kiosk, legal documents, school/textbook search). Notion-only
// functions such as toggle-report-link take the webhook key, never a browser session (sync-school-calendar also takes an admin browser session since v2.8.0 item 112),
// so a leaked browser session cannot reach them (v2.5.51).
export const SECURITY_BROWSER_ROUTES = new Set([
  'list-students','kiosk-checkin','get-legal-document-data','school-api','textbook-api','class-room','clear-example-data',
  // (v2.8.0 항목 74) 관리 앱 읽기: 복사본(app_rows) 목록만 돌려준다. Notion에 쓰지 않는다.
  'app-api',
  // (v2.8.0 항목 112, 261123) 관리 앱 [학교 › 학사일정 가져오기]: 노션 학교 버튼과 같은 start를 관리자 로그인으로 부른다.
  // 관리자 세션(admin)만 — 키오스크 세션은 아래 kind 'kiosk' 규칙이라 여전히 못 부른다. 웹훅 키로 부르는 노션 버튼도 그대로.
  'sync-school-calendar',
]);
export function securityEnabled(): boolean { return Deno.env.get('ADMIN_SECURITY_ENABLED') === 'true'; }
export class SecurityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function securityRpc(action: string, data: Record<string, unknown> = {}): Promise<any> {
  const base = Deno.env.get('SB_URL'), key = Deno.env.get('SB_SERVICE_ROLE_KEY');
  if (!base || !key) throw new SecurityError(503, '관리자 인증 서버 설정이 필요합니다.');
  const res = await fetch(`${base.replace(/\/$/,'')}/rest/v1/rpc/hada_security_command`, {
    method: 'POST', headers: { 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}` },
    body: JSON.stringify({p_action:action,p_data:data}), signal:AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // Database error text (e.g. "DELETE requires a WHERE clause") goes to the function log only; it holds
    // no request values. The browser keeps the generic message.
    console.error('hada_security_command failed', action, res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw new SecurityError(503, '관리자 인증 저장소에 연결하지 못했습니다.');
  }
  const result = await res.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new SecurityError(503, '관리자 인증 응답 형식이 올바르지 않습니다.');
  if (result.error) throw new SecurityError(result.status ?? 400, result.error);
  return result;
}
export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function sha256(value:string):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
}
export function equalSecret(a:string,b:string):boolean {
  const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++)diff|=(aa[i]??0)^(bb[i]??0);
  return diff===0;
}
// Published initial password. It only opens the password-change screen (must_change) and the one-time
// example-data clear (authorizeInitialSetup); it is never accepted by business pages. The deploy manager can reset an academy back to it.
export const INITIAL_PASSWORD='0000';
export function validatePassword(raw:unknown):string {
  if(typeof raw!=='string'||raw.length<8||raw.length>128||raw.trim()!==raw)throw new SecurityError(400,'비밀번호는 앞뒤 공백 없이 8~128자로 입력해 주세요.');
  if(raw===INITIAL_PASSWORD)throw new SecurityError(400,'초기 비밀번호와 다른 비밀번호를 입력해 주세요.');
  return raw;
}
// Fixed webhook key kept in Edge Function Secrets (Notion button/automation headers).
export function fixedWebhookKey():string {
  const key=Deno.env.get('WEBHOOK_SECRET')||Deno.env.get('ADMIN_SECRET')||'';
  if(!key)throw new SecurityError(503,'웹훅 키(ADMIN_SECRET) 설정이 필요합니다.');
  return key;
}
// Creates the owner state on first use (initial password, internal key, Vault, webhook hash) and
// re-applies the initial password after a deploy-manager reset. Idempotent and serialized in SQL.
export async function ensureInitialized():Promise<void> {
  const state=await securityRpc('status');
  if(state.initialized&&state.password_set)return;
  const internalKey=randomToken();
  await securityRpc('init',{password_hash:await hashPassword(INITIAL_PASSWORD),internal_key:internalKey,internal_hash:await sha256(internalKey),webhook_hash:await sha256(fixedWebhookKey())});
}
export async function hashPassword(password:string,salt=randomToken(16)):Promise<string> {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:600000,hash:'SHA-256'},key,256);
  const digest=Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
  return `pbkdf2-sha256$600000$${salt}$${digest}`;
}
export async function verifyPassword(password:unknown,encoded:string):Promise<boolean> {
  if(typeof password!=='string'||password.length>128)return false;
  if(!/^pbkdf2-sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(encoded))return false;
  return equalSecret(await hashPassword(password,encoded.split('$')[2]),encoded);
}
// The function name, not the last path segment: several functions use sub-routes
// (sync-registration-textbook/create-class, sync-textbook-distribution/from-cart), and an appended
// segment must not let a key borrow another function's scope (e.g. /process-sync-queue/kiosk-checkin).
// Only a LEADING /functions/v1 is stripped; searching for it later in the path would let a caller
// append /functions/v1/<allowed-route> after the real function name and borrow that route's scope.
export function routeName(req:Request):string {
  const parts=new URL(req.url).pathname.split('/').filter(Boolean);
  return (parts[0]==='functions'&&parts[1]==='v1'?parts[2]:parts[0])??'';
}
export async function authorizeKey(req:Request,provided:unknown,legacy:string):Promise<boolean> {
  if(typeof provided!=='string'||!provided||provided.length>1024)return false;
  if(!securityEnabled())return !!legacy && equalSecret(provided,legacy);
  const candidate=await sha256(provided),route=routeName(req);
  // Lets the server count webhook calls per function during a webhook key rotation. Only known webhook
  // routes are sent so arbitrary paths cannot fill the usage table.
  const data={candidate,route:SECURITY_WEBHOOK_ROUTES.has(route)?route:''};
  let result=await securityRpc('authorize',data);
  // First request after activation (often a Notion webhook) creates the owner state.
  if(result.kind==='uninitialized'){await ensureInitialized();result=await securityRpc('authorize',data);}
  if(result.kind==='internal')return true;
  if(result.kind==='session')return SECURITY_BROWSER_ROUTES.has(route);
  if(result.kind==='webhook')return SECURITY_WEBHOOK_ROUTES.has(route);
  // Long-lived kiosk sessions: check-in and the minimal directory only (the full list exposes report tokens).
  if(result.kind==='kiosk')return route==='kiosk-checkin'||(route==='list-students'&&new URL(req.url).searchParams.get('kiosk')==='1');
  return false;
}
// (v2.8.0, 261123 대표 "0000 비밀번호로 예시 데이터 비우기") 설치 때 하다랩이 비밀번호를 바꾸지 않고 예시 데이터를 비울 수 있게,
// 초기 비밀번호(must_change) 상태의 관리자 세션은 예시 데이터 비우기(clear-example-data) 한 곳만 더 받는다.
// SQL authorize는 must_change일 때 모든 세션을 'none'으로 돌려주므로 그대로 두고, 여기서 profile(관리자 세션 확인 — 키오스크 세션은 거절)로
// must_change인지 본다. must_change가 아니면 false(그때는 authorizeKey가 이미 정상 판단함). 비우기는 한 번 끝나면 서버가 잠근다(exampleClear.ts).
export const INITIAL_SETUP_ROUTES=new Set(['clear-example-data']);
export async function authorizeInitialSetup(req:Request,provided:unknown):Promise<boolean> {
  if(!securityEnabled()||!INITIAL_SETUP_ROUTES.has(routeName(req)))return false;
  if(typeof provided!=='string'||!/^[0-9a-f]{64}$/.test(provided))return false;
  try{const ctx=await securityRpc('profile',{session_hash:await sha256(provided)});return ctx?.must_change===true;}catch(_){return false;}
}
export async function currentInternalKey():Promise<string> {
  let state=await securityRpc('internal');
  if(!state.internal_key){await ensureInitialized();state=await securityRpc('internal');}
  if(!state.internal_key)throw new SecurityError(503,'관리자 보안 초기 설정을 완료하지 못했습니다.');
  return state.internal_key;
}
export function nextRecommended(iso:string):string {
  const value=new Date(iso);const day=value.getUTCDate();value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+3);
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();value.setUTCDate(Math.min(day,last));return value.toISOString();
}
