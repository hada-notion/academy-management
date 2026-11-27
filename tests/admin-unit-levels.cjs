// 관리 앱 단원 편집 [단원 목록 입력]의 단원 단계(항목 164) — livebook.js 순수 함수(lbUnitLevels · lbUnitPick)를 노드에서 바로 시험. 브라우저 없음.
// 사용: node tests/admin-unit-levels.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, '../prototype/admin-app/livebook.js'), 'utf8');
const ctx = { document: { addEventListener() {}, querySelector() { return null; } }, window: {}, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const { lbUnitLevels, lbUnitPick } = ctx;
const lv = (t) => lbUnitLevels(t).levels.map((g) => `${g.label} ${g.count}`).join(' · ');
const pick = (t, k, up) => JSON.parse(JSON.stringify(lbUnitPick(t, k, up)));
const keyOf = (t, label) => lbUnitLevels(t).levels.find((g) => g.label === label).key;

// 1) 블록구문 필수편 꼴(STAGE 3 · Chapter 13 · Unit 60, 쪽 없음) — 예시 단원 이름
const CH = [[1, 7], [2, 5], [3, 4], [4, 4], [5, 4], [6, 5], [7, 5], [8, 4], [9, 4], [10, 4], [11, 5], [12, 5], [13, 4]]; // [Chapter, Unit 수] 합 60
const STAGE_AT = { 1: '[STAGE I 영어문장 구조와 동사]', 5: '[Stage II 주어/보어/목적어구 ·절 & 관계절]', 9: '[STAGE III 모든 문장과 특수 구문]' };
const UNAME = { 7: '구동사 2', 8: '시간표현 1: 현재/과거/미래/진행', 48: '가정표현 4', 60: '수 일치 & 시제 조정' };
let u = 0; const BL = [];
for (const [c, n] of CH) {
  if (STAGE_AT[c]) BL.push(STAGE_AT[c]);
  BL.push(`Chapter ${String(c).padStart(2, '0')}. 예시 장 ${c}`);
  for (let i = 0; i < n; i++) { u++; BL.push(`Unit ${String(u).padStart(2, '0')} ${UNAME[u] || '예시 구문 ' + u}`); }
}
const BLOCK = BL.join('\n');
assert.equal(u, 60);
{
  const L = lbUnitLevels(BLOCK);
  assert.equal(lv(BLOCK), 'STAGE 3 · Chapter 13 · Unit 60', '단계 3개');
  assert.equal(L.def, keyOf(BLOCK, 'Unit'), '기본 = Unit');
  const us = pick(BLOCK, L.def);
  assert.equal(us.length, 60);
  assert.deepEqual(us[0], { name: 'Unit 01 예시 구문 1', page: null });
  assert.deepEqual(us[6], { name: 'Unit 07 구동사 2', page: null }, '이름 끝 2는 쪽 아님');
  assert.deepEqual(us[7], { name: 'Unit 08 시간표현 1: 현재/과거/미래/진행', page: null });
  assert.deepEqual(us[47], { name: 'Unit 48 가정표현 4', page: null }, '가정표현 4는 쪽 아님');
  assert.deepEqual(us[59], { name: 'Unit 60 수 일치 & 시제 조정', page: null });
  assert.ok(us.every((x) => x.page === null && !/^\d+(-\d+)?\./.test(x.name)), '쪽 비움 · 번호 지어 붙이지 않음');
  const ch = pick(BLOCK, keyOf(BLOCK, 'Chapter'));
  assert.equal(ch.length, 13); assert.equal(ch[0].name, 'Chapter 01. 예시 장 1');
  const st = pick(BLOCK, keyOf(BLOCK, 'STAGE'));
  assert.deepEqual(st.map((x) => x.name), ['[STAGE I 영어문장 구조와 동사]', '[Stage II 주어/보어/목적어구 ·절 & 관계절]', '[STAGE III 모든 문장과 특수 구문]'], 'STAGE I 포함 · 이름 그대로');
  const up = pick(BLOCK, L.def, true);
  assert.equal(up[0].name, 'Chapter 01 · Unit 01 예시 구문 1', '윗 단계 이름 붙이기');
  assert.equal(pick(BLOCK, keyOf(BLOCK, 'Chapter'), true)[0].name, 'STAGE I · Chapter 01. 예시 장 1');
}
// 2) 백발백중 꼴(Lesson + "   - Vocabulary 어휘" 반복) — 기본 Lesson, 쪽은 줄 끝(모든 Lesson 줄)
{
  const T = Array.from({ length: 8 }, (_, i) => `Lesson ${String(i + 1).padStart(2, '0')} 예시 과 ${i + 1} ${10 + i * 20}\n` + ['Vocabulary 어휘', 'Grammar 문법', 'Reading 독해', 'Listening 듣기', 'Speaking 말하기', 'Writing 쓰기', 'Review 복습', 'Test 평가'].map((s) => '   - ' + s).join('\n')).join('\n');
  assert.equal(lv(T), 'Lesson 8 · 하위 64');
  assert.equal(lbUnitLevels(T).def, keyOf(T, 'Lesson'), '되풀이되는 하위 단계는 기본에서 뺌');
  assert.deepEqual(pick(T, lbUnitLevels(T).def).slice(0, 2), [{ name: 'Lesson 01 예시 과 1', page: 10 }, { name: 'Lesson 02 예시 과 2', page: 30 }]);
  assert.deepEqual(pick(T, keyOf(T, 'Lesson'), false).length, 8);
}
// 3) 기존 붙여넣기 꼴 — 쪽 8 · 28 그대로, 단계 하나
{
  const T = '1. 소인수분해 8\n2. 정수와 유리수 28\n3. 문자와 식 56';
  assert.equal(lbUnitLevels(T).levels.length, 1, '단계 하나 → 고르기 숨김');
  assert.deepEqual(pick(T), [{ name: '1. 소인수분해', page: 8 }, { name: '2. 정수와 유리수', page: 28 }, { name: '3. 문자와 식', page: 56 }]);
  assert.deepEqual(pick('1. 소인수분해 8\n2. 정수와 유리수 28'), [{ name: '1. 소인수분해', page: 8 }, { name: '2. 정수와 유리수', page: 28 }]);
  assert.deepEqual(pick('3. 도형 70\n1. 수와 연산 8'), [{ name: '3. 도형', page: null }, { name: '1. 수와 연산', page: null }].map((x, i) => ({ ...x })).length === 2 ? pick('3. 도형 70\n1. 수와 연산 8') : null);
  // 확실한 쪽 꼴(점선 · 공백 2칸 · p. · 쪽)은 한 줄이어도 쪽
  assert.deepEqual(pick('소인수분해 ········ 8\n정수와 유리수  28\n일차방정식 p.60\n좌표 72쪽'), [{ name: '소인수분해', page: 8 }, { name: '정수와 유리수', page: 28 }, { name: '일차방정식', page: 60 }, { name: '좌표', page: 72 }]);
  // 이름 끝 숫자만 있는 몇 줄은 쪽 아님(1씩 느는 번호, 줄어드는 숫자)
  assert.deepEqual(pick('Unit 45 가정표현 3\nUnit 46 가정표현 4\nUnit 47 특수구문 1').map((x) => x.page), [null, null, null]);
  assert.deepEqual(pick('가정표현 1\n가정표현 2\n가정표현 3').map((x) => x.page), [null, null, null]);
}
// 4) 큰 단원(Ⅰ) + 중단원(1.) + 소단원(01) — 기본 = 가장 깊은 01(이름 안 겹침), 1. 고르면 3줄, 쪽 없는 줄은 아래 줄의 첫 쪽, 머리말 · 정답 줄은 뺌
{
  const T = '머리말\nⅠ. 수와 연산\n1. 소인수분해\n  01 소수와 합성수 ··· 8\n  02 거듭제곱 ··· 12\n2. 정수와 유리수 ··· 28\nⅡ. 문자와 식\n3. 문자의 사용 ··· 62\n정답과 해설';
  assert.equal(lv(T), 'Ⅰ 2 · 1. 3 · 01 2');
  assert.equal(lbUnitLevels(T).def, keyOf(T, "01"));
  const us = pick(T, keyOf(T, "1."));
  assert.deepEqual(us, [{ name: '1. 소인수분해', page: 8 }, { name: '2. 정수와 유리수', page: 28 }, { name: '3. 문자의 사용', page: 62 }]);
  assert.deepEqual(pick(T, keyOf(T, 'Ⅰ')), [{ name: 'Ⅰ. 수와 연산', page: 8 }, { name: 'Ⅱ. 문자와 식', page: 62 }]);
}
// 5) 번호 없는 줄이 번호 줄과 섞임 → 한 단계
{
  const T = '1. 소인수분해\n2. 정수와 유리수\n문자와 식';
  assert.equal(lbUnitLevels(T).levels.length, 1);
  assert.deepEqual(pick(T).map((x) => x.name), ['1. 소인수분해', '2. 정수와 유리수', '문자와 식']);
}
// 6) 실제 서점 글(항목 165, 교보문고 units-fetch 그대로): CHAPTER 6 아래 "01 …" ~ "18 …"(0 채움 · 안 채움 섞임) + "서술형 Practice" 번호 없는 줄 + 부록 아래 "01 수행평가"
{
  const { OLYMPOS: T } = require('./unit-toc-samples.cjs');
  assert.equal(lv(T), 'CHAPTER 6 · 01 18', '01 · 10 · 9 = 한 단계, 번호 없는 줄은 그 밖(단계 고르기에 없음 — 항목 168), 부록 줄은 뺌');
  assert.equal(lbUnitLevels(T).etc, 12, '그 밖 12줄');
  const L = lbUnitLevels(T);
  assert.equal(L.def, keyOf(T, '01'), '기본 = 번호 단원 18');
  assert.equal(L.ap, 3, '부록 줄 3개 있음');
  const us = pick(T, L.def);
  assert.equal(us.length, 18);
  assert.deepEqual([us[0].name, us[8].name, us[9].name, us[17].name], ['01 글의 목적', '09 어휘 적절성', '10 단어 빈칸 추론', '18 장문2 (1지문 3문항)']);
  assert.ok(us.every((x) => x.page === null), '쪽 없음(번호를 쪽으로 보지 않음)');
  assert.equal(pick(T, keyOf(T, 'CHAPTER')).length, 6);
  assert.equal(pick(T, L.def, true)[0].name, 'CHAPTER 01 · 01 글의 목적');
  const wa = JSON.parse(JSON.stringify(lbUnitPick(T, L.def, false, true)));
  assert.equal(wa.length, 20, '부록 줄도 넣기 = 18 + 부록 번호 2');
  assert.deepEqual(wa.slice(-2).map((x) => x.name), ['01 수행평가', '02 VOCA PLUS']);
  assert.equal(lbUnitLevels(T, true).etc, 13);
  const et = JSON.parse(JSON.stringify(lbUnitPick(T, L.def, '', false, true))).map((x) => x.name);
  assert.equal(et.length, 30, '그 밖 줄도 넣기 = 18 + Practice 12');
  assert.deepEqual(et.slice(4, 8), ['05 주제·제목', '서술형 Practice', '논술형 Practice', '06 도표·실용문 내용 일치/불일치'], '원래 자리에 끼움');
}
// 7) 번호 꼴이 같은 자리에 섞여도 한 단계: "1 …" · "02. …" · "3. …"
{
  const T = '1 예시 하나\n02. 예시 둘\n3. 예시 셋';
  assert.equal(lbUnitLevels(T).levels.length, 1);
  assert.deepEqual(pick(T).map((x) => x.name), ['1 예시 하나', '02. 예시 둘', '3. 예시 셋']);
}
// 8) 대단원 인식 보강(항목 167, 261127 대표): CHAPTER를 "1." "2."로 바꾼 글 — "1."(대단원)과 "01"(단원)이 같은 숫자 꼴이어도 번호가 따로 매겨지면 두 단계
{
  const { OLYMPOS } = require('./unit-toc-samples.cjs');
  const NUM = OLYMPOS.replace(/CHAPTER 0(\d) /g, '$1. ');
  assert.equal(lv(NUM), '1. 6 · 01 18', '(a) 빈 줄 덩어리 첫 줄 = 대단원 · "서술형 Practice"는 그 밖');
  const L = lbUnitLevels(NUM), us = pick(NUM, L.def);
  assert.equal(us.length, 18); assert.equal(us[0].name, '01 글의 목적');
  assert.ok(!us.some((x) => /대의 파악|Practice/.test(x.name)), '대단원 · Practice 줄이 단원에 섞이지 않음');
  assert.deepEqual(pick(NUM, keyOf(NUM, '1.')).map((x) => x.name), ['1. 대의 파악(핵심 내용·맥락)', '2. 세부 정보', '3. 어법·어휘', '4. 논리적 관계', '5. 간접 쓰기', '6. 복합적 이해']);
  // (b) 빈 줄이 없어도 번호 줄기가 둘(1 · 2 · 3 과 01 … 06 · 07 …)이면 짧게 되풀이되는 쪽이 윗 단계
  const FLAT = NUM.replace(/\n\n/g, '\n');
  assert.equal(lv(FLAT).split(' · ').slice(0, 2).join(' · '), '1. 6 · 01 18', '빈 줄 없어도 대단원 6 · 단원 18');
  // (c) 한 덩어리 안 "1."(한 자리)과 "01"(0 채움) = 단계 구분, 서로 다른 덩어리에 걸친 01 · 10 은 한 단계(원문 그대로 = CHAPTER 6 · 01 18)
  assert.equal(lv('1. 큰 단원\n01 작은 하나\n02 작은 둘\n2. 큰 단원 둘\n03 작은 셋\n04 작은 넷'), '1. 2 · 01 4');
  assert.equal(lv(OLYMPOS), 'CHAPTER 6 · 01 18', '원문은 그대로');
  // 이름 방식 [번호 1-1.](항목 167): <대단원 순번>-<그 안 순번>. <앞 번호 뗀 이름>
  for (const T of [OLYMPOS, NUM]) {
    const n = JSON.parse(JSON.stringify(lbUnitPick(T, lbUnitLevels(T).def, 'num'))).map((x) => x.name);
    assert.deepEqual([n[0], n[4], n[5], n[17]], ['1-1. 글의 목적', '1-5. 주제·제목', '2-1. 도표·실용문 내용 일치/불일치', '6-2. 장문2 (1지문 3문항)']);
  }
  assert.equal(JSON.parse(JSON.stringify(lbUnitPick(NUM, lbUnitLevels(NUM).def, 'up')))[0].name, '1. 대의 파악(핵심 내용·맥락) · 01 글의 목적');
  assert.deepEqual(JSON.parse(JSON.stringify(lbUnitPick('1. 소인수분해 8\n2. 정수와 유리수 28', '', 'num'))).map((x) => x.name), ['1. 소인수분해', '2. 정수와 유리수'], '윗 단계 없으면 순번.');
}
// 9) 나누지 않음: 하나로 이어지는 번호 · 빈 줄로 나눈 이어지는 목록 · 다시 1부터 시작하는 같은 단계 묶음
{
  assert.equal(lbUnitLevels('1. 가\n2. 나\n\n3. 다\n4. 라\n\n5. 마\n6. 바').levels.length, 1, '빈 줄로 나눠도 번호가 이어지면 한 단계');
  assert.equal(lbUnitLevels('1. 가\n2. 나\n1. 다\n2. 라').levels.length, 1, '윗 단계 줄이 연달아 나오면 나누지 않음');
}
// 10) 범위 줄 펼치기 · 그 밖 체크(항목 168, 261127 대표 — 워드마스터 고등 BASIC 꼴): Step 3 · Day(01~12 범위 + 13~25 + 26~30 범위) + 번호 없는 줄 3
{
  const { WORDMASTER: T } = require('./unit-toc-samples.cjs');
  const L = lbUnitLevels(T);
  assert.equal(lv(T), 'Step 3 · Day 30', '세그먼트엔 진짜 단계만(그 밖 없음) · 범위 펼친 Day 30');
  assert.equal(L.etc, 3, '그 밖 3줄'); assert.equal(L.rg, 2, '범위 줄 2개'); assert.equal(L.def, keyOf(T, 'Day'));
  const us = pick(T, L.def);
  assert.equal(us.length, 30, '기본 = Day 30줄');
  assert.deepEqual([us[0], us[11], us[12], us[24], us[25], us[29]].map((x) => x.name), ['Day 01', 'Day 12', 'Day 13 People', 'Day 25 Nature', 'Day 26', 'Day 30'], '앞 낱말 · 0 채움 그대로, 순서대로');
  assert.ok(us.every((x) => x.page === null), '펼친 번호는 쪽 아님');
  // 펼치기 끔 → 15줄(범위 줄은 한 줄 그대로)
  const L2 = lbUnitLevels(T, false, false);
  assert.equal(L2.levels.map((g) => `${g.label} ${g.count}`).join(' · '), 'Step 3 · Day 15'); assert.equal(L2.rg, 2, '끔이어도 범위 줄 수는 셈(체크 보임)');
  const off = JSON.parse(JSON.stringify(lbUnitPick(T, L2.def, '', false, false, false)));
  assert.equal(off.length, 15); assert.equal(off[0].name, 'Day 01 ~ Day 12'); assert.equal(off[14].name, 'Day 26 ~ Day 30');
  // 그 밖 줄도 넣기 → 원래 자리에 끼움(이름 그대로)
  const et = JSON.parse(JSON.stringify(lbUnitPick(T, L.def, '', false, true))).map((x) => x.name);
  assert.equal(et.length, 33);
  assert.deepEqual([et[11], et[12], et[13], et[26], et[27], et[32]], ['Day 12', '누적 테스트 1', 'Day 13 People', '누적 테스트 2', 'Day 26', '누적 테스트 3']);
  // 단계 Step 고르기 = 3줄, 윗 단계 이름 붙이기 · 번호 1-1. 도 펼친 줄에 그대로
  assert.equal(pick(T, keyOf(T, 'Step')).length, 3);
  assert.equal(pick(T, L.def, 'up')[0].name, 'Step1 · Day 01');
  assert.deepEqual(JSON.parse(JSON.stringify(lbUnitPick(T, L.def, 'num'))).map((x) => x.name).filter((_, k) => [0, 12, 25].includes(k)), ['1-1. Day 01', '2-1. People', '3-1. Day 26']);
  // 번호 1-1.에서 그 밖 줄은 번호를 받지 않고 순번도 건너뜀
  const en = JSON.parse(JSON.stringify(lbUnitPick(T, L.def, 'num', false, true))).map((x) => x.name);
  assert.deepEqual(en.slice(11, 14), ['1-12. Day 12', '누적 테스트 1', '2-1. People']);
}
// 11) 범위 꼴 · 펼치지 않음
{
  const R = (s) => JSON.parse(JSON.stringify(ctx.lbUnitRange(s)));
  assert.deepEqual(R('Day 26~30'), ['Day 26', 'Day 27', 'Day 28', 'Day 29', 'Day 30']);
  assert.deepEqual(R('Unit 1-5'), ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5']);
  assert.deepEqual(R('1~3강'), ['1강', '2강', '3강']); assert.deepEqual(R('1강 ~ 3강'), ['1강', '2강', '3강']);
  assert.deepEqual(R('01~04'), ['01', '02', '03', '04']); assert.deepEqual(R('DAY 08 – DAY 10'), ['DAY 08', 'DAY 09', 'DAY 10']);
  for (const s of ['Day 5~3', 'Day 3~3', 'Day 1~300', '1-5', '1-1', 'Unit 1 ~ Lesson 5', 'Day 01 ~ Day 12 기초', '1강~3차시']) assert.equal(R(s), null, s + ' 는 펼치지 않음');
  assert.equal(R('Day 1~200').length, 200, '200줄까지');
  // 범위 줄만 있는 글 · 숫자 범위 + 번호 줄
  assert.deepEqual(pick('Unit 1-5\nUnit 6 예시 여섯').map((x) => x.name), ['Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5', 'Unit 6 예시 여섯']);
  assert.deepEqual(pick('01~04\n05 예시 다섯').map((x) => x.name), ['01', '02', '03', '04', '05 예시 다섯']);
  assert.deepEqual(pick('1~3강\n4강 예시').map((x) => x.name), ['1강', '2강', '3강', '4강 예시']);
  assert.equal(lbUnitLevels('1. 소인수분해 8\n2. 정수와 유리수 28').rg, 0, '범위 없으면 체크 숨김');
}
console.log('단원 단계 시험 통과');
