// 관리 앱 열린 화면 자동 갱신 · 노션 요청 상태(261123) — 가짜 서버 · 가짜 Realtime으로만(실제 DB · 네트워크 · 비밀값 없음).
// 확인: ① 신호 → 그 줄만 바뀜(새로 고침 없이, 걸린 시간 3번) ② 작성 중인 줄은 덮지 않음 + [노션 값 불러오기]
//       ③ 요청 처리 중 · 실패가 표 줄 · 창 · 홈 입력 점검에 ④ 연결 끊김 → 다시 붙고 놓친 것 따라잡음 ⑤ 지운 줄 빠짐 ⑥ refresh=0이면 끔
//       ⑦ 모든 changes 부름에 관리자 세션, 알림에 값 없음 ⑧ 1280 가로 넘침 없음
// 사용: ROOT=<저장소 폴더> SHOTS=<캡처 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-live-refresh.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const SID = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const stu = (n, name, extra = {}) => ({ id: SID(n), props: { 학생이름: name, 학교: [], 학년: [], ...extra }, url: `https://www.notion.so/${SID(n).replace(/-/g, '')}`, icon: '', notion_created_at: iso(-86400000), notion_edited_at: iso(-3600000), synced_at: iso(-3600000) });
// 예시 반 하나 · 강사 하나 · 학생마다 등록 하나(학생 화면 기본 탭 "등록 중"에 보이게)
const row = (id, props) => ({ id, props, url: '', icon: '', notion_created_at: iso(-86400000), notion_edited_at: iso(-3600000), synced_at: iso(-3600000) });
const CLS = '0000000c-0000-4000-8000-00000000000c', TCH = '0000000e-0000-4000-8000-00000000000e';
const FIX = {
  '강사(학원) DB': [row(TCH, { 이름: '예시 강사', 직책: '강사' })],
  '클래스(학원) DB': [row(CLS, { 클래스명: '예시 수학반', 담당강사: [TCH], 수강료: 200000, '월간 수업 총량': 8, 개강일: { start: '2026-03-02' } })],
  '등록(학원) DB': [1, 2, 3].map((n) => row(`0000000${n}-0000-4000-8000-0000000000e${n}`, { 학생정보: [SID(n)], 클래스: [CLS], 등록일: { start: '2026-03-02' } })),
};
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open(query = '') {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const S = { rows: new Map([[SID(1), stu(1, '예시 학생 가')], [SID(2), stu(2, '예시 학생 나')], [SID(3), stu(3, '예시 학생 다')]]), gone: [], calls: [], sockets: [], joins: 0, frames: [] };
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
      S.calls.push({ fn, action: q.action, key: req.headers()['x-admin-key'], body: q });
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: iso(), rows: q.db === '학생(학원) DB' ? [...S.rows.values()] : (FIX[q.db] || []) });
        if (q.action === 'changes') {
          const from = q.since ? Date.parse(q.since) - 15000 : Infinity;
          const rows = [...S.rows.values()].filter((r) => Date.parse(r.synced_at) > from).map((r) => ({ ...r, db: '학생(학원) DB' }));
          return reply(route, 200, { ok: true, now: iso(), rows, gone: S.gone.filter((g) => Date.parse(g.at) > from).map(({ id, db }) => ({ id, db })), crAt: null, subscription: S.sub || null });
        }
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: iso(-60000), rootTitle: '하다 학원관리 v2.0' });
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [], sessions: [] });
    });
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      S.sockets.push(ws);
      ws.onMessage((msg) => {
        const m = JSON.parse(msg); S.frames.push(m);
        if (m.event === 'phx_join') { S.joins++; ws.send(JSON.stringify({ event: 'phx_reply', topic: m.topic, ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response: {} } })); }
        if (m.event === 'heartbeat') ws.send(JSON.stringify({ event: 'phx_reply', topic: 'phoenix', ref: m.ref, payload: { status: 'ok', response: {} } }));
      });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1${query}`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    await page.evaluate(() => { openScreen('students'); });
    const signal = () => { const ws = S.sockets[S.sockets.length - 1]; ws.send(JSON.stringify({ event: 'broadcast', topic: 'realtime:hada-app', ref: null, payload: { type: 'broadcast', event: 'rows', payload: { dbs: ['학생(학원) DB'], n: 1 } } })); };
    const notion = (n, props) => { const r = S.rows.get(SID(n)); S.rows.set(SID(n), { ...r, props: { ...r.props, ...props }, notion_edited_at: iso(), synced_at: iso() }); };
    return { page, S, errors, signal, notion };
  }
  const viewText = (page) => page.textContent('#view');
  // ① 자동 갱신 3번(걸린 시간) ⑦ 세션 · 알림 값 없음
  {
    const { page, S, errors, signal, notion } = await open();
    await page.waitForFunction(() => window.LR_STATE && window.LR_STATE.joined, null, { timeout: 10000 });
    await page.screenshot({ path: shots + 'refresh-0-before.png' });
    const took = [];
    for (const [i, nm] of [[1, '예시 학생 가 바뀜'], [2, '예시 학생 나 바뀜'], [3, '예시 학생 다 바뀜']]) {
      notion(i, { 학생이름: nm }); const t0 = Date.now(); signal();
      await page.waitForFunction((nm) => document.querySelector('#view').textContent.replace(/\s+/g, ' ').includes(nm), nm, { timeout: 10000 }).catch(async (e) => {
        console.error('상태:', await page.evaluate(() => JSON.stringify({ L: { need: LR_STATE.need, cur: LR_STATE.cur, busy: LR_STATE.busy, applied: LR_STATE.applied }, names: DB.students.map((s) => s.name), raw: [...APP_RAW.raw['학생(학원) DB'].values()].map((r) => r.props.학생이름), act: document.activeElement.tagName + '.' + document.activeElement.className })));
        console.error('다시 그림:', await page.evaluate((nm) => { render(); return [document.querySelector('#view').textContent.replace(/\s+/g, ' ').includes(nm), activeTab.screen, [...document.querySelectorAll('#view tr[data-id]')].map((t) => t.getAttribute('data-id').slice(0, 9) + ':' + t.textContent.slice(0, 40)), JSON.stringify(activeTab.state).slice(0, 300)]; }, nm));
        console.error('nm:', await page.evaluate((nm) => [typeof nm, JSON.stringify(nm), document.querySelector('#view').textContent.replace(/\s+/g, ' ').includes(nm)], nm));
        console.error('view:', await page.evaluate(() => { const v = document.querySelector('#view').textContent, i = v.indexOf('바뀜'); return [document.querySelectorAll('#view').length, i, [...v.slice(Math.max(0, i - 10), i + 2)].map((c) => c.charCodeAt(0).toString(16)).join(' ')]; }));
        console.error('부름:', JSON.stringify(S.calls.filter((c) => c.action === 'changes').map((c) => c.body.since)));
        throw e; });
      took.push(Date.now() - t0);
    }
    await page.screenshot({ path: shots + 'refresh-1-after.png' });
    const ch = S.calls.filter((c) => c.action === 'changes');
    assert.ok(ch.length >= 3 && ch.every((c) => c.key === 'sess-1'), 'changes 부름에 관리자 세션');
    assert.ok(ch.every((c) => Array.isArray(c.body.dbs) && c.body.dbs.includes('학생(학원) DB')));
    const first = S.calls.findIndex((c) => c.action === 'changes');
    const late = S.calls.slice(first).filter((c) => c.action === 'list').map((c) => c.body.db);
    assert.deepEqual(late.filter((d) => d === '학생(학원) DB'), [], /* 메뉴 DB는 화면이 따로 받음 */'처음 한 번만 전체 받기(바뀐 줄만 받음): ' + late.join(','));
    assert.equal(await page.evaluate(() => typeof dirtyCount === 'function' ? dirtyCount() : -1), 0, '반영한 줄이 작성 중으로 잡히지 않음');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '1280 가로 넘침 없음');
    const dot = await page.evaluate(() => { const d = document.getElementById('lrDot'); return d ? d.className : ''; }); assert.match(dot, /on/);
    assert.deepEqual(errors, []); done.push(`자동 갱신 ${took.join('·')}ms`); fs.writeFileSync(shots + 'refresh-took.json', JSON.stringify({ took }));
    await page.close();
  }
  // ② 작성 중 보호
  {
    const { page, signal, notion, errors } = await open();
    await page.waitForFunction(() => window.LR_STATE && window.LR_STATE.joined, null, { timeout: 10000 });
    await page.evaluate((id) => { const s = DB.students.find((x) => x.id === id); s.memo = '앱에서 쓰는 메모'; s.state = 'draft'; activeTab.state.sel = id; render(); }, SID(2));
    notion(2, { 학생이름: '노션에서 고친 이름' }); signal();
    await page.waitForFunction(() => document.querySelector('[data-lrtake]'), null, { timeout: 10000 }).catch(async (e) => {
      console.error('보호 상태:', await page.evaluate(() => JSON.stringify({ need: LR_STATE.need, pending: [...LR_STATE.pending.keys()], act: document.activeElement.tagName + '.' + document.activeElement.className, panels: [...document.querySelectorAll('.panel')].map((p) => p.className + ' body:' + !!p.querySelector('.pbody')), modal: document.getElementById('modalRoot').children.length, html: [...document.querySelector('.panel').children].map((c) => c.tagName + '.' + c.className).join(' | ') })));
      throw e; });
    const kept = await page.evaluate((id) => { const s = DB.students.find((x) => x.id === id); return [s.name, s.memo, s.state]; }, SID(2));
    assert.deepEqual(kept, ['예시 학생 나', '앱에서 쓰는 메모', 'draft'], '작성 중인 줄은 덮지 않음');
    assert.match(await page.textContent('.panel .lr-note'), /노션에서 이 줄이 바뀌었어요/);
    await page.screenshot({ path: shots + 'refresh-2-dirty.png' });
    await page.click('[data-lrtake]');
    const took = await page.evaluate((id) => { const s = DB.students.find((x) => x.id === id); return [s.name, s.memo, s.state]; }, SID(2));
    assert.deepEqual(took, ['노션에서 고친 이름', '', 'saved'].slice(0, 2).concat([took[2]]));
    assert.notEqual(took[2], 'draft'); assert.equal(await page.locator('[data-lrtake]').count(), 0);
    await page.screenshot({ path: shots + 'refresh-3-take.png' });
    assert.deepEqual(errors, []); done.push('작성 중 보호'); await page.close();
  }
  // ③ 요청 상태: 처리 중 → 실패(표 줄 · 창 · 홈)
  {
    const { page, signal, notion, errors } = await open();
    await page.waitForFunction(() => window.LR_STATE && window.LR_STATE.joined, null, { timeout: 10000 });
    notion(1, { 요청: '🔄 처리 중', '요청 결과': '🔄 처리 중 · 접수 안내 보내기 · 14:02' }); signal();
    await page.waitForFunction(() => /요청 처리 중/.test(document.querySelector('#view').textContent.replace(/\s+/g, ' ')), null, { timeout: 10000 });
    await page.evaluate((id) => { activeTab.state.sel = id; render(); }, SID(1));
    assert.match(await page.textContent('.panel .lr-note.run'), /노션 요청 처리 중/);
    await page.screenshot({ path: shots + 'refresh-4-running.png' });
    notion(1, { 요청: '⚠️ 실패', '요청 결과': '⚠️ 실패 · 알림톡 설정에 템플릿이 없어요 · 11/23 13:01:11' }); signal();
    await page.waitForFunction(() => /요청 실패/.test(document.querySelector('#view').textContent.replace(/\s+/g, ' ')), null, { timeout: 10000 });
    assert.match(await page.textContent('.panel .lr-note.fail'), /알림톡 설정에 템플릿이 없어요/);
    await page.screenshot({ path: shots + 'refresh-5-failed.png' });
    assert.match(await page.textContent('#syncAt'), /자동 갱신 켜짐 · 마지막 받음 [0-9]{2}:[0-9]{2}/);
    await page.evaluate(() => { openScreen('today'); });
    await page.waitForFunction(() => document.querySelector('[data-lrreq=fail]'), null, { timeout: 10000 });
    await page.screenshot({ path: shots + 'refresh-6-home.png' });
    await page.click('[data-lrreq=fail]');
    const m = await page.textContent('#modalRoot'); assert.match(m, /학생 · 예시 학생 가/); assert.match(m, /알림톡 설정에 템플릿이 없어요/);
    assert.ok(!/13:01:11/.test(m), '글 끝 시각은 걷어내고 한 번만'); 
    assert.equal(await page.locator('#modalRoot a[href^="https://www.notion.so/"]').count(), 1);
    await page.screenshot({ path: shots + 'refresh-7-list.png' });
    assert.deepEqual(errors, []); done.push('요청 상태'); await page.close();
  }
  // ③-2 (261123) 노션 연동 구독 끊김: 홈 입력 점검 경고 → 안내 창 → 되돌아오면 사라짐
  {
    const { page, S, signal, errors } = await open();
    await page.waitForFunction(() => window.LR_STATE && window.LR_STATE.joined, null, { timeout: 10000 });
    await page.evaluate(() => { openScreen('today'); });
    S.sub = { state: 'down', since: iso(-12 * 60000), reason: '노션에서 고친 줄 2개를 웹훅으로 받지 못했어요(폴링이 찾음)', missed: 2, pollMin: 5, lastReportAt: iso(-60000), simulating: true };
    signal();
    await page.waitForFunction(() => document.querySelector('[data-lrreq=sub]'), null, { timeout: 10000 });
    assert.match(await page.textContent('[data-lrreq=sub]'), /노션 연동 구독 끊김/);
    await page.screenshot({ path: shots + 'refresh-8-sub-down.png' });
    await page.click('[data-lrreq=sub]');
    const m = await page.textContent('#modalRoot'); assert.match(m, /5분마다/); assert.match(m, /2개를 웹훅으로 받지 못했어요/); assert.match(m, /Active/); assert.match(m, /꺼짐 흉내/);
    await page.screenshot({ path: shots + 'refresh-9-sub-modal.png' });
    await page.click('#lrClose');
    S.sub = { state: 'ok', since: null, reason: null, missed: 0, pollMin: 15, lastReportAt: iso(), simulating: false };
    signal();
    await page.waitForFunction(() => !document.querySelector('[data-lrreq=sub]'), null, { timeout: 10000 });
    assert.deepEqual(errors, []); done.push('구독 끊김 경고'); await page.close();
  }
  // ④ 연결 끊김 → 다시 붙음 → 놓친 것 따라잡음 ⑤ 지운 줄
  {
    const { page, S, notion, errors } = await open();
    await page.waitForFunction(() => window.LR_STATE && window.LR_STATE.joined, null, { timeout: 10000 });
    const j0 = S.joins; S.sockets[S.sockets.length - 1].close();
    await page.waitForFunction(() => !window.LR_STATE.joined, null, { timeout: 5000 });
    notion(3, { 학생이름: '끊긴 사이 바뀐 이름' }); S.rows.delete(SID(2)); S.gone.push({ id: SID(2), db: '학생(학원) DB', at: iso() });
    await page.waitForFunction(() => window.LR_STATE.joined, null, { timeout: 15000 });
    assert.ok(S.joins > j0, '다시 붙음');
    await page.waitForFunction(() => document.querySelector('#view').textContent.replace(/\s+/g, ' ').includes('끊긴 사이 바뀐 이름'), null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('#view').textContent.replace(/\s+/g, ' ').includes('예시 학생 나'), null, { timeout: 10000 });
    assert.deepEqual(errors, []); done.push('다시 연결 · 지운 줄'); await page.close();
  }
  // ⑥ refresh=0
  {
    const { page, S, errors } = await open('&refresh=0');
    await page.waitForTimeout(2500);
    assert.equal(S.sockets.length, 0); assert.equal(S.calls.filter((c) => c.action === 'changes').length, 0);
    assert.deepEqual(errors, []); done.push('끄기'); await page.close();
  }
  console.log('자동 갱신 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
