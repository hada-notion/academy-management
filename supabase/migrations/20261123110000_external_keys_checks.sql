-- (v2.8.0 항목 113, 261123 2바퀴째) 외부 키: 카카오를 빼고, 연결 확인 결과를 남겨 관리자 설정을 열면 바로 보이게.
--
-- 1) 카카오 책 검색을 쓰지 않는다(대표 261123 "카카오는 안쓸거야"). 앱에서 넣은 카카오 키가 있으면 Vault 줄 · 표 줄을 지우고,
--    키 표 · 함수가 받는 키를 NEIS_API_KEY · NL_CERT_KEY 둘로 줄인다(함수 Secret KAKAO_REST_KEY는 서버가 더 읽지 않는다 — 대시보드에서 지워도 됨).
-- 2) 연결 확인 결과 표(hada_external_key_checks): 키마다 마지막 확인의 출처(app = 앱에서 넣은 키, secret = 함수 Secret) · 결과 · 시각.
--    값은 없다. 관리자 설정을 열 때 서버가 이 결과가 10분 안이고 출처가 같으면 다시 쓰고, 아니면 상대 서버에 한 번 물어 새로 적는다.
--    키를 저장 · 삭제하면 그 키의 확인 결과를 지운다(다음에 열 때 새로 확인).
-- 부르는 곳 · 권한: 20261123090000과 같다(서비스 역할만, anon · authenticated 거절). 'read'만 값을 돌려준다(서버 함수 안에서만 씀).
-- 되돌리기(이 파일 전): 20261123090000_external_keys.sql의 함수 정의를 다시 적용하고
--   alter table public.hada_external_keys drop constraint hada_external_keys_name_check;
--   alter table public.hada_external_keys add constraint hada_external_keys_name_check check (name in ('NEIS_API_KEY','NL_CERT_KEY','KAKAO_REST_KEY'));
--   drop table public.hada_external_key_checks;   (지운 카카오 키는 되살리지 않음 — 쓰지 않는 키)
-- 모든 DELETE/UPDATE에 WHERE(Supabase pg-safeupdate).

-- 1) 카카오 정리
do $$
begin
  begin
    delete from vault.secrets where name='hada_ext_KAKAO_REST_KEY';
  exception when insufficient_privilege then
    perform vault.update_secret(s.id, '') from vault.secrets s where s.name='hada_ext_KAKAO_REST_KEY';
  end;
end $$;
delete from public.hada_external_keys where name='KAKAO_REST_KEY';
alter table public.hada_external_keys drop constraint if exists hada_external_keys_name_check;
alter table public.hada_external_keys add constraint hada_external_keys_name_check check (name in ('NEIS_API_KEY','NL_CERT_KEY'));

-- 2) 연결 확인 결과
create table if not exists public.hada_external_key_checks (
  name text primary key check (name in ('NEIS_API_KEY','NL_CERT_KEY')),
  source text not null check (source in ('app','secret')),
  state text not null check (state in ('ok','wrong','unknown')),  -- 연결됨 · 키가 틀림 · 확인 못 함(상대 서버 오류)
  checked_at timestamptz not null default clock_timestamp()
);
alter table public.hada_external_key_checks enable row level security;
revoke all on table public.hada_external_key_checks from public, anon, authenticated;

create or replace function public.hada_external_key(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
 v_name text := coalesce(p_data->>'name','');
 v_value text := p_data->>'value';
 v_secret text := 'hada_ext_' || coalesce(p_data->>'name','');
 secret_id uuid;
 v_now timestamptz := clock_timestamp();
 v_out jsonb := '{}'::jsonb;
 v_checks jsonb := '{}'::jsonb;
 r record;
begin
 -- 상태: 값 없이 있음 · 바꾼 날, 그리고 마지막 연결 확인(출처 · 결과 · 시각).
 if p_action='status' then
  for r in select k.name,k.changed_at from public.hada_external_keys k
   where exists(select 1 from vault.secrets s where s.name='hada_ext_'||k.name) loop
   v_out := v_out || jsonb_build_object(r.name, jsonb_build_object('changed_at',r.changed_at));
  end loop;
  for r in select c.name,c.source,c.state,c.checked_at from public.hada_external_key_checks c loop
   v_checks := v_checks || jsonb_build_object(r.name, jsonb_build_object('source',r.source,'state',r.state,'checked_at',r.checked_at));
  end loop;
  return jsonb_build_object('keys',v_out,'checks',v_checks);
 end if;
 -- 읽기: 서버 함수만(서비스 역할). 값은 함수 안에서만 쓰고 응답 · 로그에 내보내지 않는다.
 if p_action='read' then
  for r in select k.name,d.decrypted_secret from public.hada_external_keys k
   join vault.decrypted_secrets d on d.name='hada_ext_'||k.name loop
   if coalesce(r.decrypted_secret,'')<>'' then v_out := v_out || jsonb_build_object(r.name, r.decrypted_secret); end if;
  end loop;
  return jsonb_build_object('keys',v_out);
 end if;
 if v_name not in ('NEIS_API_KEY','NL_CERT_KEY') then
  return jsonb_build_object('error','지원하지 않는 키입니다.','status',400);
 end if;
 if p_action='set' then
  -- 키 모양: 앞뒤 공백 · 줄바꿈 없는 글자 8~256자.
  if v_value is null or v_value !~ '^[\x21-\x7e]+$' or length(v_value) not between 8 and 256 then
   return jsonb_build_object('error','키 형식이 올바르지 않습니다. 받은 키를 앞뒤 공백 없이 그대로 붙여 넣어 주세요.','status',400);
  end if;
  select id into secret_id from vault.secrets where name=v_secret limit 1;
  if secret_id is null then perform vault.create_secret(v_value, v_secret);
  else perform vault.update_secret(secret_id, v_value); end if;
  insert into public.hada_external_keys(name,changed_at,test_state,tested_at) values(v_name,v_now,null,null)
   on conflict(name) do update set changed_at=excluded.changed_at,test_state=null,tested_at=null;
  delete from public.hada_external_key_checks where name=v_name;
  return jsonb_build_object('ok',true,'changed_at',v_now);
 end if;
 if p_action='checked' then
  if coalesce(p_data->>'state','') not in ('ok','wrong','unknown') or coalesce(p_data->>'source','') not in ('app','secret') then
   return jsonb_build_object('error','확인 결과 형식 오류','status',400);
  end if;
  insert into public.hada_external_key_checks(name,source,state,checked_at) values(v_name,p_data->>'source',p_data->>'state',v_now)
   on conflict(name) do update set source=excluded.source,state=excluded.state,checked_at=excluded.checked_at;
  return jsonb_build_object('ok',true,'checked_at',v_now);
 end if;
 if p_action='clear' then
  -- Vault 줄을 지운다. 이 서버에서 vault.secrets DELETE 권한이 없으면 값을 빈 글자로 덮는다('read'는 빈 값을 건너뛴다).
  begin
   delete from vault.secrets where name=v_secret;
  exception when insufficient_privilege then
   select id into secret_id from vault.secrets where name=v_secret limit 1;
   if secret_id is not null then perform vault.update_secret(secret_id, ''); end if;
  end;
  delete from public.hada_external_keys where name=v_name;
  delete from public.hada_external_key_checks where name=v_name;
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('error','지원하지 않는 서버 작업','status',400);
end $$;
revoke all on function public.hada_external_key(text,jsonb) from public, anon, authenticated;
grant execute on function public.hada_external_key(text,jsonb) to service_role;
