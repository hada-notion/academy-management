// 관리 앱 교재 단원 수 — 노션 단원목록 관계가 25개를 넘어 사본이 id 목록을 비우고 "단원목록#more"만 세운 교재(항목 169).
// 가짜 서버로만(?live=1). 그 교재는 할 일 "단원 없음"에 안 나오고 표 [단원] 칸은 "25개 넘음". 진짜 단원이 없는 교재는 그대로 "단원 없음".
// 사용: NODE_PATH=<hada-ui-tests>/node_modules ROOT=<저장소 폴더> node tests/admin-unit-count-more.cjs
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = process.env.ROOT || path.resolve(__dirname, '..');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
const H = 'https://twczhsxybkcvjkdfdxvs.supabase.co/functions/v1/';
const row = (id, name, extra) => ({ id, props: Object.assign({ '교재명': name, '구분': '교재', '전체 분량': 200, '진도 단위': 'P.-', '가격': 15000, '사용중': true }, extra) });
const ROWS = [
	row('11111111-1111-4111-8111-111111111111', '예시 많은 단원', { '단원목록': [], '단원목록#more': true }),
	row('22222222-2222-4222-8222-222222222222', '예시 단원 없음', { '단원목록': [] }),
	row('33333333-3333-4333-8333-333333333333', '예시 단원 3개', { '단원목록': ['a', 'b', 'c'] }),
];
(async () => {
	const server = http.createServer((req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8'); fs.createReadStream(f).pipe(res); });
	await new Promise((r) => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
	const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.addInitScript(() => { try { sessionStorage.setItem('hada_admin_browser_session_v1', 'sess-1'); } catch (_) {} });
	const reply = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) });
	await page.route(H + '**', async (route) => {
		const req = route.request(); if (req.method() === 'OPTIONS') return reply(route, {});
		const fn = req.url().slice(H.length).split('?')[0], q = req.postDataJSON() || {};
		if (fn === 'app-api') {
			if (q.action === 'list') return reply(route, { ok: true, db: q.db, at: new Date().toISOString(), rows: q.db === '라이브러리(학원) DB' ? ROWS : [] });
			if (q.action === 'options') return reply(route, { ok: true, dbs: {} });
			if (q.action === 'status') return reply(route, { ok: true, dbs: [], syncedAt: null, rootTitle: '하다 학원관리 v2.0' });
			return reply(route, { ok: true });
		}
		return reply(route, { ok: true, rows: [], items: [] });
	});
	await page.goto(`${origin}/prototype/admin-app/hada-admin.html?live=1`);
	await page.waitForFunction(() => window.LIVE && window.LIVE.loaded, null, { timeout: 30000 });
	await page.evaluate(() => openScreen('books'));
	const r = await page.evaluate(() => {
		const L = DB.books, by = (n) => L.find((x) => x.name === n);
		const todo = LISTS.books.todo().find((t) => t.k === 'unit');
		const colF = LISTS.books_b.cols.find((c) => c[0] === '단원')[1];
		const noneF = (b) => !bkUnitN(b);
		return { todo: todo.rows.map((x) => x.name), cell: L.map((x) => [x.name, colF(x)]), none: L.filter(noneF).map((x) => x.name) };
	});
	assert.deepEqual(r.todo, ['예시 단원 없음'], '단원목록 [] + #more 인 교재는 할 일 "단원 없음"에서 빠짐');
	assert.deepEqual(r.none, ['예시 단원 없음'], '표 필터 "단원 없음"도 같음');
	assert.deepEqual(Object.fromEntries(r.cell), { '예시 많은 단원': '25개 넘음', '예시 단원 없음': '—', '예시 단원 3개': '3개' });
	assert.deepEqual(errors, []);
	console.log('교재 단원 수(25개 넘음) 통과');
	await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
