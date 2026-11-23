// 관리 앱 — 노션 버튼과 같은 일을 하는 단추(261123, 과제 막힌단추) — 가짜 서버로만. 실제 자료 모드(?live=1)에서
// 막혀 있던 단추가 노션 버튼과 같은 줄 · 같은 칸(`요청` = 동작 ID, 또는 자동화가 보는 상태 칸)을 app-api save update로 바꾸는지,
// 확인 창이 뜨는지, 저장 안 한 줄은 보내지 않는지. 등록 [종료 처리](261123 과제 종료처리)는 확인 창 숫자 = 서버 미리보기(end-preview), 보내는 것 = 종료일 + 요청. PC 1280만.
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-request-live.cjs   (캡처는 SHOTS 폴더)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = (process.env.SHOTS || __dirname) + '/';
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const id = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const S1 = id(1), S2 = id(2), C1 = id(3), E1 = id(4), E2 = id(5), P1 = id(6), P2 = id(7), BK = id(8), ET = id(9), TB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date().toISOString();
const DBS = () => ({
  '학생(학원) DB': [
    { id: S1, props: { '학생이름': '예시 학생 가', '어머니 연락처': '010-0000-0000', '우선 연락 대상': '어머니', '개인정보 동의': false, '등록': [E1] } },
    { id: S2, props: { '학생이름': '예시 학생 나', '개인정보 동의': false, '등록': [E2] } },
  ],
  '클래스(학원) DB': [{ id: C1, props: { '클래스명': '예시반', '기타경비': [ET], '등록': [E1, E2], '시간표': [TB] } }],
  '등록(학원) DB': [
    { id: E1, props: { '이름': '예시 학생 가 예시반', '학생정보': [S1], '클래스': [C1], '등록일': { start: '2026-11-01', end: null }, '수강상태': '🟢 수강 중', '시간표': [TB] } },
    { id: E2, props: { '이름': '예시 학생 나 예시반', '학생정보': [S2], '클래스': [C1], '등록일': { start: '2026-11-01', end: null }, '수강상태': '🟢 수강 중', '시간표': [TB] } },
  ],
  '진도관리(학원) DB': [
    { id: P1, props: { '진도교재': '예시 교재 · 예시반', '라이브러리': [BK], '클래스': [C1], '진도방식': '그룹 진도', '진행상태': '완료', '등록': [E1, E2] } },
    { id: P2, props: { '진도교재': '예시 교재 · 예시반', '라이브러리': [BK], '클래스': [C1], '진도방식': '개별 진도', '진행상태': '진행 중', '등록': [] } },
  ],
  '라이브러리(학원) DB': [{ id: BK, props: { '교재명': '예시 교재', '사용중': true } }],
  '기타경비(학원) DB': [{ id: ET, props: { '이름': '예시 모의고사비', '받는 방식': '한 번', '신고 금액': 10000 } }],
  '시간표(학원) DB': [{ id: TB, props: { '이름': '예시반 (월) 16:00~18:00', '클래스': [C1], '요일': '월', '등원시간(HH:mm)': '16:00', '하원시간(HH:mm)': '18:00', '등록': [E1, E2], '수업 방식': '그룹 수업', '시작일': { start: '2026-11-30', end: null } } }],
});
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch(); const done = [];
  async function open() {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const saves = [], errors = [], data = DBS(), previews = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
    const reply = (route, status, d) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(d) });
    const row = (db, r) => ({ db, id: r.id, props: r.props, notion_created_at: now, notion_edited_at: new Date().toISOString(), url: '', icon: '' });
    await page.route(H + '**', async (route) => {
      const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, 200, {});
      const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
      if (fn === 'app-api') {
        if (q.action === 'list') return reply(route, 200, { ok: true, db: q.db, at: now, rows: (data[q.db] || []).map((r) => row(q.db, r)) });
        if (q.action === 'options') return reply(route, 200, { ok: true, dbs: {} });
        if (q.action === 'status') return reply(route, 200, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
        if (q.action === 'changes') return reply(route, 200, { ok: true, rows: [], gone: [], now: new Date().toISOString() });
        if (q.action === 'end-preview') { previews.push(q); const all = ['2026-11-20', '2026-12-07', '2026-12-14', '2026-12-21']; return reply(route, 200, { ok: true, basis: q.endDate, dates: all.filter((d) => d > q.endDate) }); }
        if (q.action === 'save') {
          assert.equal(req.headers()['x-admin-key'], 'sess-1', 'save에 관리자 세션');
          saves.push(q.changes);
          const results = q.changes.map((c, i) => { const r = (data[c.db] || []).find((x) => x.id === c.id); if (!r) return { i, ok: false, id: c.id, error: '이 DB의 줄이 아닙니다.' }; Object.assign(r.props, c.props); return { i, ok: true, id: c.id, row: row(c.db, r) }; });
          return reply(route, 200, { ok: results.every((r) => r.ok), results });
        }
        return reply(route, 200, { ok: true });
      }
      return reply(route, 200, { ok: true, rows: [], items: [] });
    });
    await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1&refresh=0`);
    await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
    return { page, saves, errors, data, previews };
  }
  const sel = async (page, scr, rid, tab) => { await page.evaluate(([s, r]) => { openScreen(s); activeTab.state.sel = r; panelOpen = true; render(); }, [scr, rid]); if (tab) await page.evaluate((t) => [...document.querySelectorAll('#view .panel .ptabs button')].find((x) => x.textContent.trim() === t).click(), tab); await page.waitForTimeout(150); };
  const press = (page, css) => page.evaluate((c) => { const x = document.querySelector(c); if (!x) throw new Error('없음: ' + c); x.click(); }, css);
  const dlg = (page) => page.evaluate(() => { const m = [...document.querySelectorAll('.modal')].pop(); return m ? m.innerText : ''; });
  const ok = async (page) => { await page.evaluate(() => [...document.querySelectorAll('#co')].pop().click()); };
  const last = async (saves, n) => { for (let k = 0; k < 50 && saves.length < n; k++) await new Promise((r) => setTimeout(r, 100)); assert.equal(saves.length, n, `save ${n}번`); return saves[n - 1].map((c) => ({ op: c.op, db: c.db, id: c.id, props: c.props })); };
  const noOverflow = async (page, name) => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': 가로 넘침');

  const { page, saves, errors, previews } = await open();
  // 1) 등록 [링크 재발급] → 확인 창(노션 버튼 뜻) → 등록 요청 = reg-link-regenerate · 줄에 대기 알약
  await sel(page, 'enrolls', E1, '현황'); await press(page, '#view .panel [data-ermore]');
  assert.equal(await page.evaluate(() => document.querySelector('#view .panel [data-act=enReissue]').disabled), false, '[링크 재발급] 켜짐');
  await press(page, '#view .panel [data-act=enReissue]'); assert.match(await dlg(page), /노션 등록 \[링크 재발급\]과 같아요/);
  await page.screenshot({ path: shots + 'request-live-reissue.png' }); await ok(page);
  assert.deepEqual(await last(saves, 1), [{ op: 'update', db: '등록(학원) DB', id: E1, props: { '요청': 'reg-link-regenerate' } }]);
  await page.waitForTimeout(300); assert.match(await page.textContent('#view .panel'), /노션 요청 처리 중|노션 요청 대기/, '창 위에 처리 중');
  done.push('링크 재발급');
  // 2) 등록 [등록 안내 전송] → 공용 보내기 창(설명 = 노션 버튼) → 등록 요청 = reg-registration-notice
  //    앞 요청과 같은 이유(알림톡 꺼짐)가 되풀이돼도 상태 칸이 ⚠️면 "받았지만 하지 못했어요"(원본 사용성 시험에서 "완료"로 보였던 것)
  const OFF = "알림톡 설정의 '등록 안내' 행을 켜 주세요.";
  await page.evaluate(([r, off]) => { const p = APP_RAW.raw['등록(학원) DB'].get(r).props; p['마지막 오류'] = off; p['안내 상태'] = '⚠️ 오류'; p['요청'] = '✅ 완료'; p['요청 결과'] = '✅ 완료 · 등록 안내 · 2.0초 · 11/23 09:00:00'; }, [E2, OFF]);
  await sel(page, 'enrolls', E2, '정보'); await press(page, '#view .panel [data-engd2]');
  assert.match(await dlg(page), /노션 \[등록 안내\] 버튼과 같아요/); await ok(page);
  assert.deepEqual(await last(saves, 2), [{ op: 'update', db: '등록(학원) DB', id: E2, props: { '요청': 'reg-registration-notice' } }]);
  await page.evaluate(([r, off]) => { const p = APP_RAW.raw['등록(학원) DB'].get(r).props; p['요청'] = '✅ 완료'; p['요청 결과'] = '✅ 완료 · 등록 안내 · 2.1초 · 11/23 10:00:00'; p['마지막 오류'] = off; p['안내 상태'] = '⚠️ 오류'; }, [E2, OFF]); // 서버가 끝낸 모습(이유 글은 앞과 같음)
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /받았지만 하지 못했어요/.test(t.textContent)), null, { timeout: 8000 });
  done.push('등록 안내 · 받았지만 못 함');
  // 3) 등록 [교재 생성](개별 교재) → 등록 교재 생성 상태 = ⚪ 대기(노션 자동화가 요청을 씀)
  await sel(page, 'enrolls', E1, '진도'); await press(page, '#view .panel [data-act=genPg1]');
  assert.match(await dlg(page), /노션 등록 \[교재 생성\]과 같아요/); await ok(page);
  assert.deepEqual(await last(saves, 3), [{ op: 'update', db: '등록(학원) DB', id: E1, props: { '교재 생성 상태': '⚪ 대기' } }]);
  done.push('교재 생성(학생)');
  // 4) 클래스 [교재 생성] → 수강 중 등록 전부
  await sel(page, 'classes', C1, '진도'); await press(page, '#view .panel [data-act=genPg]'); await ok(page);
  assert.deepEqual((await last(saves, 4)).map((c) => [c.id, c.props['교재 생성 상태']]), [[E1, '⚪ 대기'], [E2, '⚪ 대기']]);
  done.push('교재 생성(클래스)');
  // 5) 클래스 [한 번 청구]는 재무 구조 정리 뒤로 보류(담당 P0 261123) — 꺼진 채, 까닭이 보임, 보내지 않음
  await sel(page, 'classes', C1, '정보');
  assert.equal(await page.evaluate(() => document.querySelector('#view .panel [data-cetone]').disabled), true, '[한 번 청구] 꺼짐');
  assert.match(await page.evaluate(() => document.querySelector('#view .panel [data-cetone]').title), /노션 클래스 \[기타경비 청구\]/);
  assert.equal(saves.length, 4, '보내지 않음');
  done.push('한 번 청구 보류');
  // 6) 클래스 [시간표 변경 안내 전송] → 수강 중 등록의 시간표 안내 상태 = ⚪ 대기
  await sel(page, 'classes', C1, '시간표'); await press(page, '#view .panel [data-ttn]');
  assert.match(await dlg(page), /노션 \[시간표 변경 안내\] 버튼과 같아요/); await ok(page);
  assert.deepEqual((await last(saves, 5)).map((c) => [c.id, c.props['시간표 안내 상태']]), [[E1, '⚪ 대기'], [E2, '⚪ 대기']]);
  //    서버가 받아 대기열에 넣은 동안(상태 칸 ⏳)은 "대기열" 한 줄, 상태 칸이 ⚠️가 되면 그 이유로 알림
  await page.evaluate((ids) => ids.forEach((r, i) => { const p = APP_RAW.raw['등록(학원) DB'].get(r).props; p['요청'] = '✅ 완료'; p['요청 결과'] = `✅ 완료 · 시간표 안내 · 1.${i}초 · 11/23 11:00:0${i}`; p['시간표 안내 상태'] = '⏳ 대기열'; }), [E1, E2]);
  await page.waitForFunction(() => /대기열에서 처리하고 있어요/.test(document.querySelector('#view .panel').innerText), null, { timeout: 8000 });
  await page.evaluate((ids) => ids.forEach((r) => { const p = APP_RAW.raw['등록(학원) DB'].get(r).props; p['시간표 안내 상태'] = '⚠️ 오류'; p['마지막 오류'] = '알림톡 설정의 시간표 변경 안내 행을 켜 주세요.'; }), [E1, E2]);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /시간표 변경 안내 2줄 — 서버가 받았지만 하지 못했어요/.test(t.textContent)), null, { timeout: 8000 });
  done.push('시간표 변경 안내 · 대기열');
  // 7) 진도 [수료] → 진도관리 요청 = progress-completion
  await sel(page, 'progress', P1, '수료'); await press(page, '#view .panel [data-act=pgDone]');
  assert.match(await dlg(page), /노션 진도 \[수료\]와 같아요/); await ok(page);
  assert.deepEqual(await last(saves, 6), [{ op: 'update', db: '진도관리(학원) DB', id: P1, props: { '요청': 'progress-completion' } }]);
  done.push('수료');
  // 8) 학생 [접수 안내 전송] → 학생 요청 = student-inquiry / [개인정보 동의] → 확인 창 → 개인정보 동의 = true
  await sel(page, 'students', S1); await page.evaluate(() => [...document.querySelectorAll('#view .panel [data-s1rc]')][0].click());
  assert.match(await dlg(page), /노션 \[접수안내 전송\] 버튼과 같아요/); await ok(page);
  assert.deepEqual(await last(saves, 7), [{ op: 'update', db: '학생(학원) DB', id: S1, props: { '요청': 'student-inquiry' } }]);
  await sel(page, 'students', S2); await press(page, '#view .panel .hf-swrow[aria-label="개인정보 동의"]');
  assert.match(await dlg(page), /개인정보 동의를 체크할까요\?/); await ok(page);
  assert.deepEqual(await last(saves, 8), [{ op: 'update', db: '학생(학원) DB', id: S2, props: { '개인정보 동의': true } }]);
  done.push('접수 안내 · 개인정보 동의');
  // 9) 저장 안 한 변경이 있는 줄은 보내지 않음(서버는 노션 값을 읽음)
  await page.evaluate((r) => { const e = DB.enrolls.find((x) => x.id === r); e.note = '고친 메모'; e.state = 'draft'; render(); }, E2);
  await sel(page, 'enrolls', E2, '현황'); await press(page, '#view .panel [data-ermore]'); await press(page, '#view .panel [data-act=enReissue]');
  assert.match(await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' ')), /먼저 \[저장\]/);
  assert.equal(await dlg(page), '', '확인 창 없음'); assert.equal(saves.length, 8, '보내지 않음');
  done.push('저장 안 한 줄');
  // 10) 등록 [종료 처리] → 확인 창(되돌릴 수 없음 · 종료일 · 서버 미리보기로 센 앞으로 수업 수) → 종료일 + 요청 = reg-end-cleanup 한 번에
  await sel(page, 'enrolls', E1, '정보');
  assert.equal(await page.evaluate(() => document.querySelector('#view .panel [data-act=end]').disabled), false, '[종료 처리] 켜짐');
  await page.evaluate(() => { TODAY = '2026-12-01'; });
  await press(page, '#view .panel [data-act=end]');
  await page.waitForFunction(() => /수업 3개에서 빠져요/.test(([...document.querySelectorAll('.modal')].pop() || {}).innerText || ''), null, { timeout: 5000 });
  assert.equal(previews[0].id, E1); assert.equal(previews[0].endDate, '2026-12-01', '종료일이 비면 오늘');
  assert.match(await dlg(page), /되돌리는 기능이 없어요/); assert.match(await dlg(page), /12월 2일부터 수업 3개에서 빠져요 \(12월 7일 ~ 12월 21일\)/);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'cc', '첫 초점은 [취소]');
  await page.screenshot({ path: shots + 'request-live-end.png' });
  //    종료일을 앞으로 당기면(지난 날) 지난 수업도 빠짐을 따로 알림 — 다시 셈
  await page.evaluate(() => { const m = [...document.querySelectorAll('.modal')].pop(); const inp = m.querySelector('#lqEndD input'); inp.value = '2026-11-15'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); inp.dispatchEvent(new Event('blur', { bubbles: true })); });
  await page.waitForFunction(() => /이미 지난 수업 1개/.test(([...document.querySelectorAll('.modal')].pop() || {}).innerText || ''), null, { timeout: 5000 });
  await page.screenshot({ path: shots + 'request-live-end-past.png' });
  assert.equal(previews[previews.length - 1].endDate, '2026-11-15');
  await ok(page);
  assert.deepEqual(await last(saves, 9), [{ op: 'update', db: '등록(학원) DB', id: E1, props: { '종료일': '2026-11-15', '요청': 'reg-end-cleanup' } }]);
  //    서버가 끝내면(요청 결과 = 앞으로 수업 n개에서 뺌) 알림
  await page.evaluate((r) => { const p = APP_RAW.raw['등록(학원) DB'].get(r).props; p['요청'] = '✅ 완료'; p['요청 결과'] = '✅ 완료 · 종료 처리 · 3.1초 · 12/1 10:00:00 · 종료일 2026-11-15 · 앞으로 수업 4개에서 뺌'; }, E1);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /종료 처리 완료/.test(t.textContent)), null, { timeout: 8000 });
  //    저장 안 한 변경이 있으면 확인 창 없이 막음
  await page.evaluate((r) => { const e = DB.enrolls.find((x) => x.id === r); e.note = '고친 메모'; e.state = 'draft'; render(); }, E2);
  await sel(page, 'enrolls', E2, '정보'); await press(page, '#view .panel [data-act=end]');
  assert.equal(await dlg(page), '', '확인 창 없음'); assert.equal(saves.length, 9, '보내지 않음');
  await noOverflow(page, '등록 창');
  assert.deepEqual(errors, []); done.push('종료 처리');
  console.log('노션 버튼 단추 통과:', done.join(', '));
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
