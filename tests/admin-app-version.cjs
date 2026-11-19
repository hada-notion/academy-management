// 관리 앱 캐시 번호 검사: prototype/admin-app 의 js·css 를 바꾼 PR 은 hada-admin.html 의
// 그 파일 링크 ?v= 번호도 같이 올려야 한다(번호가 그대로면 이미 받은 브라우저가 옛 파일을 계속 쓴다).
// 사용: BASE_REF=origin/main node tests/admin-app-version.cjs   (BASE_REF 없으면 건너뜀)
const { execSync } = require('child_process');
const BASE = process.env.BASE_REF;
if (!BASE) { console.log('BASE_REF 없음 — 건너뜀'); process.exit(0); }
const DIR = 'prototype/admin-app/', HTML = DIR + 'hada-admin.html';
const fs = require('fs');
const sh = c => execSync(c, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const changed = sh(`git diff --name-only ${BASE}...HEAD -- ${DIR}`).split('\n').filter(f => /\.(js|css)$/.test(f));
if (!changed.length) { console.log('바뀐 js·css 없음 — 통과'); process.exit(0); }
const vers = html => { const o = {}; for (const m of html.matchAll(/(?:src|href)="([^"?]+)\?v=(\d+)"/g)) o[m[1]] = m[2]; return o; };
let before = {}; try { before = vers(sh(`git show ${BASE}:${HTML}`)); } catch (e) { }
const after = vers(fs.readFileSync(HTML, 'utf8'));
const errs = [];
for (const f of changed) {
  const name = f.slice(DIR.length);
  if (!(name in after)) continue; // hada-admin.html 이 불러오지 않는 파일(검사·도구)은 대상 아님
  if (before[name] && before[name] === after[name]) errs.push(`${name}: 파일을 바꿨는데 hada-admin.html 의 ?v=${after[name]} 가 그대로입니다`);
}
if (errs.length) { console.error(errs.join('\n') + '\n→ hada-admin.html 의 ?v= 번호를 올리세요(예: 전체를 새 번호 하나로).'); process.exit(1); }
console.log(`통과 — 바뀐 ${changed.length}개 파일의 ?v= 번호가 올라갔습니다`);
