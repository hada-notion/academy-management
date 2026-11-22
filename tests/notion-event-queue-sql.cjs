// 노션 웹훅 반영 대기열 마이그레이션(20261123020000) 검사. PGlite에 pg_cron · pg_net · Vault 대신 기록만 하는 가짜를 둔다.
// 같은 이벤트 한 번만, 같은 줄 합치기 · 처리 중 새 이벤트(seq), 임대 하나만, 실패 재시도 · 6번이면 failed, 예약(폴링 15분) 확인.
// 실제 DB · 네트워크 · 비밀값 없음.
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
for(const f of ['20261014060000_class_room_copy_cron.sql','20261117010000_app_copy.sql','20261118010000_app_copy_incremental_5min.sql','20261123010000_notion_webhook_events.sql']){
 await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
}
const sql=fs.readFileSync('supabase/migrations/20261123020000_notion_event_queue.sql','utf8');
const q=async(s,p=[])=>(await db.query(s,p)).rows;
const one=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
const sched=async n=>one('select schedule from cron.job where jobname=$1',[n]);
// 웹훅 구독(확인 토큰)이 없는 학원: 폴링은 5분 그대로
await db.exec(sql);
assert.equal(await sched('app-copy-incremental'),'*/5 * * * *','구독 없으면 그대로');
assert.equal(await sched('class-room-copy-incremental'),'*/5 * * * *','구독 없으면 그대로');
// 구독이 확인된 원본: 15분(다시 적용해도 같다)
await db.exec("insert into public.notion_webhook_tokens(token) values('test-only-token')");
await db.exec(sql);await db.exec(sql);
assert.equal(await sched('app-copy-incremental'),'*/15 * * * *');
assert.equal(await sched('class-room-copy-incremental'),'*/15 * * * *');
assert.equal(await sched('notion-events-drain'),'* * * * *');
assert.equal(await sched('notion-events-prune'),'40 17 * * *');
assert.equal(await sched('app-copy-reconcile'),'*/3 18-19 * * *','밤 대조 그대로');
assert.equal(await sched('class-room-copy-reconcile-sessions'),'0 18 * * *','밤 대조 그대로');
assert.match(await one("select command from cron.job where jobname='app-copy-incremental'"),/"mode":"app","step":"incremental"/);
assert.match(await one("select command from cron.job where jobname='class-room-copy-incremental'"),/class_room_copy_incremental_step/);

