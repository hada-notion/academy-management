// 간격 기준(관리앱-기준.md "간격 다섯" 블록 ↔ 블록 12)을 예시 자료에 없는 두 자리에서 확인한다(261124 통합 검수에서 실자료로 찾음).
// ① 수업 창 [루틴] 탭 빈 상태: 안내 칸(.rtempty) ↔ [클래스 루틴으로 이동] — 22px이었음(안내 칸 아래 여백 10 + 구역 12)
// ② 직원 창 [앱 계정] 탭: 아이디 표(.lt-kv) ↔ 단추 줄(.lt-row) — 8px이었음(두 칸의 위아래 여백 8이 구역 12를 덮음)
// 실제 화면과 같은 CSS(app.css · liveteacher.js가 넣는 style)로 같은 마크업을 창 구역 안에 그려 잰다(네트워크 없음).
// 사용: NODE_PATH=<playwright 있는 node_modules> node tests/admin-gap-live-spots.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ROOT || path.resolve(__dirname, '..');
(async () => {
  const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.end(fs.readFileSync(f)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [], bad = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}/prototype/admin-app/hada-admin.html`); await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const host = document.createElement('div'); host.className = 'panel'; host.style.cssText = 'position:fixed;left:0;top:0;width:420px;z-index:99999;background:#fff';
    host.innerHTML = '<div class="pbody">'
      + '<div class="box" id="g1"><div class="rtempty"><b>이 클래스에 루틴이 없어요</b><br>클래스 창 [루틴] 탭에서 넣어요</div><button type="button" class="btn lpgo2">클래스 루틴으로 이동</button></div>'
      + '<div class="box lt-acct" id="g2"><h3>관리 앱 계정 <span class="tag">꺼짐</span></h3><p class="hint">설명</p><dl class="lt-kv"><dt>아이디</dt><dd>010-0000-0000</dd></dl><div class="lt-row"><button class="btn pri">앱 계정 켜기</button></div><p class="hint">끝 안내</p></div>'
      + '</div>';
    document.body.appendChild(host);
    const R = (s) => document.querySelector(s).getBoundingClientRect();
    const gap = (a, c) => Math.round(R(c).top - R(a).bottom);
    const kvGrid = getComputedStyle(document.querySelector('#g2 .lt-kv')).display;
    const out = { kvGrid, rt: gap('#g1 .rtempty', '#g1 .lpgo2'), hintKv: gap('#g2 > p.hint', '#g2 .lt-kv'), kvRow: gap('#g2 .lt-kv', '#g2 .lt-row'), rowHint: gap('#g2 .lt-row', '#g2 .lt-row + p.hint') };
    host.remove(); return out;
  });
  if (r.kvGrid !== 'grid') bad.push('직원 [앱 계정] CSS(liveteacher.js)가 안 실림 — 잴 수 없음');
  for (const [k, n] of [['수업 [루틴] 빈 안내 ↔ 단추', r.rt], ['[앱 계정] 설명 ↔ 아이디 표', r.hintKv], ['[앱 계정] 아이디 표 ↔ 단추 줄', r.kvRow], ['[앱 계정] 단추 줄 ↔ 끝 안내', r.rowHint]]) if (n !== 12) bad.push(`${k} = ${n}px (기준 12)`);
  if (errs.length) bad.push('페이지 오류: ' + errs.slice(0, 3).join(' / '));
  await b.close(); server.close();
  if (bad.length) { console.log('❌ ' + bad.join('\n❌ ')); process.exit(1); }
  console.log('✅ 실자료 간격 두 자리 12px 통과 ' + JSON.stringify(r));
})();
