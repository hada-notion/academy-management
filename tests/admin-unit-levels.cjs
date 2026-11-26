// 관리 앱 단원 편집 [나누기]의 단원 단계(항목 164) — livebook.js 순수 함수(lbUnitLevels · lbUnitPick)를 노드에서 바로 시험. 브라우저 없음.
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
console.log('단원 단계 시험 통과');
