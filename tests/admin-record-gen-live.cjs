// 관리 앱 학습기록 결함(v2.8.0 학습생성결함, 261124) — 가짜 서버로만(실제 노션 · 키 · 네트워크 없음, 예시 데이터만).
// 확인: ① 개별 진도 반 수업 [학습] [진행 중 교재 n개로 생성] → 학생 없는 기준 교재 줄은 빼고, 이 수업 학생의 개별 교재 줄 + 그룹 교재 줄로 만든다
//          (예전: 기준 교재 줄을 보내 서버가 "이 교재를 가진 학생이 이 수업에 없습니다"로 거절). [저장] 때 create-records에 기준 교재 id가 없다.
//       ② 교재 고르기 목록에도 기준 교재 줄 · 이 수업에 없는 학생의 개별 교재가 없다
//       ③ 학습기록 메뉴: 수업 창을 열지 않은 수업 · 보강 수업의 기록까지 그 달 기록이 다 보인다(class-room range-records)
// 사용: ROOT=<저장소 폴더> SHOTS=<캡처 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-record-gen-live.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const CFG = `window.HADA_CONFIG={supabaseUrl:"https://mockref.supabase.co",supabaseAnonKey:"k"};`;
const AUTH = `window.HadaAdminAuth={config(){return{url:"https://mockref.supabase.co",anonKey:"k"}},savedSession(){return"s"},saveSession(){},async login(){return"s"}};`;
const ID = (n) => String(n).padStart(32, '0'), ED = '2026-11-17T00:00:00.000Z';
const row = (n, props) => ({ id: ID(n), props, url: '', icon: '', notion_edited_at: ED });
const D = (s, e) => ({ start: s, end: e || null });
const now = new Date(), p2 = (v) => String(v).padStart(2, '0'), ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const TODAY = ymd(now), DOW = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()], MONTH = TODAY.slice(0, 7);
const BASE = ID(20), PA = ID(21), PB = ID(22), GRP = ID(23), PC = ID(24); // 기준 교재 · 학생1 개별 · 학생2 개별 · 그룹 교재 · 이 수업에 없는 학생3 개별
const ROWS = {
  '강사(학원) DB': [row(1, { 이름: '예시 강사', 직책: '원장' })],
  '영역(학원) DB': [row(2, { 이름: '수학', 순서: 1, 사용: true })],
  '학년(학원) DB': [row(3, { 이름: '중1', 사용: true, 순서: 7 })],
  '시즌(학원) DB': [row(4, { 이름: '예시 시즌', 기간: D('2026-01-01', '2027-12-31'), 상태: '확정' })],
  '클래스(학원) DB': [row(5, { 클래스명: '예시 개별반', 약칭: '예개', 영역: [ID(2)], 담당강사: [ID(1)], 수강료: 240000, '월간 수업 총량': 8, 단위: '횟수' })],
  '학생(학원) DB': [row(6, { 학생이름: '예시학생1', 학년: [ID(3)] }), row(7, { 학생이름: '예시학생2', 학년: [ID(3)] }), row(11, { 학생이름: '예시학생3', 학년: [ID(3)] })],
  '등록(학원) DB': [row(8, { 학생정보: [ID(6)], 클래스: [ID(5)], 등록일: D('2026-09-01') }), row(9, { 학생정보: [ID(7)], 클래스: [ID(5)], 등록일: D('2026-09-01') }), row(12, { 학생정보: [ID(11)], 클래스: [ID(5)], 등록일: D('2026-09-01') })],
  '시간표(학원) DB': [row(10, { 이름: '예시 개별반 ' + DOW, 클래스: [ID(5)], 시즌: [ID(4)], 요일: DOW, '등원시간(HH:mm)': '15:00', '하원시간(HH:mm)': '16:00', 등록: [ID(8), ID(9)], 강사: [ID(1)] })],
  '라이브러리(학원) DB': [row(30, { 교재명: '예시 개별 교재', 사용중: true }), row(31, { 교재명: '예시 그룹 교재', 사용중: true })],
  '진도관리(학원) DB': [
    row(20, { 진도교재: '예시 개별 교재 · 예시 개별반', 진도방식: '개별 진도', 클래스: [ID(5)], 라이브러리: [ID(30)], 진행상태: '진행 중' }),
    row(21, { 진도교재: '예시 개별 교재 · 예시학생1 예시 개별반', 진도방식: '개별 진도', 등록: [ID(8)], 반별교재: [BASE], 라이브러리: [ID(30)], 진행상태: '진행 중' }),
    row(22, { 진도교재: '예시 개별 교재 · 예시학생2 예시 개별반', 진도방식: '개별 진도', 등록: [ID(9)], 반별교재: [BASE], 라이브러리: [ID(30)], 진행상태: '진행 중' }),
    row(23, { 진도교재: '예시 그룹 교재 · 예시 개별반', 진도방식: '그룹 진도', 클래스: [ID(5)], 라이브러리: [ID(31)], 진행상태: '진행 중' }),
    row(24, { 진도교재: '예시 개별 교재 · 예시학생3 예시 개별반', 진도방식: '개별 진도', 등록: [ID(12)], 반별교재: [BASE], 라이브러리: [ID(30)], 진행상태: '진행 중' }),
  ],
};
const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const SES = ID(50), SES2 = ID(51), MK = ID(52), A1 = ID(60), A2 = ID(61);
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(f)] || 'text/plain'); res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const bad = [], R = {};
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const creates = [], made = [], ranges = [];
  await p.route('**/hada_config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: CFG }));
  await p.route('**/admin_auth.js', (r) => r.fulfill({ contentType: 'application/javascript', body: AUTH }));
  await p.route('https://mockref.supabase.co/**', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}'), fn = r.request().url().split('/').pop();
    const send = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
    if (fn === 'class-room') {
      if (body.action === 'day') return send(body.date === TODAY ? { date: body.date, sessions: [{ id: SES, name: '예시 개별반', start: TODAY + 'T15:00:00.000+09:00', end: TODAY + 'T16:00:00.000+09:00', time: '15:00–16:00', teacherIds: [ID(1)], classIds: [ID(5)], makeup: false, students: 2, records: 0, attendanceSummary: '', className: '예시 개별반', classEmoji: '', arrived: 0, blockId: ID(10) }], makeupWaiting: [] } : { date: body.date, sessions: [], makeupWaiting: [] });
      if (body.action === 'session') return send({ session: { id: SES }, students: [{ attendanceId: A1, registrationId: ID(8), name: '예시학생1', status: '🟢 출석', arrivedAt: null, leftAt: null, memo: '', comment: '' }, { attendanceId: A2, registrationId: ID(9), name: '예시학생2', status: '🟢 출석', arrivedAt: null, leftAt: null, memo: '', comment: '' }], homeworkDue: [], records: made.map((m) => ({ id: m.id, kind: '학습', bookId: m.book, title: m.title, range: '', content: '' })) });
      if (body.action === 'create-records') {
        creates.push(body);
        const book = (body.bookIds || [])[0];
        if (book === BASE || book === PC) return send({ error: '이 교재를 가진 학생이 이 수업에 없습니다.' }, 400); // 서버 targetRegistrations와 같은 거절
        const m = { id: ID(700 + creates.length), book, title: `[학습] ${book} ${TODAY}` }; made.push(m);
        return send({ records: [{ id: m.id, title: m.title, created: true }] });
      }
      if (body.action === 'range-records') {
        ranges.push(body.from + '~' + body.to);
        // 수업 창을 연 수업(SES)의 기록 + 열지 않은 다른 수업(SES2) 기록 + 보강 수업(MK, 시간표 없음) 기록 — 노션 학습기록 DB 목록 그대로
        return send({ records: [
          ...made.map((m) => ({ id: m.id, title: m.title, kind: '학습', bookId: m.book, range: '', content: '', sessionId: SES, date: TODAY, time: '15:00', classIds: [ID(5)], blockId: ID(10), homework: null, score: null })),
          { id: ID(800), title: '[과제] 예시 그룹 교재 · 예시 개별반 ' + MONTH + '-01', kind: '과제', bookId: GRP, range: '10-12', content: '', sessionId: SES2, date: MONTH + '-01', time: '15:00', classIds: [ID(5)], blockId: ID(10), homework: { submitted: 1, total: 2, due: null }, score: null },
          { id: ID(801), title: '[학습] 예시 보강 기록', kind: '학습', bookId: PA, range: '3-4', content: '', sessionId: MK, date: MONTH + '-02', time: '17:00', classIds: [], blockId: null, homework: null, score: null },
        ] });
      }
      if (body.action === 'class-sessions') return send({ sessions: [] });
      if (body.action === 'routines') return send({ available: false, status: '', checks: [] });
      if (body.action === 'makeup-waiting') return send({ items: [] });
      return send({ error: '없는 동작' }, 400);
    }
    if (body.action === 'list') return send({ ok: true, rows: ROWS[body.db] || [] });
    if (body.action === 'options') return send({ ok: true, dbs: {} });
    return send({ ok: true, results: [], rows: [] });
  });
  await p.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1&gates=P1,P2,P3,P3w,P3b&c=${Date.now()}`);
  await p.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
  await p.evaluate(() => { openScreen('timetable', false, { view: 'lesson', lv: 'wk' }); });
  await p.waitForFunction((today) => LIVE_LD[today] === 'ok', TODAY, { timeout: 15000 });
  const k = await p.evaluate((today) => lkey(DB.blocks[0], today), TODAY);
  await p.evaluate((k) => { panelOpen = true; activeTab.state.ltab = 'log'; activeTab.state.lsel = k; render(); }, k);
  await p.waitForFunction((k) => LIVE_LS[k] && LIVE_LS[k].state === 'ok', k, { timeout: 15000 });
  await p.waitForTimeout(200);
  // ① 생성 버튼: 기준 교재 · 수업에 없는 학생 교재는 빠지고 3권(학생1 · 학생2 개별 + 그룹)
  R.btn = await p.evaluate(() => { const bt = document.querySelector('#recGen'); return bt ? bt.textContent.trim() : ''; });
  if (!/진행 중 교재 3개로 생성/.test(R.btn)) bad.push('① 버튼 ' + R.btn);
  await p.screenshot({ path: shots + 'record-gen-before.png' });
  await p.evaluate(() => document.querySelector('#recGen').click());
  await p.waitForTimeout(200);
  R.drafts = await p.evaluate((k) => DB.recs.filter((r) => r.key === k && !r.del).map((r) => r.bookId).sort(), k);
  if (JSON.stringify(R.drafts) !== JSON.stringify([PA, PB, GRP].sort())) bad.push('① 만든 줄 ' + JSON.stringify(R.drafts));
  // ② 교재 고르기 목록
  R.pick = await p.evaluate(([b, k]) => { const bl = DB.blocks[0]; const d = k.split('|')[1]; return recGenBooks(bl, lessonRoster(bl, d)).map((x) => x.id).sort(); }, [ID(10), k]);
  if (R.pick.includes(BASE) || R.pick.includes(PC)) bad.push('② 고를 수 있는 교재 ' + JSON.stringify(R.pick));
  await p.screenshot({ path: shots + 'record-gen-drafts.png' });
  // [저장] → create-records 3번, 기준 교재 없음, 거절 없음
  R.save = await p.evaluate(async () => { const r = await liveSave(); await new Promise((ok) => setTimeout(ok, 400)); return r ? { ok: r.ok } : null; });
  R.sent = creates.map((c) => (c.bookIds || [])[0]);
  if (R.sent.length !== 3 || R.sent.includes(BASE) || R.sent.includes(PC)) bad.push('① 보낸 교재 ' + JSON.stringify(R.sent));
  R.toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '));
  if (/가진 학생이 이 수업에 없습니다/.test(R.toast)) bad.push('① 거절 알림 ' + R.toast);
  await p.screenshot({ path: shots + 'record-gen-saved.png' });
  // ③ 학습기록 메뉴: 그 달 기록 전부(만든 3건 + 열지 않은 수업 1건 + 보강 1건)
  await p.evaluate(() => { document.querySelectorAll('.modal .btn.pri, #co').forEach((x) => x.click()); openScreen('records', false, { sub: 'l' }); });
  await p.waitForFunction(() => Object.values(LIVE_RECM).some((M) => M.state === 'ok'), null, { timeout: 15000 }).catch(async () => { console.log('DBG', await p.evaluate(() => JSON.stringify({ scr: activeTab.screen, st: activeTab.state, recm: LIVE_RECM, mode: window.LIVE_MODE, t: typeof liveRecMonth, r: liveRecMonth(thisM()), ar: String(LISTS.records.afterRender).slice(0, 60) }).slice(0, 800))); });
  await p.waitForTimeout(300);
  R.menu = await p.evaluate(() => ({ rows: LISTS.records_l.rows().length, trs: document.querySelectorAll('tr[data-id]').length, text: document.body.textContent.includes('예시 보강 기록') && document.body.textContent.includes('[과제] 예시 그룹 교재'), cnt: [...document.querySelectorAll('tr[data-id]')].map((tr) => tr.textContent).find((t) => t.includes('[과제] 예시 그룹 교재')) || '' }));
  R.ranges = ranges;
  if (R.menu.rows !== 5 || R.menu.trs < 5 || !R.menu.text) bad.push('③ 메뉴 ' + JSON.stringify(R.menu));
  if (!R.menu.cnt.includes('1/2')) bad.push('③ 과제 현황 ' + R.menu.cnt);
  if (!ranges.some((x) => x === `${MONTH}-01~${MONTH}-${p2(new Date(+MONTH.slice(0, 4), +MONTH.slice(5, 7), 0).getDate())}`)) bad.push('③ 받은 기간 ' + JSON.stringify(ranges));
  await p.screenshot({ path: shots + 'record-menu.png' });
  if (errs.length) bad.push('오류 ' + errs.join(';'));
  console.log(JSON.stringify(R).slice(0, 2500));
  console.log(bad.length ? 'FAIL ' + bad.join(' | ') : 'ALL OK');
  await b.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
