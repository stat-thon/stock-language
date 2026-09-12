import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const readJSON = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'));
const cases = await readJSON('cases.json');
const glossary = await readJSON('glossary.json');
const notes = await readJSON('collection-notes.json');
const ids = new Set(glossary.map(t => t.id));
assert.equal(ids.size, glossary.length, '용어 ID 중복');
assert.equal(new Set(cases.map(c => c.id)).size, cases.length, '사례 ID 중복');
assert.equal(new Set(cases.map(c => c.excerpt.normalize('NFKC').replace(/\s/g, ''))).size, cases.length, '발췌 중복');
for (const c of cases) {
  assert(c.terms.every(t => ids.has(t)), `${c.id}: 미등록 용어`);
  assert(notes.some(n => n.stock === c.stock && n.excerpt === c.excerpt), `${c.id}: 수집 발췌와 다름`);
  assert(c.excerpt.split(/\s+/).length <= 25, `${c.id}: 인용 길이`);
  assert(c.explanation && c.checks.length && c.caution && c.sourceNote, `${c.id}: 해석/출처 범위 누락`);
}
console.log(`PASS 데이터: ${cases.length}개 실제 발췌 대조, 중복·용어 연결·출처 범위`);

const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.STUDY_CHROME_PATH || (existsSync(macChrome)?macChrome:undefined);
const browser = await chromium.launch({headless: true, ...(executablePath?{executablePath}:{})});
const context = await browser.newContext({viewport:{width:1440,height:1000}, acceptDownloads:true});
const p = await context.newPage();
const errors = [];
const outbound = [];
p.on('pageerror', e => errors.push(e.message));
await context.route(/^https?:/, route => { outbound.push(route.request().url()); return route.abort(); });
const KEY = 'sentence-beyond.study.v1';
try {
  await p.goto(new URL('index.html',root).href);
  assert.equal(await p.locator('.case-card').count(), Math.min(8,cases.length));
  while (await p.locator('#load-more').isVisible()) await p.locator('#load-more').click();
  assert.equal(await p.locator('.case-card').count(), cases.length);
  console.log('PASS 단일 HTML: 네트워크 없이 사례 전체 표시');
  for (const name of ['SK하이닉스','삼성전자','대한광통신']) {
    await p.locator('.stock-button').filter({hasText:name}).click();
    assert.equal(await p.locator('.case-card').count(),Math.min(8,cases.filter(c=>c.stock===({'SK하이닉스':'000660','삼성전자':'005930','대한광통신':'010170'})[name]).length));
  }
  await p.locator('.stock-button').filter({hasText:'전체 종목'}).click();
  await p.locator('#case-search').fill('FCF');
  assert.equal(await p.locator('.case-card').count(),1);
  await p.locator('#case-search').fill('존재하지않는검색어');
  assert.equal(await p.locator('.case-card').count(),0);
  await p.locator('#case-search').fill('');
  await p.locator('.term-highlight').first().click();
  assert(await p.locator('#dialog').isVisible());
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#dialog').isVisible(),false);
  console.log('PASS 종목 필터·검색·빈 결과·용어 팝업');

  await p.locator('#save-read-case-01').click();
  await p.locator('[data-case-id="case-01"] .details-toggle').click();
  await p.locator('#done-read-case-01').click();
  await p.reload();
  const saved=await p.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  assert(saved.savedCases.includes('case-01') && saved.completed.includes('case-01'));
  await p.locator('#hide-completed').check();
  assert.equal(await p.locator('[data-case-id="case-01"]').count(),0);
  await p.locator('#hide-completed').uncheck();
  await p.locator('[data-page="glossary"]').click();
  assert.equal(await p.locator('.term-card').count(),glossary.length);
  await p.locator('#term-search').fill('HBM');
  assert.equal(await p.locator('.term-card .term-title').filter({hasText:/^HBM$/}).count(),1);
  await p.locator('#save-term-glossary-hbm').click();
  await p.locator('[data-page="notebook"]').click();
  await p.locator('#start-quiz').click();
  await p.getByRole('button',{name:'정답 확인하기',exact:true}).click();
  assert((await p.locator('.quiz-answer').textContent()).includes('HBM'));
  await p.getByRole('button',{name:'알고 있어요',exact:true}).click();
  await p.keyboard.press('Escape');
  assert((await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).review,KEY)).some(r=>r.id==='hbm' && r.status==='known'));
  console.log('PASS 저장·완료·새로고침 유지·용어집 검색·복습');

  await p.locator('[data-page="read"]').click();
  await p.locator('[data-action="add-stock"]').click();
  await p.locator('#stock-name').fill('학습 테스트 종목');
  await p.locator('#stock-code').fill('035420');
  await p.locator('#dialog').getByRole('button',{name:'종목 추가',exact:true}).click();
  const add = async (url, text, explanation='직접 작성한 테스트 해석입니다.') => {
    await p.locator('[data-action="add-case"]').first().click();
    await p.locator('#case-url').fill(url);
    await p.locator('#case-excerpt').fill(text);
    await p.locator('#case-explanation').fill(explanation);
    await p.getByRole('button',{name:'내 학습장에 추가',exact:true}).click();
  };
  const feed='https://www.tossinvest.com/stocks/A005930/community';
  await add(feed,'PER 기준을 살펴보았습니다.');
  assert.equal(await p.locator('#dialog').isVisible(),false,'기존 종목 피드의 서로 다른 글 추가 허용');
  await add(feed,'EPS 기준은 다릅니다. <img src=x onerror="window.__injected=true">');
  assert.equal(await p.locator('#dialog').isVisible(),false,'같은 피드의 다른 글 추가 허용');
  assert.equal(await p.evaluate(()=>window.__injected),undefined);
  assert.equal(await p.locator('.comparison img').count(),0);
  await p.reload();
  assert.equal((await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).cases,KEY)).length,2);
  await add(feed,'PER 기준을 살펴보았습니다.');
  assert((await p.locator('#case-form-error').textContent()).includes('같은'));
  await p.keyboard.press('Escape');
  await add('https://example.com/qa-only','단순 응원입니다.');
  assert((await p.locator('#case-form-error').textContent()).includes('용어'));
  await p.keyboard.press('Escape');
  console.log('PASS 종목 추가·문장 추가·동일 피드 회귀·중복/무용어 제외·HTML 무해화');

  await p.locator('[data-page="notebook"]').click();
  const waitDownload=p.waitForEvent('download');
  await p.locator('[data-action="export"]').click();
  const download=await waitDownload;
  const backup=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(backup.cases.length,2);
  await p.locator('[data-action="updates"]').click();
  assert((await p.locator('#dialog').textContent()).includes('자동으로 수집'));
  assert.equal(await p.locator('#dialog .update-links a').count(),5);
  const contributionDownload=p.waitForEvent('download');
  await p.getByRole('button',{name:'추가한 사례 내보내기',exact:true}).click();
  const contribution=JSON.parse(await readFile(await (await contributionDownload).path(),'utf8'));
  assert.equal(contribution.format,'sentence-beyond.contribution.v1');
  assert.equal(contribution.cases.length,2);
  assert.deepEqual(Object.keys(contribution).sort(),['cases','exportedAt','format','stocks']);
  assert.deepEqual(contribution.stocks,backup.stocks.filter(s=>backup.cases.some(c=>c.stock===s.code)),'사례에서 사용하는 개인 종목만 내보냄');
  await p.keyboard.press('Escape');
  const upload = async data => {
    await p.locator('#backup-file').setInputFiles({name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  };
  await upload(backup);
  await p.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).cases.length===2,KEY);
  assert.equal((await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).stocks,KEY)).length,1);
  const bad=structuredClone(backup);bad.cases[0].sourceUrl='javascript:alert(1)';
  await upload(bad);
  await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('잘못된'));
  assert.equal((await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).cases,KEY)).length,2);
  await p.locator('#backup-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});
  await p.waitForFunction(()=>document.getElementById('toast').textContent.includes('JSON 파일'));
  console.log('PASS 백업 내보내기·중복 없이 합치기·위험 URL/손상 JSON 거부');

  await p.evaluate(key=>localStorage.removeItem(key),KEY);
  await p.goto(new URL('index.html',root).href);
  await p.locator('[data-action="updates"]').click();
  assert(await p.getByRole('button',{name:'추가한 사례 내보내기',exact:true}).isDisabled());
  await p.keyboard.press('Escape');
  for(const width of [320,375,414,768,1440]) {
    await p.setViewportSize({width,height:1000});
    for(const tab of ['read','glossary','notebook']) {
      await p.locator(`[data-page="${tab}"]`).click();
      const dimensions=await p.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert(dimensions.scroll<=dimensions.inner,`${width}px ${tab}: 가로 넘침`);
    }
  }
  await p.setViewportSize({width:1440,height:1000});await p.locator('[data-page="read"]').click();
  await p.screenshot({path:fileURLToPath(new URL('preview-desktop.png',root))});
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:fileURLToPath(new URL('preview-mobile.png',root))});
  await p.locator('[data-page="glossary"]').click();
  await p.emulateMedia({media:'print'});
  assert.equal(await p.locator('.term-card:visible').count(),glossary.length);
  assert(await p.locator('.print-detail').first().isVisible());
  console.log('PASS 5개 화면 폭 × 3개 화면·인쇄용 용어 설명');
  assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(outbound.length,0,'오프라인 HTML의 외부 요청');
  console.log(`PASS 완료: ${cases.length}사례 · ${glossary.length}용어 · 브라우저 오류 0 · 외부 요청 0`);
} finally {await browser.close();}
