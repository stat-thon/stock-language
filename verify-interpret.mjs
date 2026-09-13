import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const root = new URL('.', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
assert(html.includes('window.InterpretLab'), '먼저 npm run build로 글 해석하기 탭을 빌드해 주세요.');
const BRIDGE = 'http://127.0.0.1:8767';
const TOKEN = 'test-interpret-token-0123456789';
const KEY = 'sentence-beyond.study.v1';
const SESSION = 'sentence-beyond.interpret.session.v1';
const seed = { version: 1, stocks: [], cases: [], savedCases: [], savedTerms: ['hbm'], completed: [], review: [{ id: 'hbm', status: 'known', at: '가상 검증일' }] };
const sample = '학습용 가상 문장: PER는 16.7배이고 EPS와 FCF를 함께 비교합니다.';
const answer = '## 쉬운 해석\n가상 EPS와 FCF를 비교합니다.\n<img src=x onerror="window.__interpretXSS=1">\n<script>window.__interpretXSS=2</script>\n숫자의 시점과 근거를 확인하세요.';
let state, requests = [], closedStreams = 0;
const errors = [], outbound = [], failures = [];
let passed = 0;
const filter = process.env.STUDY_INTERPRET_FILTER ? new RegExp(process.env.STUDY_INTERPRET_FILTER) : null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
function reset(overrides = {}) { state = { mode: 'success', authenticated: true, busy: false, http: 200, code: '', ...overrides }; requests = []; closedStreams = 0; }
reset();

// A private mock server sends actual HTTP chunks. No live bridge or Codex request is made.
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  requests.push({ path: url.pathname, method: req.method, authorization: req.headers.authorization, body: null });
  const logged = requests.at(-1);
  const json = (value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/health') { json({ ok: true, version: 1 }); return; }
  if (url.pathname === '/api/session') { json({ token: TOKEN }); return; }
  if (url.pathname === '/api/status') {
    if (state.statusHttp) { json({ code: 'unauthorized', message: '검증용 연결 만료' }, state.statusHttp); return; }
    json({ authenticated: state.authenticated, authMode: state.authenticated ? 'chatgpt' : 'none', busy: state.busy }); return;
  }
  if (url.pathname === '/pair') {
    const origin = JSON.stringify(url.searchParams.get('origin')).replace(/</g, '\\u003c');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<button id="approve">검증용 연결 승인</button><script>document.querySelector('#approve').onclick=()=>opener.postMessage({type:'stock-language-paired',token:'${TOKEN}'},${origin});</script>`); return;
  }
  if (url.pathname !== '/api/analyze') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
  const chunks = []; for await (const part of req) chunks.push(part);
  try { logged.body = JSON.parse(Buffer.concat(chunks).toString()); } catch { json({ code: 'invalid_input' }, 400); return; }
  const current = { ...state };
  if (current.http !== 200) { json({ code: current.code, message: current.message || `검증용 오류 ${current.http}` }, current.http); return; }
  if (current.mode === 'content-type') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('unexpected'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  res.on('close', () => { if (!res.writableEnded) closedStreams++; });
  const write = value => { if (!res.destroyed && !res.writableEnded) res.write(value); };
  try {
    write(': a comment\r\n\r\n');
    write(frame({ type: 'status', text: '검증용 문장을 읽고 있어요' }));
    if (current.mode === 'cancel' || current.mode === 'timeout') {
      write(frame({ type: 'delta', text: '먼저 도착한 일부 결과입니다.' }));
      // Keep the response open until the browser cancels; avoid persistent timers.
      return;
    }
    if (current.mode === 'bad-json') { write('data: {broken}\n\n'); res.end(); return; }
    const first = answer.slice(0, 15), rest = answer.slice(15);
    const payload = Buffer.from(frame({ type: 'delta', text: first }) + frame({ type: 'delta', text: rest }));
    // One-byte writes split Korean UTF-8 bytes, JSON frames and CRLF delimiters.
    for (let i = 0; i < payload.length; i++) { write(payload.subarray(i, i + 1)); if (i % 5 === 0) await pause(2); }
    if (current.mode === 'error') write(frame({ type: 'error', code: current.code || 'usage_limit', message: current.message || '검증용 사용 한도 안내' }));
    else if (current.mode !== 'eof') { await pause(80); write(frame({ type: 'done' })); }
    res.end();
  } catch { res.destroy(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.STUDY_CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function contextFor({ clipboard = 'success', savedToken = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(/^https?:/, route => {
    const url = route.request().url();
    if (url.startsWith(BRIDGE + '/')) return route.continue({ url: ORIGIN + url.slice(BRIDGE.length) });
    if (url.startsWith(ORIGIN + '/')) return route.continue();
    outbound.push(url); return route.abort();
  });
  await context.addInitScript(({ KEY, seed, SESSION, BRIDGE, TOKEN, clipboard, savedToken }) => {
    if (!localStorage.getItem(KEY)) { localStorage.setItem(KEY, JSON.stringify(seed)); localStorage.setItem('unrelated-personal-note', '이 기록은 변경하지 않습니다.'); }
    if (savedToken && !sessionStorage.getItem(SESSION)) sessionStorage.setItem(SESSION, JSON.stringify({ bridge: BRIDGE, token: TOKEN }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (clipboard === 'fail') throw new Error('blocked'); window.__copiedInterpretation = text; } } });
  }, { KEY, seed, SESSION, BRIDGE, TOKEN, clipboard, savedToken });
  const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
async function openLocal(page) { await page.goto(BRIDGE + '/#interpret'); await expect(page.locator('#interpret-connection-status')).toHaveText('이 Mac의 Codex와 연결됨'); }
async function input(page) { await page.locator('#interpret-text').fill(sample); }
async function start(page) { await input(page); await page.locator('[data-interpret-action="analyze"]').click(); }
async function preserve(page) {
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY), seed);
  assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-personal-note')), '이 기록은 변경하지 않습니다.');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), SESSION), null);
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage }))).includes(TOKEN), '연결 토큰이 localStorage에 저장됨');
}
async function check(name, test) {
  if (filter && !filter.test(name)) return;
  reset(); let fixture;
  try { fixture = await contextFor(); await test(fixture.page, fixture.context); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push({ name, message: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  finally { await fixture?.context.close(); }
}

try {
  await check('공개 화면 자동 연결 없음·본문/링크 검증·가상 예시', async page => {
    await page.goto(ORIGIN + '/#interpret'); await expect(page.locator('#interpret-page')).toBeVisible();
    await page.waitForTimeout(120); assert.equal(requests.filter(r => r.path.startsWith('/api') || r.path === '/health').length, 0);
    await page.locator('#interpret-source').fill('https://example.com/post'); await page.locator('[data-interpret-action="analyze"]').click();
    await expect(page.locator('#interpret-message')).toContainText('본문을 붙여넣어 주세요');
    await page.locator('#interpret-text').fill('https://example.com/post'); await page.locator('[data-interpret-action="analyze"]').click();
    await expect(page.locator('#interpret-text')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-interpret-action="example"]').click(); await expect(page.locator('#interpret-text')).toHaveValue(/학습용 가상/);
    await page.locator('#interpret-source').fill('javascript:alert(1)'); await page.locator('[data-interpret-action="analyze"]').click();
    await expect(page.locator('#interpret-source')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#interpret-source').fill('https://name:pass@example.com'); await page.locator('[data-interpret-action="analyze"]').click();
    await expect(page.locator('#interpret-source')).toHaveAttribute('aria-invalid', 'true');
    await page.locator('#interpret-source').fill(''); await page.locator('#interpret-text').evaluate(node => { node.value = '가'.repeat(12001); });
    await page.locator('[data-interpret-action="analyze"]').click(); await expect(page.locator('#interpret-message')).toContainText('12,000자');
    assert.equal(requests.filter(r => r.path === '/api/analyze').length, 0); await preserve(page);
  });
  await check('공개 화면 연결 승인·origin/source 검증·세션 저장·연결 해제', async (page, context) => {
    await page.goto(ORIGIN + '/#interpret');
    await page.evaluate(() => { const open = window.open.bind(window); window.open = (...args) => { window.__lastPairPopup = open(...args); return window.__lastPairPopup; }; });
    const popupPromise = context.waitForEvent('page'); await page.locator('[data-interpret-action="connect"]').click(); const popup = await popupPromise;
    await popup.waitForLoadState();
    await page.evaluate(({ BRIDGE }) => {
      dispatchEvent(new MessageEvent('message', { origin: 'https://wrong.example', source: window.__lastPairPopup, data: { type: 'stock-language-paired', token: 'forged-token' } }));
      dispatchEvent(new MessageEvent('message', { origin: BRIDGE, source: window, data: { type: 'stock-language-paired', token: 'forged-token' } }));
    }, { BRIDGE });
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
    assert.equal(requests.filter(r => r.path === '/api/status').length, 0);
    await popup.locator('#approve').click(); await expect(page.locator('#interpret-connection-status')).toHaveText('이 Mac의 Codex와 연결됨');
    assert.equal(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), SESSION)).token, TOKEN);
    assert.equal(requests.filter(r => r.path === '/api/session').length, 0, '공개 화면이 로컬 자동 세션에 접근함');
    assert(requests.some(r => r.path === '/api/status' && r.authorization === `Bearer ${TOKEN}`));
    await preserve(page);
    await page.reload(); await expect(page.locator('#interpret-connection-status')).toContainText('연결 확인을 눌러');
    const before = requests.filter(r => r.path.startsWith('/api') || r.path === '/health').length; await page.waitForTimeout(100);
    assert.equal(requests.filter(r => r.path.startsWith('/api') || r.path === '/health').length, before);
    await page.locator('[data-interpret-action="disconnect"]').click(); assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
  });
  await check('로컬 자동 세션·실제 HTTP 스트림 경계·완료·안전 출력·복사', async page => {
    await openLocal(page); assert(requests.some(r => r.path === '/api/session'));
    await input(page); await page.locator('#interpret-source').fill('https://example.com/actual-source'); await page.locator('[data-interpret-action="analyze"]').click();
    await expect(page.locator('[data-interpret-action="analyze"]')).toBeDisabled();
    await page.locator('form.interpret-input-panel').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await expect(page.locator('#interpret-result')).toContainText('가상 EPS');
    await expect(page.locator('#interpret-status')).toContainText('해석 완료');
    assert.equal(await page.locator('#interpret-result').textContent(), answer);
    assert.equal(await page.locator('#interpret-result img,#interpret-result script').count(), 0); assert.equal(await page.evaluate(() => window.__interpretXSS), undefined);
    const request = requests.filter(r => r.path === '/api/analyze'); assert.equal(request.length, 1); assert.deepEqual(request[0].body, { text: sample, sourceUrl: 'https://example.com/actual-source' });
    assert.equal(request[0].authorization, `Bearer ${TOKEN}`);
    await page.locator('[data-interpret-action="copy"]').click(); assert((await page.evaluate(() => window.__copiedInterpretation)).includes(answer));
    await expect(page.locator('.interpret-copy-feedback')).toContainText('복사했어요'); await preserve(page);
  });
  await check('사용자 중지·부분 결과·중복 요청 차단·재시도', async page => {
    state.mode = 'cancel'; await openLocal(page); await start(page); await expect(page.locator('#interpret-result')).toContainText('일부 결과');
    await page.locator('[data-interpret-action="stop"]').click(); await expect(page.locator('#interpret-status')).toContainText('중지됨');
    await expect(page.locator('[data-interpret-action="analyze"]')).toBeEnabled(); await expect.poll(() => closedStreams).toBeGreaterThan(0);
    await page.locator('[data-interpret-action="copy"]').click(); assert((await page.evaluate(() => window.__copiedInterpretation)).includes('완료되지 않은 일부 결과'));
    state.mode = 'success'; await page.locator('[data-interpret-action="analyze"]').click(); await expect(page.locator('#interpret-status')).toContainText('해석 완료');
    assert.equal(await page.locator('#interpret-result').textContent(), answer); await preserve(page);
  });
  await check('120초 제한은 사용자 중지와 구분', async page => {
    state.mode = 'timeout'; await openLocal(page); await page.clock.install(); await start(page); await expect(page.locator('#interpret-result')).toContainText('일부 결과');
    await page.clock.fastForward(120001); await expect(page.locator('#interpret-status')).toContainText('시간 초과');
    await expect(page.locator('#interpret-message')).toContainText('2분'); await expect(page.locator('[data-interpret-action="analyze"]')).toBeEnabled();
  });
  await check('완료 신호 누락·SSE 오류·잘못된 형식', async page => {
    await openLocal(page);
    for (const mode of ['eof', 'error', 'bad-json', 'content-type']) {
      state.mode = mode; await start(page); await expect(page.locator('#interpret-status')).toHaveText(/완료되지 않음|완료하지 못했어요/);
      await expect(page.locator('#interpret-message')).toBeVisible(); assert(!await page.locator('#interpret-status').textContent().then(t => t.includes('해석 완료')));
      if (mode === 'eof') await expect(page.locator('#interpret-message')).toContainText('완료 신호');
      if (mode === 'error') await expect(page.locator('#interpret-message')).toContainText('Codex 사용 한도');
    }
  });
  await check('HTTP 오류 구분·만료 재연결·다른 작업 진행 상태', async page => {
    await openLocal(page);
    for (const [http, code, message] of [[400, 'invalid_input', '입력'], [401, 'unauthorized', '다시 연결'], [409, 'busy', '다른 해석'], [429, 'rate_limited', '요청이 잠시 제한'], [503, 'unavailable', '분석 도구']]) {
      state.http = http; state.code = code; await start(page); await expect(page.locator('#interpret-message')).toContainText(message);
      if (http === 429) assert(!(await page.locator('#interpret-message').textContent()).includes('Codex 사용 한도'));
      if (http === 401) assert.equal(await page.evaluate(key => sessionStorage.getItem(key), SESSION), null);
      state.http = 200; await page.locator('[data-interpret-action="connect"]').click(); await expect(page.locator('#interpret-connection-status')).toHaveText('이 Mac의 Codex와 연결됨');
    }
    state.busy = true; await page.locator('[data-interpret-action="connect"]').click(); await expect(page.locator('#interpret-connection-status')).toContainText('다른 해석 진행 중');
    const before = requests.filter(r => r.path === '/api/analyze').length; await start(page); assert.equal(requests.filter(r => r.path === '/api/analyze').length, before);
    state.busy = false; state.authenticated = false; await page.locator('[data-interpret-action="connect"]').click(); await expect(page.locator('#interpret-connection-status')).toContainText('로그인 필요');
    await preserve(page);
  });
  await check('복사 실패의 직접 복사·입력과 결과 자동 저장 없음', async (page, context) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } }));
    await openLocal(page); await start(page); await expect(page.locator('#interpret-status')).toContainText('해석 완료');
    await page.locator('[data-interpret-action="copy"]').click(); await expect(page.locator('#interpret-copy-fallback')).toBeVisible();
    await expect(page.locator('#interpret-copy-text')).toHaveValue(new RegExp('가상 EPS'));
    await preserve(page); await page.reload(); await expect(page.locator('#interpret-text')).toHaveValue(''); await expect(page.locator('#interpret-result')).toBeEmpty();
    assert.equal(context.pages().length, 1);
  });
  await check('모바일 320~1440px·5개 메뉴·탭 왕복 입력 유지', async page => {
    await page.goto(ORIGIN + '/#interpret'); await input(page);
    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 가로 넘침`);
      for (const id of ['read', 'glossary', 'analysis', 'notebook', 'interpret']) {
        await page.locator(`.masthead [data-page="${id}"]`).click(); await expect(page.locator(`#${id}-page`)).toBeVisible();
      }
      await expect(page.locator('#interpret-text')).toHaveValue(sample);
      await expect(page.locator('.masthead [data-page="interpret"]')).toHaveAttribute('aria-current', 'page');
    }
    await preserve(page);
  });
  await check('팝업 차단·로컬 연결 실패·파일 화면 대체 링크', async page => {
    await page.goto(ORIGIN + '/#interpret'); await page.evaluate(() => { window.open = () => null; });
    await page.locator('[data-interpret-action="connect"]').click(); await expect(page.locator('#interpret-message')).toContainText('팝업이 차단');
    await page.route(BRIDGE + '/health', route => route.abort()); await page.goto(BRIDGE + '/#interpret');
    await expect(page.locator('#interpret-message')).toContainText('연결하지 못했어요');
    await expect(page.locator('a[href="http://127.0.0.1:8767/#interpret"]')).toHaveText('Mac에서 열기 ↗');
    await page.goto(new URL('index.html', root).href + '#interpret'); await page.locator('[data-interpret-action="connect"]').click();
    await expect(page.locator('#interpret-message')).toContainText('파일로 연 화면');
  });
  assert.equal(outbound.length, 0, `의도하지 않은 외부 요청: ${outbound.join(', ')}`);
  assert.equal(errors.length, 0, `브라우저 오류: ${errors.join(', ')}`);
  if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
  else console.log(`PASS 글 해석 UI 완료: ${passed}개 검증 묶음 · 실제 분할 HTTP 스트림 · 외부 요청 0 · 브라우저 오류 0${filter ? ' (필터 실행)' : ''}`);
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
