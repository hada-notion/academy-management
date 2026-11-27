// 단원 목록 시험 자료(항목 165) — 온라인 서점 단원 목록 글을 서버 units-fetch(교보문고)로 받은 그대로(2026-11-27, ISBN13 9788954786898 영어 독해 교재).
// CHAPTER 6개 아래 번호 단원 18개("01 …" ~ "18 …", 0 채움 · 안 채움 섞임) + 번호 없는 "서술형 Practice" 줄 + 부록 아래 번호 줄.
const OLYMPOS = "CHAPTER 01 대의 파악(핵심 내용·맥락)\n01 글의 목적\n02 심경(변화)·분위기\n03 주장·요지\n04 함축적 의미\n05 주제·제목\n서술형 Practice\n논술형 Practice\n\nCHAPTER 02 세부 정보\n06 도표·실용문 내용 일치/불일치\n07 학술문 내용 불일치\n서술형 Practice\n논술형 Practice\n\nCHAPTER 03 어법·어휘\n08 어법 정확성\n09 어휘 적절성\n서술형 Practice\n논술형 Practice\n\nCHAPTER 04 논리적 관계\n10 단어 빈칸 추론\n11 짧은 어구 빈칸 추론\n12 긴 어구 빈칸 추론\n서술형 Practice\n논술형 Practice\n\nCHAPTER 05 간접 쓰기\n13 무관한 문장 찾기\n14 글의 순서 배열\n15 문장 삽입\n16 요약문 완성\n서술형 Practice\n논술형 Practice\n\nCHAPTER 06 복합적 이해\n17 장문1 (1지문 2문항)\n18 장문2 (1지문 3문항)\n서술형 Practice\n논술형 Practice\n\n부록\n01 수행평가\n02 VOCA PLUS\n※ 꿀꺽 VOCA (PDF) - EBS/별도 탑재\n\n정답과 해설";
// 범위 줄 꼴(항목 168, 261127 대표 실측 워드마스터 고등 BASIC 목차 꼴): Step 3개 · "Day 01 ~ Day 12" 범위 줄 · Day 13 ~ 25 한 줄씩 · "Day 26 ~ Day 30" 범위 줄 + 번호 없는 줄 3(이름 · Step 머리 · Day 14~24 주제는 예시)
const WORDMASTER = ['Step1. 고등 핵심 어휘로 기초 세우기', 'Day 01 ~ Day 12', '누적 테스트 1', 'Step 2. 예시 주제별 어휘',
  ...['People', 'Food', 'Health', 'Home', 'School', 'Sports', 'Travel', 'Work', 'Money', 'Media', 'Science', 'Culture', 'Nature'].map((x, i) => `Day ${13 + i} ${x}`),
  '누적 테스트 2', 'Step 3. 예시 수능 어휘', 'Day 26 ~ Day 30', '누적 테스트 3'].join('\n');
module.exports = { OLYMPOS, OLYMPOS_ISBN: '9788954786898', WORDMASTER };
