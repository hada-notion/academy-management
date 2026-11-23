-- (v2.8.0, 261123 키 자동 등록) 학원이 받은 외부 키를 관리 앱 [관리자 설정]에서 넣으면 서버가 바로 쓴다.
--
-- 키: NEIS_API_KEY(나이스 학교·학사일정) · NL_CERT_KEY(국립중앙도서관 책 정보) · KAKAO_REST_KEY(카카오 책 검색).
-- 저장: 값은 Supabase Vault(vault.secrets, 이름 'hada_ext_<키 이름>')에만. 이 표(hada_external_keys)에는 값이 없고
--       "있음 · 바꾼 날 · 마지막 연결 확인 결과"만 둔다.
-- 쓰기: 함수(_shared/externalKeys.ts)는 Vault 먼저, 없으면 지금처럼 함수 Secret(환경 변수).
-- 부르는 곳: 함수 admin-security(관리자 로그인 세션 확인 뒤)와 키를 쓰는 함수들 — 서비스 역할로만.
--   anon · authenticated는 부르지 못한다(revoke). 값을 돌려주는 동작은 'read' 하나이고, 브라우저로 가는 응답에는 넣지 않는다.
-- 지우기: Vault 줄과 표 줄을 지운다 → 함수는 다시 Secret을 쓴다(Secret은 건드리지 않음).
-- 되돌리기(이 파일 전): drop function public.hada_external_key(text,jsonb);
--                     delete from vault.secrets where name like 'hada_ext_%';
--                     drop table public.hada_external_keys;
-- 모든 DELETE/UPDATE에 WHERE(Supabase pg-safeupdate).

create table if not exists public.hada_external_keys (
  name text primary key check (name in ('NEIS_API_KEY','NL_CERT_KEY','KAKAO_REST_KEY')),
  changed_at timestamptz not null default clock_timestamp(),
  test_state text check (test_state in ('ok','wrong','unknown')),  -- 마지막 연결 확인: 연결됨 · 키가 틀림 · 확인 못 함
  tested_at timestamptz
);
alter table public.hada_external_keys enable row level security;
revoke all on table public.hada_external_keys from public, anon, authenticated;

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
 r record;
begin
 -- 상태: 값 없이 있음 · 바꾼 날 · 확인 결과만.
 if p_action='status' then
  for r in select k.name,k.changed_at,k.test_state,k.tested_at from public.hada_external_keys k
   where exists(select 1 from vault.secrets s where s.name='hada_ext_'||k.name) loop
   v_out := v_out || jsonb_build_object(r.name, jsonb_build_object('changed_at',r.changed_at,'test_state',r.test_state,'tested_at',r.tested_at));
  end loop;
  return jsonb_build_object('keys',v_out);
 end if;
 -- 읽기: 서버 함수만(서비스 역할). 값은 함수 안에서만 쓰고 응답 · 로그에 내보내지 않는다.
 if p_action='read' then
  for r in select k.name,d.decrypted_secret from public.hada_external_keys k
   join vault.decrypted_secrets d on d.name='hada_ext_'||k.name loop
   if coalesce(r.decrypted_secret,'')<>'' then v_out := v_out || jsonb_build_object(r.name, r.decrypted_secret); end if;
  end loop;
  return jsonb_build_object('keys',v_out);
 end if;
 if v_name not in ('NEIS_API_KEY','NL_CERT_KEY','KAKAO_REST_KEY') then
  return jsonb_build_object('error','지원하지 않는 키입니다.','status',400);
 end if;
 if p_action='set' then
  -- 키 모양: 앞뒤 공백 · 줄바꿈 없는 글자 8~256자(세 곳 모두 영문 · 숫자 · 기호 키).
  if v_value is null or v_value !~ '^[\x21-\x7e]+$' or length(v_value) not between 8 and 256 then
   return jsonb_build_object('error','키 형식이 올바르지 않습니다. 받은 키를 앞뒤 공백 없이 그대로 붙여 넣어 주세요.','status',400);
  end if;
  select id into secret_id from vault.secrets where name=v_secret limit 1;
  if secret_id is null then perform vault.create_secret(v_value, v_secret);
  else perform vault.update_secret(secret_id, v_value); end if;
  insert into public.hada_external_keys(name,changed_at,test_state,tested_at) values(v_name,v_now,null,null)
   on conflict(name) do update set changed_at=excluded.changed_at,test_state=null,tested_at=null;
  return jsonb_build_object('ok',true,'changed_at',v_now);
 end if;
 if p_action='tested' then
  if coalesce(p_data->>'state','') not in ('ok','wrong','unknown') then
   return jsonb_build_object('error','확인 결과 형식 오류','status',400);
  end if;
  update public.hada_external_keys set test_state=p_data->>'state',tested_at=v_now where name=v_name;
  return jsonb_build_object('ok',true,'tested_at',v_now);
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
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('error','지원하지 않는 서버 작업','status',400);
end $$;
revoke all on function public.hada_external_key(text,jsonb) from public, anon, authenticated;
grant execute on function public.hada_external_key(text,jsonb) to service_role;
