// 관리 앱 재무 확인 창(261124 앱 클릭 점검) — 예시 데이터만, 서버·네트워크 없음.
// 확인: ① [기타경비 청구] 창의 "붙은 기타경비"가 클래스 쪽 연결(실제 자료 = 클래스 `기타경비`)도 센다
//       ② 확인 단추를 누르면 노션에 쓰는 동안 "노션에 쓰는 중…"으로 잠기고, 실패해 창이 남으면 원래 이름으로 풀린다
// 사용: ROOT=<저장소 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-finance-dialog.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('.it[data-scr="bill"]').click()); await p.waitForTimeout(500);
  await p.evaluate(() => { const s = document.querySelector('#view [data-sub="g"]'); if (s) s.click(); }); await p.waitForTimeout(500);
  // ① 실제 자료 모양: 기타경비 쪽 classIds 없이 클래스 etcIds만
  const cname = await p.evaluate(() => {
    const e = (DB.etcs || []).find((x) => !x.del); if (!e) return null;
    (DB.etcs || []).forEach((x) => { delete x.classIds; });
    const tr = document.querySelector('#view tr[data-id]'); const c = DB.classes.find((x) => x.id === tr.dataset.id);
    DB.classes.forEach((x) => { x.etcIds = []; }); c.etcIds = [e.id]; render(); return c.name;
  });
  if (!cname) bad.push('예시 기타경비가 없음');
  await p.waitForTimeout(300);
  const etcBtn = p.locator('#view tr[data-id]').first().locator('button', { hasText: '기타경비 청구' });
  if (!(await etcBtn.count())) bad.push('기타경비 청구 단추가 없음');
  else {
    await etcBtn.click(); await p.waitForTimeout(300);
    const txt = await p.evaluate(() => (document.querySelector('.modal') || document.body).innerText.replace(/\s+/g, ' '));
    if (!/붙은 기타경비 1개/.test(txt)) bad.push('붙은 기타경비가 1개로 안 보임: ' + (txt.match(/붙은 기타경비[^가-힣]*\S+/) || [''])[0]);
    // ② 느린 쓰기(실패 — 창은 남김)
    await p.evaluate(() => { window.finRun = () => new Promise((r) => setTimeout(r, 800)); });
    await p.locator('#fnO').click(); await p.waitForTimeout(150);
    const during = await p.evaluate(() => { const o = document.querySelector('#fnO'); return o && { dis: o.disabled, t: o.textContent }; });
    if (!during || !during.dis || during.t !== '노션에 쓰는 중…') bad.push('쓰는 동안 잠기지 않음: ' + JSON.stringify(during));
    await p.locator('#fnO').click({ force: true }).catch(() => {});
    await p.waitForTimeout(1000);
    const after = await p.evaluate(() => { const o = document.querySelector('#fnO'); return o && { dis: o.disabled, t: o.textContent }; });
    if (!after || after.dis || after.t !== '기타경비 청구') bad.push('끝난 뒤 단추가 풀리지 않음: ' + JSON.stringify(after));
  }
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log('✅ 재무 확인 창 통과(기타경비 수 · 쓰는 중 잠금)');
})();
