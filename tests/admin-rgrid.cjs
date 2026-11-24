// 관리 앱 반복 줄 칸(PANEL.rgrid, 관리앱-기준 5장 "반복 줄 칸") — 평소 = 정돈된 글, [ㅇㅇ 편집]으로만 입력칸.
// 예시 데이터(시제품 모드)만, 서버·네트워크 없음. PC 1280 · 1440.
// 확인: 시험 [성적] 평소 입력칸 0 · 머리줄과 줄의 열 위치 같음 · 정렬 왼쪽 통일 · 넘침 없음 → [성적 편집] 입력칸 · 열 위치 보기와 같음 ·
//       Enter = 아래 줄 같은 칸 · Esc = 편집 전 값 · [편집 완료] = 값 남고 작성 중 → 수업 창 평가 카드 정답 줄도 같은 부품(늘 편집 갈래).
// 사용: ROOT=<저장소 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-rgrid.cjs  (SHOTS=<폴더>면 캡처 저장)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..'), shots = process.env.SHOTS || '';
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const done = [];
  for (const W of [1280, 1440]) {
    const p = await b.newPage({ viewport: { width: W, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1200);
    const exId = await p.evaluate(() => { openScreen('exams'); activeTab.state.sub = ''; const x = DB.exams.find((e) => DB.grades.some((g) => g.examId === e.id && !g.del)); activeTab.state.sel = x.id; activeTab.state.ltab = 'gr'; panelOpen = true; render(); return x.id; });
    await p.waitForTimeout(250);
    // 열 위치: 칸마다 [왼쪽, 오른쪽] — 머리줄과 모든 줄이 같아야 함
    const cols = () => p.evaluate(() => [...document.querySelectorAll('#lp .rgrid .rgrow')].map((r) => [...r.children].map((c) => { const b = c.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; })));
    const over = () => p.evaluate(() => { const g = document.querySelector('#lp .rgrid'); return [...g.querySelectorAll('.rgrow > *')].filter((c) => c.getBoundingClientRect().right > g.getBoundingClientRect().right + 0.5).length; });
    // 1) 평소 = 글
    assert.equal(await p.locator('#lp .rgrid input, #lp .rgrid select').count(), 0, '평소 입력칸 0');
    assert.match(await p.textContent('#lp .rgrow.rgh'), /학생\s*점수\s*등수\s*백분율\s*등급/);
    const v = await cols(); v.forEach((r, i) => assert.deepEqual(r.slice(1), v[0].slice(1), `보기 ${i}줄 열 위치`));
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#lp .rgrow:not(.rgh) .rgc.num')).textAlign), 'left', '정렬 한쪽(왼쪽) 통일 — 대표 261124');
    assert.equal(await over(), 0, '보기 넘침 없음');
    assert.equal(await p.evaluate(() => document.querySelector('#lp .rgrow:not(.rgh)').getBoundingClientRect().height), 40, '줄 40');
    if (shots) await p.locator('#lp').screenshot({ path: path.join(shots, `rgrid-exam-view-${W}.png`) });
    // 2) [성적 편집] → 입력칸, 열 위치 그대로
    await p.click('#lp [data-rged]'); await p.waitForTimeout(150);
    const n = await p.locator('#lp .rgrid .rgi').count(), rows = await p.locator('#lp .rgrow:not(.rgh)').count();
    assert.equal(n, rows * 4, '줄마다 입력칸 4');
    assert.equal(await p.evaluate(() => document.activeElement.dataset.gf), 'score', '첫 칸에 커서');
    const e = await cols(); e.forEach((r, i) => assert.deepEqual(r.slice(1), v[0].slice(1), `편집 ${i}줄 열 위치 = 보기`));
    assert.equal(await over(), 0, '편집 넘침 없음');
    const g0 = await p.evaluate(() => { const g = exGr(DB.exams.find((x) => x.id === activeTab.state.sel))[0]; return { score: g.score, state: g.state }; });
    await p.keyboard.type('7'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    assert.deepEqual(await p.evaluate(() => [document.activeElement.dataset.gf, [...document.querySelectorAll('#lp .rgrow:not(.rgh)')].indexOf(document.activeElement.closest('.rgrow'))]), ['score', 1], 'Enter = 아래 줄 같은 칸');
    if (shots) await p.locator('#lp').screenshot({ path: path.join(shots, `rgrid-exam-edit-${W}.png`) });
    // 3) Esc = 편집 전 값
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    assert.equal(await p.locator('#lp .rgrid .rgi').count(), 0, 'Esc 뒤 입력칸 닫힘');
    assert.deepEqual(await p.evaluate(() => { const g = exGr(DB.exams.find((x) => x.id === activeTab.state.sel))[0]; return { score: g.score, state: g.state }; }), g0, 'Esc = 편집 전 값');
    assert.ok(await p.evaluate(() => !!document.querySelector('#lp')), 'Esc로 창은 안 닫힘');
    // 4) [편집 완료] = 값 남고 작성 중
    await p.click('#lp [data-rged]'); await p.waitForTimeout(100);
    await p.fill('#lp .rgrow:not(.rgh) [data-gf=rank]', '5'); await p.selectOption('#lp .rgrow:not(.rgh) select[data-gf=level]', '2등급');
    await p.click('#lp [data-rgok]'); await p.waitForTimeout(150);
    assert.equal(await p.locator('#lp .rgrid .rgi').count(), 0, '편집 완료 뒤 글');
    assert.match(await p.textContent('#lp .rgrow:not(.rgh)'), /5\/\d+.*2등급/, '고친 값이 글로');
    assert.equal(await p.locator('#lp .rgrow.draft').count(), 1, '고친 줄 노란 띠');
    // 5) 수업 창 평가 카드 — 정답 줄도 같은 부품(늘 편집)
    await p.evaluate(() => { const r = DB.recs.find((z) => z.kind === '평가' && !z.del); const it = document.querySelector('.it[data-scr="lesson"]'); if (it) it.click(); const st = activeTab.state; st.lsel = r.key; st.ltab = 'log'; st.recOpen = r.id; render(); });
    await p.waitForTimeout(300);
    assert.ok(await p.locator('.reccard.open .rgrid.ed').count() === 1, '평가 카드 = 반복 줄 칸');
    assert.match(await p.textContent('.reccard.open .rgrow.rgh'), /학생\s*정답\s*전체\s*점수/);
    const c = await p.evaluate(() => [...document.querySelectorAll('.reccard.open .rgrow')].map((r) => [...r.children].slice(1).map((x) => Math.round(x.getBoundingClientRect().left))));
    c.forEach((r) => assert.deepEqual(r, c[0], '평가 열 위치'));
    assert.equal(await p.evaluate(() => [...document.querySelectorAll('.reccard.open .rgrow > *')].filter((x) => x.scrollWidth > x.clientWidth + 1 && !x.matches('input')).length), 0, '평가 글자 잘림 없음');
    if (shots) await p.locator('.reccard.open').screenshot({ path: path.join(shots, `rgrid-rec-${W}.png`) });
    assert.deepEqual(errs, [], '페이지 오류 없음');
    done.push(`${W} 성적 보기·편집·Enter·Esc·완료 · 평가 카드`); await p.close();
  }
  await b.close(); server.close();
  console.log('통과: ' + done.join(' / '));
})().catch((e) => { console.error(e); process.exit(1); });
