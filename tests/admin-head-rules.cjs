// 관리 앱 화면 머리 규칙(관리앱-기준.md C 제목 줄 · 표 범례, 대표 261124) — 가짜 서버 실자료 모드로 메뉴 전부를 열어 본다(실제 DB · 네트워크 없음).
// 확인: ① 제목 아래 설명 줄 없음(#view 바로 아래 .ro-line 없음) ② 연결 점 · 자동 갱신 글이 모든 화면 같은 자리(상태 묶음 안)
//       ③ 보기만 안내는 상태 묶음 안 한 줄, "단추로 노션에 써요" 글 없음 ④ 제목 줄에 표 범례(○ 출석 …) 없음 ⑤ 가로 넘침 · 오류 없음
// 사용: NODE_PATH=<playwright 있는 node_modules> [OUT=<캡처 폴더>] [W=1280|1440] node tests/admin-head-rules.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), out = process.env.OUT ? process.env.OUT + '/' : '', W = +(process.env.W || 1280);
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: W, height: 800 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
  const reply = (route, status, data) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
  await page.route(H + '**', async (route) => {
    const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
    const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
    if (fn === 'app-api') {
      if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: iso(), rows: [] });
      if (q.action === 'changes') return reply(route, 200, { ok: true, now: iso(), rows: [], gone: [], crAt: null });
      if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
      if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: iso(-60000), rootTitle: '하다 학원관리 v2.0' });
      return reply(route, 200, { ok: true });
    }
    return reply(route, 200, { ok: true, rows: [], items: [], sessions: [] });
  });
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((msg) => { const m = JSON.parse(msg);
      if (m.event === 'phx_join') ws.send(JSON.stringify({ event: 'phx_reply', topic: m.topic, ref: m.ref, join_ref: m.join_ref, payload: { status: 'ok', response: {} } }));
      if (m.event === 'heartbeat') ws.send(JSON.stringify({ event: 'phx_reply', topic: 'phoenix', ref: m.ref, payload: { status: 'ok', response: {} } })); });
  });
  await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
  await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const scrs = (process.env.SCRS || 'today,timetable,timetable:today,timetable:wk,timetable:mon,timetable:atd,timetable:atm,events,students,teachers,enrolls,classes,schools,exams,subjects,books,progress,reports,completion,letters,tuition,bill,profit,legal,files,alims,admin').split(',');
  const rep = [], all = [];
  for (const s of scrs) {
    try { await page.evaluate((s) => { const [a, lv] = s.split(':'); openScreen(a); if (lv) { activeTab.state.view = 'lesson'; activeTab.state.lv = lv; render(); } }, s); } catch (e) { try { await page.evaluate((s) => openScreen(s), s); } catch (e2) { rep.push(s + ' 열기 실패 ' + e2.message); continue; } }
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const v = document.getElementById('view'), h1 = v.querySelector('h1'), dot = document.getElementById('lrDot'), sa = document.getElementById('syncAt');
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y)]; };
      const kids = [...v.children].map((c) => c.className).slice(0, 4).join(' | ');
      const ro = document.querySelector('#view .ro-line'), lg = document.querySelector('#view .tbl-legend'), ttl = v.querySelector(':scope > .pg-ttl, :scope > .ttl');
      return { under: !!v.querySelector(':scope > .ro-line'), roIn: !!(ro && ro.closest('#pgStat')), dotIn: !!(dot && dot.closest('#pgStat')), btnTxt: /단추로 노션에 써요/.test(v.textContent), ttlLegend: !!(ttl && /○ 출석/.test(ttl.textContent)), title: h1 && h1.textContent.trim(), dot: r(dot), syncAt: sa && sa.textContent, syncPos: r(sa), ro: ro && ro.textContent, roPos: r(ro), lg: lg && lg.textContent, kids, over: document.documentElement.scrollWidth > innerWidth };
    });
    rep.push(`${s}\t${JSON.stringify(info)}`); all.push([s, info]);
    assert.equal(info.under, false, `${s}: 제목 아래 설명 줄`); assert.equal(info.btnTxt, false, `${s}: 단추 설명 글`); assert.equal(info.ttlLegend, false, `${s}: 제목 줄 범례`); assert.equal(info.over, false, `${s}: 가로 넘침`);
    if (info.ro) assert.ok(info.roIn, `${s}: 보기만 안내가 상태 묶음 밖`);
    if (info.dot) assert.ok(info.dotIn, `${s}: 점이 상태 묶음 밖`);
    if (out) await page.screenshot({ path: `${out}${W}-${s.replace(':', '_')}.png`, clip: { x: 0, y: 0, width: W, height: 330 } });
  }
  if (out) fs.writeFileSync(out + `report-${W}.txt`, rep.join('\n') + '\nerrors: ' + JSON.stringify(errors));
  const dots = new Set(all.filter(([, i]) => i.dot).map(([, i]) => i.dot.join(',')));
  assert.equal(dots.size, 1, '점 자리가 화면마다 다름: ' + [...dots].join(' / '));
  assert.ok(all.filter(([, i]) => i.dot).length >= 15, '점이 보인 화면이 너무 적음');
  assert.deepEqual(errors, [], '페이지 오류');
  console.log(`머리 규칙 통과(${W}): ${all.length}화면 · 점 한 자리 ${[...dots][0]} · 보기만 안내 ${all.filter(([, i]) => i.ro).length}화면`);
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
