// 관리 앱 수업 저장이 실패할 때(261123 출시 전 1번) — 가짜 서버로만(실제 노션 · 키 · 네트워크 없음, 예시 데이터만).
// 확인: ① 서버를 막은 채 위 [저장] → 실패 알림이 남고("저장할 변경이 없어요"로 덮이지 않음) 입력 · 작성 중 표시 · 저장 수가 그대로
//       ② 두 명 중 한 명만 실패(서버 502 + savedIds · failed) → 된 학생은 저장됨, 실패한 학생만 작성 중
//       ③ 서버가 돌아오면 다시 [저장] → 실패했던 학생만 다시 나가고 작성 중이 풀림
//       ④ 앱 저장 줄과 함께여도 수업 실패가 저장 결과 창에 남음
// 사용: ROOT=<저장소 폴더> SHOTS=<캡처 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-lesson-save-fail.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const CFG = `window.HADA_CONFIG={supabaseUrl:"https://mockref.supabase.co",supabaseAnonKey:"k"};`;
const AUTH = `window.HadaAdminAuth={config(){return{url:"https://mockref.supabase.co",anonKey:"k"}},savedSession(){return"s"},saveSession(){},async login(){return"s"}};`;
const ID = (n) => String(n).padStart(32, '0'), ED = '2026-11-17T00:00:00.000Z';
const row = (n, props) => ({ id: ID(n), props, url: '', icon: '', notion_edited_at: ED });
const D = (s, e) => ({ start: s, end: e || null });
const now = new Date(), p2 = (v) => String(v).padStart(2, '0'), ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const TODAY = ymd(now), DOW = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
const ROWS = {
  '강사(학원) DB': [row(1, { 이름: '예시 강사', 직책: '원장' })],
  '영역(학원) DB': [row(2, { 이름: '수학', 순서: 1, 사용: true })],
  '학년(학원) DB': [row(3, { 이름: '중1', 사용: true, 순서: 7 })],
  '시즌(학원) DB': [row(4, { 이름: '예시 시즌', 기간: D('2026-01-01', '2027-12-31'), 상태: '확정' })],
  '클래스(학원) DB': [row(5, { 클래스명: '예시 수학반', 약칭: '예수', 영역: [ID(2)], 담당강사: [ID(1)], 수강료: 240000, '월간 수업 총량': 8, 단위: '횟수' })],
  '학생(학원) DB': [row(6, { 학생이름: '예시학생1', 학년: [ID(3)] }), row(7, { 학생이름: '예시학생2', 학년: [ID(3)] })],
  '등록(학원) DB': [row(8, { 학생정보: [ID(6)], 클래스: [ID(5)], 등록일: D('2026-09-01') }), row(9, { 학생정보: [ID(7)], 클래스: [ID(5)], 등록일: D('2026-09-01') })],
  '시간표(학원) DB': [row(10, { 이름: '예시 수학반 ' + DOW, 클래스: [ID(5)], 시즌: [ID(4)], 요일: DOW, '등원시간(HH:mm)': '15:00', '하원시간(HH:mm)': '16:00', 등록: [ID(8), ID(9)], 강사: [ID(1)] })],
};
const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const SES = ID(50), A1 = ID(60), A2 = ID(61);
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const bad = [], R = {};
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const ST = { [A1]: '🟢 출석', [A2]: '🔴 결석' }, saves = [], calls = [], saveBodies = [];
  let mode = 'ok'; // ok · down(서버 막힘) · partial(A2만 실패)
  await p.route('**/hada_config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: CFG }));
  await p.route('**/admin_auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: AUTH }));
  await p.route('https://mockref.supabase.co/**', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}'), fn = r.request().url().split('/').pop();
    if (r.request().method() === 'POST') calls.push(fn + ':' + body.action);
    const send = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
    if (fn === 'class-room') {
      if (body.action === 'day') return send(body.date === TODAY ? { date: body.date, sessions: [{ id: SES, name: '예시 수학반', start: TODAY + 'T15:00:00.000+09:00', end: TODAY + 'T16:00:00.000+09:00', time: '15:00–16:00', teacherIds: [ID(1)], classIds: [ID(5)], makeup: false, students: 2, records: 0, attendanceSummary: '🟢 출석 1 | 🔴 결석 1', className: '예시 수학반', classEmoji: '', arrived: 0 }], makeupWaiting: [] } : { date: body.date, sessions: [], makeupWaiting: [] });
      if (body.action === 'save-attendance') {
        saves.push({ mode, items: body.items });
        if (mode === 'down') return r.abort('connectionrefused');
        const items = body.items || [], okItems = mode === 'partial' ? items.filter((it) => it.attendanceId !== A2) : items;
        okItems.forEach((it) => { ST[it.attendanceId] = it.status; });
        if (okItems.length < items.length) return send({ error: `출결 ${items.length}건 중 ${items.length - okItems.length}건을 저장하지 못했어요 — 노션에 쓰지 못했어요(시간 초과)`, saved: okItems.length, savedIds: okItems.map((x) => x.attendanceId), failed: items.filter((x) => !okItems.includes(x)).map((x) => ({ id: x.attendanceId, error: '노션에 쓰지 못했어요(시간 초과)' })) }, 502);
        return send({ saved: items.length });
      }
      if (body.action === 'session') return send({ session: { id: SES }, students: [{ attendanceId: A1, registrationId: ID(8), name: '예시학생1', status: ST[A1], arrivedAt: null, leftAt: null, memo: '', comment: '' }, { attendanceId: A2, registrationId: ID(9), name: '예시학생2', status: ST[A2], arrivedAt: null, leftAt: null, memo: '', comment: '' }], homeworkDue: [], records: [] });
      if (body.action === 'class-sessions') return send({ sessions: [] });
      if (body.action === 'routines') return send({ available: false, status: '', checks: [] });
      return send({ error: '없는 동작' }, 400);
    }
    if (body.action === 'list') return send({ ok: true, rows: ROWS[body.db] || [] });
    if (body.action === 'options') return send({ ok: true, dbs: {} });
    // 출시 전 5번: 새 줄은 노션에 만들고 사본만 못 쓴 것처럼 답한다(서버 appSave.ts와 같은 모양 — ok + 새 id + warn)
    if (body.action === 'save') { saveBodies.push(body.changes || []); return send({ ok: true, results: (body.changes || []).map((c, i) => c.op === 'create' ? { i, ok: true, id: ID(900 + saveBodies.length), tmp: c.tmp, row: null, warn: '노션엔 저장됨, 앱 사본만 못 맞춤 — 잠시 뒤 저절로 맞춰져요(다시 저장하지 않아도 돼요)' } : { i, ok: true, id: c.id }) }); }
    return send({ ok: true, results: [], rows: [] });
  });
  await p.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1&gates=P1,P2,P3,P3w&c=${Date.now()}`);
  await p.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
  await p.evaluate(() => { openScreen('timetable', false, { view: 'lesson', lv: 'wk' }); });
  await p.waitForFunction((today) => LIVE_LD[today] === 'ok', TODAY, { timeout: 15000 });
  const k = await p.evaluate((today) => lkey(DB.blocks[0], today), TODAY);
  const open = async () => {
    await p.evaluate((k) => { panelOpen = true; activeTab.state.ltab = 'att'; activeTab.state.lsel = k; render(); }, k);
    await p.waitForFunction((k) => LIVE_LS[k] && LIVE_LS[k].state === 'ok', k, { timeout: 15000 });
    await p.waitForTimeout(200);
  };
  await open();
  const pickAtt = async (i, v) => { await p.evaluate(([i, v]) => { const seg = document.querySelectorAll('.panel .attseg')[i]; seg.querySelector(`button[data-v="${v}"]`).click(); }, [i, v]); await p.waitForTimeout(120); };
  const state = () => p.evaluate(([k, today]) => { const bl = DB.blocks[0]; const c = lChanges(k) || { att: [] }; return { a: lessonRoster(bl, today).map((x) => attOf(bl, today, x.id)), dirty: dirtyCount(), ldirty: LDIRTY.size, changed: c.att.length, loaded: !!(LIVE_LS[k] && LIVE_LS[k].state === 'ok'), toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ') }; }, [k, TODAY]);
  const topSave = () => p.evaluate(async () => { const r = await liveSave(); await new Promise((ok) => setTimeout(ok, 300)); return r ? { ok: r.ok, lessons: r.lessons, lf: (r.lessonFailed || []).length } : null; });
  // ① 서버를 막은 채 두 학생 출결을 바꾸고 위 [저장]
  await pickAtt(0, '결석'); await pickAtt(1, '출석');
  R.before = await state();
  mode = 'down';
  const sessCalls0 = calls.filter((c) => c === 'class-room:session').length;
  R.downSave = await topSave();
  R.down = await state();
  R.down.reloaded = calls.filter((c) => c === 'class-room:session').length - sessCalls0;
  if (/저장할 변경이 없어요/.test(R.down.toast) || !/일부만 저장했어요|저장하지 못|작성 중으로 남겼어요/.test(R.down.toast)) bad.push('① 실패 알림 ' + R.down.toast);
  if (JSON.stringify(R.down.a) !== '["결석","출석"]') bad.push('① 입력이 사라짐 ' + JSON.stringify(R.down.a));
  if (R.down.ldirty !== 1 || R.down.changed !== 2 || R.down.dirty < 1) bad.push('① 작성 중 표시 · 저장 수 ' + JSON.stringify(R.down));
  await p.screenshot({ path: shots + 'lesson-save-fail-down.png' });
  // ② 한 명만 실패
  mode = 'partial';
  R.partSave = await topSave();
  R.part = await state();
  if (JSON.stringify(R.part.a) !== '["결석","출석"]' || R.part.ldirty !== 1 || R.part.changed !== 1 || !/^일부만 저장했어요.*작성 중으로 남겼어요/.test(R.part.toast)) bad.push('② 한 명 실패 ' + JSON.stringify(R.part));
  if (ST[A1] !== '🔴 결석' || ST[A2] !== '🔴 결석') bad.push('② 서버 값 ' + JSON.stringify(ST));
  await p.screenshot({ path: shots + 'lesson-save-fail-partial.png' });
  // ③ 서버가 돌아오면 실패한 학생만 다시 나간다
  mode = 'ok';
  const n0 = saves.length;
  R.okSave = await topSave();
  await p.waitForFunction((k) => LIVE_LS[k] && LIVE_LS[k].state === 'ok', k, { timeout: 15000 }).catch(() => {});
  await open();
  R.ok = await state();
  R.okSent = saves.slice(n0).map((s) => s.items.map((it) => it.attendanceId === A1 ? 'A1' : 'A2'));
  if (JSON.stringify(R.okSent) !== '[["A2"]]') bad.push('③ 다시 보낸 줄 ' + JSON.stringify(R.okSent));
  if (R.ok.ldirty !== 0 || R.ok.dirty !== 0 || JSON.stringify(R.ok.a) !== '["결석","출석"]') bad.push('③ 저장 뒤 ' + JSON.stringify(R.ok));
  // ④ 앱 저장 줄(학생 이름)과 함께일 때도 수업 실패가 저장 결과에 남는다
  await pickAtt(0, '출석');
  mode = 'down';
  R.mixSave = await p.evaluate(async () => { const s = DB.students[0]; s.name = s.name + ' '; s.state = 'draft'; const r = await liveSave(); await new Promise((ok) => setTimeout(ok, 300)); return { ok: r && r.ok, modal: (document.querySelector('.modal, .mbox, [role=dialog]') || document.body).textContent.includes('수업 저장 안 됨') }; });
  R.mix = await state();
  if (!R.mixSave.modal || R.mix.ldirty !== 1) bad.push('④ 함께 저장 ' + JSON.stringify({ save: R.mixSave, st: R.mix }));
  await p.screenshot({ path: shots + 'lesson-save-fail-mixed.png' });
  // ⑤ (출시 전 5번) 새 학생: 노션엔 만들고 사본만 실패 → 노션 id로 바뀌고 저장됨, 안내가 보이고, 다시 [저장]해도 만들기를 또 보내지 않음
  mode = 'ok';
  await p.evaluate(() => { document.querySelectorAll('.modal .btn.pri, #co').forEach((x) => x.click()); });
  R.newStu = await p.evaluate(async () => {
    const s0 = DB.students[0], s = JSON.parse(JSON.stringify(s0)); s.id = 'snew1'; s.name = '예시학생3'; s.state = 'draft'; delete s._edited; DB.students.push(s);
    const r = await liveSave(); await new Promise((ok) => setTimeout(ok, 300));
    const text = document.body.textContent, row = DB.students.find((x) => x.name === '예시학생3');
    return { id: row && row.id, state: row && row.state, warned: text.includes('앱 사본만 못 맞춤'), ok: r && r.ok };
  });
  await p.screenshot({ path: shots + 'save-copy-warn.png' });
  const creates0 = saveBodies.flat().filter((c) => c.op === 'create').length;
  await p.evaluate(async () => { document.querySelectorAll('#co').forEach((x) => x.click()); await liveSave(); await new Promise((ok) => setTimeout(ok, 300)); });
  R.newStu.createsAfter = saveBodies.flat().filter((c) => c.op === 'create').length - creates0;
  if (!/^0+9\d\d$/.test(R.newStu.id || '') || R.newStu.state !== 'saved' || !R.newStu.warned || R.newStu.createsAfter !== 0 || creates0 !== 1) bad.push('⑤ 새 줄 사본 실패 ' + JSON.stringify({ ...R.newStu, creates0 }));
  if (errs.length) bad.push('오류 ' + errs.join(';'));
  console.log(JSON.stringify(R).slice(0, 2500));
  console.log(bad.length ? 'FAIL ' + bad.join(' | ') : 'ALL OK');
  await b.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
