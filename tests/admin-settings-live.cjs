// 관리 앱 관리자 설정 실제 연결(261123) — 가짜 서버로만. 실제 자료 모드(?live=1)에서 관리자 설정 화면이
// admin_settings.html과 같은 서버 동작(admin-security · clear-example-data)을 같은 값으로 부르는지, app-api admin-status 값이 보이는지.
// 사용: ROOT=<저장소 폴더> node check-admin-settings-live.cjs   (캡처는 SHOTS 폴더, 기본 이 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || 'C:/Users/admin/hada/dev/project1', shots = (process.env.SHOTS || __dirname) + '/';
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
  console.log('관리자 설정 실제 연결 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
