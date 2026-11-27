// 관리 앱 [단원 편집] 한 화면(항목 167) — 가짜 서버로만. 실제 자료 모드(?live=1), PC 1280만.
// 왼쪽 단원 목록 글(붙여 넣기 · 가져오기 units-fetch) → 오른쪽 단원 줄(누른 줄만 밑줄 입력 · Enter 다음 줄 · Esc · [+] · [×]) ·
// 손으로 고친 뒤 다시 만들 때 묻기 · 기존 단원 교재의 [바꾸기 | 뒤에 붙이기](바꾸기 = 순서대로 짝지어 update) · edit-units 10개씩 묶음 저장 · 저장 중 [저장]도 꺼짐.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-unit-edit.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { OLYMPOS, WORDMASTER } = require('./unit-toc-samples.cjs');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const BK = '11111111-1111-4111-8111-111111111111';
const BOOK_ROW = { id: BK, props: { '교재명': '예시 수학 1', '구분': '교재', '시리즈': '예시 시리즈', '출판사': '예시 출판', '전체 분량': 200, '진도 단위': 'P.-', '가격': 15000, '사용중': true, 'ISBN13': '9790000000011' } };
const OLYMPOS_NUM = OLYMPOS.replace(/CHAPTER 0(\d) /g, '$1. '); // 대표 261127: CHAPTER를 "1." "2."로 바꾼 글
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open(opts = {}) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [];
    let editN = 0, newId = 0;
    let units = opts.units || [{ id: 'u1', name: '1. 수와 연산', page: 8, uses: 0 }, { id: 'u2', name: '2. 문자와 식', page: 40, uses: 2 }];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    await page.route(/contents\.kyobobook|kakao|nl\.go\.kr/, (route) => route.fulfill({ status: 404, body: '' }));
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
      calls.push({ fn, action: q.action, body: q });
      if (fn === 'textbook-api') {
        switch (q.action) {
          case 'units': return reply(route, 200, { bookId: q.bookId, units });
          case 'units-fetch': return reply(route, 200, opts.fetch === 'none' ? { found: false, text: '', source: '' } : { found: true, source: 'kyobo', text: opts.fetchText || OLYMPOS });
          case 'edit-units': {
            /* 서버(editUnits)처럼 고침 → 삭제 → 추가 차례로. editDelay = 응답 늦추기, editFailAt = 그 번째 호출은 앞 4개만 하고 멈춤 */
            editN++; if (opts.editDelay) await new Promise((r) => setTimeout(r, opts.editDelay));
            const ops = [...(q.update || []).map((x) => ['u', x]), ...(q.remove || []).map((x) => ['r', x]), ...(q.add || []).map((x) => ['a', x])];
            const fail = opts.editFailAt === editN, run = fail ? ops.slice(0, 4) : ops, d = { updated: 0, removed: 0, added: 0 }, blocked = [];
            for (const [k, x] of run) {
              if (k === 'u') { units = units.map((u) => (u.id === x.id ? { ...u, name: x.name, page: x.page } : u)); d.updated++; }
              if (k === 'r') { if ((units.find((u) => u.id === x) || {}).uses) blocked.push(x); else { units = units.filter((u) => u.id !== x); d.removed++; } }
              if (k === 'a' && !units.some((u) => u.name === x.name)) { units = [...units, { id: 'n' + newId++, name: x.name, page: x.page, uses: 0 }]; d.added++; }
            }
            if (fail) return reply(route, 200, { ok: false, ...d, blocked, skipped: 0, error: `저장하다 멈췄습니다(수정 ${d.updated} · 삭제 ${d.removed} · 추가 ${d.added}). 다시 열어 확인해 주세요.` });
            return reply(route, 200, { ok: true, ...d, blocked, skipped: 0 });
          }
          case 'series': return reply(route, 200, { series: [{ id: 's1', name: '예시 시리즈' }], duplicates: [] });
        }
        return reply(route, 400, { error: '지원하지 않는 작업입니다.' });
      }
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? [opts.book || BOOK_ROW] : [] });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: { '라이브러리(학원) DB': { '시리즈': ['예시 시리즈'], '출판사': ['예시 출판'] } } });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.evaluate(() => openScreen('books'));
    await page.evaluate((id) => { activeTab.state.sel = id; panelOpen = true; render(); }, BK);
    await page.click('#lp [data-tab="unit"], #lp button:has-text("단원")');
    const n0 = (opts.units || [1, 2]).length;
    await page.waitForFunction((n) => new RegExp('단원 ' + n + '개').test(document.querySelector('#lp').textContent), n0, { timeout: 10000 });
    await page.click('#lp [data-lbu="edit"]'); await page.waitForSelector('.dlg #lbuR');
    return { page, calls, errors };
  }
  const tb = (calls, a) => calls.filter((c) => c.fn === 'textbook-api' && c.action === a);
  const flat = (calls) => { const ed = tb(calls, 'edit-units').map((c) => c.body); return { n: ed.length, update: ed.flatMap((x) => x.update), remove: ed.flatMap((x) => x.remove), add: ed.flatMap((x) => x.add) }; };
  const rowsOf = (page) => page.$$eval('.dlg #lbuR .lbuer', (l) => l.map((r) => { const i = r.querySelectorAll('.lbuin'); return i.length ? i[0].value + '|' + i[1].value : r.querySelector('.nm').textContent + '|' + r.querySelector('.pg').textContent; }));
  const head = (page) => page.textContent('.dlg #lbuVh');
  const seg = (page, sel) => page.$$eval(sel + ' button', (l) => l.map((x) => (x.classList.contains('on') ? '*' : '') + x.textContent.replace(/\s+/g, ' ').trim()));
  const editing = (page) => page.$$eval('.dlg #lbuR .lbuer.on', (l) => l.map((r) => +r.dataset.i));
  const box = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const noOverflow = async (page, name) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': 가로 넘침');
  const settle = (page) => page.waitForTimeout(450); // 글 입력 다시 만들기 지연(300) 뒤
  const checks = (page) => page.$$eval('.dlg #lbuChR label', (l) => l.filter((x) => x.offsetParent).map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  /* 체크 줄(항목 168): 보이는 체크가 한 줄 · 서로 겹치지 않음 · 창 안 · 단계 세그먼트와 왼쪽 맞춤 */
  const checkRow = async (page, d, lvB) => {
    const bs = await page.$$eval('.dlg #lbuChR label', (l) => l.filter((x) => x.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    assert(bs.length >= 1);
    bs.forEach((b, k) => {
      assert(b.h <= 24, '체크 한 줄: ' + JSON.stringify(b)); assert(b.x + b.w <= d.x + d.w - 16, '체크가 창 안: ' + JSON.stringify([b, d]));
      assert(Math.abs(b.y + b.h / 2 - (bs[0].y + bs[0].h / 2)) < 4, '체크는 같은 줄');
      if (k) assert(bs[k - 1].x + bs[k - 1].w + 8 <= b.x, '체크끼리 겹치지 않음: ' + JSON.stringify(bs));
    });
    assert(Math.abs(bs[0].x - lvB.x) < 2, '체크 줄은 단계 세그먼트와 왼쪽 맞춤: ' + JSON.stringify([bs[0], lvB]));
  };

  // 1) 빈 교재: 탭 없음 · [가져오기] → 오른쪽 18줄 · 단계 바꾸면 6줄 · 이름 방식 · 부록 · 줄 바로 고치기 · 묻기 · 저장 본문
  {
    const { page, calls, errors } = await open({ units: [] });
    assert.equal(await page.locator('.dlg #lbuTabs, .dlg [data-ut], .dlg #lbuSplit').count(), 0, '탭 · [단원 목록 입력] 없음');
    assert.equal(await page.$eval('.dlg', (e) => e.classList.contains('lbuwide')), true, '처음부터 넓은 창');
    assert.match(await page.textContent('.dlg #lbuR'), /붙여 넣거나 \[가져오기\]를 누르면 여기에 단원 줄이 생겨요/);
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => document.querySelectorAll('.dlg #lbuR .lbuer').length === 18, null, { timeout: 10000 });
    assert.deepEqual(tb(calls, 'units-fetch').map((c) => c.body), [{ action: 'units-fetch', isbn13: '9790000000011' }]);
    assert.equal(await page.inputValue('.dlg #lbuT'), OLYMPOS, '받은 글 그대로 왼쪽 칸에');
    assert.equal(await head(page), '단원 18개');
    const r0 = await rowsOf(page); assert.equal(r0[0], '01 글의 목적|—'); assert.equal(r0[17], '18 장문2 (1지문 3문항)|—');
    assert.deepEqual(await seg(page, '.dlg #lbuLv'), ['CHAPTER 6', '*01 18']);
    assert.deepEqual(await seg(page, '.dlg #lbuNm'), ['*그대로', '윗 단계 이름 붙이기', '번호 1-1.']);
    assert.match(await page.textContent('.dlg #lbuLM'), /교보문고에서 단원 목록을 가져왔어요/);
    // 배치: 글 칸 | 단원 줄 같은 높이 · 넓은 창 1280 안 · 아래 단계 → 이름 → 체크 줄(그 밖 · 부록, 범위 줄 없으면 범위 체크 숨김) → 안내
    const d = await box(page, '.dlg'), ta = await box(page, '.dlg #lbuT'), v = await box(page, '.dlg #lbuV');
    assert(d.w >= 900 && d.x >= 0 && d.x + d.w <= 1280, '넓은 창: ' + JSON.stringify(d));
    assert.equal(Math.round(ta.h), Math.round(v.h), '같은 높이'); assert(v.x > ta.x + ta.w - 1, '단원 줄은 오른쪽');
    assert.equal(await page.isVisible('.dlg #lbuExL'), false, '범위 줄 없으면 [범위 줄 펼치기] 숨김');
    assert.deepEqual(await checks(page), ['그 밖 줄도 넣기 (12)', '부록 줄도 넣기 (3)']);
    const lvB = await box(page, '.dlg #lbuLv'), nmB = await box(page, '.dlg #lbuNm'), chB = await box(page, '.dlg #lbuChR'), lmB = await box(page, '.dlg #lbuLM');
    assert(lvB.y < nmB.y && nmB.y + nmB.h <= chB.y + 1 && chB.y + chB.h <= lmB.y + 1, '단계 → 이름 → 체크 줄 → 안내: ' + JSON.stringify([lvB, nmB, chB, lmB]));
    await checkRow(page, d, lvB);
    await noOverflow(page, '빈 교재'); await page.screenshot({ path: shots + 'unit-edit-normal.png' });
    // 그 밖 줄도 넣기(항목 168): 켜면 Practice 줄이 원래 자리에 · 끄면 18
    await page.check('.dlg #lbuEt'); assert.equal(await head(page), '단원 30개', '그 밖 줄도 넣기');
    assert.deepEqual((await rowsOf(page)).slice(4, 8), ['05 주제·제목|—', '서술형 Practice|—', '논술형 Practice|—', '06 도표·실용문 내용 일치/불일치|—']);
    await page.uncheck('.dlg #lbuEt'); assert.equal(await head(page), '단원 18개');
    // 단계 · 이름 방식 · 부록 → 오른쪽 바로(손으로 고친 것 없으면 묻지 않음)
    await page.click('.dlg #lbuLv button:has-text("CHAPTER")');
    assert.equal(await head(page), '단원 6개'); assert.equal((await rowsOf(page))[0], 'CHAPTER 01 대의 파악(핵심 내용·맥락)|—');
    await page.click('.dlg #lbuNm [data-nm="num"]'); assert.equal((await rowsOf(page))[1], '2. 세부 정보|—', '번호 1-1.(윗 단계 없음 = 순번.)');
    await page.click('.dlg #lbuLv button:has-text("01")');
    assert.deepEqual((await rowsOf(page)).slice(4, 7), ['1-5. 주제·제목|—', '2-1. 도표·실용문 내용 일치/불일치|—', '2-2. 학술문 내용 불일치|—'], '번호 1-1.');
    await page.click('.dlg #lbuNm [data-nm="up"]'); assert.equal((await rowsOf(page))[0], 'CHAPTER 01 · 01 글의 목적|—');
    await page.click('.dlg #lbuNm [data-nm=""]');
    await page.check('.dlg #lbuAp'); assert.equal(await head(page), '단원 20개', '부록 줄도 넣기'); await page.uncheck('.dlg #lbuAp');
    assert.equal(await page.locator('.dlg .lbuask').count(), 0, '손으로 고친 것이 없으면 묻지 않음');
    // 줄 누름 → 그 줄만 밑줄 입력
    const hNorm = (await box(page, '.dlg #lbuR .lbuer[data-i="2"]')).h;
    await page.click('.dlg #lbuR .lbuer[data-i="1"] .nm');
    assert.deepEqual(await editing(page), [1], '누른 줄만 편집');
    assert.equal(await page.locator('.dlg #lbuR input').count(), 2, '입력칸은 그 줄 둘(이름 · 시작)뿐');
    const st = await page.$eval('.dlg #lbuR .lbuer.on .lbuin', (e) => { const s = getComputedStyle(e); return [s.borderTopWidth, s.borderLeftWidth, s.borderBottomWidth, s.backgroundColor]; });
    assert.deepEqual(st, ['0px', '0px', '1px', 'rgba(0, 0, 0, 0)'], '밑줄 입력(상자 없음)');
    const hEd = (await box(page, '.dlg #lbuR .lbuer.on')).h; assert(Math.abs(hEd - hNorm) <= 4, `편집 줄 높이 ${hEd} ≈ 평소 ${hNorm}`);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.f), 'name', '이름 칸에 커서');
    await page.fill('.dlg #lbuR .lbuer.on [data-f="name"]', '02 심경(고침)');
    await page.screenshot({ path: shots + 'unit-edit-row.png' });
    await page.keyboard.press('Enter'); assert.deepEqual(await editing(page), [2], 'Enter = 다음 줄 편집');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.lbuer').dataset.i), '2');
    await page.keyboard.press('Escape'); assert.deepEqual(await editing(page), [], 'Esc = 편집 끝');
    assert.equal(await page.locator('.dlg #lbuR').count(), 1, 'Esc에도 창은 그대로');
    assert.equal((await rowsOf(page))[1], '02 심경(고침)|—');
    // 다른 줄 누르면 옮겨감 · [+] 아래에 끼우기 · [×] 삭제
    await page.click('.dlg #lbuR .lbuer[data-i="3"] .nm'); await page.click('.dlg #lbuR .lbuer[data-i="0"] .pg');
    assert.deepEqual(await editing(page), [0]); assert.equal(await page.evaluate(() => document.activeElement.dataset.f), 'page', '시작 쪽을 누르면 시작 칸');
    await page.click('.dlg #lbuR .lbuer.on [data-addb]'); assert.deepEqual(await editing(page), [1], '[+] = 바로 아래 새 줄 편집');
    await page.keyboard.type('끼운 단원'); await page.press('.dlg #lbuR .lbuer.on [data-f="name"]', 'Tab'); await page.keyboard.type('9');
    assert.equal(await head(page), '단원 19개');
    await page.click('.dlg #lbuR .lbuer[data-i="5"] .nm'); await page.click('.dlg #lbuR .lbuer.on [data-del]');
    assert.equal(await head(page), '단원 18개', '[×] 새 줄은 바로 빠짐');
    const handRows = await rowsOf(page); assert.equal(handRows[1], '끼운 단원|P.9');
    // 손으로 고친 뒤 단계 바꾸면 묻기 — [취소]면 그대로(단계도 되돌림), [다시 만들기]면 새로
    await page.click('.dlg #lbuLv button:has-text("CHAPTER")');
    await page.waitForSelector('.dlg .lbuask, .lbuask');
    assert.equal(await page.textContent('.lbuask h3'), '오른쪽에서 고친 내용이 바뀌어요');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '취소', '처음 커서는 [취소]');
    await page.screenshot({ path: shots + 'unit-edit-ask.png' });
    await page.click('.lbuask [data-ak="0"]');
    assert.deepEqual(await rowsOf(page), handRows, '[취소] = 고친 줄 그대로'); assert.deepEqual(await seg(page, '.dlg #lbuLv'), ['CHAPTER 6', '*01 18'], '단계도 되돌림');
    await page.click('.dlg #lbuLv button:has-text("CHAPTER")'); await page.click('.lbuask [data-ak="1"]');
    assert.equal(await head(page), '단원 6개', '[다시 만들기]');
    await page.click('.dlg #lbuLv button:has-text("01")'); assert.equal(await page.locator('.lbuask').count(), 0);
    // 글을 고쳐도 다시 만들기(짧게 기다림)
    await page.fill('.dlg #lbuT', OLYMPOS.replace('18 장문2 (1지문 3문항)\n', '18 장문2 (1지문 3문항)\n19 덧붙인 단원\n')); await settle(page);
    assert.equal(await head(page), '단원 19개', '글을 고치면 오른쪽 줄 바로');
    await page.fill('.dlg #lbuT', OLYMPOS); await settle(page);
    await page.click('.dlg #lbuR .lbuer[data-i="0"] .nm'); await page.fill('.dlg #lbuR .lbuer.on [data-f="page"]', '6');
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 15000 });
    const F = flat(calls);
    assert.equal(F.n, 2, '18줄 = 10 + 8'); assert.deepEqual([F.update, F.remove], [[], []]);
    assert.equal(F.add.length, 18); assert.deepEqual(F.add[0], { name: '01 글의 목적', page: 6 }); assert.deepEqual(F.add[17], { name: '18 장문2 (1지문 3문항)', page: null });
    assert.deepEqual(tb(calls, 'edit-units')[0].body.action, 'edit-units');
    assert.deepEqual(errors, []); done.push('빈 교재 가져오기 · 줄 고치기 · 묻기 · 저장'); await page.close();
  }
  // 2) CHAPTER를 "1." "2."로 바꾼 글(대표 261127): 대단원 6 · 단원 18 그대로, "1. 대의 파악" · "서술형 Practice"는 단원 줄에 섞이지 않음
  {
    const { page, errors } = await open({ units: [], fetchText: OLYMPOS_NUM });
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => document.querySelectorAll('.dlg #lbuR .lbuer').length === 18, null, { timeout: 10000 });
    assert.deepEqual(await seg(page, '.dlg #lbuLv'), ['1. 6', '*01 18']);
    const r = await rowsOf(page); assert(!r.some((x) => /대의 파악|Practice/.test(x)), '대단원 · Practice 줄 안 섞임');
    await page.click('.dlg #lbuNm [data-nm="num"]');
    assert.deepEqual((await rowsOf(page)).slice(0, 1).concat((await rowsOf(page)).slice(5, 6)), ['1-1. 글의 목적|—', '2-1. 도표·실용문 내용 일치/불일치|—']);
    await page.screenshot({ path: shots + 'unit-edit-num.png' });
    assert.deepEqual(errors, []); done.push('대단원 "1." 글 · 번호 1-1.'); await page.close();
  }
  // 2b) 범위 줄 펼치기 · 그 밖 체크(항목 168, 대표 261127 워드마스터 꼴): 기본 Day 30줄 · 세그먼트 Step 3 · Day 30(그 밖 없음) · 펼치기 끔 15 · 그 밖 켬 33 · 손으로 고친 뒤면 묻기
  {
    const { page, errors } = await open({ units: [], fetchText: WORDMASTER });
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => document.querySelectorAll('.dlg #lbuR .lbuer').length === 30, null, { timeout: 10000 });
    assert.deepEqual(await seg(page, '.dlg #lbuLv'), ['Step 3', '*Day 30'], '세그먼트에 그 밖 없음');
    assert.deepEqual(await checks(page), ['범위 줄 펼치기', '그 밖 줄도 넣기 (3)'], '부록 없으면 부록 체크 숨김');
    assert.equal(await page.isChecked('.dlg #lbuEx'), true, '펼치기 기본 켬'); assert.equal(await page.isChecked('.dlg #lbuEt'), false, '그 밖 기본 끔');
    let r = await rowsOf(page); assert.equal(r[0], 'Day 01|—'); assert.equal(r[12], 'Day 13 People|—'); assert.equal(r[29], 'Day 30|—');
    const d = await box(page, '.dlg'), lvB = await box(page, '.dlg #lbuLv');
    await checkRow(page, d, lvB); await noOverflow(page, '워드마스터');
    await page.screenshot({ path: shots + 'unit-edit-range.png' });
    await page.uncheck('.dlg #lbuEx');
    assert.equal(await head(page), '단원 15개', '펼치기 끔 = 15줄'); assert.equal((await rowsOf(page))[0], 'Day 01 ~ Day 12|—');
    assert.deepEqual(await seg(page, '.dlg #lbuLv'), ['Step 3', '*Day 15']);
    assert.equal(await page.isVisible('.dlg #lbuExL'), true, '끈 뒤에도 체크는 보임');
    await page.check('.dlg #lbuEx'); await page.check('.dlg #lbuEt');
    r = await rowsOf(page); assert.equal(r.length, 33, '그 밖 줄도 넣기 = 30 + 3');
    assert.deepEqual(r.slice(11, 14), ['Day 12|—', '누적 테스트 1|—', 'Day 13 People|—'], '원래 자리에 끼움');
    // 체크 셋 다 보이는 꼴(부록 줄 추가) — 한 줄 · 겹치지 않음
    await page.fill('.dlg #lbuT', WORDMASTER + '\n부록\n01 예시 부록 하나\n02 예시 부록 둘'); await settle(page);
    assert.deepEqual(await checks(page), ['범위 줄 펼치기', '그 밖 줄도 넣기 (3)', '부록 줄도 넣기 (2)']);
    await checkRow(page, d, lvB); await page.screenshot({ path: shots + 'unit-edit-checks.png' });
    // 손으로 고친 뒤 체크를 바꾸면 묻기 — [취소]면 체크도 되돌림
    await page.click('.dlg #lbuR .lbuer[data-i="0"] .nm'); await page.fill('.dlg #lbuR .lbuer.on [data-f="name"]', 'Day 01 고침'); await page.keyboard.press('Escape');
    await page.uncheck('.dlg #lbuEx'); await page.waitForSelector('.lbuask');
    await page.click('.lbuask [data-ak="0"]');
    assert.equal(await page.isChecked('.dlg #lbuEx'), true, '[취소] = 체크 되돌림'); assert.equal((await rowsOf(page))[0], 'Day 01 고침|—');
    assert.deepEqual(errors, []); done.push('범위 줄 펼치기 · 그 밖 체크'); await page.close();
  }
  // 3) 기존 단원 교재: 열면 기존 줄(왼쪽 비어 있음) · 연결된 단원은 [×] 없음 · 글 넣으면 [바꾸기 | 뒤에 붙이기] 묻기 · 뒤에 붙이기 → 저장 본문
  {
    const { page, calls, errors } = await open();
    assert.equal(await page.inputValue('.dlg #lbuT'), '', '왼쪽 비어 있음');
    assert.deepEqual(await rowsOf(page), ['1. 수와 연산|P.8', '2. 문자와 식|P.40'], '열면 기존 단원');
    await page.click('.dlg #lbuR .lbuer[data-i="1"] .nm');
    assert.equal(await page.locator('.dlg #lbuR .lbuer.on [data-del]').count(), 0, '연결된 단원은 삭제 단추 없음');
    assert.match(await page.textContent('.dlg #lbuR .lbuer.on'), /연결 2/);
    await page.mouse.click(8, 8); assert.equal(await page.locator('.dlg #lbuR').count(), 1, '배경을 눌러도 창은 그대로(항목 163)');
    await page.fill('.dlg #lbuT', '1. 수와 연산 8\n3. 도형 70'); await settle(page);
    assert.equal(await page.textContent('.lbuask h3'), '기존 단원을 바꿀까요?');
    assert.deepEqual(await page.$$eval('.lbuask [data-ak]', (l) => l.map((x) => x.textContent)), ['취소', '뒤에 붙이기', '바꾸기']);
    await page.screenshot({ path: shots + 'unit-edit-ask-mode.png' });
    await page.click('.lbuask [data-ak="0"]');
    assert.deepEqual(await rowsOf(page), ['1. 수와 연산|P.8', '2. 문자와 식|P.40'], '[취소] = 기존 줄 그대로');
    assert.match(await page.textContent('.dlg #lbuLM'), /반영하지 않았어요/);
    await page.click('.dlg #lbuRe'); await page.click('.lbuask [data-ak="1"]');
    assert.deepEqual(await rowsOf(page), ['1. 수와 연산|P.8', '2. 문자와 식|P.40', '3. 도형|P.70'], '뒤에 붙이기(같은 이름은 넣지 않음)');
    assert.match(await page.textContent('.dlg #lbuLM'), /이미 있는 이름 1개는 넣지 않았어요/);
    assert.doesNotMatch(await page.textContent('.dlg'), /있음|건너뜀|단원 0개/, '옛 미리보기 혼란 없음');
    await page.click('.dlg #lbuR .lbuer[data-i="0"] .nm'); await page.fill('.dlg #lbuR .lbuer.on [data-f="name"]', '1. 수와 연산(개정)'); await page.keyboard.press('Escape');
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 10000 });
    const ed = tb(calls, 'edit-units'); assert.equal(ed.length, 1);
    assert.deepEqual(ed[0].body, { action: 'edit-units', bookId: '11111111-1111-4111-8111-111111111111', update: [{ id: 'u1', name: '1. 수와 연산(개정)', page: 8 }], remove: [], add: [{ name: '3. 도형', page: 70 }] }, '저장 본문 꼴 같음');
    assert.deepEqual(errors, []); done.push('기존 단원 · 뒤에 붙이기'); await page.close();
  }
  // 4) 바꾸기(대표 261127 실측 — 기존 40 → 새 글): 순서대로 짝지어 update, 남는 새 줄만 add · 남는 기존 줄만 remove · 진행 분모 = 보낼 건수 · 저장 중 [저장]도 꺼짐
  for (const [nNew, exp] of [[40, { update: 40, add: 0, remove: 0 }], [42, { update: 40, add: 2, remove: 0 }], [38, { update: 38, add: 0, remove: 2 }]]) {
    const old = Array.from({ length: 40 }, (_, i) => ({ id: 'd' + (i + 1), name: `DAY ${String(i + 1).padStart(2, '0')} 예전 주제`, page: null, uses: 0 }));
    const { page, calls, errors } = await open({ units: old, editDelay: 400 });
    const text = Array.from({ length: nNew }, (_, i) => `DAY ${String(i + 1).padStart(2, '0')} 새 주제`).join('\n');
    await page.fill('.dlg #lbuT', text); await settle(page); await page.click('.lbuask [data-ak="2"]');
    assert.equal(await head(page), `단원 ${nNew}개${exp.remove ? ` · 저장하면 삭제 ${exp.remove}개` : ''}`);
    const total = exp.update + exp.add + exp.remove;
    await page.hover('.dlg #co'); await page.click('.dlg #co');
    await page.waitForFunction((t) => new RegExp('단원 저장 중 \\d+/' + t).test((document.querySelector('.dlg #lbuP .t') || {}).textContent || ''), total, { timeout: 10000 });
    assert.equal(await page.isDisabled('.dlg #co'), true, '저장 중 [저장] 꺼짐'); assert.equal(await page.isDisabled('.dlg #cc'), true, '저장 중 [취소] 꺼짐');
    assert(+(await page.$eval('.dlg #co', (e) => getComputedStyle(e).opacity)) < 0.5, '[저장]도 흐림(올려 둔 채)');
    if (nNew === 40) await page.screenshot({ path: shots + 'unit-edit-save-progress.png' });
    await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 20000 });
    const F = flat(calls);
    assert.deepEqual({ update: F.update.length, add: F.add.length, remove: F.remove.length }, exp, `기존 40 → 새 ${nNew}`);
    assert.deepEqual(F.update[0], { id: 'd1', name: 'DAY 01 새 주제', page: null }, '순서대로 짝지음');
    if (exp.remove) assert.deepEqual(F.remove, ['d39', 'd40']);
    if (exp.add) assert.deepEqual(F.add.map((x) => x.name), ['DAY 41 새 주제', 'DAY 42 새 주제']);
    assert.equal(F.n, Math.ceil(total / 10));
    assert.deepEqual(errors, []); await page.close();
  }
  done.push('바꾸기 40 → 40 · 42 · 38');
  // 5) 묶음 저장 실패 · [다시 저장](항목 165 그대로): 고침 10 · 삭제 5 · 추가 45 → 3번째 묶음에서 멈춤 → 남은 것만
  {
    const units20 = Array.from({ length: 20 }, (_, i) => ({ id: 'w' + (i + 1), name: (i + 1) + '. 단원 ' + (i + 1), page: 10 * (i + 1), uses: 0 }));
    const { page, calls, errors } = await open({ units: units20, editFailAt: 3 });
    const ADD = Array.from({ length: 45 }, (_, i) => `새 단원 ${i + 1}`);
    await page.fill('.dlg #lbuT', ADD.join('\n')); await settle(page); await page.click('.lbuask [data-ak="1"]');
    assert.equal(await head(page), '단원 65개');
    for (let i = 0; i < 10; i++) { await page.click(`.dlg #lbuR .lbuer[data-i="${i}"] .nm`); await page.fill('.dlg #lbuR .lbuer.on [data-f="name"]', `${i + 1}. 단원 ${i + 1}(고침)`); }
    for (let i = 10; i < 15; i++) { await page.click(`.dlg #lbuR .lbuer[data-i="${i}"] .nm`); await page.click('.dlg #lbuR .lbuer.on [data-del]'); }
    await page.keyboard.press('Escape');
    assert.equal(await head(page), '단원 60개 · 저장하면 삭제 5개');
    await page.click('.dlg #co');
    await page.waitForFunction(() => /까지 저장했어요/.test(document.querySelector('.dlg #lbuM').textContent), null, { timeout: 15000 });
    assert.match(await page.textContent('.dlg #lbuM'), /24\/60까지 저장했어요 — 나머지 36개는 \[다시 저장\]을 눌러요/);
    assert.equal((await page.textContent('.dlg #co')).trim(), '다시 저장'); assert.equal(await page.isDisabled('.dlg #co'), false, '멈추면 [저장] 다시 켬');
    await page.click('.dlg #co'); await page.waitForFunction(() => !document.querySelector('.dlg #lbuR'), null, { timeout: 15000 });
    const again = tb(calls, 'edit-units').slice(3).map((c) => c.body);
    assert.equal(again.length, 4, '남은 36개 = 4번');
    assert.deepEqual({ update: again.flatMap((x) => x.update), remove: again.flatMap((x) => x.remove), add: again.flatMap((x) => x.add).map((x) => x.name) }, { update: [], remove: [], add: ADD.slice(9) });
    assert.deepEqual(errors, []); done.push('묶음 저장 실패 · 다시 저장'); await page.close();
  }
  // 6) 쪽 순서로 정렬 · 맨 아래 [단원 추가] · ISBN 없음 · 못 찾음
  {
    const units5 = Array.from({ length: 5 }, (_, i) => ({ id: 'w' + (i + 1), name: (i + 1) + '. 단원 ' + (i + 1), page: 10 * (i + 1), uses: 0 }));
    const { page, calls, errors } = await open({ units: units5, fetch: 'none' });
    const sortShown = () => page.$eval('.dlg #lbuSort', (e) => getComputedStyle(e).display !== 'none');
    assert.equal(await sortShown(), false);
    {
      const L = await page.$$eval('.dlg #lbuLinks a.link-chip', (as) => as.map((x) => [x.textContent, x.href, x.target, x.rel])), I = '9790000000011';
      assert.equal(L.length, 3, 'ISBN13 있으면 관련 링크 3개');
      assert.deepEqual(L.map((x) => x[1]), ['https://search.kyobobook.co.kr/search?keyword=' + I, 'https://www.yes24.com/Product/Search?domain=BOOK&query=' + I, 'https://www.nl.go.kr/NL/contents/search.do?srchTarget=total&kwd=' + I]);
      assert.ok(L.every((x) => x[2] === '_blank' && /noopener/.test(x[3])));
      assert.equal(await page.isVisible('.dlg #lbuT'), true, '링크를 눌러도 창은 그대로(새 탭)');
      assert.equal(await page.$eval('.dlg #lbuLinks', (e) => e.scrollWidth <= e.clientWidth), true, '1280에서 넘치지 않음');
      await page.screenshot({ path: shots + 'unit-edit-links.png' });
    }
    await page.click('.dlg #lbuR .lbuer[data-i="0"] .pg'); await page.fill('.dlg #lbuR .lbuer.on [data-f="page"]', '300'); await page.keyboard.press('Escape');
    assert.equal(await sortShown(), true, '순서가 어긋나면 정렬 단추'); await page.click('.dlg #lbuSort');
    assert.deepEqual((await rowsOf(page)).map((x) => x.split('|')[0]), ['2. 단원 2', '3. 단원 3', '4. 단원 4', '5. 단원 5', '1. 단원 1']);
    await page.click('.dlg #lbuAdd'); assert.deepEqual(await editing(page), [5], '[단원 추가] = 맨 아래 새 줄 편집');
    await page.keyboard.press('Escape'); assert.equal(await head(page), '단원 5개', '비운 새 줄은 편집 끝에 빠짐');
    await page.click('.dlg #lbuGet');
    await page.waitForFunction(() => /이 ISBN으로 단원을 찾지 못했어요/.test(document.querySelector('.dlg #lbuLM').textContent), null, { timeout: 10000 });
    assert.equal(tb(calls, 'units-fetch').length, 1);
    assert.deepEqual(errors, []); await page.close();
  }
  {
    const book = { id: BK, props: { ...BOOK_ROW.props, 'ISBN13': '' } };
    const { page, calls, errors } = await open({ units: [], book });
    assert.equal(await page.isDisabled('.dlg #lbuGet'), true, 'ISBN13 없으면 흐린 단추');
    assert.match(await page.textContent('.dlg'), /ISBN13이 있어야 해요/);
    assert.equal(await page.locator('.dlg #lbuLinks').count(), 0, 'ISBN13 없으면 관련 링크 숨김');
    await page.fill('.dlg #lbuT', '1. 소인수분해 8\n2. 정수와 유리수 28'); await settle(page);
    assert.deepEqual(await rowsOf(page), ['1. 소인수분해|P.8', '2. 정수와 유리수|P.28'], '단원 없는 교재는 묻지 않고 바로');
    assert.equal(await page.isVisible('.dlg #lbuLvR'), false, '단계 하나면 단계 고르기 숨김');
    assert.equal(tb(calls, 'units-fetch').length, 0);
    assert.deepEqual(errors, []); done.push('정렬 · 단원 추가 · ISBN 없음 · 못 찾음'); await page.close();
  }
  console.log('단원 편집 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
