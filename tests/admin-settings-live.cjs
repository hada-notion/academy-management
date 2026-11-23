// 관리 앱 관리자 설정 실제 연결(261123) — 가짜 서버로만. 실제 자료 모드(?live=1)에서 관리자 설정 화면이
// 옛 관리자 설정 웹 화면과 같은 서버 동작(admin-security · clear-example-data)을 같은 값으로 부르는지, app-api admin-status 값이 보이는지.
// 261123: 옛 웹 화면은 없앰 — 웹 화면으로 가는 단추가 없는지, 첫 설치 초기 비밀번호를 앱 로그인 창에서 바로 바꾸는지도 본다.
// 사용: ROOT=<저장소 폴더> node check-admin-settings-live.cjs   (캡처는 SHOTS 폴더, 기본 이 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const SUBS = {
  on: { tables: true, state: 'on', tokenAt: '2026-11-23T01:00:00Z', lastEventAt: new Date(Date.now() - 7 * 60000).toISOString(), lastEventType: 'page.properties_updated', events24h: 42, rejectedAt: null, pending: 2, failed: 1 },
  waiting: { tables: true, state: 'waiting', tokenAt: '2026-11-23T01:00:00Z', lastEventAt: null, lastEventType: null, events24h: 0, rejectedAt: null, pending: 0, failed: 0 },
  off: { tables: true, state: 'off', tokenAt: null, lastEventAt: null, lastEventType: null, events24h: 0, rejectedAt: null, pending: 0, failed: 0 },
  down: { tables: true, state: 'down', tokenAt: '2026-11-23T01:00:00Z', lastEventAt: new Date(Date.now() - 40 * 60000).toISOString(), lastEventType: 'page.properties_updated', events24h: 42, rejectedAt: null, pending: 0, failed: 0,
    health: { state: 'down', since: new Date(Date.now() - 12 * 60000).toISOString(), reason: '노션에서 고친 줄 2개를 웹훅으로 받지 못했어요(폴링이 찾음)', missed: 2, pollMin: 5, lastReportAt: new Date(Date.now() - 60000).toISOString(), simulating: false } },
  none: { tables: false, state: 'none', tokenAt: null, lastEventAt: null, lastEventType: null, events24h: 0, rejectedAt: null, pending: 0, failed: 0 },
};
const FAKE_KEY = 'TEST-ONLY-FAKE-KEY-0000', GOOD_KEY = 'TEST-ONLY-FAKE-GOOD-1111', KEY_SECRET = { NL_CERT_KEY: true }; let keyVault = {}, keyStatusCalls = [];
const CLEAR_STATUS = { workspace: '하다 예시 학원', canStart: true, flag: null, keep: ['알림톡 설정(학원) DB', '과목(학원) DB'], missing: [], unknown: ['메모 DB'],
  dbs: [{ name: '학생(학원) DB', group: '학생 · 등록', required: true, checked: true, count: 30 }, { name: '등록(학원) DB', group: '학생 · 등록', required: true, checked: true, count: 45 },
    { name: '라이브러리(학원) DB', group: '기준 자료', required: false, checked: false, count: 120, capped: true }] };
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  // 한 장면: sub = 구독 상태, opts = { profile401, adminFail, clearFlag }
  async function open(variant, sub, opts = {}) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [], logs = []; let clearState = opts.clearFlag || null;
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => logs.push(m.text()));
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('t_init')) { sessionStorage.setItem('t_init', '1'); sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } } catch (_) {} });
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {}, key = req.headers()['x-admin-key'];
      calls.push({ fn, action: q.action, key, body: q });
      if (fn === 'admin-security') {
        if (q.action === 'status') return reply(route, 200, { ready: true, webhook_key_weak: false });
        if (q.action === 'profile') return opts.profile401 ? reply(route, 401, { error: '로그인이 만료되었습니다.' }) : reply(route, 200, { changed_at: '2026-10-01T03:00:00Z', recommended_at: '2027-01-01T03:00:00Z', change_due: !!opts.due, must_change: false });
        if (q.action === 'change') return q.current_password === 'old-pass-1' ? reply(route, 200, { ok: true, changed_at: '2026-11-23T05:00:00Z' }) : reply(route, 401, { error: '현재 비밀번호가 올바르지 않습니다.' });
        if (q.action === 'logout') return reply(route, 200, { ok: true });
        if (q.action === 'login') return reply(route, 200, { session: 'sess-2', must_change: false });
        // (v2.8.0 항목 113) 외부 키 — 값은 되돌려 주지 않는다. GOOD_KEY만 연결됨, 나머지는 키가 틀림. 서버 Secret(도서관)은 연결됨
        if (q.action === 'keys-status') { keyStatusCalls.push(q.check === true); const keys = {}; for (const n of ['NEIS_API_KEY', 'NL_CERT_KEY']) { const v = keyVault[n], sec = !!KEY_SECRET[n], source = v ? 'app' : sec ? 'secret' : ''; keys[n] = { app: !!v, changed_at: v ? '2026-11-23T05:00:00Z' : null, secret: sec, source, state: v ? v.test : sec ? 'ok' : 'none', checked_at: source ? '2026-11-23T05:52:00Z' : null }; } return reply(route, 200, { keys }); }
        if (q.action === 'key-set') { const test = q.value === GOOD_KEY ? 'ok' : 'wrong'; keyVault[q.name] = { value: q.value, test }; return reply(route, 200, { ok: true, changed_at: '2026-11-23T05:00:00Z', test }); }
        if (q.action === 'key-test') { const v = keyVault[q.name]; return reply(route, 200, v ? { test: v.test, source: 'app', checked_at: '2026-11-23T05:53:00Z' } : KEY_SECRET[q.name] ? { test: 'ok', source: 'secret', checked_at: '2026-11-23T05:53:00Z' } : { test: null, source: '' }); }
        if (q.action === 'key-clear') { delete keyVault[q.name]; return reply(route, 200, { ok: true, secret: !!KEY_SECRET[q.name] }); }
      }
      if (fn === 'clear-example-data') {
        if (q.action === 'state') return reply(route, 200, { flag: clearState, canStart: !clearState || !['done', 'locked', 'running'].includes(clearState.state), updatedAt: '2026-11-23T05:00:00Z' });
        if (q.action === 'status') return reply(route, 200, { ...CLEAR_STATUS, flag: clearState, canStart: !clearState || !['done', 'locked', 'running'].includes(clearState.state) });
        if (q.action === 'start') { if (q.workspace !== CLEAR_STATUS.workspace) return reply(route, 400, { error: '워크스페이스 이름이 다릅니다.' }); clearState = { state: 'running', done: 10, total: 75 }; setTimeout(() => { clearState = { state: 'done', done: 75, total: 75, finishedAt: '2026-11-23T05:10:00Z', plan: [{ name: '학생(학원) DB' }, { name: '등록(학원) DB' }] }; }, 1500); return reply(route, 200, clearState); }
        if (q.action === 'stop') return reply(route, 200, { flag: clearState });
      }
      if (fn === 'app-api') {
        if (q.action === 'admin-status') return opts.adminFail ? reply(route, 500, { error: '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }) : reply(route, 200, { ok: true, notion: { ok: true, rootTitle: '하다 학원관리 v2.0' }, syncedAt: new Date(Date.now() - 3 * 60000).toISOString(), subscription: SUBS[sub] });
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: new Date().toISOString(), rows: [] });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1&admv=${variant}`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.evaluate(() => openScreen('admin'));
    await page.waitForFunction(() => !document.querySelector('#view').textContent.includes('확인하는 중'), null, { timeout: 15000 }).catch(async (e) => { console.error('화면:', (await page.textContent('#view')).slice(0, 600)); throw e; });
    return { page, calls, errors, logs };
  }
  const checkLayout = async (page, name) => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); assert(ov, name + ': 가로 넘침');
    const cut = await page.evaluate(() => [...document.querySelectorAll('#view .crow .ca .btn')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent)); assert.deepEqual(cut, [], name + ': 단추 글자 잘림');
  };
  // 1) 시안 a · b · c × 구독 켜짐, 그리고 b × 확인 대기 · 꺼짐 · 준비 전
  for (const [v, s] of (process.env.ONLY ? [] : [['a', 'on'], ['b', 'on'], ['c', 'on'], ['b', 'waiting'], ['b', 'off'], ['b', 'none'], ['b', 'down']])) {
    const { page, calls, errors } = await open(v, s);
    const t = await page.textContent('#view');
    assert.match(t, /로그인됨/); assert.match(t, /마지막으로 바꾼 날 2026\. 10\. 1\./); assert.match(t, /하다 학원관리 v2\.0/); assert.match(t, /아직 비우지 않았어요/);
    assert.match(t, { on: /켜짐/, waiting: /확인 대기/, off: /꺼짐/, none: /준비 전/, down: /끊김/ }[s]);
    if (s === 'down') { assert.match(t, /2개를 웹훅으로 받지 못했어요/); assert.match(t, /5분마다/); assert.match(t, /Active/); }
    assert.doesNotMatch(t, /옛 웹훅 키|관리자 설정 화면|옛 방식/, '웹 화면으로 가는 줄 없음'); assert.equal(await page.locator('[data-ladm=web]').count(), 0, '웹 화면 단추 없음');
    if (s === 'on' && v !== 'a') { assert.match(t, /최근 24시간 42건/); assert.match(t, /2건 처리 중/); assert.match(t, /1건 다시 맞추는 중/); }
    assert.ok(calls.filter((c) => c.fn !== 'app-api' || c.action === 'admin-status').every((c) => c.key === 'sess-1'), '모든 부름에 관리자 세션');
    await checkLayout(page, v + s); await page.screenshot({ path: shots + `admin-live-${v}-${s}.png`, fullPage: true });
    assert.deepEqual(errors, []); done.push(`${v}/${s}`); await page.close();
  }
  // 2) 비밀번호 바꾸기: 확인 다름 → 안내, 현재 틀림 → 서버 안내, 맞음 → change 한 번(같은 값 이름) · 세션 지움 · 다시 불러옴
  {
    const { page, calls, errors, logs } = await open('b', 'on');
    await page.click('[data-ladm=pw]'); await page.fill('#lapw0', 'old-pass-1'); await page.fill('#lapw1', 'new-pass-123'); await page.fill('#lapw2', 'new-pass-12X'); await page.click('.dlg #co');
    assert.match(await page.textContent('#laerr'), /확인 값이 달라요/); assert.equal(calls.filter((c) => c.action === 'change').length, 0);
    await page.screenshot({ path: shots + 'admin-live-pw.png' });
    await page.fill('#lapw0', 'wrong-1'); await page.fill('#lapw2', 'new-pass-123'); await page.click('.dlg #co');
    await page.waitForFunction(() => /올바르지 않습니다/.test(document.querySelector('#laerr').textContent));
    await page.fill('#lapw0', 'old-pass-1');
    const nav = page.waitForNavigation({ timeout: 10000 }); await page.click('.dlg #co'); await nav;
    const ch = calls.filter((c) => c.action === 'change'); assert.equal(ch.length, 2); assert.deepEqual(Object.keys(ch[1].body).sort(), ['action', 'current_password', 'new_password']); assert.equal(ch[1].body.new_password, 'new-pass-123'); assert.equal(ch[1].key, 'sess-1');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('hada_admin_browser_session_v1')), null, '바꾼 뒤 세션을 지움');
    await page.waitForSelector('#lvpw', { timeout: 15000 }); // live.js 로그인 창
    assert.ok(!logs.some((l) => /old-pass-1|new-pass-123/.test(l)), '콘솔에 비밀번호 없음');
    assert.deepEqual(errors, []); done.push('비밀번호'); await page.close();
  }
  // 3) 예시 데이터 비우기: 이름 다르면 단추 꺼짐, 같으면 켜짐 → 확인 → start(같은 값 이름) → 진행 → 끝(잠김)
  {
    const { page, calls, errors } = await open('b', 'on');
    await page.click('[data-ladm=clear]'); await page.waitForSelector('#laws');
    assert.match(await page.textContent('#lasum'), /고른 DB 2개 · 비울 페이지 75건/);
    await page.fill('#laws', '하다 예시'); assert.equal(await page.isDisabled('.dlg #co'), true);
    await page.fill('#laws', '하다 예시 학원'); assert.equal(await page.isDisabled('.dlg #co'), false);
    await page.screenshot({ path: shots + 'admin-live-clear.png' });
    page.once('dialog', (d) => d.accept()); await page.click('.dlg #co');
    await page.waitForFunction(() => !document.querySelector('#laprog').hidden);
    const st = calls.filter((c) => c.action === 'start'); assert.equal(st.length, 1); assert.deepEqual(st[0].body, { action: 'start', workspace: '하다 예시 학원', dbs: ['학생(학원) DB', '등록(학원) DB'] });
    await page.waitForFunction(() => /이 기능은 잠겼어요/.test(document.querySelector('#ladone').textContent), null, { timeout: 15000 });
    await page.screenshot({ path: shots + 'admin-live-clear-done.png' });
    await page.click('.dlg #cc'); await page.waitForFunction(() => /잠김/.test(document.querySelector('#view').textContent), null, { timeout: 10000 });
    assert.equal(await page.locator('[data-ladm=clear]').count(), 0, '끝나면 비우기 단추 없음');
    assert.deepEqual(errors, []); done.push('비우기'); await page.close();
  }
  // 4) 로그아웃 → logout 부름 · 세션 지움 · 로그인 창
  {
    const { page, calls, errors } = await open('b', 'on');
    const nav = page.waitForNavigation({ timeout: 10000 }); await page.click('[data-ladm=logout]'); await nav;
    assert.equal(calls.filter((c) => c.action === 'logout').length, 1); await page.waitForSelector('#lvpw', { timeout: 15000 });
    assert.deepEqual(errors, []); done.push('로그아웃'); await page.close();
  }
  // 5) 실패: 프로필 401 → 로그인 풀림 + 다시 로그인 단추, app-api 실패 → 확인 못 함(나머지 칸은 그대로)
  {
    const { page, errors } = await open('b', 'on', { profile401: true, adminFail: true });
    const t = await page.textContent('#view'); assert.match(t, /로그인 풀림/); assert.match(t, /확인 못 함/); assert.match(t, /아직 비우지 않았어요/);
    assert.equal(await page.locator('[data-ladm=relogin]').count(), 1);
    await page.screenshot({ path: shots + 'admin-live-fail.png', fullPage: true });
    assert.deepEqual(errors, []); done.push('실패'); await page.close();
  }
  // 6) 첫 설치: 초기 비밀번호로 로그인 → 서버 409(설정용만) → 새 비밀번호 창 → scope settings 로그인 · change · 새 비밀번호로 로그인 → 노션 자료
  {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = [], logs = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => logs.push(m.text()));
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {}, key = req.headers()['x-admin-key'];
      calls.push({ fn, action: q.action, key, body: q });
      if (fn === 'admin-security' && q.action === 'login') {
        if (q.password === '0000') return q.scope === 'settings' ? reply(route, 200, { session: 'sess-0', must_change: true }) : reply(route, 409, { error: '초기 비밀번호 상태입니다. 관리자 설정 페이지에서 비밀번호를 먼저 변경해 주세요.' });
        if (q.password === 'first-pass-1') return reply(route, 200, { session: 'sess-1', must_change: false });
        return reply(route, 401, { error: '비밀번호가 올바르지 않습니다.' });
      }
      if (fn === 'admin-security' && q.action === 'change') return key === 'sess-0' && q.current_password === '0000' ? reply(route, 200, { ok: true }) : reply(route, 401, { error: '세션이 만료되었습니다.' });
      if (fn === 'app-api') return reply(route, 200, q.action === 'list' ? { ok: true, db: q.db, at: new Date().toISOString(), rows: [] } : { ok: true, dbs: {} });
      return reply(route, 200, { ok: true });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
    await page.waitForSelector('#lvpw', { timeout: 15000 }); await page.fill('#lvpw', '0000'); await page.click('.dlg #co');
    await page.waitForSelector('#lvnp1', { timeout: 10000 });
    await page.fill('#lvnp1', 'first-pass-1'); await page.fill('#lvnp2', 'first-pass-X'); await page.click('.dlg #co');
    assert.match(await page.textContent('#lvnerr'), /확인 값이 달라요/);
    await page.fill('#lvnp2', 'first-pass-1'); await page.screenshot({ path: shots + 'admin-live-first-pw.png' }); await page.click('.dlg #co');
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    const lg = calls.filter((c) => c.action === 'login').map((c) => [c.body.password === '0000' ? 'init' : 'new', c.body.scope || '']);
    assert.deepEqual(lg, [['init', ''], ['init', 'settings'], ['new', '']]);
    const ch = calls.filter((c) => c.action === 'change'); assert.equal(ch.length, 1); assert.equal(ch[0].key, 'sess-0'); assert.deepEqual(Object.keys(ch[0].body).sort(), ['action', 'current_password', 'new_password']);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('hada_admin_browser_session_v1')), 'sess-1');
    assert.ok(!logs.some((l) => /first-pass-1/.test(l)), '콘솔에 비밀번호 없음');
    assert.deepEqual(errors, []); done.push('첫 설치 비밀번호'); await page.close();
  }
  // 7) (261123 대표 "0000 비밀번호로 예시 데이터 비우기 / 한번 진행하고 나면 막히도록") 설치 길: 0000 → 새 비밀번호 창 안 [예시 데이터 비우기…] →
  //    같은 비우기 창(설정용 세션 sess-0) → 끝 → 창으로 돌아오면 "잠겼어요"만(단추 없음) → [취소] = 0000 세션 로그아웃, 비밀번호는 그대로.
  //    잠긴 학원(locked) · 서버가 이 길을 모름(401)이면 설치 상자가 안 보인다. 0000 세션으로는 clear-example-data · 로그인 · 로그아웃 말고 부르지 않는다.
  for (const mode of ['open', 'locked', 'old']) {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const calls = [], errors = []; let clearState = mode === 'locked' ? { state: 'locked' } : null;
    page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    const can = () => !clearState || !['done', 'locked', 'running'].includes(clearState.state);
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {}, key = req.headers()['x-admin-key'];
      calls.push({ fn, action: q.action, key, body: q });
      if (fn === 'admin-security' && q.action === 'login') return q.password === '0000' && q.scope === 'settings' ? reply(route, 200, { session: 'sess-0', must_change: true }) : reply(route, 409, { error: '초기 비밀번호 상태입니다. 관리자 설정 페이지에서 비밀번호를 먼저 변경해 주세요.' });
      if (fn === 'admin-security' && q.action === 'logout') return reply(route, 200, { ok: true });
      if (fn === 'clear-example-data') {
        if (mode === 'old' || key !== 'sess-0') return reply(route, 401, { error: '인증 실패' });
        if (q.action === 'state') return reply(route, 200, { flag: clearState, canStart: can(), updatedAt: '2026-11-23T05:00:00Z' });
        if (q.action === 'status') return reply(route, 200, { ...CLEAR_STATUS, flag: clearState, canStart: can(), full: true });
        if (q.action === 'start') { if (q.workspace !== CLEAR_STATUS.workspace) return reply(route, 400, { error: '워크스페이스 이름이 맞지 않습니다.' }); clearState = { state: 'running', done: 10, total: 75 }; setTimeout(() => { clearState = { state: 'done', done: 75, total: 75, finishedAt: '2026-11-23T05:10:00Z' }; }, 1500); return reply(route, 200, clearState); }
      }
      return reply(route, 403, { error: '0000 세션으로 부르면 안 되는 곳' });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
    await page.waitForSelector('#lvpw', { timeout: 15000 }); await page.fill('#lvpw', '0000'); await page.click('.dlg #co');
    await page.waitForSelector('#lvnp1', { timeout: 10000 }); await page.waitForTimeout(800);
    if (mode !== 'open') {
      assert.equal(await page.isVisible('#lvclr'), false, mode + ': 설치 상자 안 보임');
      await page.screenshot({ path: shots + `admin-live-0000-${mode}.png` });
      await page.mouse.click(8, 8); await page.waitForSelector("#lvpw", { timeout: 10000 }); /* 바깥 누름 = 취소: 로그인 창으로, 앱 화면에 남지 않음 */
      if (mode === "locked") { await page.waitForTimeout(300); assert.ok(calls.some((c) => c.action === "logout" && c.key === "sess-0"), "바깥 누름도 0000 세션 로그아웃"); }
    } else {
      assert.equal(await page.isVisible('#lvclrgo'), true); assert.match(await page.textContent('#lvclr'), /아직 비우지 않았어요[\s\S]*한 번 끝나면 잠겨/);
      await page.screenshot({ path: shots + 'admin-live-0000-open.png' });
      await page.click('#lvclrgo'); await page.waitForSelector('.dlg .la-clear', { timeout: 15000 });
      // (261123 안A) 0000이면 고르기 칸이 모두 체크 · 잠김(선택 DB였던 라이브러리도), 안내 한 줄
      assert.equal(await page.locator('.dlg [data-ladb]:not(:checked)').count(), 0); assert.equal(await page.locator('.dlg [data-ladb]:not([disabled])').count(), 0); assert.match(await page.textContent('#lafull'), /고를 수 없어요/);
      await page.fill('#laws', CLEAR_STATUS.workspace); await page.screenshot({ path: shots + 'admin-live-0000-clear.png' });
      await page.click('.dlg #co'); await page.waitForFunction(() => /비웠어요[\s\S]*잠겼어요/.test(document.querySelector('.dlg').textContent), null, { timeout: 15000 });
      await page.click('.dlg #cc'); await page.waitForSelector('#lvnp1', { timeout: 10000 });
      await page.waitForFunction(() => { const b = document.querySelector('#lvclr'); return b && !b.hidden && /잠겼어요/.test(b.textContent); }, null, { timeout: 10000 });
      assert.equal(await page.isVisible('#lvclrgo'), false, '끝난 뒤 비우기 단추 없음');
      await page.screenshot({ path: shots + 'admin-live-0000-done.png' });
      await page.click('.dlg #cc'); await page.waitForSelector('#lvpw', { timeout: 10000 }); await page.waitForTimeout(300);
      assert.ok(calls.some((c) => c.action === 'logout' && c.key === 'sess-0'), '취소 = 0000 세션 로그아웃');
      assert.equal(calls.filter((c) => c.action === 'change').length, 0, '비밀번호는 바꾸지 않음');
      assert.deepEqual(calls.filter((c) => c.fn === 'clear-example-data' && c.action === 'start').map((c) => c.key), ['sess-0']);
      assert.equal(calls.find((c) => c.action === 'start').body.dbs.length, CLEAR_STATUS.dbs.length, '고른 것 없이 전부 보냄');
    }
    const settingsLogins = calls.filter((c) => c.action === 'login' && c.body.scope === 'settings').length;
    assert.ok(settingsLogins <= (mode === 'open' ? 2 : 1), '설정용 로그인은 창을 열 때 한 번(돌아올 때 다시 쓰기) — ' + settingsLogins);
    assert.deepEqual(calls.filter((c) => c.key === 'sess-0' && !(c.fn === 'clear-example-data' || (c.fn === 'admin-security' && c.action === 'logout'))), [], '0000 세션은 비우기 · 로그아웃에만');
    assert.equal(calls.filter((c) => c.fn === 'app-api').length, 0, '로그인 전 노션 자료 부름 없음');
    assert.deepEqual(errors, []); done.push('0000 설치 비우기 ' + mode); await page.close();
  }
  // (261123 키 자동 등록) 외부 키: 가짜 키 저장 → 키가 틀림, 맞는 키 → 연결됨, 공백 막기, 삭제 → 서버 설정값 · 없음, 값은 화면 · 저장소 · 콘솔에 없음
  if (!process.env.ONLY || process.env.ONLY === 'keys') {
    keyVault = {}; keyStatusCalls = [];
    const { page, calls, errors, logs } = await open('b', 'on');
    const seg = (t, label, next) => { const a = t.split(label)[1] || ''; return next ? a.split(next)[0] : a; };
    const row = async (label, next) => seg(await page.locator('section.cbox', { hasText: '외부 키' }).innerText(), label, next);
    // 열자마자(누르지 않고) 상태가 보임: 나이스 = 키 없음, 도서관 = 서버 설정값 연결됨 + 확인 시각. 카카오 줄 없음
    assert.equal(keyStatusCalls[0], true, '열 때 check:true로 부름');
    assert.match(await row('나이스', '국립중앙도서관'), /키 없음/); assert.match(await row('국립중앙도서관'), /연결됨[\s\S]*서버 설정값[\s\S]*\d\d:\d\d 확인/);
    assert.ok(!/카카오/.test(await page.locator('section.cbox', { hasText: '외부 키' }).innerText()), '카카오 줄 없음');
    await page.locator('section.cbox', { hasText: '외부 키' }).screenshot({ path: shots + 'admin-live-keys-open.png' });
    // (261123 대표) 받는 곳 링크: 카드 줄과 [키 저장] 창 모두 새 탭 · noopener, 주소 = 노션 키 발급 매뉴얼의 NEIS_API_KEY · NL_CERT_KEY 페이지
    const KL = { 'https://open.neis.go.kr': /나이스/, 'https://www.nl.go.kr/NL/contents/N31101010000.do': /국립중앙도서관/ };
    const cardLinks = await page.locator('section.cbox', { hasText: '외부 키' }).locator('a.link-chip').evaluateAll((as) => as.map((x) => [x.getAttribute('href'), x.target, x.rel, x.textContent.trim()]));
    assert.equal(cardLinks.length, 2, '카드 줄 링크 둘'); for (const [h, t, r, tx] of cardLinks) { assert.ok(KL[h] && KL[h].test(tx), '링크 주소 · 이름 ' + h + ' ' + tx); assert.equal(t, '_blank'); assert.match(r, /noopener/); }
    await page.click('[data-ladm="kset:NEIS_API_KEY"]'); assert.equal(await page.getAttribute('#lakey', 'type'), 'password');
    { const dl = await page.locator('.dlg a.link-chip').evaluateAll((as) => as.map((x) => [x.getAttribute('href'), x.target, x.rel])); assert.deepEqual(dl, [['https://open.neis.go.kr', '_blank', 'noopener']], '창 링크(나이스)'); }
    await page.fill('#lakey', ' ' + FAKE_KEY); await page.click('.dlg #co'); assert.match(await page.textContent('#laerr'), /공백/);
    await page.fill('#lakey', FAKE_KEY); await page.click('.dlg #co'); await page.waitForFunction(() => /키가 틀림/.test(document.querySelector('#view').textContent));
    assert.match(await row('나이스', '국립중앙도서관'), /키가 틀림[\s\S]*앱에 넣은 키/);
    await page.locator('section.cbox', { hasText: '외부 키' }).screenshot({ path: shots + 'admin-live-keys-wrong.png' });
    await page.click('[data-ladm="kset:NL_CERT_KEY"]'); await page.fill('#lakey', GOOD_KEY); await page.click('.dlg #co');
    await page.waitForFunction(() => /연결됨[\s\S]*앱에 넣은 키/.test(document.querySelector('#view').textContent.split('국립중앙도서관')[1] || ''));
    await page.click('[data-ladm="ktest:NL_CERT_KEY"]'); await page.waitForTimeout(300);
    await page.click('[data-ladm="kdel:NL_CERT_KEY"]'); await page.click('.dlg #co'); await page.waitForFunction(() => /서버 설정값/.test(document.querySelector('#view').textContent.split('국립중앙도서관')[1] || ''));
    await page.click('[data-ladm="kdel:NEIS_API_KEY"]'); assert.match(await page.textContent('.dlg'), /동작하지 않아요/); await page.click('.dlg #co');
    await page.waitForFunction(() => /키 없음/.test((document.querySelector('#view').textContent.split('나이스')[1] || '').split('국립중앙도서관')[0]));
    await checkLayout(page, '외부 키');
    assert.ok(keyStatusCalls.every(Boolean), '다시 그릴 때도 check:true(서버가 10분 안 결과는 다시 씀)');
    const set = calls.filter((c) => c.action === 'key-set'); assert.equal(set.length, 2); assert.ok(set.every((c) => c.key === 'sess-1' && Object.keys(c.body).sort().join() === 'action,name,value'));
    assert.deepEqual(calls.filter((c) => c.action === 'key-clear').map((c) => c.body.name), ['NL_CERT_KEY', 'NEIS_API_KEY']);
    const leak = (x) => x.includes(FAKE_KEY) || x.includes(GOOD_KEY);
    assert.ok(!leak(await page.content()), '화면에 키 값 없음'); assert.ok(!leak(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)), '저장소 · 주소에 키 값 없음');
    assert.ok(!logs.some(leak), '콘솔에 키 값 없음'); assert.ok(calls.filter((c) => leak(JSON.stringify(c.body))).every((c) => c.fn === 'admin-security' && c.action === 'key-set'), '키 값은 key-set에만');
    assert.deepEqual(errors, []); done.push('외부 키'); await page.close();
  }
  console.log('관리자 설정 실제 연결 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
