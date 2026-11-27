// 관리 앱 선택지 칩 색 = 노션 옵션 색(v2.8.0 항목 166, 대표 261127) — 가짜 서버로만, PC 1280.
// 실제 자료 모드(?live=1): app-api option-colors가 준 색이 먼저(교재 유형 독해 = green → nc-green, NCOL과 다르면 노션 색),
// 노션 색이 없는 칸은 NCOL 그대로, 일정 세부 구분은 EV_SUB_NC(달력 표)까지 노션 색, [동기화]는 fresh로 다시 받아 바로 반영. 예시 모드는 NCOL 그대로.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-option-colors.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const BOOK = { id: '11111111-1111-4111-8111-111111111111', props: { '교재명': '예시 영어 1', '구분': '교재', '출판사': '예시 출판', '교재 유형': ['독해', '내신'], '전체 분량': 100, '진도 단위': 'P.-', '사용중': true } };
const TEACHER = { id: '22222222-2222-4222-8222-222222222222', props: { '이름': '예시 강사', '직책': '강사' } };
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  try {
    // 1) 예시 모드: NCOL 그대로(option-colors 안 부름)
    {
      const page = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/prototype/admin-app/hada-admin.html`);
      await page.waitForFunction(() => typeof ncCls === 'function' && typeof DB !== 'undefined');
      const r = await page.evaluate(() => [ncCls('books', 'types', '내신'), ncCls('books', 'types', '독해'), ncCls('teachers', 'role', '강사'), evNcSub('상담'), NOPT_COL]);
      assert.deepEqual(r, ['nc-orange', '', 'nc-blue', 'green', null], '예시 모드 = 고정표');
      assert.deepEqual(errors, []); await page.close(); done.push('예시 모드 NCOL 그대로');
    }
    // 2) 실제 자료 모드(가짜 서버)
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [];
    let colors = {
      '라이브러리(학원) DB': { '교재 유형': { '독해': 'green', '내신': 'red' }, '출판사': { '예시 출판': 'blue' } },
      '일정(학원) DB': { '세부 구분': { '🗣️ 상담': 'pink', '새 구분': 'brown' } },
    };
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(/contents\.kyobobook|kakao|nl\.go\.kr/, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
      calls.push({ fn, action: q.action, body: q });
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? [BOOK] : q.db === '강사(학원) DB' ? [TEACHER] : [] });
        if (q.action === 'option-colors') return reply(route, 200, { ok: true, dbs: colors });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: { '라이브러리(학원) DB': { '교재 유형': ['독해', '내신'], '출판사': ['예시 출판'] } } });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '예시 학원' });
        if (q.action === 'run') return reply(route, 200, { ok: true, changed: 0, syncedAt: new Date().toISOString() });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.waitForFunction(() => !!NOPT_COL, null, { timeout: 10000 });
    assert(calls.some((c) => c.action === 'option-colors' && c.body.fresh === false), '첫 화면 뒤 option-colors(fresh 아님)');
    const fn = await page.evaluate(() => ({
      keys: [ncKeyMap()['books|types'], ncKeyMap()['books|pub'], ncKeyMap()['teachers|role'], ncKeyMap()['events|sub'], ncKeyMap()['blocks|day']],
      dok: ncCls('books', 'types', '독해'), nae: ncCls('books', 'types', '내신'), role: ncCls('teachers', 'role', '강사'), series: ncCls('books', 'series', '쎈'),
      sub: ncCls('events', 'sub', '상담'), subCal: evNcSub('상담'), newSub: evNcSub('새 구분'), grade: ncCls('students', 'grade', '중2'),
      opt: optColorOf('btype', '독해'), items: ncItems('books', 'types', ['독해']).map((x) => x.cls),
    }));
    assert.deepEqual(fn.keys, [['라이브러리(학원) DB', '교재 유형'], ['라이브러리(학원) DB', '출판사'], ['강사(학원) DB', '직책'], ['일정(학원) DB', '세부 구분'], ['시간표(학원) DB', '요일']], 'APPMAP · APPVIEW에서 역으로 찾은 칸');
    assert.equal(fn.dok, 'nc-green', '노션에만 있는 새 선택지 = 노션 색');
    assert.equal(fn.nae, 'nc-red', 'NCOL(orange)과 다르면 노션 색');
    assert.equal(fn.role, 'nc-blue', '노션 색이 없는 칸 = NCOL 그대로');
    assert.equal(fn.series, 'nc-red', '노션 표에 칸이 없으면 NCOL');
    assert.deepEqual([fn.sub, fn.subCal, fn.newSub], ['nc-pink', 'pink', 'brown'], '일정 세부 구분: 이모지 떼고 노션 색, 달력 표(EV_SUB_NC)도 같은 색');
    assert.equal(fn.grade, 'nc-blue', '학년은 규칙 그대로');
    assert.equal(fn.opt, 'green', '선택지 관리 색 = 노션 색');
    assert.deepEqual(fn.items, ['nc-green'], '고르기 목록(체크 목록) 같은 색');
    done.push('색 우선순위(노션 → NCOL → 규칙)');
    // 표: 출판사 칩(NCOL에 없는 '예시 출판') = 노션 색
    await page.evaluate(() => openScreen('books'));
    await page.waitForSelector('#view table');
    const pubCls = await page.evaluate(() => { const c = [...document.querySelectorAll('#view td .tchip')].find((x) => x.textContent.trim() === '예시 출판'); return c ? c.className : null; });
    assert(pubCls && /\bnc-blue\b/.test(pubCls), '라이브러리 표 출판사 칩 = 노션 색: ' + pubCls);
    await page.screenshot({ path: path.join(process.env.SHOTS || require('os').tmpdir(), 'option-colors-books.png') });
    done.push('라이브러리 표 칩 색');
    // [동기화]: fresh로 다시 받아 바로 반영(노션에서 독해 색을 purple로 바꾼 셈)
    colors = JSON.parse(JSON.stringify(colors)); colors['라이브러리(학원) DB']['교재 유형']['독해'] = 'purple';
    await page.click('#syncBtn');
    await page.waitForFunction(() => ncCls('books', 'types', '독해') === 'nc-purple', null, { timeout: 10000 });
    assert(calls.some((c) => c.action === 'option-colors' && c.body.fresh === true), '[동기화] = option-colors fresh');
    done.push('[동기화] 뒤 새 색');
    // 서버가 실패해도 화면은 그대로(NCOL)
    assert.deepEqual(errors, []);
    await page.close();
  } finally { await b.close(); server.close(); }
  console.log('통과 — ' + done.join(' · '));
})().catch((e) => { console.error(e); process.exit(1); });
