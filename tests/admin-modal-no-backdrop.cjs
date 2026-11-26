// 관리 앱 팝업(모달)은 단추로만 닫힘(항목 163, 261126) — 바깥(어두운 배경) 클릭 · Esc로는 안 닫히고 입력한 값이 남는다.
// 확인 창(askRun) · 입력이 있는 창(modal) · 시간표 화면의 Esc. 닫힘은 [취소] · [저장]으로만. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-modal-no-backdrop.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${origin}/prototype/admin-app/hada-admin.html`); await page.waitForSelector('#view', { timeout: 15000 });
  const open = () => page.locator('#modalRoot .dlg').count();
  const away = async () => { await page.mouse.click(8, 8); await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
  // 1) 확인 창(askRun): 배경 · Esc로 안 닫힘, [취소]로 닫힘, 실행 함수는 안 불림
  await page.evaluate(() => { window.__ran = 0; askRun('삭제할까요?', '<p>예시</p>', '삭제', () => { window.__ran++; }); });
  await page.waitForSelector('#modalRoot .dlg');
  await away(); assert.equal(await open(), 1, '확인 창: 배경 · Esc 뒤에도 열려 있음');
  assert.equal(await page.locator('#modalRoot .dlg.nudge').count(), 1, '배경을 누르면 창이 살짝 눌렸다 돌아옴');
  await page.click('#modalRoot #cc'); assert.equal(await open(), 0, '확인 창: [취소]로 닫힘'); assert.equal(await page.evaluate(() => window.__ran), 0);
  // 2) 입력 있는 창(modal): 쓴 글이 배경 클릭 · Esc 뒤에도 남고, [저장]으로 닫힘
  await page.evaluate(() => { window.__saved = null; modal('<h2>예시 창</h2><input class="inp" id="tx"><div class="actions"><button class="btn" id="cc">취소</button><button class="btn pri" id="co">저장</button></div>', (m, close) => { m.querySelector('#cc').onclick = close; m.querySelector('#co').onclick = () => { window.__saved = m.querySelector('#tx').value; close(); }; }); });
  await page.fill('#modalRoot #tx', '입력하던 글'); await away();
  assert.equal(await page.inputValue('#modalRoot #tx'), '입력하던 글', '입력 창: 값이 그대로');
  await page.click('#modalRoot #co'); assert.equal(await open(), 0); assert.equal(await page.evaluate(() => window.__saved), '입력하던 글', '[저장]으로 닫히며 값 저장');
  // 3) 시간표 화면에서도 Esc로 안 닫힘(예전엔 시간표 키 처리가 창을 닫았음)
  await page.evaluate(() => { const i = [...document.querySelectorAll('.it[data-scr]')].find((x) => x.dataset.scr === 'timetable'); if (i) i.click(); }); await page.waitForTimeout(300);
  await page.evaluate(() => askRun('시간표 확인', '<p>예시</p>', '확인', () => {})); await page.focus('#modalRoot #co'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  assert.equal(await open(), 1, '시간표 화면: Esc로 안 닫힘'); await page.click('#modalRoot #cc'); assert.equal(await open(), 0);
  assert.deepEqual(errors, []); await b.close(); server.close(); console.log('팝업은 단추로만 닫힘 통과: 확인 창 · 입력 창 · 시간표 Esc');
})().catch((e) => { console.error(e); process.exit(1); });
