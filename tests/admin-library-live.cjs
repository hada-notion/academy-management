// 관리 앱 라이브러리 실제 연결(261123, 옛 라이브러리 웹 화면에서 옮김) — 가짜 서버로만. 실제 자료 모드(?live=1)에서
// 책 찾기(search → detail → register, 교보문고 주소 → kyobo-book → register-custom), 단원 편집 [고치기 | 단원 목록](units · units-fetch · edit-units 묶음 저장),
// 시리즈 관리(series · edit-series)가 서버 textbook-api를 같은 값 이름으로 부르는지. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-library-live.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { OLYMPOS } = require('./unit-toc-samples.cjs');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const BK = '11111111-1111-4111-8111-111111111111';
const BOOK_ROW = { id: BK, props: { '교재명': '예시 수학 1', '구분': '교재', '시리즈': '예시 시리즈', '출판사': '예시 출판', '전체 분량': 200, '진도 단위': 'P.-', '가격': 15000, '사용중': true, 'ISBN13': '9790000000011' } };
// 단원 가져오기(units-fetch) 가짜 응답 — 교보문고 목차 꼴(하위 줄 "   - …")
const FETCHED = 'Lesson 01 Hello 8\n   - Vocabulary 어휘\n   - Reading 독해\n\nLesson 02 World 20\n   - Vocabulary 어휘';
const FOUND = [
  { isbn13: '9791100000017', title: '예시 개념 수학 1', author: '김하다', publisher: '예시 출판', pubDate: '2026-01-01', price: 18000, series: '', pages: 300, altCover: '', sources: ['nl'], cover: '', registered: false },
  { isbn13: '9790000000011', title: '예시 수학 1', author: '', publisher: '예시 출판', pubDate: '', price: 15000, series: '', pages: 200, altCover: '', sources: ['nl'], cover: '', registered: true },
];
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open(opts = {}) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [];
    let series = [{ id: 's1', name: '예시 시리즈' }, { id: 's2', name: '빈 시리즈' }];
    let editN = 0, newId = 0;
    let units = opts.units || [{ id: 'u1', name: '1. 수와 연산', page: 8, uses: 0 }, { id: 'u2', name: '2. 문자와 식', page: 40, uses: 2 }];
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
          case 'units-fetch': return reply(route, 200, opts.fetch === 'none' ? { found: false, text: '', source: '' } : { found: true, source: 'kyobo', text: opts.fetchText || FETCHED });
          case 'parse': return reply(route, 200, { toc: { units: [{ name: '3. 도형', page: 70, include: true, big: '' }, { name: '1. 수와 연산', page: 8, include: true, big: '' }] } });
          case 'edit-units': {
            /* 서버(editUnits)처럼 고침 → 삭제 → 추가 차례로. opts.editDelay = 응답 늦추기, opts.editFailAt = 그 번째 호출은 앞 4개만 하고 멈춤(ok:false + error) — 항목 165 */
            editN++; if (opts.editDelay) await new Promise((r) => setTimeout(r, opts.editDelay));
            const ops = [...(q.update || []).map((x) => ['u', x]), ...(q.remove || []).map((x) => ['r', x]), ...(q.add || []).map((x) => ['a', x])];
            const fail = opts.editFailAt === editN, run = fail ? ops.slice(0, 4) : ops, d = { updated: 0, removed: 0, added: 0 };
            for (const [k, x] of run) {
              if (k === 'u') { units = units.map((u) => (u.id === x.id ? { ...u, name: x.name, page: x.page } : u)); d.updated++; }
              if (k === 'r') { units = units.filter((u) => u.id !== x); d.removed++; }
              if (k === 'a' && !units.some((u) => u.name === x.name)) { units = [...units, { id: 'n' + newId++, name: x.name, page: x.page, uses: 0 }]; d.added++; }
            }
            if (fail) return reply(route, 200, { ok: false, ...d, blocked: [], skipped: 0, error: `저장하다 멈췄습니다(수정 ${d.updated} · 삭제 ${d.removed} · 추가 ${d.added}). 다시 열어 확인해 주세요.` });
            return reply(route, 200, { ok: true, ...d, blocked: [], skipped: 0 });
          }
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
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? [opts.book || BOOK_ROW] : [] });
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
  const pv = (page) => page.evaluate(() => { const r = [...document.querySelectorAll('.dlg #lbuVl .lbupvr')]; return { head: document.querySelector('.dlg #lbuVh').textContent, n: r.length, first: r[0] ? r[0].querySelector('.nm').textContent + '|' + r[0].querySelector('.pg').textContent : '' }; });
  const tabOn = (page) => page.$$eval('.dlg #lbuTabs [data-ut]', (l) => l.filter((x) => x.classList.contains('on')).map((x) => x.dataset.ut).join(','));
  const noOverflow = async (page, name) =>assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': 가로 넘침');
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
    assert.equal(await page.locator('#lp [data-lbu]').count(), 1, '머리 단추는 [단원 편집] 하나');
    assert.match(await page.textContent('#lp [data-lbu="edit"]'), /단원 편집/);
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuR .unn');
    assert.equal(await tabOn(page), 'edit', '단원이 있으면 처음 탭 = 고치기');
    assert.equal(await page.locator('.dlg #lbuR [data-i="1"] [data-del]').count(), 0, '연결된 단원은 삭제 단추 없음');
    await page.fill('.dlg #lbuR [data-i="0"] .unn', '1. 수와 연산(개정)');
    /* 항목 163: 바깥(어두운 배경)을 누르거나 Esc를 눌러도 안 닫힘 — 고친 값 유지, [취소]로만 닫힘 */
    await page.mouse.click(8, 8); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.equal(await page.inputValue('.dlg #lbuR [data-i="0"] .unn'), '1. 수와 연산(개정)', '배경 클릭 · Esc 뒤에도 창과 고친 값이 그대로');
    assert.equal(await page.locator('.dlg.nudge').count(), 1, '배경을 누르면 창이 살짝 눌렸다 돌아옴');
    await page.click('.dlg [data-ut="list"]'); assert.equal(await page.isVisible('.dlg #lbuR'), false, '탭을 옮기면 고치기 줄은 숨김');
    assert.deepEqual(await page.$$eval('.dlg #lbuTabs [data-ut]', (l) => l.map((x) => x.textContent.trim())), ['고치기', '단원 목록'], '탭 둘(261127 대표)');
    assert.equal((await page.textContent('.dlg #lbuSplit')).trim(), '단원 목록 입력');
    await page.fill('.dlg #lbuT', '1. 수와 연산 8\n3. 도형 70'); await page.click('.dlg #lbuSplit');
    await page.waitForSelector('.dlg #lbuR [data-i="2"]');
    assert.equal(await tabOn(page), 'edit', '입력하면 고치기 탭으로');
    assert.equal(await page.inputValue('.dlg #lbuR [data-i="0"] .unn'), '1. 수와 연산(개정)', '탭을 옮겨도 고친 줄 유지');
    assert.equal(await page.locator('.dlg #lbuR [data-i]').count(), 3, '같은 이름은 건너뜀(노션에 있는 원래 이름 포함 — 서버와 같은 규칙)');
    assert.equal(tb(calls, 'parse').length, 0, '[단원 목록 입력]은 화면에서 나눔(서버 parse 안 부름, 항목 164)');
    assert.equal(await page.inputValue('.dlg #lbuR [data-i="2"] .unp'), '70', '끝 숫자가 커지는 목록 = 시작 쪽');
    await page.screenshot({ path: shots + 'lib-live-units-edit.png' });
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 10000 });
    const ed = tb(calls, 'edit-units'); assert.equal(ed.length, 1);
    assert.deepEqual(ed[0].body, { action: 'edit-units', bookId: BK, update: [{ id: 'u1', name: '1. 수와 연산(개정)', page: 8 }], remove: [], add: [{ name: '3. 도형', page: 70 }] });
    await page.waitForFunction(() => /도형/.test(document.querySelector('#lp').textContent), null, { timeout: 10000 });
    assert.deepEqual(errors, []); done.push('단원'); await page.close();
  }
  // 3b) 단원 고치기: [쪽 순서로 정렬] · 아래에 추가
  {
    const units20 = Array.from({ length: 20 }, (_, i) => ({ id: 'w' + (i + 1), name: (i + 1) + '. 단원 ' + (i + 1), page: 10 * (i + 1), uses: 0 }));
    const { page, calls, errors } = await open({ units: units20 });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 1(?!\d)/.test(document.querySelector('#lp').textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuR .unn');
    const names = () => page.$$eval('.dlg #lbuR .unn', (l) => l.map((i) => i.value));
    const sortShown = () => page.$eval('.dlg #lbuO', (e) => getComputedStyle(e).display !== 'none');
    assert.equal(await page.locator('.dlg #lbuR [data-addb]').count(), 20);
    assert.equal(await sortShown(), false, '쪽 순서가 맞으면 정렬 단추 안 보임');
    await page.screenshot({ path: shots + 'lib-units-sort-before.png' });
    // 줄 순서 섞기: 1번째 쪽 300, 2번째 쪽 비움, 3번째 쪽 5
    await page.fill('.dlg #lbuR [data-i="0"] .unp', '300'); await page.fill('.dlg #lbuR [data-i="1"] .unp', ''); await page.fill('.dlg #lbuR [data-i="2"] .unp', '5');
    assert.equal(await sortShown(), true, '순서가 어긋나면 정렬 단추');
    await page.screenshot({ path: shots + 'lib-units-sort-mixed.png' });
    await page.click('.dlg #lbuSort');
    const n1 = await names();
    assert.deepEqual(n1.slice(0, 3), ['3. 단원 3', '4. 단원 4', '5. 단원 5'], '쪽 오름차순');
    assert.deepEqual(n1.slice(-2), ['1. 단원 1', '2. 단원 2'], '쪽 300 다음, 쪽 빈 줄은 맨 아래');
    assert.equal(await page.inputValue('.dlg #lbuR [data-i="0"] .unp'), '5', '입력한 값 유지');
    assert.equal(await sortShown(), false, '정렬하면 단추 사라짐');
    await page.screenshot({ path: shots + 'lib-units-sort-after.png' });
    // 아래에 추가: 5번째 줄 아래에 빈 줄
    await page.click('.dlg #lbuR [data-i="4"] [data-addb]');
    const nm = await names(); assert.equal(nm.length, 21); assert.equal(nm[5], '', '그 줄 바로 아래 빈 줄'); assert.equal(nm[4], '7. 단원 7');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelectorAll('.dlg #lbuR .unn')[5]), true, '새 줄에 커서');
    await page.fill('.dlg #lbuR [data-i="5"] .unn', '끼운 단원'); await page.fill('.dlg #lbuR [data-i="5"] .unp', '75');
    assert.equal(await sortShown(), false, '75는 70과 80 사이 — 순서 맞음');
    // 단원 20개: 줄 높이 48 · 간격 8 유지
    const hs = await page.$$eval('.dlg #lbuR .unrow', (l) => l.slice(0, 3).map((r) => Math.round(r.getBoundingClientRect().height)));
    assert.deepEqual(hs, [48, 48, 48]);
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 10000 });
    const ed = tb(calls, 'edit-units'); assert.equal(ed.length, 1);
    assert.deepEqual(ed[0].body, { action: 'edit-units', bookId: BK, update: [{ id: 'w3', name: '3. 단원 3', page: 5 }, { id: 'w1', name: '1. 단원 1', page: 300 }, { id: 'w2', name: '2. 단원 2', page: null }], remove: [], add: [{ name: '끼운 단원', page: 75 }] });
    assert.deepEqual(errors, []); done.push('단원 정렬'); await page.close();
  }
  // 3c) 단원 편집 [단원 목록] 탭 [가져오기](항목 162 · 165): 단원 없으면 처음 탭 = 단원 목록 → units-fetch(같은 글 칸, 글 있으면 묻기) → 고친 뒤 [단원 목록 입력] → 고치기 탭 · 탭 옮겨도 값 유지 · 저장 꼴 같음
  {
    const { page, calls, errors } = await open({ units: [] });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 0개/.test(document.querySelector("#lp").textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuTabs');
    assert.equal(await tabOn(page), 'list', '단원 없으면 처음 탭 = 단원 목록');
    assert.equal(await page.isDisabled('.dlg #lbuGet'), false);
    await page.screenshot({ path: shots + 'lib-units-tab-fetch-empty.png' });
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => document.querySelector('.dlg #lbuT').value.length > 0, null, { timeout: 10000 });
    assert.deepEqual(tb(calls, 'units-fetch').map((c) => c.body), [{ action: 'units-fetch', isbn13: '9790000000011' }]);
    assert.equal(await page.inputValue('.dlg #lbuT'), FETCHED, '받은 글 그대로 채움(항목 164 — 큰 단원만 대신 단원 단계)');
    const segF = () => page.$$eval('.dlg [data-lv="T"] button', (l) => l.map((x) => (x.classList.contains('on') ? '*' : '') + x.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(await segF(), ['*Lesson 2', '하위 3'], '단계 Lesson · 하위, 기본 = Lesson(하위 줄 이름이 되풀이됨)');
    assert.match(await page.textContent('.dlg #lbuLM'), /교보문고에서 단원 목록을 가져왔어요 — 고친 뒤 \[단원 목록 입력\]/);
    await page.screenshot({ path: shots + 'lib-units-tab-fetch.png' });
    // 붙여넣기 탭에 적어 둔 글 · 가져오기 글은 탭을 옮겨도 그대로
    // 글이 있으면 [가져오기] 전에 묻기 — [취소]면 글 그대로 · 서버 안 부름
    await page.fill('.dlg #lbuT', '메모 줄');
    let asked = ''; page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    await page.click('.dlg #lbuGet'); await page.waitForTimeout(200);
    assert.match(asked, /바꿀까요/); assert.equal(await page.inputValue('.dlg #lbuT'), '메모 줄', '취소하면 글 그대로');
    assert.equal(tb(calls, 'units-fetch').length, 1, '취소하면 서버 안 부름');
    page.once('dialog', (d) => d.accept());
    await page.click('.dlg #lbuGet'); await page.waitForFunction((f) => document.querySelector('.dlg #lbuT').value === f, FETCHED, { timeout: 10000 });
    assert.equal(tb(calls, 'units-fetch').length, 2);
    await page.fill('.dlg #lbuT', 'Lesson 01 Hello 8\nLesson 02 World 20\nLesson 03 Again 30'); await page.waitForTimeout(300);
    assert.equal(await page.isVisible('.dlg [data-lv="T"]'), false, '단계가 하나면 단계 고르기 숨김');
    await page.click('.dlg #lbuSplit');
    await page.waitForSelector('.dlg #lbuR [data-i="1"]');
    assert.equal(await tabOn(page), 'edit', '입력하면 고치기 탭으로');
    assert.equal(tb(calls, 'parse').length, 0, '고친 글을 화면에서 나눔(서버 parse 안 부름)');
    assert.deepEqual(await page.$$eval('.dlg #lbuR .unn', (l) => l.map((i) => i.value)), ['Lesson 01 Hello', 'Lesson 02 World', 'Lesson 03 Again'], '이름 그대로 · 번호 지어 붙이지 않음');
    await page.fill('.dlg #lbuR [data-i="0"] .unn', '3. 도형(고침)');
    await page.click('.dlg [data-ut="list"]'); assert.equal(await page.inputValue('.dlg #lbuT'), '', '입력한 글은 비움');
    await page.click('.dlg [data-ut="edit"]'); assert.equal(await page.inputValue('.dlg #lbuR [data-i="0"] .unn'), '3. 도형(고침)', '고친 줄 유지');
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 10000 });
    const ed = tb(calls, 'edit-units'); assert.equal(ed.length, 1);
    assert.deepEqual(ed[0].body, { action: 'edit-units', bookId: BK, update: [], remove: [], add: [{ name: '3. 도형(고침)', page: 8 }, { name: 'Lesson 02 World', page: 20 }, { name: 'Lesson 03 Again', page: 30 }] });
    assert.deepEqual(errors, []); done.push('단원 가져오기'); await page.close();
  }
  // 3f) 단원 묶음 저장(항목 165): 60개(고침 10 · 삭제 5 · 추가 45) → edit-units 10개씩 6번 · 차례 · 본문 합 = 한 번에 보낼 때와 같음 · 진행 숫자 · 저장 중 [취소] 막힘
  //     3번째 묶음이 4개만 하고 멈춤 → 멈춤 · "24/60까지 저장했어요" · [다시 저장] = 남은 36개만(추가된 줄은 받은 id로)
  for (const failAt of [0, 3]) {
    const units20 = Array.from({ length: 20 }, (_, i) => ({ id: 'w' + (i + 1), name: (i + 1) + '. 단원 ' + (i + 1), page: 10 * (i + 1), uses: 0 }));
    const { page, calls, errors } = await open({ units: units20, editDelay: 400, editFailAt: failAt });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 1(?!\d)/.test(document.querySelector('#lp').textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuR .unn');
    for (let i = 0; i < 10; i++) await page.fill(`.dlg #lbuR [data-i="${i}"] .unn`, `${i + 1}. 단원 ${i + 1}(고침)`);
    for (let i = 10; i < 15; i++) await page.click(`.dlg #lbuR [data-i="${i}"] [data-del]`);
    const ADD = Array.from({ length: 45 }, (_, i) => `새 단원 ${i + 1}`);
    await page.click('.dlg [data-ut="list"]'); await page.fill('.dlg #lbuT', ADD.join('\n')); await page.click('.dlg #lbuSplit');
    await page.waitForSelector('.dlg #lbuR [data-i="64"]');
    const EXP = { update: Array.from({ length: 10 }, (_, i) => ({ id: 'w' + (i + 1), name: `${i + 1}. 단원 ${i + 1}(고침)`, page: 10 * (i + 1) })), remove: Array.from({ length: 5 }, (_, i) => 'w' + (i + 11)), add: ADD.map((name) => ({ name, page: null })) };
    const seen = new Set();
    const watch = setInterval(() => page.evaluate(() => { const p = document.querySelector('.dlg #lbuP'); return p && !p.hidden ? p.querySelector('.t').textContent + '|' + document.querySelector('.dlg #cc').disabled : ''; }).then((t) => t && seen.add(t), () => {}), 60);
    await page.click('.dlg #co');
    await page.waitForFunction(() => /단원 저장 중 20\/60/.test((document.querySelector('.dlg #lbuP .t') || {}).textContent || ''), null, { timeout: 10000 });
    assert.equal(await page.isDisabled('.dlg #cc'), true, '저장 중 [취소] 막힘');
    assert.equal(await page.isDisabled('.dlg [data-ut="list"]'), true, '저장 중 탭 · 칸 막힘');
    assert.equal(await page.$eval('.dlg #lbuP .bar>i', (e) => e.style.width), '33%');
    if (!failAt) await page.screenshot({ path: shots + 'lib-units-save-progress.png' });
    const eds = () => tb(calls, 'edit-units').map((c) => c.body);
    if (!failAt) {
      await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 15000 }); clearInterval(watch);
      const ed = eds();
      assert.equal(ed.length, 6, '60개 = 10개씩 6번');
      ed.forEach((x) => { assert.equal(x.update.length + x.remove.length + x.add.length, 10); assert.equal(x.bookId, BK); });
      assert.deepEqual({ update: ed.flatMap((x) => x.update), remove: ed.flatMap((x) => x.remove), add: ed.flatMap((x) => x.add) }, EXP, '본문 합 = 한 번에 보낼 때와 같음(고침 → 삭제 → 추가 차례)');
      assert.deepEqual(ed[1], { action: 'edit-units', bookId: BK, update: [], remove: EXP.remove, add: EXP.add.slice(0, 5) }, '둘째 묶음 = 삭제 5 + 추가 5');
      const nums = [...seen].map((t) => +t.split('|')[0].match(/(\d+)\/60/)[1]);
      for (const n of [0, 10, 20, 30, 40, 50]) assert(nums.includes(n), '진행 숫자 ' + n + '/60 보임: ' + [...seen].join(', '));
      assert([...seen].every((t) => t.endsWith('|true')), '저장 내내 [취소] 막힘');
      await page.waitForFunction(() => /단원을 저장했어요 — 고침 10 · 삭제 5 · 추가 45/.test(document.body.textContent), null, { timeout: 5000 });
      assert.deepEqual(errors, []); done.push('단원 묶음 저장'); await page.close(); continue;
    }
    await page.waitForFunction(() => /까지 저장했어요/.test(document.querySelector('.dlg #lbuM').textContent), null, { timeout: 15000 }); clearInterval(watch);
    assert.equal(eds().length, 3, '실패한 묶음에서 멈춤');
    assert.match(await page.textContent('.dlg #lbuM'), /24\/60까지 저장했어요 — 나머지 36개는 \[다시 저장\]을 눌러요/);
    assert.equal((await page.textContent('.dlg #co')).trim(), '다시 저장');
    assert.equal(await page.isDisabled('.dlg #cc'), false, '멈추면 [취소] 다시 됨');
    assert.equal(await page.isHidden('.dlg #lbuP'), true, '멈추면 진행 줄 숨김');
    assert.equal(await page.locator('.dlg #lbuR [data-i]').count(), 60, '삭제된 5줄은 빠짐(20 - 5 + 45)');
    await page.screenshot({ path: shots + 'lib-units-save-stopped.png' });
    await page.click('.dlg #co');
    await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 15000 });
    const again = eds().slice(3);
    assert.equal(again.length, 4, '남은 36개 = 4번');
    assert.deepEqual({ update: again.flatMap((x) => x.update), remove: again.flatMap((x) => x.remove), add: again.flatMap((x) => x.add) }, { update: [], remove: [], add: EXP.add.slice(9) }, '다시 저장 = 남은 것만(저장된 고침 · 삭제 · 추가는 안 보냄)');
    assert.deepEqual(errors, []); done.push('단원 묶음 저장 실패 · 다시 저장'); await page.close();
  }
  // 3g) 실제 서점 글(항목 165, units-fetch 받은 그대로 — CHAPTER 6 · 번호 단원 18 · 서술형 Practice · 부록): 단계 · 미리보기 · 부록 줄도 넣기 · 아래 3줄 배치 · 넓은 창
  {
    const { page, errors } = await open({ units: [], fetchText: OLYMPOS });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 0개/.test(document.querySelector("#lp").textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuTabs');
    await page.click('.dlg #lbuGet'); await page.waitForFunction(() => document.querySelector('.dlg #lbuT').value.length > 0, null, { timeout: 10000 });
    const segT = () => page.$$eval('.dlg [data-lv="T"] button', (l) => l.map((x) => (x.classList.contains('on') ? '*' : '') + x.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(await segT(), ['CHAPTER 6', '*01 18', '그 밖 12'], '번호 단원 18 한 단계 · 기본');
    const P = await pv(page); assert.deepEqual([P.head, P.n, P.first], ['단원 18개', 18, '01 글의 목적|—']);
    assert.equal(await page.isVisible('.dlg [data-lvap="T"]'), true, '부록 줄이 있으면 [부록 줄도 넣기]');
    const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const d = await box('.dlg'), ta = await box('.dlg #lbuT'), v = await box('.dlg #lbuV');
    assert(d.w >= 900 && d.x >= 0 && d.x + d.w <= 1280, '넓은 창 · 1280 안: ' + JSON.stringify(d));
    assert.equal(Math.round(ta.h), Math.round(v.h), '글 칸 · 미리보기 같은 높이'); assert(v.x > ta.x + ta.w - 1, '미리보기는 오른쪽');
    assert.equal(await page.$eval('.dlg #lbuV', (e) => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto'), true, '미리보기 따로 스크롤');
    const r1 = await box('.dlg [data-lv="T"]'), r2 = await box('.dlg #lbuLM'), r3 = await box('.dlg #lbuSplit'), c3 = await box('.dlg [data-lvup="T"]');
    assert(r1.y < r2.y && r2.y < r3.y, '아래 3줄: 단계 → 안내 → 체크 · 단추');
    assert.equal(Math.abs((c3.y + c3.h / 2) - (r3.y + r3.h / 2)) < 12, true, '3줄 = 왼쪽 체크 · 오른쪽 단추 한 줄'); assert(c3.x < r3.x);
    assert.match(await page.textContent('.dlg #lbuLM'), /교보문고에서 단원 목록을 가져왔어요 — 고친 뒤 \[단원 목록 입력\]을 눌러요/);
    await noOverflow(page, '실제 서점 글'); await page.screenshot({ path: shots + 'lib-units-real-units.png' });
    await page.check('.dlg [data-lvap="T"]');
    assert.deepEqual(await segT(), ['CHAPTER 6', '*01 20', '그 밖 13'], '부록 줄도 넣기 = 20');
    assert.equal((await pv(page)).head, '단원 20개');
    await page.uncheck('.dlg [data-lvap="T"]');
    await page.click('.dlg [data-lv="T"] button:has-text("CHAPTER")');
    const C = await pv(page); assert.deepEqual([C.head, C.n, C.first], ['단원 6개', 6, 'CHAPTER 01 대의 파악(핵심 내용·맥락)|—']);
    await page.screenshot({ path: shots + 'lib-units-real-chapter.png' });
    await page.click('.dlg [data-lv="T"] button:has-text("01")');
    await page.click('.dlg #lbuSplit'); await page.waitForSelector('.dlg #lbuR [data-i="17"]');
    const nm = await page.$$eval('.dlg #lbuR .unn', (l) => l.map((i) => i.value));
    assert.equal(nm.length, 18); assert.equal(nm[9], '10 단어 빈칸 추론'); assert.equal(nm[17], '18 장문2 (1지문 3문항)');
    assert.equal(await page.$eval('.dlg', (e) => e.classList.contains('lbuwide')), false, '고치기 탭은 보통 폭');
    assert.deepEqual(errors, []); done.push('실제 서점 글 단계 · 미리보기'); await page.close();
  }
  // 3e) 단원 단계(항목 164): 블록구문 꼴 3단계(STAGE 3 · Chapter 13 · Unit 60) — 붙여넣기 탭, 기본 Unit · Chapter 고르면 13줄 · STAGE 고르면 3줄(이름 그대로, 번호 · 쪽 없음) · 윗 단계 이름 붙이기
  {
    const CH = [[1, 7], [2, 5], [3, 4], [4, 4], [5, 4], [6, 5], [7, 5], [8, 4], [9, 4], [10, 4], [11, 5], [12, 5], [13, 4]];
    const STAGE_AT = { 1: '[STAGE I 영어문장 구조와 동사]', 5: '[Stage II 주어/보어/목적어구 ·절 & 관계절]', 9: '[STAGE III 모든 문장과 특수 구문]' };
    const UNAME = { 7: '구동사 2', 8: '시간표현 1: 현재/과거/미래/진행', 48: '가정표현 4', 60: '수 일치 & 시제 조정' };
    let n = 0; const BL = [];
    for (const [c, k] of CH) { if (STAGE_AT[c]) BL.push(STAGE_AT[c]); BL.push(`Chapter ${String(c).padStart(2, '0')}. 예시 장 ${c}`); for (let i = 0; i < k; i++) { n++; BL.push(`Unit ${String(n).padStart(2, '0')} ${UNAME[n] || '예시 구문 ' + n}`); } }
    const { page, calls, errors } = await open({ units: [] });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 0개/.test(document.querySelector("#lp").textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuTabs');
    await page.click('.dlg [data-ut="list"]');
    const segT = () => page.$$eval('.dlg [data-lv="T"] button', (l) => l.map((x) => (x.classList.contains('on') ? '*' : '') + x.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(await page.isVisible('.dlg [data-lv="T"]'), false, '빈 글 = 단계 고르기 숨김');
    assert.match(await page.textContent('.dlg #lbuV'), /붙여 넣거나 \[가져오기\]를 누르면 들어갈 단원이 여기에 보여요/, '빈 글 = 미리보기 안내');
    await page.fill('.dlg #lbuT', BL.join('\n')); await page.waitForTimeout(300);
    assert.deepEqual(await segT(), ['STAGE 3', 'Chapter 13', '*Unit 60'], '단계 3개 · 기본 Unit');
    assert.deepEqual(await pv(page), { head: '단원 60개', n: 60, first: 'Unit 01 예시 구문 1|—' }, '미리보기 = Unit 60');
    await page.click('.dlg [data-lv="T"] button:has-text("Chapter")');
    assert.deepEqual(await pv(page), { head: '단원 13개', n: 13, first: 'Chapter 01. 예시 장 1|—' }, '단계 바꾸면 미리보기 바로');
    await page.check('.dlg [data-lvup="T"]');
    assert.equal((await pv(page)).first, 'STAGE I · Chapter 01. 예시 장 1|—', '윗 단계 이름 붙이기도 미리보기에');
    await page.screenshot({ path: shots + 'lib-units-preview-chapter.png' });
    await page.uncheck('.dlg [data-lvup="T"]'); await page.click('.dlg [data-lv="T"] button:has-text("STAGE")');
    assert.deepEqual(await pv(page), { head: '단원 3개', n: 3, first: '[STAGE I 영어문장 구조와 동사]|—' });
    await page.click('.dlg [data-lv="T"] button:has-text("Unit")');
    await page.fill('.dlg #lbuT', BL.join('\n') + '\nUnit 61 덧붙인 구문'); await page.waitForTimeout(300);
    assert.deepEqual(await pv(page), { head: '단원 61개', n: 61, first: 'Unit 01 예시 구문 1|—' }, '글을 고치면 미리보기 바뀜');
    await page.fill('.dlg #lbuT', BL.join('\n')); await page.waitForTimeout(300);
    await noOverflow(page, '단원 단계'); await page.screenshot({ path: shots + 'lib-units-levels.png' });
    assert.equal(await page.$eval('.dlg [data-lvup="T"]', (c) => Math.round(c.closest('label').getBoundingClientRect().height) <= 20), true, '윗 단계 이름 붙이기 한 줄');
    const names = () => page.$$eval('.dlg #lbuR .unn', (l) => l.map((i) => i.value));
    const pages = () => page.$$eval('.dlg #lbuR .unp', (l) => l.map((i) => i.value));
    await page.click('.dlg [data-lv="T"] button:has-text("STAGE")'); assert.deepEqual(await segT(), ['*STAGE 3', 'Chapter 13', 'Unit 60']);
    await page.click('.dlg #lbuSplit'); await page.waitForSelector('.dlg #lbuR [data-i="2"]');
    assert.deepEqual(await names(), ['[STAGE I 영어문장 구조와 동사]', '[Stage II 주어/보어/목적어구 ·절 & 관계절]', '[STAGE III 모든 문장과 특수 구문]'], 'STAGE 3줄 · STAGE I 포함 · 이름 그대로');
    assert.deepEqual(await pages(), ['', '', ''], '쪽 비움');
    // Chapter 13줄 · 윗 단계 이름 붙이기
    await page.click('.dlg [data-ut="list"]'); await page.fill('.dlg #lbuT', BL.join('\n')); await page.waitForTimeout(300);
    await page.click('.dlg [data-lv="T"] button:has-text("Chapter")'); await page.check('.dlg [data-lvup="T"]');
    await page.screenshot({ path: shots + 'lib-units-levels-chapter.png' });
    await page.click('.dlg #lbuSplit'); await page.waitForSelector('.dlg #lbuR [data-i="15"]');
    const nm = await names(); assert.equal(nm.length, 16); assert.equal(nm[3], 'STAGE I · Chapter 01. 예시 장 1');
    // Unit 60줄(기본): 이름 끝 숫자는 쪽 아님
    await page.click('.dlg [data-ut="list"]'); await page.fill('.dlg #lbuT', BL.join('\n')); await page.waitForTimeout(300); await page.uncheck('.dlg [data-lvup="T"]');
    await page.click('.dlg [data-lv="T"] button:has-text("Unit")');
    await page.click('.dlg #lbuSplit'); await page.waitForSelector('.dlg #lbuR [data-i="75"]');
    const n2 = await names(), p2 = await pages();
    assert.equal(n2.length, 76); assert.equal(n2[22], 'Unit 07 구동사 2'); assert.equal(p2[22], ''); assert.equal(n2[63], 'Unit 48 가정표현 4'); assert.equal(p2[63], '');
    assert.equal(tb(calls, 'parse').length, 0);
    assert.deepEqual(errors, []); done.push('단원 단계'); await page.close();
  }
  // 3f) [정보] 탭 관련 링크(항목 164): ISBN13 있으면 3개(새 탭) · ISBN 지우면 바로 숨김
  {
    const { page, errors } = await open();
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.waitForSelector('#lp #bkLinks');
    const links = () => page.$$eval('#lp #bkLinks a', (l) => l.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.target, a.rel]));
    assert.deepEqual(await links(), [
      ['교보문고 ↗', 'https://search.kyobobook.co.kr/search?keyword=9790000000011', '_blank', 'noopener'],
      ['예스24 ↗', 'https://www.yes24.com/Product/Search?domain=BOOK&query=9790000000011', '_blank', 'noopener'],
      ['국립중앙도서관 ↗', 'https://www.nl.go.kr/NL/contents/search.do?srchTarget=total&kwd=9790000000011', '_blank', 'noopener'],
    ]);
    assert.equal(await page.isVisible('#lp #bkLinks'), true);
    await page.locator('#lp #bkLinks').scrollIntoViewIfNeeded(); await page.screenshot({ path: shots + 'lib-book-related.png' });
    const isbnIn = page.locator('#lp [data-hf="isbn"] input');
    await isbnIn.fill(''); assert.equal(await page.isVisible('#lp #bkLinks'), false, 'ISBN 비우면 숨김');
    await isbnIn.fill('9791176831413'); assert.equal(await page.isVisible('#lp #bkLinks'), true);
    assert.equal((await links())[0][1], 'https://search.kyobobook.co.kr/search?keyword=9791176831413', 'ISBN 고치면 바로 바뀜');
    assert.deepEqual(errors, []); await page.close();
  }
  {
    const book = { id: BK, props: { ...BOOK_ROW.props, 'ISBN13': '' } };
    const { page, errors } = await open({ book });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.waitForSelector('#lp .box');
    assert.equal(await page.isVisible('#lp #bkLinks'), false, 'ISBN 없으면 관련 링크 숨김');
    assert.equal(await page.evaluate(() => (LISTS.books.infoX({ kind: '프로그램', isbn: '9791176831413' }).match(/class="link-chip"/g) || []).length), 3, '프로그램도 ISBN13이 있으면 링크 3개');
    assert.equal(await page.evaluate(() => /link-chip/.test(LISTS.books.infoX({ kind: '프로그램', isbn: '' }))), false);
    assert.deepEqual(errors, []); done.push('관련 링크'); await page.close();
  }
  // 3d) 가져오기 못 찾음 · ISBN 없음(처음 탭 = 단원 목록, [가져오기]는 안내 + 흐린 단추, 글 칸은 그대로 씀)
  {
    const { page, calls, errors } = await open({ units: [], fetch: 'none' });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 0개/.test(document.querySelector("#lp").textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuTabs');
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => /이 ISBN으로 단원을 찾지 못했어요/.test(document.querySelector('.dlg #lbuLM').textContent), null, { timeout: 10000 });
    assert.equal(await page.inputValue('.dlg #lbuT'), '');
    assert.equal(tb(calls, 'units-fetch').length, 1);
    assert.deepEqual(errors, []); await page.close();
  }
  {
    const book = { id: BK, props: { ...BOOK_ROW.props, 'ISBN13': '' } };
    const { page, calls, errors } = await open({ units: [], book });
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    await page.waitForFunction(() => /단원 0개/.test(document.querySelector("#lp").textContent), null, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuTabs');
    assert.equal(await tabOn(page), 'list', '단원 없으면 처음 탭 = 단원 목록');
    assert.match(await page.getAttribute('.dlg #lbuT', 'placeholder'), /단원 목록을 붙여 넣거나 \[가져오기\]를 눌러요/);
    assert.equal(await page.isDisabled('.dlg #lbuGet'), true, 'ISBN13 없으면 흐린 단추');
    assert.equal(await page.isDisabled('.dlg #lbuT'), false, 'ISBN13 없어도 붙여 넣기는 됨');
    assert.match(await page.textContent('.dlg [data-up="list"]'), /ISBN13이 있어야 해요/);
    await page.screenshot({ path: shots + 'lib-units-tab-list-noisbn.png' });
    assert.equal(tb(calls, 'units-fetch').length, 0);
    assert.deepEqual(errors, []); done.push('단원 가져오기 못 찾음 · ISBN 없음'); await page.close();
  }
  // 4) 시리즈 관리:도구줄 단추 → series, 추가 · 이름 바꾸기(그 시리즈 교재 화면 값도) · 순서 · 교재 있는 시리즈는 삭제 못 함 · 빈 시리즈는 두 번 눌러 삭제
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
