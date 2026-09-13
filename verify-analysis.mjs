import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const root = new URL('.', import.meta.url);
const indexURL = new URL('index.html', root).href;
const data = JSON.parse(await readFile(new URL('analysis.json', root), 'utf8'));
const cases = JSON.parse(await readFile(new URL('cases.json', root), 'utf8'));
const lessons = data.lessons;
const KEY = 'sentence-beyond.study.v1';
const selectedFilter = process.env.STUDY_ANALYSIS_FILTER;
const filter = selectedFilter ? new RegExp(selectedFilter) : null;
const failures = [];
const errors = [];
const outbound = [];
let passed = 0;

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.STUDY_CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route(/^https?:/, route => {
  outbound.push(route.request().url());
  return route.abort();
});
const p = await context.newPage();
p.setDefaultTimeout(5000);
p.on('pageerror', error => errors.push(error.message));

const seed = {
  version: 1,
  stocks: [{ code: '035420', name: '검증용 개인 종목', sector: '직접 추가' }],
  cases: [{
    id: 'user-analysis-regression', stock: '035420', title: '보존할 개인 학습 기록',
    excerpt: 'PER와 FCF의 차이를 다시 살펴보는 개인 검증 문장입니다.',
    sourceUrl: 'https://example.com/analysis-regression-personal-note',
    explanation: '분석 탭을 사용한 뒤에도 남아 있어야 하는 개인 해석입니다.',
    collectedAt: '가상 검증일', sourceLabel: '직접 추가한 출처', publishedAt: '작성일 미확인',
    terms: ['per', 'fcf'], category: '직접 추가', claimType: '미분류', custom: true,
    reason: '직접 추가한 자료입니다. 해석과 주장의 근거를 직접 확인해 주세요.', checks: [],
    caution: '직접 추가 · 미검증. 입력한 문장과 해석을 보관하며 자동 사실 확인은 하지 않습니다.',
  }],
  savedCases: [cases[0].id, 'user-analysis-regression'],
  savedTerms: ['hbm'], completed: [cases[0].id],
  review: [{ id: 'hbm', status: 'known', at: '가상 검증일' }],
};

