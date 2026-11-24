// 일정 색 = 노션 세부 구분 옵션 색(v2.8.0, 261125) — 예시 화면에서
// ① 색 표가 한 곳(EV_SUB_NC)이고 기본값이 원본 노션 색(할일 · 학원 쪽 초록, 학교 쪽 파랑)인지
// ② 일정 달력 칩 · 표 세부 구분 칩 · 홈 오늘 일정 알약 · 시험 달력 막대가 그 색을 쓰는지(옛 구분 색 0)
// ③ [보일 것] 견본을 눌러 색을 고치면 달력 칩이 바로 바뀌고, 새로 열어도 남으며, [기본 색으로]로 돌아오는지
// 를 확인한다(실제 계정 · 네트워크 없음, 1280 화면).
// 사용: NODE_PATH=<playwright 있는 node_modules> node tests/admin-schedule-color.cjs  (SHOT=<폴더>면 캡처 저장)
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
const NOTION = { '할일': 'green', '학원 휴원': 'green', '학원 행사': 'green', '상담': 'green', '테스트': 'green', '직원 회의': 'green', '학교 행사': 'blue', '시험': 'blue', '방학': 'blue', '학교 휴업': 'blue' };
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage();
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`;
  await p.goto(url); await p.waitForTimeout(1500);
  const shot = async (n) => { if (process.env.SHOT) { fs.mkdirSync(process.env.SHOT, { recursive: true }); await p.screenshot({ path: path.join(process.env.SHOT, n + '.png') }); } };
  // ① 색 표
  const tbl = await p.evaluate(() => ({ nc: Object.assign({}, EV_SUB_NC), nc0: Object.assign({}, EV_SUB_NC0), same: NCOL['events|sub'] === EV_SUB_NC, subs: Object.values(EV_SUBS).flat() }));
  if (JSON.stringify(tbl.nc0) !== JSON.stringify(NOTION)) bad.push('기본 색 표가 노션과 다름 ' + JSON.stringify(tbl.nc0));
  if (!tbl.same) bad.push('NCOL["events|sub"]가 EV_SUB_NC를 안 씀');
  if (tbl.subs.some((s) => !(s in tbl.nc0))) bad.push('색 표에 없는 세부 구분 있음');
  // ② 일정 달력 칩
  await p.evaluate(() => { openScreen('events'); activeTab.state.sub = 'c'; render(); }); await p.waitForTimeout(300);
  const cal = await p.evaluate(() => { const out = []; document.querySelectorAll('#view .evcal .evchip[data-evsel]').forEach((c) => { const e = DB.events.find((x) => x.id === c.dataset.evsel); const m = c.className.match(/evn-(\w+)/); out.push({ sub: evSubOf(e), cls: m && m[1], bg: getComputedStyle(c).backgroundColor }); }); return out; });
  if (!cal.length) bad.push('달력 칩 0개');
  cal.forEach((x) => { if (x.cls !== NOTION[x.sub]) bad.push(`달력 칩 ${x.sub} = ${x.cls}`); });
  const bgBy = {}; cal.forEach((x) => { (bgBy[x.cls] = bgBy[x.cls] || new Set()).add(x.bg); });
  Object.entries(bgBy).forEach(([c, s]) => { if (s.size > 1) bad.push(`${c} 칩 바탕이 여러 가지 ${[...s]}`); });
  await shot('1-calendar');
  // 표 세부 구분 칩
  await p.evaluate(() => { openScreen('events'); activeTab.state.sub = 'l'; render(); }); await p.waitForTimeout(300);
  const tchips = await p.evaluate(() => [...document.querySelectorAll('#view td .tchip')].map((c) => ({ t: c.textContent.trim(), cls: (c.className.match(/nc-(\w+)/) || [])[1] })).filter((x) => /할일|학원|상담|테스트|직원|학교|시험|방학/.test(x.t)));
  const tSub = tchips.filter((x) => x.t.replace(/^[^가-힣]+/, '') in NOTION);
  if (!tSub.length) bad.push('표 세부 구분 칩 0개');
  tSub.forEach((x) => { const s = x.t.replace(/^[^가-힣]+/, ''); if (x.cls !== NOTION[s]) bad.push(`표 칩 ${s} = ${x.cls}`); });
  await shot('2-table');
  // 홈 오늘 일정
  const home = await p.evaluate(() => { const d = TODAY; DB.events.push({ id: 'evT', name: '색 시험 일정', sub: '📝 시험', start: d, end: '', state: 'saved', classIds: [] }); openScreen('today'); render(); const el = document.querySelector('.hwr[data-tev="evT"] .rpill'); const c = el && (el.className.match(/nc-(\w+)/) || [])[1]; DB.events = DB.events.filter((x) => x.id !== 'evT'); return c; });
  if (home !== 'blue') bad.push('홈 오늘 일정 시험 알약 = ' + home);
  // 시험 달력 기간 막대
  await p.evaluate(() => { openScreen('exams'); activeTab.state.sub = 'c'; render(); }); await p.waitForTimeout(300);
  const ex = await p.evaluate(() => [...document.querySelectorAll('#view .evchip.exper, #view .evchip.evk-exsub')].map((c) => (c.className.match(/evn-(\w+)/) || [])[1]));
  if (ex.some((c) => c !== 'blue')) bad.push('시험 달력 색 ' + [...new Set(ex)]);
  // 옛 구분 색이 칩에 남았나
  const old = await p.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch (e) { return []; } }).filter((t) => /evk-(acad|todo|exam|event|vac|off)/.test(t)).length);
  if (old) bad.push('옛 갈래 색 규칙 ' + old + '개');
  // ③ 직접 고치기
  await p.evaluate(() => { openScreen('events'); activeTab.state.sub = 'c'; render(); }); await p.waitForTimeout(300);
  await p.click('#evEye'); await p.waitForTimeout(200);
  await shot('3-popup');
  await p.click('[data-evnc="학원 행사"]'); await p.waitForTimeout(200);
  await shot('4-edit');
  await p.click('[data-oec="yellow"]'); await p.click('#oeOk'); await p.waitForTimeout(300);
  const afterEdit = await p.evaluate(() => [...document.querySelectorAll('#view .evcal .evchip[data-evsel]')].filter((c) => evSubOf(DB.events.find((x) => x.id === c.dataset.evsel)) === '학원 행사').map((c) => (c.className.match(/evn-(\w+)/) || [])[1]));
  if (!afterEdit.length || afterEdit.some((c) => c !== 'yellow')) bad.push('고친 색이 달력에 안 나옴 ' + afterEdit);
  await p.reload(); await p.waitForTimeout(1500);
  const kept = await p.evaluate(() => EV_SUB_NC['학원 행사']);
  if (kept !== 'yellow') bad.push('새로 연 뒤 고친 색이 안 남음 ' + kept);
  await p.evaluate(() => evSubColorEdit('학원 행사')); await p.waitForTimeout(150); await p.click('#oeR'); await p.click('#oeOk'); await p.waitForTimeout(200);
  const back = await p.evaluate(() => [EV_SUB_NC['학원 행사'], localStorage.getItem('hada_proto_evSubNc')]);
  if (back[0] !== 'green' || back[1] !== '{}') bad.push('기본 색으로 안 돌아옴 ' + back);
  // 세부 구분 고르기 칸 옵션 ⋯ = 색 고치기(이름 · 삭제 없음)
  const opt = await p.evaluate(() => { const e = DB.events.find((x) => !x.del && evTopOf(x) !== '할일' && !evLockAny(x)); openScreen('events'); activeTab.state.sub = 'l'; activeTab.state.sel = e.id; activeTab.state.ltab = 'info'; panelOpen = true; render(); return e.id; });
  await p.waitForTimeout(300);
  const hf = await p.$('[data-hf="sub"] .hf-box');
  if (hf) { await hf.click(); await p.waitForTimeout(200); const ed = await p.$$('[data-edit]'); if (!ed.length) bad.push('세부 구분 옵션 ⋯ 없음'); else { await ed[0].click(); await p.waitForTimeout(200); const dlg = await p.evaluate(() => ({ h: (document.querySelector('#modalRoot h2') || {}).textContent || '', name: !!document.querySelector('#modalRoot #oeN'), del: !!document.querySelector('#modalRoot #oeDel') })); if (!/세부 구분 색/.test(dlg.h) || dlg.name || dlg.del) bad.push('옵션 ⋯ 창 ' + JSON.stringify(dlg)); await shot('5-option'); await p.click('#oeC'); } } else bad.push('세부 구분 고르기 칸 못 찾음 ' + opt);
  if (errs.length) bad.push('페이지 오류 ' + errs.join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.error('❌ 일정 색\n- ' + bad.join('\n- ')); process.exit(1); }
  console.log(`✅ 일정 색 = 노션 세부 구분 색 통과 — 달력 칩 ${cal.length} · 표 칩 ${tSub.length} · 시험 달력 ${ex.length} · 홈 · 직접 고치기(저장 · 기본 색으로) · 옵션 ⋯`);
})().catch((e) => { console.error(e); process.exit(1); });
