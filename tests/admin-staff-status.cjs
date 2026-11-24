// 직원 재직 상태(v2.8.0 항목 135, 261124) — 예시 화면에서 퇴사일이 지난 직원이
// ① 직원 화면 [재직 | 퇴사] 탭에서 퇴사로만 보이고 ② 직원 고르기 목록(담당 강사 · 담당자)에서 빠지며
// ③ 이미 그 사람이 골라져 있던 칸에서는 그대로 보이는지 확인한다(실제 계정 · 네트워크 없음).
// 사용: NODE_PATH=<playwright 있는 node_modules> node tests/admin-staff-status.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const live = DB.teachers.filter((t) => !t.del && tStat(t) !== '퇴사');
    if (live.length < 2) return { skip: '예시 재직 직원이 2명보다 적음' };
    const gone = live[0], keep = live[1], off0 = DB.teachers.filter((t) => !t.del && tStat(t) === '퇴사').length;
    gone.quit = '2000-01-01'; // 어제보다 앞 = 퇴사
    const ids = (xs) => xs.map((x) => x.v);
    const pickNone = ids(tchPick('')), pickCur = ids(tchPick(gone.id));
    const on = LISTS.teachers_on.rows().map((t) => t.id), off = LISTS.teachers_off.rows().map((t) => t.id);
    const cnt = { on: LISTS.teachers.subCount('on'), off: LISTS.teachers.subCount('off') };
    const today = tStat(gone), keepStat = tStat(keep);
    gone.quit = TODAY; const sameDay = tStat(gone); // 퇴사일 당일 = 아직 재직
    gone.quit = '';
    return { gone: gone.id, keep: keep.id, pickNone, pickCur, on, off, cnt, today, keepStat, sameDay, total: live.length, off0 };
  });
  if (r.skip) { console.log('⚠️ ' + r.skip); process.exit(1); }
  if (r.today !== '퇴사') bad.push('퇴사일이 지났는데 상태가 ' + r.today);
  if (r.sameDay !== '재직') bad.push('퇴사일 당일인데 상태가 ' + r.sameDay + '(당일까지 재직)');
  if (r.pickNone.includes(r.gone)) bad.push('고르기 목록에 퇴사 직원이 보임');
  if (!r.pickNone.includes(r.keep)) bad.push('고르기 목록에 재직 직원이 빠짐');
  if (!r.pickCur.includes(r.gone)) bad.push('이미 고른 퇴사 직원이 그 칸 목록에서 사라짐');
  if (r.on.includes(r.gone) || !r.off.includes(r.gone)) bad.push('재직/퇴사 탭 거르기가 틀림');
  if (r.cnt.off !== r.off0 + 1 || r.cnt.on !== r.total - 1) bad.push('탭 숫자가 틀림 ' + JSON.stringify(r.cnt));
  // 화면: 직원 메뉴 탭 글자
  await p.evaluate(() => { const x = document.querySelector('.it[data-scr="teachers"]'); if (x) x.click(); }); await p.waitForTimeout(500);
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#view button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^(재직|퇴사)/.test(t)));
  if (tabs.length !== 2) bad.push('직원 화면 [재직 | 퇴사] 탭이 안 보임: ' + JSON.stringify(tabs));
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log('✅ 직원 재직 상태 통과 — 탭 ' + tabs.join(' · '));
})();
