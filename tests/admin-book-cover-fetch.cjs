// 관리 앱 라이브러리 [표지] 상자 [가져오기](항목 160, 261126) — ISBN13으로 교보문고 표지를 가져온다. 가짜 서버 · 가짜 그림으로만(교보문고를 실제로 부르지 않음).
// 확인: 예시 모드 ① ISBN 있음 → 가져오기 → 카드 · 표지 상자에 새 그림 ② ISBN 없음 → 흐림 + 도움말, 눌러도 바뀌지 않음 ③ 그림 실패 → 그대로 + 실패 알림 ④ 이미 표지 있으면 확인 창 ⑤ 프로그램은 단추 없음
//       실제 자료 모드(?live=1) ⑥ 가져오기 → 위 [저장] → 확인 창 → app-api save 본문 `북커버` 외부 주소 ⑦ 삭제 → `북커버` 빈 목록 ⑧ 안 건드린 줄은 `북커버`를 보내지 않음
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-book-cover-fetch.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const BK = '11111111-1111-4111-8111-111111111111', ISBN = '9790000000011';
const BOOK_ROW = (isbn) => ({ id: BK, props: { '교재명': '예시 수학 1', '구분': '교재', '시리즈': '', '출판사': '예시 출판', '전체 분량': 200, '진도 단위': 'P.-', '가격': 15000, '사용중': true, 'ISBN13': isbn } });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="170"><rect width="120" height="170" fill="#4a7"/></svg>';
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch();
  async function open(opts = {}) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [], img = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    await page.route(/contents\.kyobobook/, (route) => { img.push(route.request().url()); return opts.imgFail ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }); });
    await page.route(/kakao|nl\.go\.kr/, (route) => route.fulfill({ status: 404, body: '' }));
    if (opts.live) {
      const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
      await page.route(H + '**', async (route) => {
        const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
        const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
        calls.push({ fn, action: q.action, body: q });
        if (fn === 'app-api') {
          if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? [BOOK_ROW(opts.isbn ?? ISBN)] : [] });
          if (q.action === 'options') return reply(route, 200, { ok: true, dbs: { '라이브러리(학원) DB': { '시리즈': [], '출판사': ['예시 출판'] } } });
          if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
          if (q.action === 'save') return reply(route, 200, { ok: true, results: q.changes.map((c, i) => ({ i, ok: true, id: c.id, row: { id: c.id, props: { ...BOOK_ROW(opts.isbn ?? ISBN).props, '북커버': (c.props['북커버'] || []) } } })) });
          return reply(route, 200, { ok: true, syncedAt: new Date().toISOString() });
        }
        if (fn === 'textbook-api') return reply(route, 200, { units: [], series: [], duplicates: [] });
        return reply(route, 200, { ok: true, rows: [], items: [] });
      });
      await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
      await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    } else {
      await page.goto(`${origin}/prototype/admin-app/hada-admin.html`);
      await page.waitForFunction(() => typeof DB !== "undefined" && DB.books && DB.books.length, null, { timeout: 30000 });
    }
    await page.evaluate(() => openScreen('books'));
    return { page, calls, errors, img };
  }
  const pick = (page, id, set) => page.evaluate(([id, set]) => { const r = DB.books.find((x) => x.id === id); Object.assign(r, set || {}); activeTab.state.sel = id; panelOpen = true; render(); return r.id; }, [id, set]);
  const toastText = (page) => page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  const waitToast = (page, re) => page.waitForFunction((s) => new RegExp(s).test((document.querySelector('.toast') || {}).textContent || ''), re.source, { timeout: 10000 });

  // 예시 모드
  {
    const { page, errors, img } = await open();
    const id = await page.evaluate(() => DB.books.find((x) => x.kind === '교재').id);
    // ② ISBN 없음 → 흐림 + 도움말, 눌러도 안 바뀜
    await pick(page, id, { isbn: '', cover: '' });
    await page.waitForSelector('#lp [data-act="covGet"]');
    assert.match(await page.getAttribute('#lp [data-act="covGet"]', 'class'), /dim/);
    assert.equal(await page.getAttribute('#lp [data-act="covGet"]', 'title'), 'ISBN13을 먼저 넣어 주세요');
    await page.click('#lp [data-act="covGet"]', { force: true }); await waitToast(page, /ISBN13을 먼저/);
    assert.equal(await page.evaluate((i) => DB.books.find((x) => x.id === i).cover || '', id), '');
    assert.equal(img.length, 0, 'ISBN 없으면 그림을 부르지 않음');
    // ① ISBN 있음 → 가져오기
    await pick(page, id, { isbn: ISBN, cover: '' });
    assert.doesNotMatch(await page.getAttribute('#lp [data-act="covGet"]', 'class'), /dim/);
    assert.equal(await page.getAttribute('#lp [data-act="covGet"]', 'title'), 'ISBN13으로 교보문고 표지를 가져와요');
    assert.match(await page.textContent('#lp .box h3:has([data-act="covGet"])'), /가져오기.*올리기/s, '[가져오기]가 [올리기] 앞');
    await page.click('#lp [data-act="covGet"]'); await waitToast(page, /표지를 가져왔어요/);
    const want = `https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/${ISBN}.jpg`;
    assert.equal(await page.evaluate((i) => DB.books.find((x) => x.id === i).cover, id), want);
    assert.equal(await page.evaluate((i) => DB.books.find((x) => x.id === i).state, id), 'draft');
    await page.waitForSelector(`#lp .bkcov img[src="${want}"]`);
    await page.screenshot({ path: shots + 'book-cover-fetch.png' });
    // ④ 이미 표지가 있으면 확인 창 — 취소하면 그대로
    await page.click('#lp [data-act="covGet"]'); await page.waitForSelector('.dlg, .modal, [role="dialog"]');
    assert.match(await page.textContent('body'), /교보문고 표지로 바꿔요/);
    await page.click('#cc'); await page.waitForTimeout(150);
    assert.equal(await page.evaluate((i) => DB.books.find((x) => x.id === i).cover, id), want);
    // ③ 그림 실패
    await page.close();
    const f = await open({ imgFail: true });
    const id2 = await f.page.evaluate(() => DB.books.find((x) => x.kind === '교재').id);
    await pick(f.page, id2, { isbn: ISBN, cover: '' });
    await f.page.click('#lp [data-act="covGet"]'); await waitToast(f.page, /이 ISBN으로 표지를 찾지 못했어요/);
    assert.equal(await f.page.evaluate((i) => DB.books.find((x) => x.id === i).cover || '', id2), '');
    assert.notEqual(await f.page.evaluate((i) => DB.books.find((x) => x.id === i).state, id2), 'draft', '실패하면 작성 중으로 바뀌지 않음');
    // ⑤ 프로그램은 단추 없음
    const pid = await f.page.evaluate(() => (DB.books.find((x) => x.kind === '프로그램') || {}).id);
    if (pid) { await f.page.evaluate((i) => { activeTab.state.sel = i; panelOpen = true; render(); }, pid); assert.equal(await f.page.locator('#lp [data-act="covGet"]').count(), 0); }
    assert.deepEqual(errors.concat(f.errors), []);
    await f.page.close();
  }

  // 실제 자료 모드(가짜 서버)
  {
    const { page, calls, errors } = await open({ live: true });
    const saves = () => calls.filter((c) => c.fn === 'app-api' && c.action === 'save');
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.waitForSelector('#lp [data-act="covGet"]');
    // ⑧ 안 건드린 줄은 북커버 칸을 보내지 않음(이름만 고쳐 저장)
    await page.evaluate((id) => { const r = DB.books.find((x) => x.id === id); r.name = '예시 수학 1 개정'; r.state = 'draft'; commit(); activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp #rowSave'); await page.waitForSelector('.dlg, .modal, [role="dialog"]');
    await page.locator('.dlg button.pri, .modal button.pri, [role="dialog"] button.pri').last().click(); await page.waitForTimeout(600);
    const first = saves().map((c) => c.body.changes.find((x) => x.db === '라이브러리(학원) DB')).filter(Boolean)[0];
    assert.equal(first.props['교재명'], '예시 수학 1 개정'); assert.equal('북커버' in first.props, false, '표지를 안 건드린 저장엔 북커버 칸이 없음');
    // ⑥ 가져오기 → 위 [저장] → 확인 창 → 저장 본문
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-act="covGet"]'); await waitToast(page, /표지를 가져왔어요/);
    await page.click('#lp #rowSave'); await page.waitForSelector('.dlg, .modal, [role="dialog"]');
    await page.screenshot({ path: shots + 'book-cover-save-dialog.png' });
    const ok = page.locator('.dlg button.pri, .modal button.pri, [role="dialog"] button.pri').last(); await ok.click();
    await page.waitForFunction(() => true); await page.waitForTimeout(600);
    const body = saves().map((c) => c.body.changes.find((x) => x.db === '라이브러리(학원) DB')).filter(Boolean).pop();
    assert.ok(body, '저장 본문');
    assert.deepEqual(body.props['북커버'], [{ name: '북커버', url: `https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/${ISBN}.jpg` }]);
    assert.equal(calls.filter((c) => c.fn !== 'app-api' && c.fn !== 'textbook-api').length, 0, '새 서버 호출 없음');
    // ⑦ 삭제 → 빈 목록
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-act="covRm"]'); await waitToast(page, /표지를 삭제했어요/);
    await page.click('#lp #rowSave'); await page.waitForSelector('.dlg, .modal, [role="dialog"]');
    await page.locator('.dlg button.pri, .modal button.pri, [role="dialog"] button.pri').last().click(); await page.waitForTimeout(600);
    const body2 = saves().map((c) => c.body.changes.find((x) => x.db === '라이브러리(학원) DB')).filter(Boolean).pop();
    assert.deepEqual(body2.props['북커버'], []);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await b.close(); server.close(); console.log('ok — 표지 가져오기');
})().catch((e) => { console.error(e); process.exit(1); });
