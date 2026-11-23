// 강사별 관리 앱 계정(강사계정 261123): hada_teacher_command를 격리된 PostgreSQL(PGlite)에서 시험한다.
// 원장 보안 마이그레이션을 차례로 올린 뒤 새 마이그레이션을 올린다. 비밀값 · 네트워크 없음.
// 실행: PGLITE_MODULE=<pglite 경로> node tests/teacher-accounts-sql.cjs (admin-security-sql.cjs 끝에서도 부른다)
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const assert=require('node:assert/strict'),fs=require('fs');
module.exports=(async()=>{
const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text,secret text);
create function vault.create_secret(value text,label text) returns uuid language plpgsql as $$ declare x uuid; begin insert into vault.secrets(name,secret) values(label,value) returning id into x;return x;end $$;
create function vault.update_secret(x uuid,value text) returns void language plpgsql as $$ begin update vault.secrets set secret=value where id=x;end $$;`);
const migrations=['20261011010000_admin_security.sql','20261012010000_admin_password_simplify.sql','20261012020000_admin_security_safeupdate.sql','20261013010000_webhook_key_rotation.sql','20261013020000_webhook_checklist.sql','20261014010000_class_password.sql','20261014020000_unify_admin_password.sql','20261124010000_teacher_accounts.sql'];
for(const f of migrations)await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
// Supabase safeupdate: 새 함수의 DELETE/UPDATE는 모두 WHERE가 있어야 한다(정적 확인).
const src=fs.readFileSync('supabase/migrations/20261124010000_teacher_accounts.sql','utf8').replace(/--[^\n]*/g,'');
const unsafe=[...src.matchAll(/\b(delete\s+from|update)\s[^;]*;/gi)].map(m=>m[0]).filter(s=>!/\bwhere\b/i.test(s));
if(unsafe.length)throw new Error('DELETE/UPDATE without WHERE: '+unsafe.join(' | '));
let checks=0;const ok=(a,b)=>{assert.deepEqual(a,b);checks++};
const h=x=>x.repeat(64),pw=d=>'pbkdf2-sha256$600000$'+'1'.repeat(32)+'$'+d.repeat(64);
const own=async(action,data={})=>(await db.query('select public.hada_security_command($1,$2::jsonb) as r',[action,JSON.stringify(data)])).rows[0].r;
const t=async(action,data={})=>(await db.query('select public.hada_teacher_command($1,$2::jsonb) as r',[action,JSON.stringify(data)])).rows[0].r;
const raw=async q=>(await db.query(q)).rows;
const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32);
// 권한: anon · authenticated는 함수 · 표를 못 쓴다.
ok((await raw("select has_function_privilege('anon','public.hada_teacher_command(text,jsonb)','execute') as x"))[0].x,false);
ok((await raw("select has_function_privilege('service_role','public.hada_teacher_command(text,jsonb)','execute') as x"))[0].x,true);
ok((await raw("select has_table_privilege('authenticated','public.hada_teacher_accounts','select') as x"))[0].x,false);
// 1) 원장 보안 초기 설정 전 · 원장 초기 비밀번호 상태에서는 강사 로그인 막힘.
ok((await t('account',{phone:'01012345678'})).status,409);
await own('init',{password_hash:pw('2'),internal_key:h('d'),internal_hash:h('d'),webhook_hash:h('c')});
ok((await t('account',{phone:'01012345678'})).status,409); // must_change(0000)
// 원장 비밀번호를 바꾼 상태로(원장 흐름은 손대지 않고 그대로 씀)
await own('login',{verified:true,version:1,token_hash:h('e'),kind:'admin'});
ok((await own('change',{session_hash:h('e'),expected_version:1,password_hash:pw('3'),internal_key:h('f'),internal_hash:h('f')})).ok,true);
const ownerVersion=(await own('owner')).version;
// 2) 켜기: 형식 · 같은 번호 막기.
ok((await t('enable',{teacher_id:A,phone:'010-1234-5678',password_hash:pw('4')})).status,400);
ok((await t('enable',{teacher_id:A,phone:'01012345678',name:'예시강사A',password_hash:pw('4')})).created,true);
ok((await t('enable',{teacher_id:B,phone:'01012345678',password_hash:pw('5')})).status,409);
ok((await t('enable',{teacher_id:B,phone:'01099998888',name:'예시강사B',password_hash:pw('5')})).created,true);
ok((await t('list')).accounts.map(a=>[a.teacher_id,a.enabled,a.must_change,a.locked]),[[A,true,true,false],[B,true,true,false]]);
assert(!JSON.stringify(await t('list')).includes('pbkdf2'));checks++;
// 3) 로그인: 없는 번호 · 꺼진 계정은 found:false(같은 말), 맞으면 세션(must_change).
ok((await t('account',{phone:'01000000000'})).found,false);
let acc=await t('account',{phone:'01012345678'});ok([acc.found,acc.teacher_id,acc.must_change],[true,A,true]);
ok((await t('login',{teacher_id:A,verified:true,version:acc.version,token_hash:h('1'),notion_users:['u-a']})).ok,true);
let s=await t('session',{session_hash:h('1')});ok([s.kind,s.teacher_id,s.must_change,s.notion_users],['teacher',A,true,['u-a']]);
// 강사 세션은 원장 authorize에서 'none'(원장 경로 전부 거절), 원장 profile도 401.
ok((await own('authorize',{candidate:h('1')})).kind,'none');
ok((await own('profile',{session_hash:h('1')})).status,401);
// 4) 비밀번호 바꾸기: 판이 맞아야, 바꾸면 그 강사 세션 모두 끊김 · must_change false.
ok((await t('change',{session_hash:h('1'),expected_version:acc.version+5,password_hash:pw('6')})).status,409);
ok((await t('change',{session_hash:h('1'),expected_version:acc.version,password_hash:pw('6')})).ok,true);
ok((await t('session',{session_hash:h('1')})).status,401);
acc=await t('account',{phone:'01012345678'});ok([acc.must_change,acc.password_hash],[false,pw('6')]);
ok((await t('login',{teacher_id:A,verified:true,version:acc.version,token_hash:h('2'),notion_users:['u-a']})).ok,true);
ok((await t('session',{session_hash:h('2')})).must_change,false);
// 5) 잠김: B가 다섯 번 틀리면 B만 잠김. A · 원장은 그대로.
const accB=await t('account',{phone:'01099998888'});
for(let i=0;i<4;i++)ok((await t('login',{teacher_id:B,verified:false,version:accB.version})).status,401);
ok((await t('account',{phone:'01099998888'})).found,true);
ok((await t('login',{teacher_id:B,verified:false,version:accB.version})).status,401);
ok((await t('account',{phone:'01099998888'})).status,429);
ok((await t('login',{teacher_id:B,verified:true,version:accB.version,token_hash:h('3')})).status,429);
ok((await t('account',{phone:'01012345678'})).found,true);           // A 그대로
ok((await t('session',{session_hash:h('2')})).teacher_id,A);
ok((await own('owner')).version,ownerVersion);                          // 원장 잠김 없음
assert(!(await own('owner')).status);checks++;
ok((await raw("select login_failures from public.hada_security_state"))[0].login_failures,0);
ok((await t('list')).accounts.find(a=>a.teacher_id===B).locked,true);
// 6) 되돌리기: 잠김 풀림 · 첫 비밀번호 · 판 올림 · 세션 끊김. 다른 강사 번호로는 못 바꿈.
ok((await t('reset',{teacher_id:B,phone:'01012345678',password_hash:pw('7')})).status,409);
ok((await t('reset',{teacher_id:C,phone:'01011112222',password_hash:pw('7')})).status,404);
ok((await t('reset',{teacher_id:B,phone:'01099998888',password_hash:pw('7')})).ok,true);
const accB2=await t('account',{phone:'01099998888'});ok([accB2.found,accB2.must_change,accB2.password_hash,accB2.version],[true,true,pw('7'),accB.version+1]);
// 7) 끄기: 세션 끊김, 로그인 안 됨(found:false). 다시 켜면 비밀번호 그대로.
ok((await t('disable',{teacher_id:A})).ok,true);
ok((await t('session',{session_hash:h('2')})).status,401);
ok((await t('account',{phone:'01012345678'})).found,false);
ok((await t('login',{teacher_id:A,verified:true,version:acc.version,token_hash:h('4')})).status,401);
ok((await t('enable',{teacher_id:A,phone:'01012345678',password_hash:pw('9')})).created,false);
acc=await t('account',{phone:'01012345678'});ok([acc.found,acc.password_hash,acc.must_change],[true,pw('6'),false]);
// 8) 세션 12시간 · 로그아웃.
ok((await t('login',{teacher_id:A,verified:true,version:acc.version,token_hash:h('5'),notion_users:[]})).ok,true);
ok((await t('logout',{session_hash:h('5')})).ok,true);
ok((await t('session',{session_hash:h('5')})).status,401);
ok((await t('login',{teacher_id:A,verified:true,version:acc.version,token_hash:h('6'),notion_users:[]})).ok,true);
await db.exec(`update public.hada_teacher_sessions set expires_at=now()-interval '1 second' where token_hash='${h('6')}'`);
ok((await t('session',{session_hash:h('6')})).status,401);
// 9) 원장 비밀번호 초기화(배포 관리자 reset) 중에는 강사도 막힘.
await own('reset');
ok((await t('account',{phone:'01012345678'})).status,409);
ok((await t('session',{session_hash:h('6')})).status,409);
console.log(`teacher accounts SQL: ${checks} checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;throw e;});