async function fresh(route = 'technical') {
  await p.emulateMedia({ media: 'screen' });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(`${indexURL}#analysis/${route}`);
  await p.reload();
  await expect(p.locator('#analysis-page')).toBeVisible();
}
async function check(name, action) {
  if (filter && !filter.test(name)) return;
  try {
    await action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
const number = text => Number(text.replace(/[^\d.−-]/g, '').replace('−', '-'));
const displayed = async selector => number(await p.locator(selector).innerText());
async function assertNoInvalidNumbers(selector) {
  const contents = await p.locator(selector).evaluateAll(nodes => nodes.map(n => n.outerHTML).join('\n'));
  assert(!/(?:NaN|Infinity|undefined)/.test(contents), `${selector}: 계산되지 않은 값이 노출됨`);
}
async function range(selector, value) {
  // Native range controls expose their state through input events; use real keyboard input.
  const input = p.locator(selector);
  const { min, step } = await input.evaluate(n => ({ min: Number(n.min), step: Number(n.step) || 1 }));
  await input.focus();
  await input.press('Home');
  for (let i = 0; i < Math.round((value - min) / step); i++) await input.press('ArrowRight');
  await expect(input).toHaveValue(String(value));
}
async function inspectChart() {
  const svg = p.locator('.analysis-chart svg');
  await expect(svg).toBeVisible();
  assert((await svg.getAttribute('aria-label')).length > 5, '차트 설명 누락');
  await assertNoInvalidNumbers('.analysis-chart');
  const details = p.locator('.analysis-data-table');
  if (!(await details.evaluate(n => n.open))) await details.locator('summary').click();
  assert(await details.locator('tbody tr').count() > 0, '차트 수치 행 없음');
  const widths = await details.locator('tr').evaluateAll(rows => rows.map(r => r.cells.length));
  assert(widths.every(n => n === widths[0]), '표 헤더와 행의 열 수 불일치');
  await assertNoInvalidNumbers('.analysis-data-table');
}

try {
  await p.goto(indexURL);
  await p.evaluate(({ key, seed }) => localStorage.setItem(key, JSON.stringify(seed)), { key: KEY, seed });
  await p.reload();

  await check('수업 전체 딥링크·출처·그룹 개수', async () => {
    assert(lessons.length > 0);
    for (const group of ['technical', 'fundamental', 'investors']) {
      await fresh(group);
      const expected = lessons.filter(l => l.group === group).length;
      assert.equal(await p.locator('.analysis-index-item').count(), expected, `${group}: 수업 개수`);
      await expect(p.locator(`[data-analysis-group="${group}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    for (const l of lessons) {
      await fresh(l.id);
      await expect(p.locator('#analysis-lesson-title')).toHaveText(l.title);
      await expect(p.locator('.analysis-index-item[aria-current="true"]')).toHaveAttribute('data-lesson-id', l.id);
      assert.equal(await p.locator('#analysis-detail .analysis-sources a').count(), l.sources.length, `${l.id}: 출처 개수`);
      const links = await p.locator('#analysis-detail .analysis-sources a').evaluateAll(as => as.map(a => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent })));
      assert(links.length > 0, `${l.id}: 출처 없음`);
      for (const a of links) {
        const u = new URL(a.href);
        assert(['https:', 'http:'].includes(u.protocol) && !u.username && !u.password, `${l.id}: 안전하지 않은 출처`);
        assert(a.text.trim() && a.target === '_blank' && a.rel.includes('noopener'), `${l.id}: 출처 링크 속성`);
      }
      await expect(p.locator('.analysis-expression small')).toContainText('실제 게시물·투자 대가의 발언 인용이 아닙니다');
      assert.equal(await p.locator('.analysis-steps li').count(), l.steps.length);
    }
    console.log(`  확인 범위: ${lessons.length}개 수업의 개별 주소`);
  });

  await check('전체 분야 검색·빈 결과·검색 해제', async () => {
    await fresh('technical');
    for (const [query, id] of [['지지선', 'tech-support'], ['PER', 'fund-per-earnings-cycle'], ['버핏', 'investor-buffett']]) {
      await p.locator('#analysis-search').fill(query);
      await expect(p.locator(`.analysis-index-item[data-lesson-id="${id}"]`)).toBeVisible();
      await expect(p.locator('#analysis-result-count')).toContainText('전체 분야에서');
    }
    await p.locator('#analysis-search').fill('검색결과가있을수없는검증문자열');
    await expect(p.locator('#analysis-detail .empty-state')).toBeVisible();
    assert.equal(await p.locator('.analysis-index-item').count(), 0);
    await p.locator('#analysis-search').fill('');
    assert(await p.locator('.analysis-index-item').count() > 0);
  });

  await check('검색 중 다른 수업 주소로 이동', async () => {
    await fresh('investors');
    await p.locator('#analysis-search').fill('버핏');
    await p.evaluate(() => { location.hash = 'analysis/tech-ohlc'; });
    await expect(p.locator('#analysis-lesson-title')).toHaveText(lessons.find(l => l.id === 'tech-ohlc').title);
    await expect(p.locator('#analysis-search')).toHaveValue('');
    await p.locator('#analysis-search').fill('PER');
    await p.evaluate(() => { location.hash = 'analysis/investors'; });
    await expect(p.locator('#analysis-search')).toHaveValue('');
    await expect(p.locator('[data-analysis-group="investors"]')).toHaveAttribute('aria-pressed', 'true');
    assert.equal(await p.locator('.analysis-index-item').count(), lessons.filter(l => l.group === 'investors').length);
  });

  await check('용어 저장으로 다시 렌더링해도 검색·수업 유지', async () => {
    await fresh('fund-per-earnings-cycle');
    await p.locator('#analysis-search').fill('PER');
    await p.locator('[data-lesson-id="fund-per-earnings-cycle"]').click();
    const route = new URL(p.url()).hash;
    await p.getByRole('button', { name: '용어집 뜻·책갈피 열기', exact: true }).first().click();
    await p.getByRole('button', { name: '학습장에 용어 저장', exact: true }).click();
    await expect(p.locator('#analysis-search')).toHaveValue('PER');
    await expect(p.locator('#analysis-lesson-title')).toHaveText(lessons.find(l => l.id === 'fund-per-earnings-cycle').title);
    assert.equal(new URL(p.url()).hash, route);
    await p.getByRole('button', { name: '✓ 학습장에 저장됨', exact: true }).click();
    await expect(p.locator('#analysis-search')).toHaveValue('PER');
    await p.keyboard.press('Escape');
  });

  await check('분야 주소 복원·깨진 주소 복구', async () => {
    for (const group of ['technical', 'fundamental', 'investors', 'workflow']) {
      await fresh('technical');
      await p.locator(`[data-analysis-group="${group}"]`).click();
      assert.equal(new URL(p.url()).hash, `#analysis/${group}`);
      await p.reload();
      await expect(p.locator(`[data-analysis-group="${group}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    await fresh('%');
    await expect(p.locator('#analysis-lesson-title')).toBeVisible();
    await fresh('not-a-lesson');
    await expect(p.locator('#analysis-lesson-title')).toBeVisible();
  });

  await check('차트 전체 기본·반례·수치표·유효 SVG', async () => {
    const charts = lessons.filter(l => l.group === 'technical');
    for (const l of charts) {
      await fresh(l.id);
      await inspectChart();
      const before = await p.locator('.analysis-chart').innerHTML();
      const caption = await p.locator('.analysis-chart-caption').innerText();
      await p.locator('[data-chart-mode="true"]').click();
      await expect(p.locator('[data-chart-mode="true"]')).toHaveAttribute('aria-pressed', 'true');
      await inspectChart();
      assert.notEqual(await p.locator('.analysis-chart').innerHTML(), before, `${l.id}: 반례 차트 변화 없음`);
      assert.notEqual(await p.locator('.analysis-chart-caption').innerText(), caption, `${l.id}: 반례 설명 변화 없음`);
      await p.locator('[data-chart-mode="false"]').click();
      assert.equal(await p.locator('.analysis-chart').innerHTML(), before, `${l.id}: 기본 차트 복원 실패`);
    }
    await fresh('tech-ohlc');
    const headers = await p.locator('.analysis-data-table thead th').allTextContents();
    for (const name of ['시가', '고가', '저가']) assert(headers.includes(name), `OHLC 표 ${name} 누락`);
    await fresh('tech-bollinger');
    assert((await p.locator('.analysis-data-table thead').textContent()).includes('상단 +2σ'));
    await fresh('tech-volume');
    assert((await p.locator('.analysis-data-table thead').textContent()).includes('가상 거래량'));
    console.log(`  확인 범위: ${charts.length}개 차트 × 기본·반례`);
  });

  await check('SMA 기간 변경과 표 계산', async () => {
    await fresh('tech-ma');
    await p.getByRole('slider', { name: '이동평균 관측값 개수' }).press('End');
    await expect(p.locator('.analysis-period output')).toHaveText('12');
    await expect(p.locator('.analysis-chart-legend')).toContainText('SMA(12)');
    const rows = await p.locator('.analysis-data-table tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)));
    assert(rows.slice(0, 11).every(r => r[2] === '—'), 'SMA 준비 기간');
    const fromDisplayedPrices = rows.slice(0, 12).reduce((sum, r) => sum + number(r[1]), 0) / 12;
    assert(Math.abs(number(rows[11][2]) - fromDisplayedPrices) < .02, 'SMA 첫 표시값과 12개 가격 평균 불일치');
    await p.getByRole('slider', { name: '이동평균 관측값 개수' }).press('Home');
    await expect(p.locator('.analysis-period output')).toHaveText('3');
    await expect(p.locator('.analysis-chart-legend')).toContainText('SMA(3)');
  });

  await check('가치평가 기준값·보수/낙관·주가 독립성·잘못된 가정', async () => {
    await fresh('workflow');
    assert.equal(await p.locator('.analysis-workflow-steps > li').count(), data.workflow.steps.length);
    assert.equal(await p.locator('#analysis-workflow .analysis-sources a').count(), data.workflow.sources.length);
    assert.equal(await displayed('#sim-intrinsic'), 11250);
    for (const [key, value] of Object.entries({ eps: 900, per: 16.67, pbr: 2.73, roe: 18, roic: 15, debt: 81.8, coverage: 5, ev: 8.95, yoy: 25, 'eps-yoy': 50, yield: 2, fcff: 80 })) {
      assert(Math.abs(await displayed(`#metric-${key}`) - value) < .011, `${key}: 기준 계산 표시`);
    }
    await p.getByRole('button', { name: '보수적 가정', exact: true }).click();
    assert.equal(await displayed('#sim-intrinsic'), 6773);
    await p.getByRole('button', { name: '낙관적 가정', exact: true }).click();
    assert.equal(await displayed('#sim-intrinsic'), 16122);
    await p.getByRole('button', { name: '기준 가정', exact: true }).click();
    const before = await displayed('#sim-intrinsic');
    await range('#sim-price', 30000);
    assert.equal(await displayed('#sim-intrinsic'), before, '시장가격만 바꾸면 DCF는 유지돼야 함');
    assert.equal(await displayed('#metric-per'), 33.33);
    assert.equal(await displayed('#metric-yield'), 1);
    assert.equal(await displayed('#metric-roe'), 18);
    await range('#sim-discount', 4);
    await range('#sim-terminalGrowth', 4);
    await expect(p.locator('#sim-intrinsic')).toHaveText('계산할 수 없어요');
    assert.equal(await p.locator('.analysis-sensitivity-table').count(), 0);
    await range('#sim-terminalGrowth', 5);
    await expect(p.locator('#sim-intrinsic')).toHaveText('계산할 수 없어요');
    await assertNoInvalidNumbers('.analysis-sim-results');
    await p.getByRole('button', { name: '기준 가정', exact: true }).click();
    assert.equal(await displayed('#sim-intrinsic'), 11250);
    await expect(p.locator('.analysis-sensitivity-table')).toBeVisible();
  });

  await check('용어집 팝업·원문 사례 이동', async () => {
    await fresh('tech-volume');
    await p.getByRole('button', { name: '용어집 뜻·책갈피 열기', exact: true }).first().click();
    await expect(p.locator('#dialog')).toBeVisible();
    await expect(p.locator('#dialog-title')).not.toBeEmpty();
    await p.keyboard.press('Escape');
    await expect(p.locator('#dialog')).not.toBeVisible();
    const link = p.locator('.analysis-related button').first();
    const title = (await link.innerText()).replace(/\s*↗$/, '');
    await link.click();
    await expect(p.locator('#read-page')).toBeVisible();
    await expect(p.locator('#case-search')).toHaveValue(title);
    assert(await p.locator('.case-card').count() >= 1);
  });

  await check('모바일 수업 선택·주요 메뉴·320~1440px 넘침', async () => {
    for (const width of [320, 375, 414, 768, 1024, 1440]) {
      await fresh('technical');
      await p.setViewportSize({ width, height: 900 });
      for (const group of ['technical', 'fundamental', 'investors', 'workflow']) {
        await p.locator(`[data-analysis-group="${group}"]`).click();
        const dimensions = await p.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert(dimensions.scroll <= dimensions.inner, `${width}px ${group}: 가로 넘침 ${dimensions.scroll}`);
      }
      if (width <= 414) {
        await p.locator('[data-analysis-group="technical"]').click();
        await expect(p.locator('#analysis-select')).toBeVisible();
        await p.locator('#analysis-select').selectOption('tech-macd');
        await expect(p.locator('#analysis-lesson-title')).toHaveText(lessons.find(l => l.id === 'tech-macd').title);
        assert.equal(new URL(p.url()).hash, '#analysis/tech-macd');
      }
      for (const page of ['read', 'glossary', 'notebook', 'analysis']) {
        await p.locator(`.masthead [data-page="${page}"]`).click();
        await expect(p.locator(`#${page}-page`)).toBeVisible();
        await expect(p.locator(`.masthead [data-page="${page}"]`)).toHaveAttribute('aria-current', 'page');
      }
    }
  });

  await check('분석 인쇄와 기존 용어집 인쇄 분리', async () => {
    for (const route of ['tech-bollinger', 'workflow']) {
      await fresh(route);
      const printableDetails = p.locator('#analysis-page .analysis-sources, #analysis-page .analysis-fixture');
      assert(await printableDetails.count() > 0, `${route}: 인쇄할 출처 또는 계산 자료가 없음`);
      assert((await printableDetails.evaluateAll(nodes => nodes.map(n => n.open))).every(open => !open), `${route}: 최초 접힘 상태`);
      await p.emulateMedia({ media: 'print' });
      await p.evaluate(() => dispatchEvent(new Event('beforeprint')));
      assert((await printableDetails.evaluateAll(nodes => nodes.map(n => n.open))).every(Boolean), `${route}: 인쇄 시 출처와 계산 자료 펼침`);
      assert.equal(await p.locator('#analysis-page').evaluate(n => getComputedStyle(n).display), 'block');
      assert.equal(await p.locator('#glossary-page').evaluate(n => getComputedStyle(n).display), 'none');
      assert.equal(await p.locator('.analysis-tabs').evaluate(n => getComputedStyle(n).display), 'none');
      const pdf = await p.pdf({ format: 'A4', printBackground: true });
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
      assert(pdf.length > 10000, '인쇄 PDF가 비어 있음');
      await p.evaluate(() => dispatchEvent(new Event('afterprint')));
      assert((await printableDetails.evaluateAll(nodes => nodes.map(n => n.open))).every(open => !open), `${route}: 인쇄 후 원래 접힘 상태 복원`);
      await p.emulateMedia({ media: 'screen' });
    }
    await p.locator('[data-page="glossary"]').click();
    await p.emulateMedia({ media: 'print' });
    await p.evaluate(() => dispatchEvent(new Event('beforeprint')));
    assert.equal(await p.locator('#analysis-page').evaluate(n => getComputedStyle(n).display), 'none');
    assert.notEqual(await p.locator('#glossary-page').evaluate(n => getComputedStyle(n).display), 'none');
    await p.evaluate(() => dispatchEvent(new Event('afterprint')));
    await p.emulateMedia({ media: 'screen' });
  });

  await check('개인 사례·종목·북마크·복습 기록 보존', async () => {
    await fresh('workflow');
    await p.locator('[data-page="notebook"]').click();
    await expect(p.locator('[data-case-id="user-analysis-regression"]')).toBeVisible();
    const after = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    assert.deepEqual(after, seed, '분석 탭 사용이 기존 저장 기록을 변경함');
    await p.reload();
    const reloaded = await p.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    assert.deepEqual(reloaded, seed, '새로고침 후 저장 기록 변경');
  });

  assert.equal(outbound.length, 0, `오프라인 외부 요청: ${outbound.join(', ')}`);
  assert.equal(errors.length, 0, `브라우저 오류: ${errors.join('\n')}`);
  if (failures.length) {
    console.error(`분석 UI 검증: ${passed}개 통과, ${failures.length}개 실패${selectedFilter ? ` (필터: ${selectedFilter})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS 분석 UI 완료: ${passed}개 검증 묶음 · ${lessons.length}수업 · 외부 요청 0 · 브라우저 오류 0${selectedFilter ? ` (필터: ${selectedFilter})` : ''}`);
  }
} finally {
  await browser.close();
}
