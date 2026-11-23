// 관리 앱 — 시험 화면 쓰기(261123 과제 시험보강) — 가짜 서버로만. 실제 자료 모드(?live=1)에서
// 시험 화면이 보기만이 아니고, 시험(학원) · 시험정보 · 성적 줄을 노션과 같은 칸으로 app-api save에 보내는지:
//   새 시험 + 시험정보 만들기(시험 tmp 연결) · [응시학생 등록](노션 버튼과 같은 거름 → 성적 줄: 학생 · 시험정보 · 학년 · 학교) ·
//   성적 고치기(점수 · 등수 · 응시인원 · 등급만, 학년 · 학교는 안 보냄) · 시험 범위(단원목록) · [시험 기간 연결](요청 = exam-period-link) ·
//   보기 칩 [지필고사 | 모의고사 | 성적 | 달력]. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-exam-live.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const id = (n) => { const h = n.toString(16); return `${h.repeat(8).slice(0, 8)}-${h.repeat(4).slice(0, 4)}-4${h.repeat(3).slice(0, 3)}-8${h.repeat(3).slice(0, 3)}-${h.repeat(12).slice(0, 12)}`; };
const S1 = id(1), S2 = id(2), S3 = id(3), C1 = id(4), E1 = id(5), E2 = id(6), E3 = id(7), SC = id(8), SC2 = id(9), GL = id(10), SB = id(11), BK = id(12), T1 = id(13), X1 = id(14), X2 = id(15), G1 = id(0), U1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', U2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const now = new Date().toISOString();
const en = (eid, sid) => ({ id: eid, props: { '이름': '예시 등록', '학생정보': [sid], '클래스': [C1], '등록일': { start: '2026-03-01', end: null }, '수강상태': '🟢 수강 중' } });
const DBS = () => ({
  '학교(학원) DB': [{ id: SC, props: { '이름': '예시중', '학교 구분': '중학교' } }, { id: SC2, props: { '이름': '다른중', '학교 구분': '중학교' } }],
  '학년(학원) DB': [{ id: GL, props: { '이름': '중2', '사용': true, '학교구분': '중학교' } }],
  '과목(학원) DB': [{ id: SB, props: { '이름': '예시 수학 2', '학년': [GL] } }],
  '라이브러리(학원) DB': [{ id: BK, props: { '교재명': '예시 수학 교재', '과목': [SB], '사용중': true } }],
  '학생(학원) DB': [
    { id: S1, props: { '학생이름': '예시 학생 가', '학교': [SC], '학년': [GL], '등록': [E1] } },
    { id: S2, props: { '학생이름': '예시 학생 나', '학교': [SC], '학년': [GL], '등록': [E2] } },
    { id: S3, props: { '학생이름': '예시 학생 다', '학교': [SC2], '학년': [GL], '등록': [E3] } },
  ],
  '클래스(학원) DB': [{ id: C1, props: { '클래스명': '예시반', '등록': [E1, E2, E3] } }],
  '등록(학원) DB': [en(E1, S1), en(E2, S2), en(E3, S3)],
  '시험(학원) DB': [{ id: T1, props: { '이름': '2026 1학기 기말고사', '연도': '2026', '시험 구분': '지필고사', '지필고사': '1학기 기말고사', '시험정보': [X1, X2] } }],
  '시험정보(학원) DB': [
    { id: X1, props: { '이름': '2026 1학기 기말고사 (예시중 중2 수학)', '시험': [T1], '학교': [SC], '학년': [GL], '과목': [SB], '시험일': { start: '2026-07-01', end: null }, '단원목록': [], '시험일정': [], '성적': [], '응시학생 현황': '0/2명', '마지막 오류': '' } },
    { id: X2, props: { '이름': '2026 1학기 기말고사 (예시중 중2 수학) 2', '시험': [T1], '학교': [SC], '학년': [GL], '과목': [SB], '시험일': { start: '2026-07-02', end: null }, '단원목록': [], '시험일정': [], '성적': [G1] } },
  ],
  '성적(학원) DB': [{ id: G1, props: { '이름': '예시 학생 가 중2 1학기 기말고사 (수학)', '학생': [S1], '시험정보': [X2], '학년': [GL], '학교': [SC], '점수': 80, '등수': null, '응시인원': null, '등급': null, '백분률': null, '시험지': [], '성적표': [] } }],
});
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const saves = [], errors = [], data = DBS(); let made = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
  const reply = (route, status, d) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(d) });
  const row = (db, r) => ({ db, id: r.id, props: r.props, notion_created_at: now, notion_edited_at: new Date().toISOString(), url: '', icon: '' });
  await page.route(H + '**', async (route) => {
    const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
    const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
    if (fn === 'textbook-api' && q.action === 'units') return reply(route, 200, { ok: true, units: [{ id: U1, name: '1. 수와 연산', page: 1, uses: 0 }, { id: U2, name: '2. 식의 계산', page: 30, uses: 0 }] });
    if (fn === 'app-api') {
      if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: now, rows: (data[q.db] || []).map((r) => row(q.db, r)) });
      if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
      if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
      if (q.action === 'changes') return reply(route, 200, { ok: true, rows: [], gone: [], now: new Date().toISOString() });
      if (q.action === 'save') {
        assert.equal(req.headers()['x-admin-key'], 'sess-1', 'save에 관리자 세션');
        saves.push(q.changes);
        const tmp = {};
        const results = q.changes.map((c, i) => {
          const props = {}; for (const [k, v] of Object.entries(c.props || {})) props[k] = Array.isArray(v) ? v.map((s) => tmp[s] || s) : v;
          if (c.op === 'create') { const nid = id(100 + ++made); tmp[c.tmp] = nid; (data[c.db] = data[c.db] || []).push({ id: nid, props }); return { i, ok: true, id: nid, tmp: c.tmp, row: row(c.db, { id: nid, props }) }; }
          const r = (data[c.db] || []).find((x) => x.id === c.id); if (!r) return { i, ok: false, id: c.id, error: '이 DB의 줄이 아닙니다.' }; Object.assign(r.props, props); return { i, ok: true, id: c.id, row: row(c.db, r) };
        });
        return reply(route, 200, { ok: results.every((r) => r.ok), results });
      }
      return reply(route, 200, { ok: true });
    }
    return reply(route, 200, { ok: true, rows: [], items: [] });
  });
  await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1&refresh=0`);
  await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
  const last = async (n) => { for (let k = 0; k < 60 && saves.length < n; k++) await new Promise((r) => setTimeout(r, 100)); assert.equal(saves.length, n, `save ${n}번`); return saves[n - 1].map((c) => ({ op: c.op, db: c.db, id: c.id, props: c.props })); };
  const sel = async (rid, tab) => { await page.evaluate(([r, t]) => { openScreen('exams'); activeTab.state.sub = ''; activeTab.state.sel = r; activeTab.state.ltab = t || 'info'; panelOpen = true; render(); }, [rid, tab]); await page.waitForTimeout(150); };
  const press = (css) => page.evaluate((c) => { const x = document.querySelector(c); if (!x) throw new Error('없음: ' + c); x.click(); }, css);

  // 0) 시험 화면이 보기만이 아님 — 안내 줄 없음, [+] 켜짐, 칩 넷
  await page.evaluate(() => { openScreen('exams'); render(); });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => !!document.querySelector('#view .ro-line')), false, '보기만 안내 없음');
  assert.equal(await page.evaluate(() => document.querySelector('#addRow').disabled), false, '[+] 켜짐');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#view .subseg:not(.ftseg) button, #view .pg-bar > .subseg:first-of-type button')].map((x) => x.textContent.replace(/\d+/g, '').trim()).slice(0, 4)), ['지필고사', '모의고사', '성적', '달력']);
  assert.equal(await page.evaluate(() => window.LIVE_EXW), true, '시험 쓰기 칸 켜짐');
  await page.screenshot({ path: shots + 'exam-live-list.png' });
  done.push('보기만 아님 · 칩');

  // 1) 새 시험 + 시험정보: [시험]에 없는 이름을 적어 생성 → 위 [저장] → 시험(학원) create, 시험정보 create(시험 = 앞 줄)
  const newX = await page.evaluate(([sc]) => {
    const L = LISTS.exams_, x = L.blank(); DB.exams.unshift(x); x.state = 'draft';
    const tid = REL_NEW.exams.testId('2026 2학기 기말고사'); x.testId = tid; L.onSet(x, 'testId');
    x.school = '예시중'; x.grade = '중2'; x.subjectIds = [DB.subjects[0].id]; x.date = '2026-12-10'; commit(); return x.id;
  }, [SC]);
  await page.evaluate(() => liveSave());
  const c1 = await last(1);
  assert.deepEqual(c1.map((c) => [c.op, c.db]), [['create', '시험(학원) DB'], ['create', '시험정보(학원) DB']]);
  assert.deepEqual(c1[0].props, { '이름': '2026 2학기 기말고사', '연도': '2026', '시험 구분': '지필고사', '지필고사': '2학기 기말고사', '모의고사(수능)': '' });
  assert.deepEqual(c1[1].props, { '시험': [saves[0][0].tmp], '학교': [SC], '학년': [GL], '과목': [SB], '시험일': '2026-12-10', '시험일정': [], '단원목록': [] });
  done.push('시험 · 시험정보 만들기');

  // 2) [응시학생 등록] — 노션 버튼과 같은 거름: 같은 학년 · 같은 학교 · 재원 · 성적 없음 → 바로 저장
  await sel(X1, 'gr');
  assert.match(await page.textContent('#view .panel [data-exgen]'), /응시학생 등록 2/, '예시중 중2 둘(다른중은 빠짐)');
  await press('#view .panel [data-exgen]');
  const c2 = await last(2);
  assert.deepEqual(c2.map((c) => [c.op, c.db, c.props['학생'][0], c.props['시험정보'][0], c.props['학년'][0], c.props['학교'][0]]).sort(), [['create', '성적(학원) DB', S1, X1, GL, SC], ['create', '성적(학원) DB', S2, X1, GL, SC]]);
  assert.equal(await page.evaluate(() => document.querySelector('#view .panel [data-exgen]').disabled), true, '다시 누를 것 없음');
  await page.screenshot({ path: shots + 'exam-live-gen.png' });
  done.push('응시학생 등록');

  // 3) 성적 고치기: 점수 · 등수 · 응시인원 · 등급 → 고친 칸만(학년 · 학교 · 학생은 안 보냄)
  await sel(X2, 'gr');
  await page.evaluate(() => { const set = (c, v) => { const i = document.querySelector('#view .panel ' + c); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }; set('[data-gf=score]', '92'); set('[data-gf=rank]', '4'); set('[data-gf=total]', '180'); set('select[data-gf=level]', '2등급'); });
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#view .panel .exgr'), /백분율 2\.2%/, '저장 전 백분율 = 등수 ÷ 응시인원');
  await page.evaluate(() => liveSave());
  assert.deepEqual(await last(3), [{ op: 'update', db: '성적(학원) DB', id: G1, props: { '점수': 92, '등수': 4, '응시인원': 180, '등급': '2등급' } }]);
  assert.match(await page.evaluate(() => document.querySelector('#view .panel .exfl').getAttribute('href')), /notion\.so\//, '파일은 노션 링크');
  done.push('성적 고치기');

  // 4) 시험 범위: 과목 교재 단원에서 고르기 → 단원목록
  await sel(X1, 'info'); await press('#view .panel [data-exunits]');
  await page.waitForFunction(() => document.querySelectorAll('#modalRoot [data-u]').length === 2);
  await page.evaluate(() => { const c = document.querySelector('#modalRoot [data-u]'); c.checked = true; c.dispatchEvent(new Event('change')); document.querySelector('#exuO').click(); });
  await page.evaluate(() => liveSave());
  assert.deepEqual(await last(4), [{ op: 'update', db: '시험정보(학원) DB', id: X1, props: { '단원목록': [U1] } }]);
  assert.match(await page.textContent('#view .panel .exmore'), /1\. 수와 연산/);
  done.push('시험 범위');

  // 5) [시험 기간 연결] → 요청 = exam-period-link(노션 버튼과 같은 서버 동작) · 마지막 오류가 창에 보임
  await page.evaluate((r) => { APP_RAW.raw['시험정보(학원) DB'].get(r).props['마지막 오류'] = '예시중 시험 기간 일정이 없어요'; const x = DB.exams.find((z) => z.id === r); x._err = '예시중 시험 기간 일정이 없어요'; render(); }, X1);
  await sel(X1, 'info');
  assert.match(await page.textContent('#view .panel .exmore'), /⚠️ 예시중 시험 기간 일정이 없어요/);
  await press('#view .panel [data-exlink]');
  assert.deepEqual(await last(5), [{ op: 'update', db: '시험정보(학원) DB', id: X1, props: { '요청': 'exam-period-link' } }]);
  await page.screenshot({ path: shots + 'exam-live-info.png' });
  done.push('시험 기간 연결');

  // 6) 성적 칩: 학생마다 한 줄(노션 성적 보기) · 모의고사 칩은 비어 있음
  await page.evaluate(() => { activeTab.state.sub = 'g'; activeTab.state.sel = null; render(); });
  assert.equal(await page.evaluate(() => LISTS.exams_g.rows().length), 3, '성적 3줄');
  await page.evaluate(() => { activeTab.state.sub = 'm'; render(); });
  assert.equal(await page.evaluate(() => LISTS.exams_m.rows().length), 0, '모의고사 0');
  done.push('성적 · 모의고사 칩');

  // 7) 창 [시험 저장] = 그 시험정보 + 새로 고른 시험(학원) 줄까지(원본 대조 261123: 새 시험 줄이 빠졌음) · 성적만 고쳐도 창 [저장]이 켜지고 그 성적을 보냄
  const nx = await page.evaluate(() => { const L = LISTS.exams_m, x = L.blank(); DB.exams.unshift(x); x.state = 'draft'; x.testId = REL_NEW.exams.testId('2026 6월 모의고사'); L.onSet(x, 'testId'); x.school = '예시중'; x.grade = '중2'; x.date = '2026-06-04'; commit(); openScreen('exams'); activeTab.state.sub = 'm'; activeTab.state.sel = x.id; activeTab.state.ltab = 'info'; panelOpen = true; render(); return x.id; });
  await page.waitForTimeout(150); await press('#view .panel #rowSave');
  const c6 = await last(6);
  assert.deepEqual(c6.map((c) => [c.op, c.db]), [['create', '시험(학원) DB'], ['create', '시험정보(학원) DB']], '창 저장에 새 시험 줄');
  assert.equal(c6[0].props['모의고사(수능)'], '6월 모의고사'); assert.equal(c6[0].props['시험 구분'], '모의고사');
  await sel(X2, 'gr');
  await page.evaluate(() => { const i = document.querySelector('#view .panel [data-gf=score]'); i.value = '95'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.querySelector('#view .panel #rowSave').disabled), false, '성적만 고쳐도 창 [저장] 켜짐');
  await press('#view .panel #rowSave');
  assert.deepEqual(await last(7), [{ op: 'update', db: '성적(학원) DB', id: G1, props: { '점수': 95 } }]);
  done.push('창 저장');

  assert.deepEqual(errors, [], '페이지 오류 없음');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '가로 넘침 없음');
  console.log('통과 —', done.join(' · '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
