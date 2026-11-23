-- 강사별 관리 앱 계정(강사계정 과제 261123). 원장(관리자 비밀번호 · hada_security_state · hada_security_command)은 그대로 두고,
-- 강사 계정 · 강사 세션은 따로 둔 표와 따로 둔 함수(hada_teacher_command)에서만 다룬다. 원장 세션 표에 강사 세션을 넣지 않으므로
-- 원장 authorize는 강사 세션을 언제나 'none'으로 본다(강사 세션은 강사를 아는 경로 — app-api · class-room · textbook-api · school-api — 만 따로 확인).
-- 아이디 = 강사 DB 연락처(숫자만), 첫 비밀번호 = 같은 번호. 첫 로그인 뒤 바꾸기 전에는 세션이 비밀번호 바꾸기만 할 수 있다(must_change).
-- 원장이 켠 강사만 로그인(enabled), 다섯 번 틀리면 그 강사만 15분 잠김, 원장이 [첫 비밀번호로 되돌리기](reset)하면 다시 첫 로그인.
-- 원장이 아직 초기 비밀번호(0000) 상태거나 보안 초기 설정 전이면 강사는 로그인하지 못한다. 모든 DELETE/UPDATE에는 WHERE(safeupdate).
create table if not exists public.hada_teacher_accounts (
 teacher_id text primary key check (teacher_id ~ '^[0-9a-f]{32}$'),
 phone text not null unique check (phone ~ '^[0-9]{9,11}$'),
 name text not null default '',
 password_hash text not null,
 must_change boolean not null default true,
 enabled boolean not null default true,
 login_failures integer not null default 0,
 locked_until timestamptz,
 version integer not null default 1,
 changed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.hada_teacher_sessions (
 token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
 teacher_id text not null references public.hada_teacher_accounts(teacher_id) on delete cascade,
 version integer not null,
 notion_users jsonb not null default '[]'::jsonb,
 expires_at timestamptz not null
);
create index if not exists hada_teacher_sessions_teacher on public.hada_teacher_sessions(teacher_id);
alter table public.hada_teacher_accounts enable row level security;
alter table public.hada_teacher_sessions enable row level security;
revoke all on public.hada_teacher_accounts from public, anon, authenticated;
revoke all on public.hada_teacher_sessions from public, anon, authenticated;

create or replace function public.hada_teacher_command(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
 a public.hada_teacher_accounts%rowtype;
 o public.hada_security_state%rowtype;
 v_now timestamptz := clock_timestamp();
 v_hash_re text := '^pbkdf2-sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$';
begin
 -- 원장 상태: 보안 초기 설정 전이거나 원장이 아직 초기 비밀번호면 강사 로그인 · 세션 모두 막는다.
 select * into o from public.hada_security_state where id=1;
 if o.id is null or coalesce(o.version,0)=0 or o.password_hash is null or o.must_change then
  if p_action in ('account','login','session','change') then
   return jsonb_build_object('error','원장 관리자 설정이 끝난 뒤에 강사 로그인을 쓸 수 있어요.','status',409);
  end if;
 end if;

 -- 원장 화면(목록): 강사 id · 번호 · 이름 · 상태. 비밀번호 해시는 돌려주지 않는다.
 if p_action='list' then
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('teacher_id',x.teacher_id,'phone',x.phone,'name',x.name,
   'enabled',x.enabled,'must_change',x.must_change,'locked',coalesce(x.locked_until>v_now,false),'locked_until',x.locked_until,
   'changed_at',x.changed_at,'created_at',x.created_at) order by x.created_at) from public.hada_teacher_accounts x),'[]'::jsonb));
 end if;

 -- 원장: 켜기. 처음이면 첫 비밀번호(번호) 해시로 만들고, 꺼 둔 계정이면 다시 켠다(비밀번호는 그대로).
 if p_action='enable' then
  if coalesce(p_data->>'teacher_id','') !~ '^[0-9a-f]{32}$' or coalesce(p_data->>'phone','') !~ '^[0-9]{9,11}$'
   or coalesce(p_data->>'password_hash','') !~ v_hash_re then
   return jsonb_build_object('error','강사 계정 형식 오류','status',400);
  end if;
  if exists(select 1 from public.hada_teacher_accounts x where x.phone=p_data->>'phone' and x.teacher_id<>p_data->>'teacher_id') then
   return jsonb_build_object('error','같은 휴대폰 번호로 켜 둔 다른 강사 계정이 있어요. 노션 강사 DB의 연락처를 먼저 고쳐 주세요.','status',409);
  end if;
  select * into a from public.hada_teacher_accounts where teacher_id=p_data->>'teacher_id' for update;
  if a.teacher_id is null then
   insert into public.hada_teacher_accounts(teacher_id,phone,name,password_hash,must_change,enabled)
    values(p_data->>'teacher_id',p_data->>'phone',left(coalesce(p_data->>'name',''),80),p_data->>'password_hash',true,true);
   return jsonb_build_object('ok',true,'created',true);
  end if;
  update public.hada_teacher_accounts set enabled=true,name=left(coalesce(p_data->>'name',a.name),80),login_failures=0,locked_until=null
   where teacher_id=a.teacher_id;
  return jsonb_build_object('ok',true,'created',false);
 end if;

 if p_action in ('disable','reset') then
  select * into a from public.hada_teacher_accounts where teacher_id=coalesce(p_data->>'teacher_id','') for update;
  if a.teacher_id is null then return jsonb_build_object('error','앱 계정을 켠 적 없는 강사예요.','status',404); end if;
  if p_action='disable' then
   update public.hada_teacher_accounts set enabled=false where teacher_id=a.teacher_id;
   delete from public.hada_teacher_sessions where teacher_id=a.teacher_id;
   return jsonb_build_object('ok',true);
  end if;
  -- 첫 비밀번호로 되돌리기: 지금 노션 번호로 아이디 · 첫 비밀번호를 다시 맞추고, 그 강사의 세션은 모두 끊는다.
  if coalesce(p_data->>'phone','') !~ '^[0-9]{9,11}$' or coalesce(p_data->>'password_hash','') !~ v_hash_re then
   return jsonb_build_object('error','강사 계정 형식 오류','status',400);
  end if;
  if exists(select 1 from public.hada_teacher_accounts x where x.phone=p_data->>'phone' and x.teacher_id<>a.teacher_id) then
   return jsonb_build_object('error','같은 휴대폰 번호로 켜 둔 다른 강사 계정이 있어요. 노션 강사 DB의 연락처를 먼저 고쳐 주세요.','status',409);
  end if;
  update public.hada_teacher_accounts set phone=p_data->>'phone',password_hash=p_data->>'password_hash',must_change=true,
   login_failures=0,locked_until=null,version=a.version+1,changed_at=null where teacher_id=a.teacher_id;
  delete from public.hada_teacher_sessions where teacher_id=a.teacher_id;
  return jsonb_build_object('ok',true);
 end if;

 -- 로그인 1단계: 번호로 계정 찾기. 없는 번호 · 꺼진 계정은 같은 말(누가 있는지 알려 주지 않음).
 if p_action='account' then
  select * into a from public.hada_teacher_accounts where phone=coalesce(p_data->>'phone','');
  if a.teacher_id is null or not a.enabled then return jsonb_build_object('found',false); end if;
  if a.locked_until>v_now then return jsonb_build_object('error','로그인 시도가 많아 잠겼어요. 15분 뒤 다시 하거나 원장에게 되돌리기를 요청하세요.','status',429); end if;
  return jsonb_build_object('found',true,'teacher_id',a.teacher_id,'password_hash',a.password_hash,'version',a.version,'must_change',a.must_change,'name',a.name);
 end if;

 if p_action='login' then
  select * into a from public.hada_teacher_accounts where teacher_id=coalesce(p_data->>'teacher_id','') for update;
  if a.teacher_id is null or not a.enabled then return jsonb_build_object('error','아이디 또는 비밀번호가 올바르지 않아요.','status',401); end if;
  if a.version<>(p_data->>'version')::integer then return jsonb_build_object('error','계정이 바뀌었어요. 다시 로그인해 주세요.','status',409); end if;
  if a.locked_until>v_now then return jsonb_build_object('error','로그인 시도가 많아 잠겼어요. 15분 뒤 다시 하거나 원장에게 되돌리기를 요청하세요.','status',429); end if;
  if not coalesce((p_data->>'verified')::boolean,false) then
   -- 이 강사만 센다(원장 · 다른 강사와 따로). 다섯 번째 틀림에 15분 잠김.
   update public.hada_teacher_accounts set
    login_failures=case when locked_until is not null and locked_until<=v_now then 1 else login_failures+1 end,
    locked_until=case when (case when locked_until is not null and locked_until<=v_now then 1 else login_failures+1 end)>=5 then v_now+interval '15 minutes' else null end
    where teacher_id=a.teacher_id;
   return jsonb_build_object('error','아이디 또는 비밀번호가 올바르지 않아요.','status',401);
  end if;
  if coalesce(p_data->>'token_hash','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(coalesce(p_data->'notion_users','[]'::jsonb))<>'array' then
   return jsonb_build_object('error','세션 형식 오류','status',400);
  end if;
  delete from public.hada_teacher_sessions where teacher_id=a.teacher_id and (expires_at<=v_now or version<>a.version);
  insert into public.hada_teacher_sessions(token_hash,teacher_id,version,notion_users,expires_at)
   values(p_data->>'token_hash',a.teacher_id,a.version,coalesce(p_data->'notion_users','[]'::jsonb),v_now+interval '12 hours');
  update public.hada_teacher_accounts set login_failures=0,locked_until=null where teacher_id=a.teacher_id;
  return jsonb_build_object('ok',true);
 end if;

 if p_action='logout' then
  delete from public.hada_teacher_sessions where token_hash=coalesce(p_data->>'session_hash','');
  return jsonb_build_object('ok',true);
 end if;

 -- 세션 확인: 켜진 계정 · 같은 판 · 12시간 안. must_change면 서버 경로가 비밀번호 바꾸기 밖은 모두 거절한다.
 if p_action in ('session','change') then
  select x.* into a from public.hada_teacher_sessions t join public.hada_teacher_accounts x on x.teacher_id=t.teacher_id
   where t.token_hash=coalesce(p_data->>'session_hash','') and t.version=x.version and t.expires_at>v_now and x.enabled;
  if a.teacher_id is null then return jsonb_build_object('error','다시 로그인해 주세요.','status',401); end if;
  if p_action='session' then
   return jsonb_build_object('kind','teacher','teacher_id',a.teacher_id,'name',a.name,'phone',a.phone,'must_change',a.must_change,
    'password_hash',a.password_hash,'version',a.version,
    'notion_users',(select t.notion_users from public.hada_teacher_sessions t where t.token_hash=p_data->>'session_hash'));
  end if;
  if a.version<>(p_data->>'expected_version')::integer then return jsonb_build_object('error','계정이 바뀌었어요. 다시 로그인해 주세요.','status',409); end if;
  if coalesce(p_data->>'password_hash','') !~ v_hash_re then return jsonb_build_object('error','보안 설정 형식 오류','status',400); end if;
  update public.hada_teacher_accounts set password_hash=p_data->>'password_hash',must_change=false,version=a.version+1,changed_at=v_now,
   login_failures=0,locked_until=null where teacher_id=a.teacher_id;
  delete from public.hada_teacher_sessions where teacher_id=a.teacher_id;
  return jsonb_build_object('ok',true,'changed_at',v_now);
 end if;
 return jsonb_build_object('error','지원하지 않는 서버 작업','status',400);
end $$;
revoke all on function public.hada_teacher_command(text,jsonb) from public, anon, authenticated;
grant execute on function public.hada_teacher_command(text,jsonb) to service_role;
