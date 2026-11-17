// 관리 앱 읽기 복사본 마이그레이션(v2.8.0 항목 74) 검사. PGlite에 pg_cron·pg_net·Vault 대신 기록만 하는 가짜를 두고
// 표 · 잠금(RLS) · 건수 함수 · 예약 3개와 부르는 본문을 확인한다. 실제 DB·네트워크·비밀값 없음.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const assert=require('node:assert/strict'),fs=require('fs');
(async()=>{
const db=new PGlite();
await db.exec(`create role anon; create role authenticated;
create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(n,s,c) on conflict(jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;
create schema net; create table net.calls(id serial, url text, headers jsonb, body jsonb, timeout int);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net.calls(url,headers,body,timeout) values(url,headers,body,timeout_milliseconds) returning id::bigint $$;
create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text); insert into vault.decrypted_secrets values('sync_queue_admin_key','test-only-key');
create table public.sync_cursors(source text primary key, last_synced_at timestamptz not null);`);
await db.exec(fs.readFileSync('supabase/migrations/20261014060000_class_room_copy_cron.sql','utf8'));
const sql=fs.readFileSync('supabase/migrations/20261117010000_app_copy.sql','utf8');
await db.exec(sql);await db.exec(sql); // 다시 적용해도 겹치지 않는다
const every5=fs.readFileSync('supabase/migrations/20261118010000_app_copy_incremental_5min.sql','utf8');
await db.exec(every5);await db.exec(every5); // 사본 간격 5분(2.8), 다시 적용해도 하나
const jobs=(await db.query("select jobname,schedule from cron.job where jobname like 'app-copy%' order by jobname")).rows.map(r=>r.jobname+' '+r.schedule);
assert.deepEqual(jobs,['app-copy-first-fill */3 * * * *','app-copy-incremental */5 * * * *','app-copy-reconcile */3 18-19 * * *']);
const run=async n=>{const c=(await db.query('select command from cron.job where jobname=$1',[n])).rows[0].command;await db.query(c);return (await db.query('select url,headers,body from net.calls order by id desc limit 1')).rows[0];};
for(const [n,step] of [['app-copy-first-fill','fill'],['app-copy-incremental','incremental'],['app-copy-reconcile','reconcile-next']]){
 const c=await run(n);assert.equal(c.url,'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/sync-class-room-copy');
 assert.deepEqual(c.body,{mode:'app',step});assert.equal(c.headers['x-admin-key'],'test-only-key');
}
await db.query(`insert into public.app_rows(id,db,props,notion_edited_at) values('a','학생(학원) DB','{"이름":"하다"}',now()),('b','학생(학원) DB','{}',now()),('c','클래스(학원) DB','{}',now())`);
const counts=Object.fromEntries((await db.query('select db,n from public.app_rows_counts()')).rows.map(r=>[r.db,Number(r.n)]));
assert.deepEqual(counts,{'학생(학원) DB':2,'클래스(학원) DB':1});
assert.equal((await db.query("select relrowsecurity from pg_class where relname='app_rows'")).rows[0].relrowsecurity,true,'RLS on, no policies');
const grants=(await db.query("select count(*)::int n from information_schema.routine_privileges where routine_name='app_rows_counts' and grantee in ('anon','authenticated','PUBLIC')")).rows[0].n;
assert.equal(grants,0,'counts function not callable by anon/authenticated');
// 민감 칸 지우기(20261117020000): 이미 들어간 줄에서 토큰·웹훅 칸만 빠지고 다른 칸은 그대로, 다시 적용해도 같다
await db.query(`insert into public.app_rows(id,db,props,notion_edited_at) values('t','등록(학원) DB','{"이름":"예시","토큰":"x","웹훅 링크":"y","등록일":{"start":"2026-11-01"}}',now())`);
const skip=fs.readFileSync('supabase/migrations/20261117020000_app_copy_skip_props.sql','utf8');
await db.exec(skip);await db.exec(skip);
assert.deepEqual((await db.query("select props from public.app_rows where id='t'")).rows[0].props,{'이름':'예시','등록일':{start:'2026-11-01'}});
assert.deepEqual((await db.query("select props from public.app_rows where id='a'")).rows[0].props,{'이름':'하다'});
console.log('App copy migration passed: app_rows with RLS, counts function service-only, 3 jobs re-apply safe, bodies mode=app fill/incremental/reconcile-next with Vault key');
})().catch(e=>{console.error(e);process.exit(1)});
