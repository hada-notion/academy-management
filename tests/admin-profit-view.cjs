// 결제 · 손익 화면(대표 261124 덧): ① [그래프] 탭은 그래프만(달별 표 없음, 그래프가 본문 폭을 씀)
// ② [결제 내역] 위 [＋ 결제 줄] 단추 · 안내 글 없음(넣기 창 finAct.pnew 코드는 남김) ③ [결제 내역] 머리 합계 = 그 달 전체 —
// [지출] · [매출] 필터 탭을 골라도 "매출 0원"처럼 바뀌지 않음(261124 통합 검수에서 찾음). 예시 화면 + 파일 검사(네트워크 없음).
// 사용: NODE_PATH=<playwright 있는 node_modules> node tests/admin-profit-view.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
(async () => {
  const bad = [];
  const finlive = fs.readFileSync(path.join(root, 'prototype/admin-app/finlive.js'), 'utf8');
  if (/finbar|＋ 결제 줄<\/button>/.test(finlive)) bad.push('finlive.js가 아직 [＋ 결제 줄] 단추 줄을 그림');
  if (!/pnew:\s*\(\)\s*=>\s*newPay\(\)/.test(finlive)) bad.push('결제 줄 넣기 창(finAct.pnew)이 사라짐 — 나중에 [+]에 붙일 코드');
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1200);
  // ① 그래프 탭
  const g = await p.evaluate(() => { openScreen('profit', false, {}); activeTab.state.sub = 'g'; render();
    const w = document.querySelector('#view .finwrap'), svg = w && w.querySelector('svg'), v = document.getElementById('view');
    return { wrap: !!w, tables: w ? w.querySelectorAll('table').length : -1, svgW: svg ? +svg.getAttribute('width') : 0, viewW: v.clientWidth }; });
  if (!g.wrap) bad.push('그래프 탭이 안 그려짐');
  if (g.tables !== 0) bad.push(`그래프 탭에 표 ${g.tables}개(그래프만이어야 함)`);
  if (!(g.svgW >= Math.min(1000, g.viewW - 100))) bad.push(`그래프 폭 ${g.svgW}px — 본문 ${g.viewW}px을 다 쓰지 않음`);
  // ② · ③ 결제 내역
  const c = await p.evaluate(() => { openScreen('profit', false, {}); activeTab.state.sub = 'c'; render();
    const L = LISTS.profit_c, ms = [...new Set(L.rows().map((x) => L.byMonth(x)))];
    const m = ms.find((mm) => { const xs = L.rows().filter((x) => L.byMonth(x) === mm); return xs.some((x) => x.kind === '매출') && xs.some((x) => x.kind === '지출'); }) || ms[0];
    activeTab.state.month = m; render();
    const all = L.rows().filter((x) => L.byMonth(x) === m), sum = (k) => WON(all.filter((x) => x.kind === k).reduce((a, x) => a + (+x.amount || 0), 0));
    const want = `매출 ${sum('매출')} · 지출 ${sum('지출')}`, notes = {};
    for (const ft of ['all', '지출', '매출']) { activeTab.state.ft = ft; render(); const n = document.querySelector('#view .pg-note'); notes[ft] = n ? n.textContent.trim() : null; }
    activeTab.state.ft = 'all'; render();
    const btns = [...document.querySelectorAll('#view button')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
    return { m, want, notes, bar: !!document.querySelector('#view .finbar'), plusRow: btns.some((t) => /결제 줄/.test(t) && /＋|\+/.test(t)), hint: /지출 · 청구서 결제 합계를 넣어요/.test(document.getElementById('view').textContent) }; });
  if (c.bar || c.plusRow || c.hint) bad.push('결제 내역에 [＋ 결제 줄] 단추나 안내 글이 보임');
  for (const [ft, t] of Object.entries(c.notes)) if (t !== c.want) bad.push(`결제 내역 ${c.m} 필터 ${ft} 머리 "${t}" — 기대 "${c.want}"(그 달 전체)`);
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log(`✅ 결제 · 손익 화면 통과 — 그래프 ${g.svgW}px · 표 0, 결제 내역 ${c.m} 머리 "${c.want}"(필터 셋 같음)`);
})();
