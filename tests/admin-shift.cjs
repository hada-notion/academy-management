// 관리 앱 흔들림(261124 대표 "고정되어 있어야 하는 것들이 움직이거나 튀거나") — 예시 데이터만, 서버·네트워크 없음.
// 확인: ① 창 안을 스크롤해도 창 탭이 창 머리 바로 아래에 붙어 있음
//       ② 다시 그려도(자동 갱신과 같음) 창 스크롤이 그대로 — 클래스 [시간표] 탭처럼 다음 프레임에 자라는 창
//       ③ 1280 폭에서 다시 그려도 위 줄이 흔들리지 않음(layout-shift 0)
//       ④ 결제 · 손익 달 이동 ‹ › 단추가 달마다 제자리
//       ⑤ 확대 · 축소 단추로 시간표 · 오늘 수업의 가운데 시각이 그대로(30분 안)
//       ⑥ 수업 화면 위 줄 높이가 보기(오늘 · 주간 · 월간 · 등원 학생 · 출결 현황)마다 같음  ⑦ 처음 줄을 눌러도 창 머리 높이 그대로
// 사용: ROOT=<저장소 폴더> NODE_PATH=<playwright 있는 node_modules> node tests/admin-shift.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const bad = [], errs = [];
  const open = async (w) => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1500); return p; };
  const go = (p, s, st) => p.evaluate(([s, st]) => { document.querySelector(`.it[data-scr="${s}"]`).click(); if (st) { Object.assign(activeTab.state, st); render(); } }, [s, st]).then(() => p.waitForTimeout(500));
  let p = await open(1440);
  // ① · ②
  await go(p, 'classes'); await p.evaluate(() => document.querySelectorAll('#view tr[data-id]')[1].querySelector('td').click()); await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => { const pn = document.querySelector('#lp'); pn.scrollTop = 300; const h = pn.querySelector('.phead').getBoundingClientRect(), t = pn.querySelector('.ptabs').getBoundingClientRect(); return [Math.round(h.bottom), Math.round(t.top)]; });
  if (Math.abs(t1[0] - t1[1]) > 1) bad.push(`① 창 탭이 머리 아래에 안 붙음(머리 아래 ${t1[0]}, 탭 ${t1[1]})`);
  await p.evaluate(() => { const pn = document.querySelector('#lp'); pn.scrollTop = 0; document.querySelectorAll('#lp .ptabs button')[1].click(); }); await p.waitForTimeout(400);
  const t2 = await p.evaluate(() => new Promise((res) => { const pn = document.querySelector('#lp'); pn.scrollTop = pn.scrollHeight; const want = pn.scrollTop; render(); setTimeout(() => res([want, document.querySelector('#lp').scrollTop]), 300); }));
  if (t2[0] < 40) bad.push('② 창이 짧아 스크롤 확인 못 함 ' + t2);
  else if (Math.abs(t2[0] - t2[1]) > 2) bad.push(`② 다시 그리니 창 스크롤이 ${t2[0]} → ${t2[1]}`);
  // ④
  await go(p, 'profit'); const xs = new Set();
  for (let i = 0; i < 4; i++) { const r = await p.evaluate(() => { const e = [...document.querySelectorAll('#view .ttl button')].find((x) => x.offsetParent && /다음/.test(x.title || '')); const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }); xs.add(r.join(',')); await p.mouse.click(r[0] + 6, r[1] + 6); await p.waitForTimeout(250); }
  if (xs.size > 1) bad.push('④ 달 이동 단추가 움직임 ' + [...xs].join(' / '));
  // ⑤
  const center = () => p.evaluate(() => { const sc = document.querySelector('#view #scroll, #view #ldsc'); const r = sc.getBoundingClientRect(); const cy = r.top + r.height / 2; const m = new Map(); [...sc.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\d{1,2}:00$/.test(e.textContent.trim()) && e.offsetParent).forEach((e) => { const h = +e.textContent.trim().split(':')[0] * 60; if (!m.has(h)) m.set(h, e.getBoundingClientRect().top); }); const L = [...m.entries()].sort((a, c) => a[0] - c[0]); const k = (L[L.length - 1][1] - L[0][1]) / (L[L.length - 1][0] - L[0][0]); return Math.round(L[0][0] + (cy - L[0][1]) / k); });
  for (const [n, s, st] of [['시간표', 'timetable', null], ['오늘 수업', 'lesson', { lv: 'today', day: null }]]) {
    await go(p, s, st); const c0 = await center(); await p.locator('#view #zIn').click(); await p.waitForTimeout(350); const c1 = await center(); await p.locator('#view #zOut').click(); await p.waitForTimeout(350); const c2 = await center();
    if (Math.abs(c1 - c0) > 30 || Math.abs(c2 - c0) > 30) bad.push(`⑤ ${n} 확대하니 가운데 시각이 ${c0} → ${c1} → ${c2}분`);
  }
  // ⑦ 창 머리 높이: 고르기 전 현황 창 → 줄을 고른 창에서 그대로(창 탭이 내려가지 않음)
  for (const s of ['students', 'classes', 'teachers']) {
    await go(p, s); const h0 = await p.evaluate(() => { activeTab.state.sel = null; panelOpen = true; render(); const h = document.querySelector('#lp .phead'); return h && Math.round(h.getBoundingClientRect().height); });
    await p.evaluate(() => document.querySelector('#view tr[data-id] td').click()); await p.waitForTimeout(400);
    const h1 = await p.evaluate(() => { const h = document.querySelector('#lp .phead'); return h && Math.round(h.getBoundingClientRect().height); });
    if (h0 !== h1) bad.push(`⑦ ${s} 처음 누르니 창 머리 ${h0} → ${h1}`);
    await p.keyboard.press('Escape');
  }
  await p.close();
  // ⑥ 수업 화면 위 줄 높이가 보기마다 같음(1280 · 1440)
  for (const w of [1280, 1440]) {
    const q = await open(w); await go(q, 'lesson'); const hs = [];
    for (const lv of ['today', 'wk', 'mon', 'att', 'atm']) { await q.evaluate((lv) => { activeTab.state.lv = lv; render(); }, lv); await q.waitForTimeout(300); hs.push(await q.evaluate(() => Math.round(document.querySelector('#view > .top').getBoundingClientRect().height))); }
    if (new Set(hs).size > 1) bad.push(`⑥ ${w} 수업 위 줄 높이가 보기마다 다름 ${hs.join(' / ')}`);
    await q.close();
  }
  // ③
  p = await open(1280);
  for (const s of ['timetable', 'tuition']) {
    await go(p, s); await p.mouse.move(5, 890);
    const cls = await p.evaluate(() => new Promise((res) => { let v = 0; const o = new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) v += e.value; })); o.observe({ type: 'layout-shift' }); render(); setTimeout(() => { render(); setTimeout(() => { o.disconnect(); res(v); }, 400); }, 300); }));
    if (cls > 0.0005) bad.push(`③ ${s} 1280에서 다시 그리면 위 줄이 흔들림(CLS ${cls.toFixed(4)})`);
  }
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log('✅ 흔들림 통과(창 탭 고정 · 창 스크롤 유지 · 1280 위 줄 · 달 이동 단추 · 확대 가운데)');
})();
