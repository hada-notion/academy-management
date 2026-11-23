// 관리 앱 오른쪽 창 — 다른 줄을 바꿔 눌러도 창은 열린 채 내용만 바뀜(261124 대표).
// 예시 데이터(시제품 모드)만, 서버·네트워크 없음.
// 확인: 화면마다 줄 A → B → C를 차례로 눌러 창이 열린 채 내용이 바뀌고, 오늘 등원 학생은 같은 학생을 다시 누르면 닫힘.
// 사용: ROOT=<저장소 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-panel-switch.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
const JOBS = [
  ['lesson', { lv: 'att' }, '[data-lds]'],
  ['lesson', { lv: 'today' }, '[data-lpg]'],
  ['makeup', null, '[data-mksel]'],
  ['timetable', null, '#grid .blk[data-id]'],
  ['teachers', null, '#view tr[data-id]'],
  ['students', null, '#view tr[data-id]'],
  ['classes', null, '#view tr[data-id]'],
  ['enrolls', null, '#view tr[data-id]'],
  ['exams', null, '#view tr[data-id]'],
  ['schools', null, '#view tr[data-id]'],
  ['books', null, '#view tr[data-id]'],
];
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1500);
  const sig = () => p.evaluate(() => { const pn = document.querySelector('.body>.panel, #lp, #view #panel'); return pn ? (pn.innerText || '').slice(0, 80).replace(/\s+/g, ' ') : null; });
  for (const [scr, lv, sel] of JOBS) {
    const name = scr + (lv ? '/' + lv.lv : '');
    await p.evaluate((s) => { const x = document.querySelector(`.it[data-scr="${s}"]`); if (x) x.click(); }, scr); await p.waitForTimeout(400);
    if (lv) { await p.evaluate((o) => { Object.assign(activeTab.state, o); render(); }, lv); await p.waitForTimeout(300); }
    const n = await p.locator(sel).count();
    if (n < 3) { bad.push(`${name}: 고를 줄이 ${n}개`); continue; }
    let prev = null;
    for (const i of [0, 1, 2]) {
      const e = p.locator(sel).nth(i); await e.scrollIntoViewIfNeeded(); await e.click(); await p.waitForTimeout(350);
      const s = await sig();
      if (!s) bad.push(`${name}: ${i + 1}번째 줄을 누르니 창이 닫힘`);
      else if (prev && s === prev) bad.push(`${name}: ${i + 1}번째 줄을 눌러도 창 내용이 그대로`);
      prev = s;
    }
    if (scr === 'lesson' && lv.lv === 'att') {
      const e = p.locator(sel).nth(2); await e.click(); await p.waitForTimeout(350);
      if (await p.evaluate(() => !!document.querySelector('#panelAs'))) bad.push(`${name}: 같은 학생을 다시 눌러도 창이 안 닫힘`);
    }
    console.log(`${name} 확인`);
  }
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log('✅ 오른쪽 창 바꿔 누르기 통과');
})();
