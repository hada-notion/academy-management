// 관리 앱 라이브러리 실제 연결(261123, 옛 라이브러리 웹 화면에서 옮김) — 가짜 서버로만. 실제 자료 모드(?live=1)에서
// 책 찾기(search → detail → register, 교보문고 주소 → kyobo-book → register-custom), 단원 고치기(units · parse · edit-units),
// 시리즈 관리(series · edit-series)가 서버 textbook-api를 같은 값 이름으로 부르는지. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-library-live.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const BK = '11111111-1111-4111-8111-111111111111';
const BOOK_ROW = { id: BK, props: { '교재명': '예시 수학 1', '구분': '교재', '시리즈': '예시 시리즈', '출판사': '예시 출판', '전체 분량': 200, '진도 단위': 'P.-', '가격': 15000, '사용중': true, 'ISBN13': '9790000000011' } };
const FOUND = [
  { isbn13: '9791100000017', title: '예시 개념 수학 1', author: '김하다', publisher: '예시 출판', pubDate: '2026-01-01', price: 18000, series: '', pages: 300, altCover: '', sources: ['nl'], cover: '', registered: false },
  { isbn13: '9790000000011', title: '예시 수학 1', author: '', publisher: '예시 출판', pubDate: '', price: 15000, series: '', pages: 200, altCover: '', sources: ['nl'], cover: '', registered: true },
];
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open() {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [];
    let series = [{ id: 's1', name: '예시 시리즈' }, { id: 's2', name: '빈 시리즈' }];
    let units = [{ id: 'u1', name: '1. 수와 연산', page: 8, uses: 0 }, { id: 'u2', name: '2. 문자와 식', page: 40, uses: 2 }];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    await page.route(/contents\.kyobobook|kakao|nl\.go\.kr/, (route) => route.fulfill({ status: 404, body: '' }));
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {}, key = req.headers()['x-admin-key'];
      calls.push({ fn, action: q.action, key, body: q });
      if (fn === 'textbook-api') {
        assert.equal(key, 'sess-1', 'textbook-api에 관리자 세션');
        switch (q.action) {
          case 'search': return reply(route, 200, { books: /^97/.test(q.query) ? FOUND.slice(0, 1) : FOUND });
          case 'detail': return reply(route, 200, { book: FOUND[0], publisher: '예시 출판', series: null, tocEmpty: false, toc: { units: [{ name: '1. 수와 연산', page: 8, include: true, big: '' }, { name: '정답과 해설', page: 280, include: false, big: '' }] } });
          case 'register': return reply(route, 200, { ok: true, bookId: 'new-1' });
          case 'kyobo-book': return reply(route, 200, { pid: q.pid, title: '예시 교보 영어', isbn13: '9791100000024', price: 16000, publisher: '예시 출판', toc: { units: [{ name: 'Unit 1', page: 6, include: true, big: '' }] } });
          case 'register-custom': return reply(route, 200, { ok: true, bookId: 'new-2' });
          case 'units': return reply(route, 200, { bookId: q.bookId, units });
          case 'parse': return reply(route, 200, { toc: { units: [{ name: '3. 도형', page: 70, include: true, big: '' }, { name: '1. 수와 연산', page: 8, include: true, big: '' }] } });
          case 'edit-units': { units = units.filter((u) => !(q.remove || []).includes(u.id)).map((u) => { const f = (q.update || []).find((x) => x.id === u.id); return f ? { ...u, name: f.name, page: f.page } : u; }).concat((q.add || []).map((a, i) => ({ id: 'n' + i, name: a.name, page: a.page, uses: 0 }))); return reply(route, 200, { ok: true, updated: (q.update || []).length, removed: (q.remove || []).length, added: (q.add || []).length, blocked: [], skipped: 0 }); }
          case 'series': return reply(route, 200, { series, duplicates: [] });
          case 'edit-series': {
            if (q.op === 'add') series = [...series, { id: 's' + (series.length + 9), name: q.name }];
            if (q.op === 'rename' && q.name === '실패할 이름') return reply(route, 502, { error: '교재 1권 중 0권만 새 이름으로 옮기고 멈췄습니다. 옮긴 교재를 옛 이름으로 되돌렸습니다. 잠시 뒤 다시 하세요.' });
            // 서버는 새 선택지를 만들고 옛 것을 빼므로 id가 바뀐다(v2.8.0). '무시될 이름'은 옛 서버(ok인데 안 바뀜) 흉내
            if (q.op === 'rename' && q.name !== '무시될 이름') series = series.map((o) => o.id === q.id ? { id: o.id + 'r', name: q.name } : o);
            if (q.op === 'order') series = q.order.map((i) => series.find((o) => o.id === i));
            if (q.op === 'remove') series = series.filter((o) => o.id !== q.id);
            return reply(route, 200, { ok: true, cleaned: [], series, duplicates: [] });
          }
        }
        return reply(route, 400, { error: '지원하지 않는 작업입니다.' });
      }
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? [BOOK_ROW] : [] });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: { '라이브러리(학원) DB': { '시리즈': ['예시 시리즈', '빈 시리즈'], '출판사': ['예시 출판'] } } });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
        if (q.action === 'run') return reply(route, 200, { ok: true, changed: 1, syncedAt: new Date().toISOString() });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.evaluate(() => openScreen('books'));
    return { page, calls, errors };
  }
  const tb = (calls, a) => calls.filter((c) => c.fn === 'textbook-api' && c.action === a);
  const noOverflow = async (page, name) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': 가로 넘침');
  // 1) 책 찾기 — 검색: 이미 있는 책은 못 고름, 고른 책 → detail(목차 include만) → register(ISBN · 교보 표지)
  {
    const { page, calls, errors } = await open();
    await page.evaluate(() => bookFindOpen()); await page.waitForSelector('#lp #bfQ');
    assert.match(await page.textContent('#lp'), /국립중앙도서관/);
    await page.fill('#lp #bfQ', '예시 수학'); await page.press('#lp #bfQ', 'Enter');
    await page.waitForSelector('#lp [data-bf="1"]');
    assert.equal(await page.isDisabled('#lp [data-bf="1"]'), true, '이미 있는 책은 못 고름');
    assert.deepEqual(tb(calls, 'search')[0].body, { action: 'search', query: '예시 수학' });
    await page.check('#lp [data-bf="0"]'); await noOverflow(page, '검색'); await page.screenshot({ path: shots + 'lib-live-search.png' });
    await page.click('#lp #bfAdd');
    await page.waitForFunction(() => !document.querySelector('#lp #bfQ'), null, { timeout: 10000 });
    assert.equal(tb(calls, 'detail').length, 1);
    assert.deepEqual(tb(calls, 'register')[0].body, { action: 'register', isbn13: '9791100000017', title: '예시 개념 수학 1', cover: 'kyobo', units: [{ name: '1. 수와 연산', page: 8 }] });
    for (let k = 0; k < 50 && !calls.some((c) => c.fn === 'app-api' && c.action === 'run'); k++) await page.waitForTimeout(200);
    const sy = calls.filter((c) => c.fn === 'app-api' && c.action === 'run');
    assert.deepEqual(sy.map((c) => c.body), [{ action: 'run', name: 'sync-copy', dbs: ['라이브러리(학원) DB'], full: true }], '등록 뒤 라이브러리 사본 맞추기');
    assert.deepEqual(errors, []); done.push('검색 등록'); await page.close();
  }
  // 2-0) 즐겨찾기 [교재 가져오기] — 단추 주소의 코드를 가짜 교보문고 책 상세 · 검색 목록에서 실행하면 JSON이 복사되고, 앱 [가져온 정보 붙여넣기]가 한 권 · 여러 권을 올린다
  {
    const { page, calls, errors } = await open();
    await page.evaluate(() => bookFindOpen()); await page.click('#lp [data-bt="k"]');
    await page.waitForSelector('#lp #bfGrab'); await page.waitForSelector('#lp #bfPaste');
    const href = await page.getAttribute('#lp #bfGrab', 'href');
    assert.ok(href.startsWith('javascript:'), '즐겨찾기 단추 주소');
    const code = decodeURIComponent(href.slice('javascript:'.length));
    assert.ok(!/\/\/[^\n]*\n/.test(code.replace(/https?:\/\//g, '').replace(/'[^'\n]*\/\/[^'\n]*'/g, '')), '즐겨찾기 주소 안에 // 주석 없음');
    await page.click('#lp #bfGrab'); await page.waitForFunction(() => /끌어다 놓은 뒤/.test(document.body.textContent)); // 앱 안에서 누르면 안내만
    const ctx = page.context(); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: origin });
    const html1 = '<!doctype html><section><h3>기본정보</h3><table><tr><th>쪽수</th><td>200쪽</td></tr></table></section><section><h3>목차</h3><div>1. 수와 연산 8<br>2. 문자와 식 40</div></section><script type="application/ld+json">{"@type":"Book","name":"예시 북마크 책","isbn":"9791100000031","image":"https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791100000031.jpg","publisher":{"name":"예시 출판"},"offers":{"price":13500}}</script><del>15,000원</del>';
    const html2 = '<!doctype html><input type="checkbox" class="result_checkbox" checked data-pid="S000300000001" data-bid="9791100000048" data-name="예시 책 하나"><input type="checkbox" class="result_checkbox" checked data-pid="S000300000002" data-bid="9791100000055" data-name="예시 책 둘"><input type="checkbox" class="result_checkbox" data-pid="S000300000003" data-bid="9791100000062" data-name="체크 안 한 책">';
    const kc = await b.newContext(); const kpages = { 'https://product.kyobobook.co.kr/detail/S000212399999': html1, 'https://search.kyobobook.co.kr/search?keyword=x': html2 };
    await kc.route('**/*', (r) => { const h = kpages[r.request().url()]; return h ? r.fulfill({ contentType: 'text/html; charset=utf-8', body: h }) : r.abort(); });
    const grab = async (url) => { const k = await kc.newPage(); k.on('dialog', (d) => d.dismiss()); await k.goto(url); await k.evaluate(code); await k.waitForTimeout(500); const t = await k.evaluate(() => navigator.clipboard.readText()); await k.close(); await page.evaluate((x) => navigator.clipboard.writeText(x), t); return t; };
    for (const o of ['https://product.kyobobook.co.kr', 'https://search.kyobobook.co.kr']) await kc.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: o });
    const one = JSON.parse(await grab('https://product.kyobobook.co.kr/detail/S000212399999'));
    assert.equal(one.hada, 'book'); assert.equal(one.title, '예시 북마크 책'); assert.equal(one.isbn13, '9791100000031'); assert.equal(one.publisher, '예시 출판'); assert.equal(one.price, 15000); assert.equal(one.pages, 200); assert.match(one.toc, /1\. 수와 연산 8\n2\. 문자와 식 40/);
    await page.click('#lp #bfPaste'); await page.waitForSelector('#lp [data-bf="0"]:checked');
    assert.match(await page.textContent('#lp'), /예시 북마크 책/); assert.match(await page.textContent('#lp'), /단원 2개/);
    await page.screenshot({ path: shots + 'lib-live-bookmark-one.png' });
    await page.click('#lp #bfAdd'); await page.waitForFunction(() => !document.querySelector('#lp #bfQ'), null, { timeout: 10000 });
    assert.deepEqual(tb(calls, 'parse')[0].body, { action: 'parse', text: one.toc });
    assert.deepEqual(tb(calls, 'register-custom')[0].body, { action: 'register-custom', title: '예시 북마크 책', units: [{ name: '3. 도형', page: 70 }, { name: '1. 수와 연산', page: 8 }], kind: '교재', isbn13: '9791100000031', cover: 'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791100000031.jpg', price: 15000, publisher: '예시 출판' });
    // 검색 목록에서 체크한 2권
    const many = JSON.parse(await grab('https://search.kyobobook.co.kr/search?keyword=x'));
    assert.equal(many.hada, 'books'); assert.equal(many.items.length, 2); assert.equal(many.items[0].pid, 'S000300000001');
    await page.evaluate(() => bookFindOpen()); await page.click('#lp [data-bt="k"]'); await page.click('#lp #bfPaste');
    await page.waitForSelector('#lp [data-bf="1"]:checked');
    const kb = tb(calls, 'kyobo-book').map((c) => c.body.pid); assert.deepEqual(kb.slice(-2), ['S000300000001', 'S000300000002']);
    await page.screenshot({ path: shots + 'lib-live-bookmark-many.png' });
    const n0 = tb(calls, 'register-custom').length; await page.click('#lp #bfAdd'); await page.waitForFunction(() => !document.querySelector('#lp #bfQ'), null, { timeout: 10000 });
    assert.equal(tb(calls, 'register-custom').length - n0, 2);
    // 엉뚱한 글은 안내만
    await page.evaluate(() => bookFindOpen()); await page.click('#lp [data-bt="k"]'); await page.evaluate(() => navigator.clipboard.writeText('{"a":1}')); await page.click('#lp #bfPaste');
    await page.waitForFunction(() => /교보문고에서 가져온 정보가 아니에요/.test(document.querySelector('#lp').textContent));
    assert.deepEqual(errors, []); done.push('북마크 단추·붙여넣기'); await page.close();
  }
  // 2) 책 찾기 — 교보문고 주소: 상품번호 → kyobo-book → register-custom(교재명 · ISBN · 교보 표지 · 정가 · 선택지에 있는 출판사 · 단원)
  {
    const { page, calls, errors } = await open();
    await page.evaluate(() => bookFindOpen()); await page.click('#lp [data-bt="k"]');
    await page.fill('#lp #bfQ', 'https://product.kyobobook.co.kr/detail/S000212345678'); await page.click('#lp #bfGo');
    await page.waitForSelector('#lp [data-bf="0"]:checked');
    assert.deepEqual(tb(calls, 'kyobo-book')[0].body, { action: 'kyobo-book', pid: 'S000212345678' });
    await page.screenshot({ path: shots + 'lib-live-kyobo.png' });
    await page.click('#lp #bfAdd'); await page.waitForFunction(() => !document.querySelector('#lp #bfQ'), null, { timeout: 10000 });
    assert.deepEqual(tb(calls, 'register-custom')[0].body, { action: 'register-custom', title: '예시 교보 영어', units: [{ name: 'Unit 1', page: 6 }], kind: '교재', isbn13: '9791100000024', cover: 'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791100000024.jpg', price: 16000, publisher: '예시 출판' });
    // 주소도 ISBN도 아니면 안내만
    await page.evaluate(() => bookFindOpen()); await page.click('#lp [data-bt="k"]'); await page.fill('#lp #bfQ', 'https://example.com/book'); await page.click('#lp #bfGo');
    await page.waitForFunction(() => /상세 주소/.test(document.querySelector('#lp').textContent));
    assert.equal(tb(calls, 'kyobo-book').length, 1);
    assert.deepEqual(errors, []); done.push('교보문고 등록'); await page.close();
  }
  // 3) 단원 고치기: [단원] 탭 → units, 이름 고치기 · 연결된 단원은 삭제 단추 없음 · 붙여넣기(parse, 같은 이름 건너뜀) · 줄 삭제 → edit-units 한 번
  {
    const { page, calls, errors } = await open();
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /수와 연산/.test(document.querySelector('#lp').textContent), null, { timeout: 10000 });
    await noOverflow(page, '단원'); await page.screenshot({ path: shots + 'lib-live-units.png' });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuR .unn');
    assert.equal(await page.locator('.dlg #lbuR [data-i="1"] [data-del]').count(), 0, '연결된 단원은 삭제 단추 없음');
    await page.fill('.dlg #lbuR [data-i="0"] .unn', '1. 수와 연산(개정)');
    await page.click('.dlg #lbuP summary'); await page.fill('.dlg #lbuT', '3. 도형 70\n1. 수와 연산 8'); await page.click('.dlg #lbuSplit');
    await page.waitForSelector('.dlg #lbuR [data-i="2"]');
    assert.equal(await page.locator('.dlg #lbuR [data-i]').count(), 3, '같은 이름은 건너뜀(노션에 있는 원래 이름 포함 — 서버와 같은 규칙)');
    await page.screenshot({ path: shots + 'lib-live-units-edit.png' });
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 10000 });
    const ed = tb(calls, 'edit-units'); assert.equal(ed.length, 1);
    assert.deepEqual(ed[0].body, { action: 'edit-units', bookId: BK, update: [{ id: 'u1', name: '1. 수와 연산(개정)', page: 8 }], remove: [], add: [{ name: '3. 도형', page: 70 }] });
    await page.waitForFunction(() => /도형/.test(document.querySelector('#lp').textContent), null, { timeout: 10000 });
    assert.deepEqual(errors, []); done.push('단원'); await page.close();
  }
  // 4) 시리즈 관리: 도구줄 단추 → series, 추가 · 이름 바꾸기(그 시리즈 교재 화면 값도) · 순서 · 교재 있는 시리즈는 삭제 못 함 · 빈 시리즈는 두 번 눌러 삭제
  {
    const { page, calls, errors } = await open();
    await page.click('#view [data-act2="lbSeries"]'); await page.waitForSelector('.dlg #lbsR [data-i="1"]');
    assert.equal(await page.isDisabled('.dlg #lbsR [data-i="0"] [data-rm]'), true, '교재 있는 시리즈는 삭제 못 함');
    await page.fill('.dlg #lbsN', '새 예시 시리즈'); await page.click('.dlg #lbsAdd');
    await page.waitForSelector('.dlg #lbsR [data-i="2"]');
    await page.fill('.dlg #lbsR [data-i="0"] .unn', '예시 시리즈 개정'); await page.press('.dlg #lbsR [data-i="0"] .unn', 'Enter');
    await page.waitForFunction(() => DB.books.some((b) => b.series === '예시 시리즈 개정'), null, { timeout: 10000 });
    await page.click('.dlg #lbsR [data-i="2"] [data-mv="-1"]'); await page.waitForFunction(() => document.querySelector('.dlg #lbsR [data-i="1"] .unn').value === '새 예시 시리즈');
    await page.click('.dlg #lbsR [data-i="2"] [data-rm]'); await page.click('.dlg #lbsR [data-i="2"] [data-rm]');
    await page.waitForFunction(() => document.querySelectorAll('.dlg #lbsR [data-i]').length === 2);
    await page.screenshot({ path: shots + 'lib-live-series.png' });
    assert.deepEqual(tb(calls, 'edit-series').map((c) => c.body.op), ['add', 'rename', 'order', 'remove']);
    assert.deepEqual(tb(calls, 'edit-series')[1].body, { action: 'edit-series', op: 'rename', id: 's1', name: '예시 시리즈 개정' });
    assert.deepEqual(await page.evaluate(() => DB.opts.series), ['예시 시리즈 개정', '새 예시 시리즈']);
    assert.equal(await page.evaluate(() => dirtyCount()), 0, '이름 바꾸기는 노션에 이미 들어감 — [저장] 숫자 0');
    // 노션이 이름 바꾸기를 받지 않으면 성공으로 보이지 않고 화면 값도 그대로
    await page.fill('.dlg #lbsR [data-i="0"] .unn', '무시될 이름'); await page.press('.dlg #lbsR [data-i="0"] .unn', 'Enter');
    await page.waitForFunction(() => /받지 않았어요/.test(document.querySelector('.dlg #lbsM').textContent), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => DB.books.some((b) => b.series === '무시될 이름')), false, '안 바뀐 이름은 화면에도 안 씀');
    // 서버가 이유로 거절하면 그 이유를 그대로 보여 주고 화면 값은 그대로
    await page.fill('.dlg #lbsR [data-i="0"] .unn', '실패할 이름'); await page.press('.dlg #lbsR [data-i="0"] .unn', 'Enter');
    await page.waitForFunction(() => /되돌렸습니다/.test(document.querySelector('.dlg #lbsM').textContent), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => DB.books.some((b) => b.series === '실패할 이름')), false, '실패한 이름은 화면에도 안 씀');
    assert.equal(await page.evaluate(() => document.querySelector('.dlg #lbsR [data-i="0"] .unn').value), '예시 시리즈 개정');
    assert.deepEqual(errors, []); done.push('시리즈'); await page.close();
  }
  console.log('라이브러리 실제 연결 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