const enq=(ev,page,type,t,bot=false,delay=0)=>one('select public.notion_event_enqueue($1,$2,$3,$4,$5::timestamptz,$6,$7)',[ev,page,'ds-1',type,t,bot,delay]);
// 할 일이 없으면 예약이 함수를 부르지 않는다
assert.equal(await one('select public.notion_events_drain_step()'),'idle');
assert.equal(await one('select count(*)::int from net.calls'),0);
// 같은 이벤트 id는 한 번만
assert.equal(await enq('e1','p1','page.created','2026-11-23T01:00:00Z'),'queued');
assert.equal(await enq('e1','p1','page.created','2026-11-23T01:00:00Z'),'duplicate');
// 같은 줄의 이벤트는 합친다. 늦은 시각이 남고, 먼저 일어난 이벤트가 늦게 와도 시각은 뒤로 가지 않는다
assert.equal(await enq('e2','p1','page.properties_updated','2026-11-23T01:00:05Z',true),'queued');
assert.equal(await enq('e0','p1','page.deleted','2026-11-23T00:59:00Z'),'queued');
let r=(await q("select event_type,event_time,events,seq,own_bot from public.notion_event_queue where page_id='p1'"))[0];
assert.equal(r.event_type,'page.properties_updated');assert.equal(new Date(r.event_time).toISOString(),'2026-11-23T01:00:05.000Z');
assert.equal(r.events,3);assert.equal(Number(r.seq),3);assert.equal(r.own_bot,false,'사람 이벤트가 섞이면 메아리 아님');
assert.equal(await one('select public.notion_event_due_count()'),1);
// 예약: 할 일이 있으면 sync-class-room-copy {"mode":"events"}
assert.equal(await one('select public.notion_events_drain_step()'),'called');
const call=(await q('select url,headers,body from net.calls order by id desc limit 1'))[0];
assert.match(call.url,/\/functions\/v1\/sync-class-room-copy$/);assert.deepEqual(call.body,{mode:'events'});assert.equal(call.headers['x-admin-key'],'test-only-key');
// 임대는 하나만
let a=await one("select public.notion_event_claim('w1',10,60)");
assert.equal(a.lease,true);assert.equal(a.items.length,1);assert.equal(a.items[0].page_id,'p1');
let b=await one("select public.notion_event_claim('w2',10,60)");
assert.equal(b.lease,false,'다른 처리기는 임대를 못 받음');assert.equal(b.items.length,0);
// 처리 중 새 이벤트가 오면 끝내기가 덮어쓰지 못하고 다시 처리된다
assert.equal(await enq('e3','p1','page.properties_updated','2026-11-23T01:01:00Z'),'queued');
assert.equal(await one("select public.notion_event_finish('p1',$1,true,'upserted app_rows:학생(학원) DB')",[a.items[0].seq]),'superseded');
assert.equal(await one("select status from public.notion_event_queue where page_id='p1'"),'pending');
a=await one("select public.notion_event_claim('w1',10,60)");
assert.equal(a.items.length,1);
assert.equal(await one("select public.notion_event_finish('p1',$1,true,'same',null,30,1)",[a.items[0].seq]),'done');
r=(await q("select status,result,notion_calls from public.notion_event_queue where page_id='p1'"))[0];
assert.deepEqual(r,{status:'done',result:'same',notion_calls:1});
// 끝난 줄에 새 이벤트가 오면 다시 pending, 묶음 수는 1부터
assert.equal(await enq('e4','p1','page.deleted','2026-11-23T01:02:00Z',true),'queued');
r=(await q("select status,events,own_bot from public.notion_event_queue where page_id='p1'"))[0];
assert.deepEqual(r,{status:'pending',events:1,own_bot:true});
// 실패: retry(간격만큼 뒤로), 6번이면 failed
for(let i=1;i<=6;i++){
 await db.exec("update public.notion_event_queue set due_at=clock_timestamp()-interval '1 second' where page_id='p1'");
 a=await one("select public.notion_event_claim('w1',10,60)");assert.equal(a.items.length,1);
 const st=await one("select public.notion_event_finish('p1',$1,false,'error','노션 줄 읽기 실패: 502',30)",[a.items[0].seq]);
 assert.equal(st,i<6?'retry':'failed');
 assert.equal(await one('select public.notion_event_due_count()'),0,'다시 할 때까지 기다림');
}
// 놓아주면 다른 처리기가 받는다
await db.query("select public.notion_event_release('w1')");
b=await one("select public.notion_event_claim('w2',10,60)");assert.equal(b.lease,true);
// 미리 미룬 이벤트(2초 묶음)는 그 전에는 할 일이 아니다
assert.equal(await enq('e5','p2','page.created','2026-11-23T01:03:00Z',false,60000),'queued');
assert.equal(await one('select public.notion_event_due_count()'),0);
// 정리
await db.exec("update public.notion_event_ids set received_at=now()-interval '4 days' where event_id='e1'; insert into public.notion_webhook_events(received_at,kind) values(now()-interval '31 days','event'),(now(),'event');");
await db.query('select public.notion_events_prune()');
assert.equal(await one("select count(*)::int from public.notion_event_ids where event_id='e1'"),0);
assert.equal(await one('select count(*)::int from public.notion_webhook_events'),1);
const grants=await one("select count(*)::int from information_schema.routine_privileges where (routine_name like 'notion_event%') and grantee in ('anon','authenticated','PUBLIC')");
assert.equal(grants,0,'anon · authenticated는 부르지 못함');
console.log('Notion event queue migration passed: once per event id, merge per page, seq guard, single lease, retry→failed, drain only when due, polling 15 min, prune, no anon grants');
})().catch(e=>{console.error(e);process.exit(1)});
