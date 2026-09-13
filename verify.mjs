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
  if(c.postSummary!==undefined)assert(typeof c.postSummary==='string'&&c.postSummary.trim(),`${c.id}: 맥락 요약 형식`);
  if(c.postSummaryScope!==undefined)assert(['full','partial'].includes(c.postSummaryScope),`${c.id}: 맥락 확인 범위`);
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
  for(const c of cases) {
    const card=p.locator(`[data-case-id="${c.id}"]`),summary=card.locator('.case-context');
    assert.equal(await summary.count(),c.postSummary?.trim()?1:0,`${c.id}: 확인된 요약만 표시`);
    if(c.postSummary?.trim()) {
      assert(await summary.isVisible(),`${c.id}: 접지 않은 맥락 요약`);
      assert.equal(await summary.locator('h4').textContent(),c.postSummaryScope==='partial'?'확인된 본문의 맥락':'글 전체의 맥락');
      assert.equal(await summary.locator('.case-context-body').textContent(),c.postSummary.trim());
      assert((await summary.locator('.case-context-label').textContent()).includes('원문 인용 아님'));
      if(c.postSummaryScope==='partial')assert.equal(await summary.locator('.case-context-label').textContent(),'공개된 부분의 학습용 요약 · 원문 인용 아님');
      assert.equal(await summary.locator('blockquote').count(),0,`${c.id}: 요약과 인용 구분`);
    }
    const source=card.locator('.case-source-link'),url=new URL(c.sourceUrl),toss=/(^|\.)tossinvest\.com$/.test(url.hostname);
    const expected=toss&&/^\/community\/posts\/\d+\/?$/.test(url.pathname)?'원문 전체 읽기 ↗':toss&&/^\/stocks\/A\d{6}\/community\/?$/.test(url.pathname)&&!url.searchParams.get('post')?'종목 커뮤니티 ↗':'출처 보기 ↗';
    assert.equal(await source.textContent(),expected,`${c.id}: 정확한 출처 유형`);
    assert(await source.isVisible(),`${c.id}: 상세를 펼치지 않아도 출처 보임`);
    assert.equal(await source.getAttribute('href'),url.href);
    assert.equal(await source.getAttribute('target'),'_blank');
    assert((await source.getAttribute('rel')).includes('noopener'));
    assert.equal(await card.locator('.case-details .case-source-link').count(),0);
    assert((await card.locator('.excerpt-note').textContent()).includes(c.sourceNote),`${c.id}: 확인 범위 유지`);
    if(c.sourceAuthor)assert.equal(await card.locator('.source-author').textContent(),`작성자 ${c.sourceAuthor.trim()}`);
    if(c.sourceVerifiedAt)assert.equal(await card.locator('.source-verified-at').textContent(),`원문 확인 ${c.sourceVerifiedAt.trim()}`);
  }
  console.log('PASS 맥락 요약·발췌 구분·항상 보이는 개별 글/종목 피드 링크');

  // In-memory QA fixtures cover missing summaries and safe text without changing source data.
  const fixtureContext=await browser.newContext();
  await fixtureContext.route(/^https?:/,route=>{outbound.push(route.request().url());return route.abort();});
  const fixture=await fixtureContext.newPage();fixture.on('pageerror',e=>errors.push(e.message));
  await fixture.addInitScript(()=>{
    let data;
    Object.defineProperty(window,'STUDY_DATA',{configurable:true,get:()=>data,set:value=>{
      data=value;
      data.cases[0]={...data.cases[0],postSummary:'검증전용맥락검색어 <img src=x onerror="window.__summaryInjected=true">',postSummaryScope:'partial',sourceAuthor:'<검증 작성자>',sourceVerifiedAt:'가상 원문 확인일',sourceUrl:'https://www.tossinvest.com/community/posts/999001?share=study'};
      data.cases[1]={...data.cases[1],sourceUrl:'https://www.tossinvest.com/stocks/A005930/community'};delete data.cases[1].postSummary;
      data.cases[2]={...data.cases[2],postSummary:'전체 확인 범위의 가상 요약',postSummaryScope:'full',sourceUrl:'https://www.tossinvest.com.evil.example/community/posts/999002'};
      if(!localStorage.getItem('sentence-beyond.study.v1'))localStorage.setItem('sentence-beyond.study.v1',JSON.stringify({version:1,stocks:[],cases:[{id:'user-context-fixture',stock:data.meta.stocks[0].code,title:'개인 맥락 요약 검증',excerpt:'검증용 개인 문장: PER를 비교합니다.',sourceUrl:'https://example.com/private-context-fixture',explanation:'직접 작성한 검증 해석',collectedAt:'가상 수집일',postSummary:'내가 확인한 일부 문장의 가상 맥락',postSummaryScope:'partial'}],savedCases:['user-context-fixture'],savedTerms:[],completed:[],review:[]}));
    }});
  });
  try {
    await fixture.goto(new URL('index.html',root).href);
    const first=fixture.locator(`[data-case-id="${cases[0].id}"]`);
    assert((await first.locator('.case-context-body').textContent()).includes('<img'));
    assert.equal(await first.locator('.case-context img').count(),0);assert.equal(await fixture.evaluate(()=>window.__summaryInjected),undefined);
    assert.equal(await first.locator('.case-source-link').textContent(),'원문 전체 읽기 ↗');
    assert.equal(await first.locator('.case-context h4').textContent(),'확인된 본문의 맥락');
    assert.equal(await first.locator('.case-context-label').textContent(),'공개된 부분의 학습용 요약 · 원문 인용 아님');
    assert.equal(await first.locator('.source-author').textContent(),'작성자 <검증 작성자>');
    assert.equal(await first.locator('.source-verified-at').textContent(),'원문 확인 가상 원문 확인일');
    assert.equal(await fixture.locator(`[data-case-id="${cases[1].id}"] .case-context`).count(),0);
    assert.equal(await fixture.locator(`[data-case-id="${cases[1].id}"] .case-source-link`).textContent(),'종목 커뮤니티 ↗');
    assert.equal(await fixture.locator(`[data-case-id="${cases[2].id}"] .case-source-link`).textContent(),'출처 보기 ↗');
    assert.equal(await fixture.locator(`[data-case-id="${cases[2].id}"] .case-context h4`).textContent(),'글 전체의 맥락');
    await fixture.locator('#case-search').fill('검증전용맥락검색어');
    assert.equal(await fixture.locator('.case-card').count(),1);assert(await first.isVisible());
    await fixture.locator('[data-page="notebook"]').click();await fixture.locator('[data-notebook="custom"]').click();
    const personal=fixture.locator('[data-case-id="user-context-fixture"]');
    assert.equal(await personal.locator('.case-context h4').textContent(),'확인된 본문의 맥락');
    await personal.locator('.icon-button').click();await personal.locator('.icon-button').click();
    const stored=await fixture.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
    assert.equal(stored.cases[0].postSummaryScope,'partial');assert.equal(stored.cases[0].postSummary,'내가 확인한 일부 문장의 가상 맥락');
    const invalid=structuredClone(stored);invalid.cases[0].postSummaryScope='complete';
    await fixture.locator('#backup-file').setInputFiles({name:'invalid-context.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await fixture.waitForFunction(()=>document.getElementById('toast').textContent.includes('확인 범위'));
    assert.deepEqual(await fixture.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY),stored,'잘못된 범위의 백업은 기존 기록을 변경하지 않음');
  } finally {await fixtureContext.close();}
  console.log('PASS 맥락 검색·전체/부분 확인 구분·HTML 문자 표시·개인 백업 범위 보존');
  for (const name of ['SK하이닉스','삼성전자','대한광통신']) {
    await p.locator('.stock-button').filter({hasText:name}).click();
    assert.equal(await p.locator('.case-card').count(),Math.min(8,cases.filter(c=>c.stock===({'SK하이닉스':'000660','삼성전자':'005930','대한광통신':'010170'})[name]).length));
  }
  await p.locator('.stock-button').filter({hasText:'전체 종목'}).click();
  await p.locator('#case-search').fill('FCF');
  assert(await p.locator('.case-card').count()>0,'FCF와 연결된 사례 검색');
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
  assert.equal(await p.locator('#notebook-content .case-context').count(),0,'기존 직접 추가 사례에는 확인하지 않은 맥락을 만들지 않음');
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
