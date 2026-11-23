// 관리 앱 자동 갱신 마이그레이션(261123) 검사. PGlite에 realtime.send 대신 기록만 하는 가짜를 둔다. 실제 DB·네트워크·비밀값 없음.
// 확인: 값이 바뀐 줄만 신호(DB 이름 · 줄 수만, 값 · id 없음) · 같은 값 다시 쓰기는 신호 없음 · 지운 줄 기록 · 3일 정리 ·
//       신호가 실패해도 사본 쓰기는 됨 · realtime이 없어도 됨 · 수업 사본 신호 · 다시 적용 가능 · 잠금(RLS).
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const assert=require('node:assert/strict'),fs=require('fs');
const MIG=fs.readFileSync('supabase/migrations/20261123050000_app_live_refresh.sql','utf8');
const base=`create role anon; create role authenticated;
create table public.app_rows(id text primary key, db text not null, props jsonb not null default '{}'::jsonb, url text not null default '', icon text not null default '',
  notion_created_at timestamptz, notion_edited_at timestamptz not null, synced_at timestamptz not null default now());
create table public.cr_sessions(id text primary key, name text not null default '', notion_edited_at timestamptz not null, synced_at timestamptz not null default now());
create table public.cr_attendance(id text primary key, status text not null default '', notion_edited_at timestamptz not null, synced_at timestamptz not null default now());`;
const fake=`create schema realtime; create table realtime.sent(id serial, payload jsonb, ev text, topic text, priv boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ insert into realtime.sent(payload,ev,topic,priv) values(payload,event,topic,private) $$;`;
(async()=>{
let checks=0;const ok=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const db=new PGlite();
await db.exec(base);await db.exec(fake);
await db.exec(MIG);await db.exec(MIG); // 다시 적용해도 트리거가 겹치지 않는다
const sent=async()=>(await db.query('select payload,ev,topic,priv from realtime.sent order by id')).rows;
const clear=()=>db.exec('delete from realtime.sent where true');
ok((await db.query("select count(*)::int n from pg_trigger where tgrelid='public.app_rows'::regclass and not tgisinternal")).rows[0].n,3,'app_rows 트리거 3개');
ok((await db.query("select count(*)::int n from pg_trigger where tgrelid='public.cr_sessions'::regclass and not tgisinternal")).rows[0].n,3,'cr 트리거 3개');
// 넣기: 문장 하나 = 신호 하나, DB 이름 · 줄 수만
await db.exec(`insert into public.app_rows(id,db,props,notion_edited_at) values('a','학생(학원) DB','{"학생이름":"예시 학생"}',now()),('b','학생(학원) DB','{}',now()),('c','클래스(학원) DB','{}',now())`);
let s=await sent();ok(s.length,1);ok(s[0].ev,'rows');ok(s[0].topic,'hada-app');ok(s[0].priv,false,'공개 채널');
ok(s[0].payload.n,3);ok([...s[0].payload.dbs].sort(),['클래스(학원) DB','학생(학원) DB']);
assert.ok(!JSON.stringify(s).includes('예시 학생')&&!JSON.stringify(s).includes('"a"'),'값 · 줄 id가 신호에 없음');checks++;
// 같은 값 다시 쓰기(5분 사본 · 밤 대조): synced_at만 바뀜 → 신호 없음
await clear();
await db.exec(`insert into public.app_rows(id,db,props,notion_edited_at) select id,db,props,notion_edited_at from public.app_rows on conflict(id) do update set props=excluded.props, notion_edited_at=excluded.notion_edited_at, synced_at=now()`);
ok(await sent(),[],'같은 값 upsert는 신호 없음');
// 한 줄만 값이 바뀜 → 그 DB 1줄
await db.exec(`update public.app_rows set props='{"학생이름":"예시 학생2"}', notion_edited_at=now()+interval '1 minute' where id='a'`);
s=await sent();ok(s.length,1);ok(s[0].payload,{dbs:['학생(학원) DB'],n:1});
// 요청 칸만 바뀌어도 신호(요청 상태 보이기)
await clear();
await db.exec(`update public.app_rows set props=props||'{"요청":"🔄 처리 중"}' where id='c'`);
ok((await sent())[0].payload,{dbs:['클래스(학원) DB'],n:1});
// 지우기 → app_row_gone + 신호, 3일 지난 기록 정리
await clear();
await db.exec(`insert into public.app_row_gone(id,db,at) values('old','학생(학원) DB',now()-interval '4 days')`);
await db.exec(`delete from public.app_rows where id='b'`);
ok((await db.query('select id,db from public.app_row_gone order by id')).rows,[{id:'b',db:'학생(학원) DB'}],'지운 줄 기록, 3일 지난 것 정리');
ok((await sent())[0].payload,{dbs:['학생(학원) DB'],n:1});
// 수업 사본: 값이 바뀔 때만, 표 이름만
await clear();
await db.exec(`insert into public.cr_sessions(id,name,notion_edited_at) values('s1','수학 수업',now())`);
ok((await sent()).map(r=>[r.ev,r.payload]),[['cr',{cr:'cr_sessions',n:1}]]);
await clear();
await db.exec(`update public.cr_sessions set synced_at=now()+interval '5 minutes' where id='s1'`);
ok(await sent(),[],'cr 같은 값 다시 쓰기는 신호 없음');
await db.exec(`update public.cr_sessions set name='수학 수업 2' where id='s1'`);
ok((await sent()).map(r=>r.payload),[{cr:'cr_sessions',n:1}]);
// 신호가 실패해도 사본 쓰기는 된다
await db.exec(`create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$ begin raise exception 'realtime down'; end $$`);
await db.exec(`insert into public.app_rows(id,db,notion_edited_at) values('d','학생(학원) DB',now())`);
ok((await db.query("select count(*)::int n from public.app_rows where id='d'")).rows[0].n,1,'신호 실패에도 쓰기 성공');
// realtime 스키마가 없어도(학원 배포 전 · 시험) 쓰기는 된다
const db2=new PGlite();await db2.exec(base);await db2.exec(MIG);
await db2.exec(`insert into public.app_rows(id,db,notion_edited_at) values('x','학생(학원) DB',now()); delete from public.app_rows where id='x'`);
ok((await db2.query('select count(*)::int n from public.app_row_gone')).rows[0].n,1);
// 잠금: app_row_gone RLS 켬, anon 권한 없음
ok((await db.query("select relrowsecurity from pg_class where relname='app_row_gone'")).rows[0].relrowsecurity,true);
ok((await db.query("select has_table_privilege('anon','public.app_row_gone','select') as p")).rows[0].p,false);
ok((await db.query("select has_function_privilege('anon','public.app_live_signal(jsonb,text)','execute') as p")).rows[0].p,false);
// Supabase safeupdate: WHERE 없는 DELETE/UPDATE 금지
const unsafe=[...MIG.replace(/--[^\n]*/g,'').matchAll(/\b(delete\s+from|update)\s[^;]*;/gi)].map(m=>m[0]).filter(x=>!/\bwhere\b/i.test(x)&&!/^update\s+on\b/i.test(x)); // "after update on <표>"(트리거 선언)은 문장이 아님
ok(unsafe,[],'WHERE 없는 DELETE/UPDATE 없음');
console.log(`app-live-refresh-sql: ${checks} checks passed`);
})().catch(e=>{console.error(e);process.exit(1)});
