// 관리 앱 학교 실제 연결(261123, 옛 학교 검색 웹 화면에서 옮김) — 가짜 서버로만. 실제 자료 모드(?live=1)에서
// [학교 검색]이 school-api(meta · search · link)를, [학교 추가]가 app-api save create(학교 DB 이름만) 뒤 link를,
// [학사일정 가져오기]가 sync-school-calendar(start)를 같은 값 이름으로 부르는지. 학교 칸 고치기는 보기만 그대로. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-school-live.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333', NEW = '44444444-4444-4444-8444-444444444444';
const ROWS = [
  { id: A, props: { '이름': '예시중', '학교 구분': '중학교', '주소': '예시시 예시로 1', '학교 코드': '7000001' } },
  { id: B, props: { '이름': '하다고', '학교 구분': '고등학교', '주소': '', '학교 코드': '' } },
  { id: C, props: { '이름': '한빛초', '학교 구분': '초등학교', '주소': '', '학교 코드': '' } },
];
const FOUND = [
  { name: '예시중학교', office: 'J10', code: '7000001', address: '예시시 예시로 1', kind: '중학교', website: '' },
  { name: '하다고등학교', office: 'J10', code: '7000002', address: '예시시 하다로 2', kind: '고등학교', website: 'https://example.com' },
  { name: '새빛중학교', office: 'J10', code: '7000003', address: '예시시 새빛로 3', kind: '중학교', website: '' },
];
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open(opt = {}) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [];
    const rows = JSON.parse(JSON.stringify(ROWS));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {}, key = req.headers()['x-admin-key'];
      calls.push({ fn, action: q.action, key, body: q });
      if (fn === 'school-api') {
        assert.equal(key, 'sess-1', 'school-api에 관리자 세션');
        if (q.action === 'meta') return reply(route, 200, { schools: rows.map((r) => ({ id: r.id, name: r.props['이름'], address: r.props['주소'], code: r.props['학교 코드'] })) });
        if (q.action === 'search') return reply(route, 200, { schools: FOUND.filter((s) => s.name.includes(q.query.replace(/(중|고|초)$/, '')) || q.query === '예시') });
        if (q.action === 'link') {
          if (opt.linkFail) return reply(route, 409, { error: '이미 연결된 학교입니다. 기존 학교를 사용하세요.' });
          const r = rows.find((x) => x.id === q.pageId), s = FOUND.find((x) => x.code === q.code);
          if (r && s) Object.assign(r.props, { '학교 코드': s.code, '주소': s.address, '학교 구분': s.kind });
          return reply(route, 200, { ok: true, name: s.name, pageId: q.pageId, message: '학교가 연결됐습니다.' });
        }
        return reply(route, 400, { error: '지원하지 않는 action' });
      }
      if (fn === 'sync-school-calendar') return reply(route, 202, { accepted: true, pageId: q.pageId });
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '학교(학원) DB' ? rows : [] });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
        if (q.action === 'save') { const c = q.changes[0]; rows.push({ id: NEW, props: { '이름': c.props['이름'], '학교 구분': '', '주소': '', '학교 코드': '' } }); return reply(route, 200, { ok: true, results: [{ i: 0, ok: true, id: NEW }] }); }
        if (q.action === 'run') return reply(route, 200, { ok: true, changed: 1, syncedAt: new Date().toISOString() });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1${opt.q || ''}`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.evaluate(() => openScreen('schools'));
    await page.waitForSelector('#view [data-act2="aFind"]');
    return { page, calls, errors, rows };
  }
  // 아래 줄 단추는 DOM click으로(Playwright click이 이 단추에서 멈춤 — DOM click · 사람 클릭은 됨)
  const act = async (page, id) => { await page.waitForSelector(`#view [data-act2="${id}"]`); await page.$eval(`#view [data-act2="${id}"]`, (x) => x.click()); };
  const of = (calls, fn, a) => calls.filter((c) => c.fn === fn && (!a || c.action === a));
  const noOverflow = async (page, name) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': 가로 넘침');
  const waitFor = async (page, f) => { for (let k = 0; k < 60 && !f(); k++) await page.waitForTimeout(200); };
  // 1) 학교 화면: 옛 안내(노션 [학교 검색]) 없음, [학교 검색] · [학사일정 가져오기]는 눌림, 줄 추가는 꺼짐
  {
    const { page, errors } = await open();
    await page.evaluate(() => render()); // 안내 줄은 다음 그리기부터(화면을 연 첫 그리기는 노션 자료 받기 전 판정 — 기존 동작)
    const view = await page.textContent("#view");
    assert.doesNotMatch(view, /노션 학교 페이지의 \[학교 검색\]/, '옛 안내 없음');
    assert.equal(await page.textContent('#pgStat .ro-line'), '이름 · 기간은 노션에서 고쳐요', '보기만 안내 = 상태 묶음 안 한 줄(제목 아래 설명 줄 없음)');
    assert.equal(await page.evaluate(() => !!document.querySelector('#view > .ro-line')), false, '제목 아래 설명 줄 없음');
    assert.equal(await page.isDisabled('#view [data-act2="aFind"]'), false, '[학교 검색] 눌림');
    assert.equal(await page.$('#view [data-act2="aCal"]'), null, '공용 창에 [학사일정 가져오기] 묶음 단추 없음(학교 창에서 한 곳씩)');
    await page.screenshot({ path: shots + 'school-live-list.png' });
    assert.deepEqual(errors, []); done.push('학교 화면'); await page.close();
  }
  // 2) 검색 → 이미 연결된 학교는 못 고름, 이름 같은 학교(코드 없음)는 [학교 코드 연결], 새 학교는 [학교 추가] → save create → link → 사본 맞추기
  {
    const { page, calls, errors } = await open();
    await act(page, 'aFind'); await page.waitForSelector('.dlg #nsQ');
    assert.equal(await page.inputValue('.dlg #nsT'), '', '처음엔 새 학교로 추가');
    await page.fill('.dlg #nsQ', '예시'); await page.fill('.dlg #nsR', '예시시'); await page.press('.dlg #nsQ', 'Enter');
    await page.waitForSelector('.dlg [data-ns="2"]');
    assert.deepEqual(of(calls, 'school-api').map((c) => c.body), [{ action: 'meta' }, { action: 'search', query: '예시', region: '예시시' }]);
    assert.equal(await page.isDisabled('.dlg [data-ns="0"]'), true, '이미 연결된 학교(같은 학교 코드)는 못 고름');
    assert.equal((await page.textContent('.dlg [data-ns="1"]')).trim(), '학교 코드 연결', '이름 같은 하다고(코드 없음)');
    assert.equal((await page.textContent('.dlg [data-ns="2"]')).trim(), '학교 추가');
    await noOverflow(page, '검색'); await page.screenshot({ path: shots + 'school-live-search.png' });
    await page.click('.dlg [data-ns="2"]');
    await page.waitForFunction(() => !document.querySelector('.dlg #nsQ'), null, { timeout: 10000 });
    assert.deepEqual(of(calls, 'app-api', 'save')[0].body.changes.map((c) => ({ op: c.op, db: c.db, props: c.props })), [{ op: 'create', db: '학교(학원) DB', props: { '이름': '새빛중' } }], '새 학교 = 짧은 이름만 앱 저장 길로');
    assert.deepEqual(of(calls, 'school-api', 'link')[0].body, { action: 'link', pageId: NEW, office: 'J10', code: '7000003' });
    await waitFor(page, () => of(calls, 'app-api', 'run').length);
    assert.deepEqual(of(calls, 'app-api', 'run').map((c) => c.body), [{ action: 'run', name: 'sync-copy', dbs: ['학교(학원) DB'], full: true }], '추가 뒤 학교 사본 맞추기');
    await page.waitForFunction((id) => DB.schools.some((s) => s.id === id && s.code && s.name === '새빛중'), NEW, { timeout: 10000 });
    assert.equal(await page.evaluate(() => dirtyCount()), 0, '노션에 이미 들어감 — [저장] 숫자 0');
    await page.waitForTimeout(400); await page.screenshot({ path: shots + 'school-live-added.png' });
    // 같은 창에서 이름 같은 학교에 코드 붙이기
    assert.equal(await page.evaluate(() => activeTab.state.sel), NEW, '추가한 학교 줄이 골라짐');
    await page.evaluate(() => { activeTab.state.sel = null; render(); }); // 줄을 안 고른 창의 아래 줄 단추
    await act(page, 'aFind'); await page.fill('.dlg #nsQ', '하다고'); await page.press('.dlg #nsQ', 'Enter');
    await page.waitForSelector('.dlg [data-ns="0"]'); await page.click('.dlg [data-ns="0"]');
    await page.waitForFunction(() => !document.querySelector('.dlg #nsQ'), null, { timeout: 10000 });
    assert.deepEqual(of(calls, 'school-api', 'link')[1].body, { action: 'link', pageId: B, office: 'J10', code: '7000002' });
    assert.equal(of(calls, 'app-api', 'save').length, 1, '코드 연결은 새 페이지를 만들지 않음');
    await page.waitForFunction((id) => DB.schools.some((s) => s.id === id && s.code && s.name === '하다고'), B, { timeout: 10000 });
    assert.deepEqual(errors, []); done.push('추가 · 이름 같은 학교 코드 연결'); await page.close();
  }
  // 3) [연결할 학교]로 고른 학교(코드 없음)에 다른 이름의 나이스 학교 코드를 붙임 · 줄을 고른 채 열면 그 학교가 골라져 있음
  {
    const { page, calls, errors } = await open();
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, C);
    await page.evaluate(() => schoolFind());
    await page.waitForSelector('.dlg #nsT');
    assert.equal(await page.inputValue('.dlg #nsT'), C, '고른 줄이 연결할 학교');
    assert.equal(await page.inputValue('.dlg #nsQ'), '한빛초');
    await page.fill('.dlg #nsQ', '새빛중'); await page.press('.dlg #nsQ', 'Enter');
    await page.waitForSelector('.dlg [data-ns="0"]');
    assert.match(await page.textContent('.dlg .nsl'), /'한빛초'에 학교 코드를 붙여요/);
    await page.screenshot({ path: shots + 'school-live-target.png' });
    await page.click('.dlg [data-ns="0"]');
    await page.waitForFunction(() => !document.querySelector('.dlg #nsQ'), null, { timeout: 10000 });
    assert.deepEqual(of(calls, 'school-api', 'link')[0].body, { action: 'link', pageId: C, office: 'J10', code: '7000003' });
    assert.equal(of(calls, 'app-api', 'save').length, 0);
    assert.deepEqual(errors, []); done.push('연결할 학교'); await page.close();
  }
  // 4) 코드 붙이기를 서버가 거절하면(409) 이유를 창에 그대로, 만든 페이지는 코드 없는 학교로 남기고 연결할 학교로 골라 둠
  {
    const { page, calls, errors } = await open({ linkFail: true });
    await act(page, 'aFind'); await page.fill('.dlg #nsQ', '새빛중'); await page.press('.dlg #nsQ', 'Enter');
    await page.waitForSelector('.dlg [data-ns="0"]'); await page.click('.dlg [data-ns="0"]');
    await page.waitForFunction(() => /이미 연결된 학교/.test(document.querySelector('.dlg #nsL').textContent), null, { timeout: 10000 });
    assert.equal(await page.inputValue('.dlg #nsT'), NEW, '만든 페이지를 연결할 학교로');
    assert.equal(await page.evaluate((id) => DB.schools.filter((s) => s.id === id && !s.code).length, NEW), 1);
    assert.equal(of(calls, 'app-api', 'save').length, 1);
    assert.deepEqual(errors, []); done.push('연결 거절'); await page.close();
  }
  // 5) [학사일정 가져오기] = 학교 창 [학사일정] 묶음 안, 그 학교 하나만 → sync-school-calendar start, 맡긴 뒤 꺼짐(두 번 맡기지 않음) · 코드 없는 학교는 꺼짐 + 이유
  {
    const { page, calls, errors } = await open();
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, B);
    assert.equal(await page.isDisabled(`.panel [data-schcal="${B}"]`), true, '코드 없는 학교는 꺼짐');
    assert.match(await page.textContent('.panel .schcal'), /학교 코드가 없어요/);
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, A);
    assert.equal(await page.isDisabled(`.panel [data-schcal="${A}"]`), false, '코드 있는 예시중은 눌림(보기만 화면이어도)');
    await page.click(`.panel [data-schcal="${A}"]`); await page.waitForSelector('.dlg #co');
    assert.match(await page.textContent('.dlg'), /예시중/);
    await page.click('.dlg #co');
    await waitFor(page, () => of(calls, 'sync-school-calendar').length);
    assert.deepEqual(of(calls, 'sync-school-calendar').map((c) => c.body), [{ action: 'start', pageId: A }]);
    assert.equal(of(calls, 'sync-school-calendar')[0].key, 'sess-1');
    await page.waitForFunction((id) => { const b = document.querySelector(`.panel [data-schcal="${id}"]`); return b && b.disabled; }, A, { timeout: 10000 });
    assert.match(await page.textContent('.panel .schcal'), /맡겼어요/);
    await page.screenshot({ path: shots + 'school-live-cal.png' });
    assert.deepEqual(errors, []); done.push('학사일정 가져오기'); await page.close();
  }
  // 6) 학교 칸 고치기는 보기만 그대로 · 학생에 없는 학교 이름을 적으면 앱이 학교를 만들지 않음(옛 안내 대신 [학교 › 학교 검색])
  {
    const { page, errors } = await open();
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, B);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.panel input:not([type=checkbox])')].every((i) => i.readOnly || i.disabled)), true, '학교 창 칸은 잠김');
    const msg = await page.evaluate(() => { DB.schools.push({ id: 'sc_tmp', name: '없는중', kind: '중학교', addr: '', state: 'draft' }); render(); return [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '); });
    assert.equal(await page.evaluate(() => DB.schools.some((s) => s.id === 'sc_tmp')), false, '앱에서 생긴 학교 줄은 뺌');
    assert.match(msg, /\[학교 › 학교 검색\]/);
    assert.deepEqual(errors, []); done.push('보기만 · 학생 학교'); await page.close();
  }
  // 7) 노션 학교 페이지 [학교 검색] 링크(&school=<id, 대시 없음>): 학교 화면 · 그 줄 · 코드 없으면 [학교 검색] 창(연결할 학교 = 그 학교), 주소에서 school= 지움
  {
    const { page, errors } = await open({ q: '&school=' + B.replace(/-/g, '') });
    await page.waitForSelector('.dlg #nsT', { timeout: 15000 });
    assert.equal(await page.inputValue('.dlg #nsT'), B);
    assert.equal(await page.evaluate(() => activeTab.screen + ' ' + activeTab.state.sel), 'schools ' + B);
    assert.doesNotMatch(await page.evaluate(() => location.search), /school=/);
    await page.screenshot({ path: shots + 'school-live-link.png' });
    assert.deepEqual(errors, []); done.push('노션 링크'); await page.close();
  }
  console.log('학교 실제 연결 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
