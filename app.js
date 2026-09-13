(() => {
  'use strict';
  const DATA = window.STUDY_DATA || {};
  const glossary = Array.isArray(DATA.glossary) ? DATA.glossary : [];
  const curated = Array.isArray(DATA.cases) ? DATA.cases : [];
  const meta = DATA.meta || {};
  const DEFAULT_STOCKS = [{code:'000660',name:'SK하이닉스',sector:'반도체'},{code:'005930',name:'삼성전자',sector:'반도체'},{code:'010170',name:'대한광통신',sector:'광통신'}];
  const baseStocks = Array.isArray(meta.stocks) && meta.stocks.length ? meta.stocks : DEFAULT_STOCKS;
  const termMap = new Map(glossary.map(t => [t.id,t]));
  const termIDs = new Set(termMap.keys());
  const KEY = 'sentence-beyond.study.v1';
  const $ = (selector,root=document) => root.querySelector(selector);
  const $$ = (selector,root=document) => [...root.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const iconPaths = {
    bookmark:'M6 3h12v18l-6-4-6 4V3Z',
    book:'M3 4h6c2 0 3 1 3 2 0-1 1-2 3-2h6v15h-6c-2 0-3 1-3 2 0-1-1-2-3-2H3V4Zm9 2v15',
    quote:'M10 7H4v6h5c0 3-2 4-4 4m15-10h-6v6h5c0 3-2 4-4 4',
    arrow:'M7 17 17 7M7 7h10v10',
    chevron:'m6 9 6 6 6-6',
    check:'m5 12 4 4L19 6',
    pen:'m4 16 12-12 4 4L8 20H4v-4ZM13 7l4 4'
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',iconPaths[name] || iconPaths.book); path.setAttribute('stroke','currentColor');
    path.setAttribute('stroke-width','1.5'); path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round'); svg.append(path); return svg;
  }
  function button(label,cls,handler,iconName) {
    const b = el('button',cls); b.type='button';
    if (iconName) b.append(icon(iconName));
    if (label) b.append(document.createTextNode(label));
    if (handler) b.addEventListener('click',handler); return b;
  }
  function link(label,url,cls='') {
    const a = el('a',cls,label); const safe = safeUrl(url);
    if (safe) { a.href=safe; a.target='_blank'; a.rel='noopener noreferrer'; }
    return a;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) return null;
    try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
    catch { return null; }
  }
  const textField = (v,max,min=0) => typeof v==='string' && v.trim().length>=min && v.length<=max;
  const normalize = value => value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  function termPosition(text,name,start=0) {
    const lower=text.toLowerCase(),word=name.toLowerCase();let pos=lower.indexOf(word,start);
    while(pos!==-1) {
      const before=lower[pos-1] || '',after=lower[pos+word.length] || '';
      if(!(/^[a-z0-9]/i.test(word)&&/[a-z0-9]/i.test(before))&&!(/[a-z0-9]$/i.test(word)&&/[a-z0-9]/i.test(after))) return pos;
      pos=lower.indexOf(word,pos+1);
    }
    return -1;
  }
  function urlKey(value) { const u=new URL(value); u.hash=''; return u.href.replace(/\/$/,''); }
  function postKey(value) {
    const safe=safeUrl(value);if(!safe)return null;const u=new URL(safe);
    if(/(^|\.)tossinvest\.com$/.test(u.hostname)&&/^\/stocks\/A\d{6}\/community\/?$/.test(u.pathname)&&!u.searchParams.get('post'))return null;
    return urlKey(safe);
  }
  function blankState() { return {version:1,stocks:[],cases:[],savedCases:[],savedTerms:[],completed:[],review:[]}; }
  function detectTerms(text) {
    const norm=normalize(text),spaced=text.normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
    return glossary.filter(t=>[t.name,...(t.aliases||[])].some(name=>name && (/[a-z0-9]/i.test(name)?termPosition(spaced,name.normalize('NFKC').replace(/\s+/g,' ').toLowerCase())!==-1:norm.includes(normalize(name))))).map(t=>t.id);
  }
  function validateState(raw) {
    if (!raw || typeof raw!=='object' || Array.isArray(raw) || raw.version!==1) throw new Error('문장 너머 버전 1 백업 파일을 선택해 주세요.');
    for (const key of ['stocks','cases','savedCases','savedTerms','completed','review']) if (!Array.isArray(raw[key]) || raw[key].length>2000) throw new Error('백업 파일의 기록 형식이 올바르지 않습니다.');
    const clean=blankState(), stockCodes=new Set(baseStocks.map(s=>s.code));
    for (const s of raw.stocks) {
      if (!s || !textField(s.code,6,6) || !/^\d{6}$/.test(s.code) || !textField(s.name,30,1)) throw new Error('종목 이름 또는 6자리 종목코드가 올바르지 않습니다.');
      if (!stockCodes.has(s.code)) {clean.stocks.push({code:s.code,name:s.name.trim(),sector:'직접 추가'});stockCodes.add(s.code);}
    }
    const caseIDs=new Set(curated.map(c=>c.id));
    const existingUrls=new Set(curated.map(c=>postKey(c.sourceUrl)).filter(Boolean));
    const existingExcerpts=new Set(curated.map(c=>normalize(c.excerpt || '')));
    for (const c of raw.cases) {
      if (!c || !textField(c.id,100,1) || !/^user-[a-zA-Z0-9-]+$/.test(c.id) || !stockCodes.has(c.stock) || !textField(c.excerpt,300,1) || !safeUrl(c.sourceUrl) || !textField(c.explanation,2000) || !textField(c.title,100,1) || !textField(c.collectedAt,40,1)) throw new Error('직접 추가한 글에 잘못된 내용이나 주소가 있습니다.');
      const terms=detectTerms(c.excerpt);
      if (!terms.length) throw new Error('용어집의 용어가 없는 글은 가져올 수 없습니다.');
      if (caseIDs.has(c.id) || postKey(c.sourceUrl)&&existingUrls.has(postKey(c.sourceUrl)) || existingExcerpts.has(normalize(c.excerpt))) continue;
      clean.cases.push({id:c.id,stock:c.stock,title:c.title.trim(),excerpt:c.excerpt.trim(),sourceUrl:safeUrl(c.sourceUrl),sourceLabel:'직접 추가한 출처',publishedAt:'작성일 미확인',collectedAt:c.collectedAt,terms,category:'직접 추가',explanation:c.explanation.trim(),claimType:'미분류',reason:'직접 추가한 자료입니다. 해석과 주장의 근거를 직접 확인해 주세요.',checks:[],caution:'직접 추가 · 미검증. 입력한 문장과 해석을 보관하며 자동 사실 확인은 하지 않습니다.',custom:true});
      caseIDs.add(c.id);if(postKey(c.sourceUrl))existingUrls.add(postKey(c.sourceUrl));existingExcerpts.add(normalize(c.excerpt));
    }
    if (clean.stocks.length>100 || clean.cases.length>500) throw new Error('종목은 100개, 직접 추가한 글은 500개까지 보관할 수 있습니다.');
    function validIDs(values,allowed) { if (values.some(v=>typeof v!=='string')) throw new Error('저장된 항목의 식별자가 올바르지 않습니다.');return [...new Set(values.filter(id=>allowed.has(id)))]; }
    clean.savedCases=validIDs(raw.savedCases,caseIDs);clean.completed=validIDs(raw.completed,caseIDs);clean.savedTerms=validIDs(raw.savedTerms,termIDs);
    for(const r of raw.review) if (r && termIDs.has(r.id) && ['known','again'].includes(r.status) && textField(r.at,40,1)) clean.review.push({id:r.id,status:r.status,at:r.at});
    clean.review=[...new Map(clean.review.map(r=>[r.id,r])).values()];
    return clean;
  }
  let state=blankState(), storageError='';
  try { const raw=localStorage.getItem(KEY); if(raw) state=validateState(JSON.parse(raw)); }
  catch { storageError='저장된 기록을 읽지 못했습니다. 현재 학습은 계속할 수 있으며, 백업 파일이 있다면 가져와 주세요.'; }
  let page='read',stock='all',caseSearch='',caseCategory='all',hideCompleted=false,limit=8;
  let termSearch='',termCategory='all',usedOnly=false,notebookTab='cases';
  let quiz=[],quizIndex=0,quizKnown=0,quizRevealed=false;
  let toastTimer;
  const expanded=new Set();
  const allCases=()=>[...curated,...state.cases];
  const allStocks=()=>[...baseStocks,...state.stocks];
  const stockName=code=>allStocks().find(s=>s.code===code)?.name || code;
  const usedTerms=()=>new Set(allCases().flatMap(c=>c.terms || []));
  function toast(message,undo) {
    clearTimeout(toastTimer);const t=$('#toast');t.replaceChildren(el('span','',message));
    if(undo)t.append(button('되돌리기','',()=>{undo();t.hidden=true;}));
    t.hidden=false;toastTimer=setTimeout(()=>{t.hidden=true;},undo?10000:5000);
  }
  function persist() {
    try { localStorage.setItem(KEY,JSON.stringify(state));return true; }
    catch { toast('이 브라우저에 저장하지 못했습니다. 학습장의 백업 내보내기로 기록을 보관하세요.');return false; }
  }
  function toggle(list,id) {state[list]=state[list].includes(id)?state[list].filter(x=>x!==id):[...state[list],id];persist();render();}
  function preservedRender(focusID) {render();if(focusID)document.getElementById(focusID)?.focus({preventScroll:true});}
  function saveCase(id) {toggle('savedCases',id);document.getElementById(`save-${page}-${id}`)?.focus({preventScroll:true});}
  function saveTerm(id) {toggle('savedTerms',id);document.getElementById(`save-term-${page}-${id}`)?.focus({preventScroll:true});}
  function empty(title,description,actionLabel,action) {
    const wrap=el('div','empty-state');wrap.append(icon('book'),el('h3','',title),el('p','',description));
    if(actionLabel)wrap.append(button(actionLabel,'button',action));return wrap;
  }
  function highlight(text,ids) {
    const fragment=document.createDocumentFragment();
    const names=[...new Map(ids.flatMap(id=>{const t=termMap.get(id);return t?[t.name,...(t.aliases||[])].filter(Boolean).map(name=>[name.toLowerCase(),{name,id}]):[];})).values()].sort((a,b)=>b.name.length-a.name.length);
    let offset=0;const lower=text.toLowerCase();
    while(offset<text.length) {
      let hit=null;
      for(const item of names) {const pos=termPosition(lower,item.name,offset);if(pos!==-1 && (!hit || pos<hit.pos || pos===hit.pos&&item.name.length>hit.name.length))hit={...item,pos};}
      if(!hit){fragment.append(document.createTextNode(text.slice(offset)));break;}
      if(hit.pos>offset)fragment.append(document.createTextNode(text.slice(offset,hit.pos)));
      const b=button(text.slice(hit.pos,hit.pos+hit.name.length),'term-highlight',()=>openTerm(hit.id));b.setAttribute('aria-label',`${termMap.get(hit.id).name} 뜻 보기`);fragment.append(b);offset=hit.pos+hit.name.length;
    }
    return fragment;
  }
  function caseCard(c) {
    const card=el('article','case-card');card.dataset.caseId=c.id;
    const head=el('div','case-heading'),titleWrap=el('div'),metadata=el('div','case-meta');
    metadata.append(el('span','stock-tag',stockName(c.stock)),el('span','','·'),el('span','',c.category || '용어 학습'));
    if(c.custom)metadata.append(el('span','claim-tag','직접 추가 · 미검증'));
    else if(state.completed.includes(c.id))metadata.append(el('span','claim-tag','학습 완료'));
    titleWrap.append(metadata,el('h3','',c.title || '이 문장, 함께 읽기'));
    if(c.editorialTitle)titleWrap.append(el('span','editorial-title-note','학습용으로 붙인 제목'));
    const saved=state.savedCases.includes(c.id),save=button('','icon-button'+(saved?' is-saved':''),()=>saveCase(c.id),'bookmark');
    save.id=`save-${page}-${c.id}`;save.setAttribute('aria-label',saved?'문장 저장 해제':'문장 저장');save.setAttribute('aria-pressed',String(saved));head.append(titleWrap,save);
    const compare=el('div','comparison'),original=el('div','original-pane'),translated=el('div','interpretation-pane');
    const originalLabel=el('div','pane-label');originalLabel.append(icon('quote'),document.createTextNode(c.custom?'직접 가져온 문장':'커뮤니티 실제 문장'));
    const quote=el('blockquote');quote.append(highlight(c.excerpt || '',c.terms || []));
    const sourceNote=el('div','excerpt-note');sourceNote.append(link(c.custom?'원문 보기 ↗':'출처 커뮤니티 ↗',c.sourceUrl));sourceNote.append(document.createTextNode(` · ${c.publishedAt || '작성일 미확인'} · 일부 발췌`));
    if(c.sourceNote)sourceNote.append(el('p','source-link-note',c.sourceNote));
    sourceNote.append(el('p','source-link-note',`수집 ${c.collectedAt || meta.collectedAt || '날짜 미기록'}`));
    original.append(originalLabel,quote,sourceNote);
    const translatedLabel=el('div','pane-label');translatedLabel.append(icon('pen'),document.createTextNode(c.custom?'내가 적은 해석':'쉬운 말로 풀면'));
    const claim=el('div','claim-line');claim.append(el('span','claim-tag',c.claimType || '의견'),el('span','',c.custom?'직접 분류해 보세요.':'글쓴이의 주장은 별도 확인이 필요해요.'));
    translated.append(translatedLabel,el('p','',c.explanation || '아직 해석을 적지 않았습니다. 색칠된 용어를 누르고 문장의 뜻을 직접 생각해 보세요.'),claim);compare.append(original,translated);
    const bottom=el('div','case-bottom'),chips=el('div','term-chips');
    for(const id of c.terms || []) {const t=termMap.get(id);if(t)chips.append(button(t.name,'term-chip',()=>openTerm(id)));}
    const isExpanded=expanded.has(c.id),details=el('div','case-details');details.id=`details-${page}-${c.id}`;details.hidden=!isExpanded;
    const detailToggle=button(isExpanded?'접어두기':'확인할 질문 보기','text-button details-toggle',()=>{if(expanded.has(c.id))expanded.delete(c.id);else expanded.add(c.id);details.hidden=!expanded.has(c.id);detailToggle.firstChild.textContent=expanded.has(c.id)?'접어두기':'확인할 질문 보기';detailToggle.setAttribute('aria-expanded',String(expanded.has(c.id)));});
    detailToggle.append(icon('chevron'));detailToggle.setAttribute('aria-controls',details.id);detailToggle.setAttribute('aria-expanded',String(isExpanded));bottom.append(chips,detailToggle);
    if(c.reason) {details.append(el('h4','', '이 문장에서 배울 점'),el('p','case-caution',c.reason));}
    const checks=el('ol','check-list');
    const cChecks=c.checks?.length?c.checks:[{question:'이 주장을 뒷받침하는 출처가 있나요?',detail:'공시나 기업 발표의 날짜와 원문을 확인하고, 단정적인 전망과 확인된 사실을 구분해 보세요.'}];
    for(const check of cChecks) {const li=el('li');li.append(el('strong','',check.question),el('p','',check.detail));if(safeUrl(check.url))li.append(link(check.label || '확인 자료 보기',check.url));checks.append(li);}
    details.append(checks);if(c.caution)details.append(el('p','case-caution',c.caution));
    const source=el('div','source-row'),sourceInfo=el('div');sourceInfo.append(link(c.custom?'직접 추가한 원문 ↗':'출처 커뮤니티 ↗',c.sourceUrl),el('small','',`${c.sourceLabel || '토스증권 커뮤니티'} · 수집 ${c.collectedAt || meta.collectedAt || '날짜 미기록'}`));
    const complete=button(state.completed.includes(c.id)?'✓ 학습 완료':'읽었어요','complete-button'+(state.completed.includes(c.id)?' active':''),()=>{toggle('completed',c.id);document.getElementById(`done-${page}-${c.id}`)?.focus({preventScroll:true});});complete.id=`done-${page}-${c.id}`;complete.setAttribute('aria-pressed',String(state.completed.includes(c.id)));source.append(sourceInfo,complete);details.append(source);
    if(c.custom)details.append(button('추가한 글 삭제','text-button delete-button',()=>deleteCase(c.id)));
    card.append(head,compare,bottom,details);return card;
  }
  function renderStocks() {
    const wrap=$('#stock-filters');wrap.replaceChildren();
    for(const s of [{code:'all',name:'전체 종목'},...allStocks()]) {
      const b=button('','stock-button'+(stock===s.code?' active':''),()=>{stock=s.code;limit=8;renderRead();});b.setAttribute('aria-pressed',String(stock===s.code));
      const name=el('span','stock-name');name.append(el('span','stock-monogram',s.code==='all'?'모두':s.name.startsWith('SK')?'SK':s.name.slice(0,1)),document.createTextNode(s.name));
      b.append(name,el('span','stock-count',s.code==='all'?allCases().length:allCases().filter(c=>c.stock===s.code).length));wrap.append(b);
    }
    if(stock!=='all')wrap.append(link('종목 커뮤니티 열기 ↗',`https://www.tossinvest.com/stocks/A${stock}/community`,'stock-community-link'));
  }
  function renderRead() {
    renderStocks();
    const cats=[...new Set(allCases().map(c=>c.category).filter(Boolean))];const select=$('#case-category');select.replaceChildren();
    for(const c of ['all',...cats]) {const o=el('option','',c==='all'?'모든 주제':c);o.value=c;select.append(o);}select.value=caseCategory;
    if(!select.value){caseCategory='all';select.value='all';}
    const matches=allCases().filter(c=>(stock==='all'||c.stock===stock)&&(caseCategory==='all'||c.category===caseCategory)&&(!hideCompleted||!state.completed.includes(c.id))&&(!caseSearch||normalize([c.title,c.excerpt,c.explanation,stockName(c.stock),...(c.terms||[]).map(id=>termMap.get(id)?.name||'')].join(' ')).includes(normalize(caseSearch))));
    const count=$('#case-result-count');count.replaceChildren(el('strong','',`${matches.length}개의 문장`),document.createTextNode(stock==='all'?'을 함께 읽어요':` · ${stockName(stock)}`));
    const wrap=$('#case-list');wrap.replaceChildren(...matches.slice(0,limit).map(caseCard));
    if(!matches.length)wrap.append(empty('아직 만날 문장이 없어요',allCases().length?'검색어나 선택한 조건을 바꾸거나 직접 문장을 추가해 보세요.':'확인한 커뮤니티 문장을 추가하면 원문과 해석을 함께 볼 수 있어요.','글 추가하기',openAddCase));
    $('#load-more').hidden=matches.length<=limit;$('#load-more').textContent=`다음 글 더 보기 · ${Math.min(8,matches.length-limit)}개`;
  }
  function termCard(t) {
    const card=el('article','term-card'),head=el('div','term-card-header'),info=el('div');
    info.append(el('p','term-category',`${t.category || '주식 용어'}${t.level?' · '+t.level:''}`),el('h2','term-title',t.name));
    if(t.aliases?.length)info.append(el('p','term-aliases',t.aliases.join(' · ')));
    const saved=state.savedTerms.includes(t.id),save=button('','icon-button'+(saved?' is-saved':''),()=>saveTerm(t.id),'bookmark');save.id=`save-term-${page}-${t.id}`;save.setAttribute('aria-label',saved?`${t.name} 저장 해제`:`${t.name} 저장`);save.setAttribute('aria-pressed',String(saved));head.append(info,save);
    const bottom=el('div','term-card-footer'),usage=allCases().filter(c=>(c.terms||[]).includes(t.id)).length;
    bottom.append(el('span','term-usage',usage?`사례·해석 ${usage}개와 연결`:'함께 알아두면 좋은 용어'),button('뜻 더 읽기','text-button',()=>openTerm(t.id),'arrow'));
    card.append(head,el('p','term-definition',t.definition),bottom);
    for(const [label,content] of [['예시',t.example],['흔한 오해',t.pitfall],['확인할 질문',t.check]])if(content)card.append(el('p','print-detail',`${label}: ${content}`));
    const sources=el('div','print-detail');for(const s of t.sources || [])sources.append(el('p','',`${s.label}: ${s.url}`));card.append(sources);return card;
  }
  function renderGlossary() {
    const tabs=$('#glossary-categories');tabs.replaceChildren();
    for(const category of ['all',...new Set(glossary.map(t=>t.category).filter(Boolean))]) {const b=button(category==='all'?'전체 용어':category,category===termCategory?'active':'',()=>{termCategory=category;renderGlossary();});b.setAttribute('aria-pressed',String(category===termCategory));tabs.append(b);}
    const used=usedTerms();
    const terms=glossary.filter(t=>(termCategory==='all'||t.category===termCategory)&&(!usedOnly||used.has(t.id))&&(!termSearch||normalize([t.name,...(t.aliases||[]),t.definition,t.pitfall].join(' ')).includes(normalize(termSearch))));
    $('#term-result-count').textContent=`${terms.length}개의 용어 · 예시는 뜻을 이해하기 위해 만든 학습용 문장입니다.`;
    const list=$('#term-list');list.replaceChildren(...terms.map(termCard));
    if(!terms.length)list.append(empty('찾는 용어가 아직 없어요','검색어를 짧게 바꾸거나 전체 주제를 선택해 보세요.','검색 초기화',()=>{termSearch='';termCategory='all';usedOnly=false;$('#term-search').value='';$('#used-only').checked=false;renderGlossary();}));
  }
  function renderNotebook() {
    const stats=$('#notebook-stats');stats.replaceChildren();
    for(const [label,value] of [['저장한 문장',state.savedCases.length],['저장한 용어',state.savedTerms.length],['학습을 마친 문장',state.completed.length]]) {const item=el('div','notebook-stat');item.append(el('strong','',value),el('span','',label));stats.append(item);}
    $$('[data-notebook]').forEach(b=>{b.classList.toggle('active',b.dataset.notebook===notebookTab);b.setAttribute('aria-pressed',String(b.dataset.notebook===notebookTab));});
    const content=$('#notebook-content');content.replaceChildren();
    if(notebookTab==='terms') {
      const terms=glossary.filter(t=>state.savedTerms.includes(t.id));content.className='term-grid';content.append(...terms.map(termCard));
      if(!terms.length)content.append(empty('다시 보고 싶은 말을 담아두세요','용어 옆 책갈피를 누르면 이곳에 모여요.','용어집 둘러보기',()=>navigate('glossary')));
    } else {
      const cases=notebookTab==='custom'?state.cases:allCases().filter(c=>state.savedCases.includes(c.id));content.className='case-list';content.append(...cases.map(caseCard));
      if(!cases.length)content.append(empty(notebookTab==='custom'?'내가 찾은 글도 공부가 돼요':'다시 읽을 문장을 모아보세요',notebookTab==='custom'?'다른 종목의 문장도 링크와 함께 추가할 수 있어요.':'문장 오른쪽의 책갈피를 누르면 이곳에 모여요.',notebookTab==='custom'?'글 추가하기':'실제 글 읽기',notebookTab==='custom'?openAddCase:()=>navigate('read')));
    }
    $('#start-quiz').disabled=!glossary.length;
  }
  function render() {
    $('#hero').hidden=page!=='read';
    for(const name of ['read','glossary','analysis','interpret','notebook'])document.getElementById(`${name}-page`).hidden=page!==name;
    $$('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('#saved-count').textContent=state.savedCases.length+state.savedTerms.length;
    const stats=$('#hero-stats');stats.replaceChildren();
    for(const [value,label] of [[curated.length,'실제 문장'],[glossary.length,'정리한 용어'],[new Set(curated.map(c=>c.stock)).size,'살펴본 종목']]){const s=el('span');s.append(el('strong','',value),document.createTextNode(label));stats.append(s);}
    $('#collection-date').textContent=meta.collectedAt?`수집 기준 ${meta.collectedAt}`:'직접 읽고 선별한 자료';
    $('#selection-footnote').textContent=meta.selectionNote || '용어의 쓰임과 맥락을 학습하기 위한 자료입니다. 글쓴이의 주장과 수치가 사실이라는 뜻은 아닙니다.';
    if(page==='interpret')window.InterpretLab.show();if(page==='read')renderRead();if(page==='glossary')renderGlossary();if(page==='notebook')renderNotebook();if(page==='analysis')window.AnalysisLab.show({openTerm,openCase:id=>{const c=curated.find(c=>c.id===id);if(!c)return;stock='all';caseCategory='all';caseSearch=c.title;hideCompleted=false;$('#case-search').value=caseSearch;$('#case-category').value='all';$('#hide-completed').checked=false;limit=8;navigate('read');}});
  }
  function navigate(name) {
    page=['read','glossary','analysis','interpret','notebook'].includes(name)?name:'read';
    if(location.hash!==`#${page}`)location.hash=page;
    render();window.scrollTo({top:0,behavior:'instant'});
  }
  const dialog=$('#dialog');
  function showDialog(title,eyebrow) {
    $('#dialog-eyebrow').textContent=eyebrow || '';const content=$('#dialog-content');content.replaceChildren(el('h2','',title));content.firstChild.id='dialog-title';
    if(!dialog.open)dialog.showModal();dialog.scrollTop=0;return content;
  }
  function appendDetail(content,title,value) {if(!value)return;const section=el('section','detail-section');section.append(el('h3','',title),el('p','',value));content.append(section);}
  function openTerm(id) {
    const t=termMap.get(id);if(!t)return;
    const content=showDialog(t.name,`${t.category || '주식 용어'}${t.level?' · '+t.level:''}`);
    if(t.aliases?.length)content.append(el('p','term-aliases',t.aliases.join(' · ')));
    content.append(el('p','term-detail-definition',t.definition));
    appendDetail(content,'예를 들면 · 학습용으로 만든 문장',t.example);appendDetail(content,'이렇게 오해하기 쉬워요',t.pitfall);appendDetail(content,'이 질문까지 해보세요',t.check);
    const matched=allCases().filter(c=>(c.terms||[]).includes(id));
    if(matched.length) {const section=el('section','detail-section');section.append(el('h3','',`사례·해석 ${matched.length}개와 연결`));
      for(const c of matched.slice(0,4)) {const p=el('p');p.append(el('span','',`${stockName(c.stock)} · ${c.title} `),link(c.custom?'원문 ↗':'출처 커뮤니티 ↗',c.sourceUrl));section.append(p);}content.append(section);}
    if(t.sources?.length) {const section=el('section','detail-section'),list=el('ul','source-list');section.append(el('h3','', '뜻을 확인한 자료'));for(const s of t.sources) {const li=el('li');li.append(link(s.label,s.url));list.append(li);}section.append(list);content.append(section);}
    const saved=state.savedTerms.includes(id),save=button(saved?'✓ 학습장에 저장됨':'학습장에 용어 저장','button'+(saved?'':' primary'),()=>{toggle('savedTerms',id);openTerm(id);},'bookmark');content.append(save);
  }
  function stockOptions(select,selected) {for(const s of allStocks()) {const o=el('option','',`${s.name} (${s.code})`);o.value=s.code;select.append(o);}if(selected&&selected!=='all')select.value=selected;}
  function field(label,id,input,help) {const wrap=el('div','form-field'),l=el('label','',label);input.id=id;l.htmlFor=id;wrap.append(l,input);if(help){const small=el('small','',help);small.id=`${id}-help`;input.setAttribute('aria-describedby',small.id);wrap.append(small);}return wrap;}
  function openAddStock(onComplete) {
    const content=showDialog('관심 종목 추가','다른 종목으로 넓혀보기');content.append(el('p','dialog-description','종목 이름과 6자리 코드를 저장한 뒤, 그 종목에서 읽은 문장을 직접 추가할 수 있어요.'));
    const form=el('form'),grid=el('div','form-grid'),name=el('input'),code=el('input');name.required=true;name.maxLength=30;name.placeholder='종목 이름';code.required=true;code.pattern='[0-9]{6}';code.maxLength=6;code.inputMode='numeric';code.placeholder='6자리 숫자';
    grid.append(field('종목 이름','stock-name',name),field('종목코드','stock-code',code,'국내 주식의 6자리 종목코드를 입력해 주세요.'));
    const error=el('p','form-error');error.setAttribute('role','alert');const actions=el('div','form-actions');actions.append(button('취소','button',()=>dialog.close()));const submit=button('종목 추가','button primary');submit.type='submit';actions.append(submit);form.append(grid,error,actions);
    form.addEventListener('submit',event=>{event.preventDefault();const n=name.value.trim(),c=code.value.trim();if(!n||!/^\d{6}$/.test(c)){error.textContent='종목 이름과 숫자 6자리 코드를 확인해 주세요.';return;}
      if(allStocks().some(s=>s.code===c||normalize(s.name)===normalize(n))){error.textContent='이미 추가한 종목입니다. 관심 종목 목록에서 선택해 주세요.';return;}
      if(state.stocks.length>=100){error.textContent='추가 종목은 100개까지 보관할 수 있습니다.';return;}
      state.stocks.push({code:c,name:n,sector:'직접 추가'});persist();stock=c;render();if(onComplete)onComplete(c);else dialog.close();});content.append(form);setTimeout(()=>name.focus(),0);
  }
  function openAddCase(selected) {
    const content=showDialog('내가 찾은 문장 추가','직접 추가 · 개인 학습용');
    content.append(el('p','dialog-description','커뮤니티에서 읽은 짧은 문장을 가져오세요. 용어집에서 아는 말을 찾아 표시하고, 내 해석을 나란히 보관해요.'));
    const form=el('form'),grid=el('div','form-grid'),select=el('select');stockOptions(select,selected||stock);
    const stockField=field('종목','case-stock',select);stockField.append(button('다른 종목 추가','text-button',()=>openAddStock(openAddCase)));
    const url=el('input');url.type='url';url.required=true;url.maxLength=2000;url.placeholder='https://www.tossinvest.com/stocks/A005930/community?post=…';
    const excerpt=el('textarea');excerpt.required=true;excerpt.maxLength=300;excerpt.placeholder='용어가 들어간 부분을 짧게 발췌해 주세요.';
    const explanation=el('textarea');explanation.maxLength=2000;explanation.placeholder='이 문장은 무슨 뜻일까요? 주장에 어떤 근거가 필요한지도 적어보세요.';
    const excerptField=field('원문 일부 발췌 (필수)','case-excerpt',excerpt,'최대 300자 · 전체 글 대신 용어를 이해할 수 있는 짧은 부분만 넣어주세요.');
    const counter=el('small','','0 / 300자'),detected=el('div','detected-terms');excerptField.append(counter,detected);
    excerpt.addEventListener('input',()=>{counter.textContent=`${excerpt.value.length} / 300자`;const ids=detectTerms(excerpt.value);detected.replaceChildren(...ids.map(id=>el('span','',termMap.get(id).name)));});
    grid.append(stockField,field('원문 주소 (필수)','case-url',url,'http 또는 https로 시작하는 원문 링크를 남겨주세요.'),excerptField,field('내가 이해한 뜻 (선택)','case-explanation',explanation));
    const note=el('p','notice-box','용어집에 있는 용어가 하나 이상 포함되어야 저장할 수 있어요. 직접 추가한 글은 미검증으로 표시하며, 해석을 자동으로 생성하거나 사실을 검증하지 않습니다.');
    const error=el('p','form-error');error.setAttribute('role','alert');error.id='case-form-error';form.setAttribute('aria-describedby',error.id);
    const actions=el('div','form-actions');actions.append(button('취소','button',()=>dialog.close()));const submit=button('내 학습장에 추가','button primary');submit.type='submit';actions.append(submit);form.append(grid,note,error,actions);
    form.addEventListener('submit',event=>{event.preventDefault();error.textContent='';const sourceUrl=safeUrl(url.value.trim()),text=excerpt.value.trim(),terms=detectTerms(text);
      if(!sourceUrl){error.textContent='원문 주소는 http 또는 https로 시작해야 합니다.';url.setAttribute('aria-invalid','true');url.focus();return;}url.removeAttribute('aria-invalid');
      if(!text||text.length>300){error.textContent='원문을 1~300자로 입력해 주세요.';excerpt.focus();return;}
      if(!terms.length){error.textContent='용어집의 용어가 감지되지 않았습니다. 전문 용어가 들어간 부분을 발췌해 주세요.';excerpt.focus();return;}
      if(allCases().some(c=>postKey(sourceUrl)&&postKey(c.sourceUrl)===postKey(sourceUrl)||normalize(c.excerpt)===normalize(text))){error.textContent='같은 개별 글 주소 또는 같은 문장이 이미 있습니다. 기존 글을 학습장에 저장해 보세요.';return;}
      if(state.cases.length>=500){error.textContent='직접 추가한 글은 500개까지 보관할 수 있습니다.';return;}
      const id=`user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      state.cases.push({id,stock:select.value,title:text.length>42?text.slice(0,42)+'…':text,excerpt:text,sourceUrl,sourceLabel:'직접 추가한 출처',publishedAt:'작성일 미확인',collectedAt:new Date().toISOString().slice(0,10),terms,category:'직접 추가',explanation:explanation.value.trim(),claimType:'미분류',reason:'직접 추가한 자료입니다. 해석과 주장의 근거를 직접 확인해 주세요.',checks:[],caution:'직접 추가 · 미검증. 입력한 문장과 해석을 보관하며 자동 사실 확인은 하지 않습니다.',custom:true});state.savedCases.push(id);persist();dialog.close();notebookTab='custom';navigate('notebook');toast('문장을 내 학습장에 추가했습니다.');});content.append(form);setTimeout(()=>select.focus(),0);
  }
  function deleteCase(id) {
    const item=state.cases.find(c=>c.id===id);if(!item)return;
    const wasSaved=state.savedCases.includes(id),wasCompleted=state.completed.includes(id),index=state.cases.indexOf(item);
    state.cases=state.cases.filter(c=>c.id!==id);state.savedCases=state.savedCases.filter(x=>x!==id);state.completed=state.completed.filter(x=>x!==id);persist();render();
    toast('추가한 글을 삭제했습니다.',()=>{state.cases.splice(index,0,item);if(wasSaved)state.savedCases.push(id);if(wasCompleted)state.completed.push(id);persist();render();});
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`문장너머-학습기록-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportContribution() {
    if(!state.cases.length){toast('직접 추가한 사례가 없습니다. 먼저 학습할 문장을 추가해 주세요.');return;}
    const codes=new Set(state.cases.map(c=>c.stock));
    const contribution={format:'sentence-beyond.contribution.v1',exportedAt:new Date().toISOString(),stocks:state.stocks.filter(s=>codes.has(s.code)).map(s=>({code:s.code,name:s.name,sector:s.sector})),cases:state.cases};
    const blob=new Blob([JSON.stringify(contribution,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');
    a.href=url;a.download=`문장너머-공개검토용사례-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function updateRequestText() {
    const repositoryUrl=safeUrl(meta.publication?.repositoryUrl);
    return [
      '문장 너머 주식 용어 학습 사이트의 공개 자료를 업데이트해 주세요.',
      repositoryUrl?`저장소: ${repositoryUrl}`:'이 사이트의 GitHub 저장소에서 작업해 주세요.',
      `기존 ${baseStocks.map(s=>s.name).join('·')} 사례와 용어집을 살펴보고, 관심 종목의 새 자료를 보강해 주세요.`,
      '토스증권 커뮤니티의 실제 게시글을 Computer Use로 직접 열고 스크롤하며 확인해 주세요. 공식 API로 허용된 조회가 가능한지도 확인하되, 읽지 않은 원문이나 출처를 만들어내지 마세요.',
      '반복되는 문장·용어, 욕설·조롱, 광고·근거 없는 매매 신호를 걸러내고 공부에 도움이 되는 사례만 고르세요. 전체 글 대신 필요한 짧은 부분을 발췌하고 원문의 뜻을 바꾸지 마세요.',
      '첨부한 공개 검토용 사례 JSON이 있다면 제안 자료로만 취급하고 원문·해석을 다시 확인해 주세요. 개인 학습기록 백업이나 책갈피는 공개하지 마세요.',
      '기존 glossary.json과 cases.json을 중복 없이 보강하고, 쉬운 해석·관찰/의견/전망의 구분·확인할 질문을 작성해 주세요. 용어의 뜻은 공식 자료와 대조해 주세요.',
      '원문 출처와 확인일, 글의 게시시각을 기록하고 개별 글 링크를 확보하지 못했다면 종목 피드 링크임을 명시하세요. 학습용 제목·예문과 실제 발췌를 구분해 주세요.',
      '데이터 형식·출처 링크·기존 기능·모바일 화면을 검증하고 단일 HTML을 빌드하세요. 검토한 공개 자료만 저장소의 main에 반영한 뒤 GitHub Pages 배포 성공과 실제 사이트 반영을 확인해 주세요.',
      '최종 응답에는 추가/수정한 사례와 용어 수, 수집 범위와 한계, 공개 사이트 주소를 알려주세요.'
    ].join('\n\n');
  }
  function openUpdates() {
    const content=showDialog('자료를 계속 쌓아가려면','문장 너머 업데이트');
    content.append(el('p','dialog-description','내 브라우저에 문장을 모으고, 함께 읽을 공개 자료는 확인과 편집을 거쳐 업데이트해요. 커뮤니티 글을 자동으로 수집하거나 저절로 추가하지는 않습니다.'));
    const steps=el('ol','update-steps');
    const personal=el('li');personal.append(el('h3','', '내 학습장에 먼저 모으기'),el('p','', '글 추가하기로 남긴 발췌·해석과 책갈피·복습 기록은 이 브라우저에만 저장됩니다. 다른 사람이 보는 공개 사이트에 바로 올라가지 않아요.'));
    const personalActions=el('div','update-step-actions');personalActions.append(button('글 추가하기','button primary',()=>openAddCase()),button('내 기록 백업하기','text-button',exportBackup));personal.append(personalActions);steps.append(personal);
    const contribution=el('li');contribution.append(el('h3','', '함께 읽을 사례 제안하기'),el('p','', '원문의 짧은 발췌와 출처를 확인하고, 내 해석을 점검해 주세요. 추가한 사례를 공개 검토용 JSON으로 내려받아 저장소 편집자나 Codex에 전달할 수 있어요.'));
    const contributionActions=el('div','update-step-actions'),download=button('추가한 사례 내보내기','button',exportContribution);download.disabled=!state.cases.length;download.setAttribute('aria-describedby','contribution-note');contributionActions.append(download);contribution.append(contributionActions);
    const countNote=el('p','update-file-note',state.cases.length?`직접 추가한 사례 ${state.cases.length}개와 그 사례에 필요한 추가 종목만 담습니다. 내 해석도 포함되니 전달 전에 확인해 주세요. 책갈피·학습 완료·복습 기록은 제외됩니다.`:'아직 직접 추가한 사례가 없습니다. 먼저 글을 추가하면 공개 검토용 파일을 내려받을 수 있어요.');countNote.id='contribution-note';contribution.append(countNote,el('p','update-file-note','공개 검토용 파일은 학습 기록 백업과 별개입니다. 내려받기만으로 전송·공개되지 않으며, 백업 가져오기에 넣는 파일도 아닙니다.'));steps.append(contribution);
    const publication=el('li');publication.append(el('h3','', '검토한 자료를 공개 사이트에 반영하기'),el('p','', '저장소에서 원문·해석·용어와 중복 여부를 검토하고 공개 자료를 편집합니다. 검증한 변경을 main에 반영하면 GitHub Pages가 자동 배포하며, 배포 상태와 실제 사이트에서 반영 여부를 확인할 수 있어요. 개인 학습기록과 책갈피는 이 과정에 포함하지 않습니다.'));
    const links=el('div','update-links');for(const [key,label] of [['updateGuideUrl','업데이트 안내서'],['repositoryUrl','자료 저장소'],['editCasesUrl','공개 사례 편집'],['actionsUrl','배포 상태'],['siteUrl','공개 사이트']]) {const url=safeUrl(meta.publication?.[key]);if(url)links.append(link(`${label} ↗`,url));}if(links.childElementCount)publication.append(links);steps.append(publication);content.append(steps);
    const requestSection=el('section','detail-section');requestSection.append(el('h3','', 'Codex에 업데이트 맡기기'),el('p','', '아래 요청을 복사해 Codex에 붙여넣으세요. 제안할 사례가 있다면 공개 검토용 파일을 함께 첨부하면 됩니다.'));
    const request=updateRequestText(),preview=el('details','update-request'),summary=el('summary','', '복사할 요청 미리 보기'),requestField=el('textarea');requestField.value=request;requestField.readOnly=true;requestField.setAttribute('aria-label','Codex에 보낼 업데이트 요청');preview.append(summary,requestField);
    const status=el('p','copy-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const copy=button('Codex에 업데이트 요청 복사','text-button',async()=>{copy.disabled=true;try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(request);status.textContent='요청을 복사했습니다. Codex 대화에 붙여넣어 주세요.';}catch{preview.open=true;requestField.focus();requestField.select();status.textContent='자동 복사를 사용할 수 없습니다. 선택된 요청을 ⌘C 또는 Ctrl+C로 복사해 주세요.';}finally{copy.disabled=false;}});
    requestSection.append(copy,status,preview);content.append(requestSection);
  }
  async function importBackup(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size>3*1024*1024){toast('파일이 너무 큽니다. 3MB 이하의 학습 기록 JSON을 선택해 주세요.');return;}
    try {
      const incoming=validateState(JSON.parse(await file.text()));
      const merged=validateState({version:1,stocks:[...state.stocks,...incoming.stocks],cases:[...state.cases,...incoming.cases],savedCases:[...state.savedCases,...incoming.savedCases],savedTerms:[...state.savedTerms,...incoming.savedTerms],completed:[...state.completed,...incoming.completed],review:[...state.review,...incoming.review]});
      const before=state;state=merged;persist();render();toast('기존 기록에 백업 내용을 합쳤습니다.',()=>{state=before;persist();render();});
    }catch(error){toast(error instanceof SyntaxError?'JSON 파일을 읽지 못했습니다. 내보낸 백업 파일을 선택해 주세요.':error.message || '백업 형식이 올바르지 않습니다.');}
  }
  function openMethod() {
    const content=showDialog('자료 수집과 출처','문장 너머의 읽기 원칙');
    content.append(el('p','dialog-description','원문의 말투를 살린 짧은 발췌와 작성한 해설을 구분합니다. 출처 링크에서 앞뒤 맥락을 함께 확인해 주세요.'));
    appendDetail(content,'살펴본 범위',`${baseStocks.map(s=>s.name).join(', ')}${meta.collectedAt?' · 수집 기준 '+meta.collectedAt:''}\n${curated.length}개의 선별 문장, ${glossary.length}개의 용어${Number.isFinite(meta.reviewedCount)?' · 살펴본 글 '+meta.reviewedCount+'개':''}`);
    appendDetail(content,'수집 방식',meta.method || '공개된 커뮤니티 화면을 확인하고 학습에 필요한 짧은 부분을 골랐습니다.');
    appendDetail(content,'API 확인',meta.apiStatus || '이 HTML은 외부 API를 호출하지 않습니다.');
    if(meta.sources?.length) {const section=el('section','detail-section'),list=el('ul','source-list');section.append(el('h3','', '수집 방법 참고 자료'));for(const s of meta.sources) {const li=el('li');li.append(link(s.label,s.url));list.append(li);}section.append(list);content.append(section);}
    appendDetail(content,'선별 기준',meta.selectionNote || '전문 용어의 의미와 문맥을 공부할 수 있는 글을 선별하고, 반복되는 용례와 단순 감정 표현은 제외합니다.');
    appendDetail(content,'원문과 풀이를 구분해 주세요','커뮤니티 원문은 이용자의 의견입니다. 전문 용어를 썼다는 이유로 수치나 전망이 확인된 사실이 되는 것은 아닙니다. 해석은 용어 학습용이며 매수·매도 추천이 아닙니다. 용어집의 예문은 이해를 돕기 위해 작성했습니다.');
    if(meta.limitations?.length) {const section=el('section','detail-section'),list=el('ul');section.append(el('h3','', '자료의 범위와 한계'));for(const value of meta.limitations)list.append(el('li','',value));section.append(list);content.append(section);}
    appendDetail(content,'기록과 개인정보','책갈피, 학습 완료, 직접 추가한 문장은 이 브라우저의 저장소에만 보관됩니다. 브라우저 기록을 지우거나 다른 기기에서 열면 이어지지 않을 수 있으니 JSON 백업을 활용해 주세요.');
  }
  function startQuiz() {
    quiz=glossary.filter(t=>state.savedTerms.includes(t.id));if(!quiz.length)quiz=[...glossary];
    quiz.sort((a,b)=>{const ar=state.review.find(r=>r.id===a.id)?.status,br=state.review.find(r=>r.id===b.id)?.status;return (ar==='again'?-1:ar==='known'?1:0)-(br==='again'?-1:br==='known'?1:0);});
    quiz=quiz.slice(0,10);quizIndex=0;quizKnown=0;quizRevealed=false;showQuiz();
  }
  function showQuiz() {
    if(quizIndex>=quiz.length) {const content=showDialog('오늘의 복습을 마쳤어요','내 언어로, 한 걸음');content.append(el('p','quiz-definition',`${quiz.length}개의 용어 중 ${quizKnown}개를 알고 있었어요.`),el('p','dialog-description','다시 보기로 표시한 용어는 다음 복습에 먼저 나와요.'),button('학습장으로 돌아가기','button primary',()=>{dialog.close();navigate('notebook');}));return;}
    const t=quiz[quizIndex],content=showDialog('이 뜻을 가진 말은?','용어 복습');content.append(el('p','quiz-progress',`${quizIndex+1} / ${quiz.length} · ${state.savedTerms.length?'저장한 용어부터':'용어집에서 시작해요'}`),el('p','quiz-definition',t.definition));
    if(!quizRevealed)content.append(button('정답 확인하기','button primary',()=>{quizRevealed=true;showQuiz();}));
    else {const answer=el('div','quiz-answer');answer.append(el('h3','',t.name),el('p','',t.pitfall || t.example));content.append(answer);const actions=el('div','form-actions');for(const [label,status] of [['다시 볼게요','again'],['알고 있어요','known']])actions.append(button(label,'button'+(status==='known'?' primary':''),()=>{state.review=state.review.filter(r=>r.id!==t.id);state.review.push({id:t.id,status,at:new Date().toISOString()});if(status==='known')quizKnown++;else if(!state.savedTerms.includes(t.id))state.savedTerms.push(t.id);persist();quizIndex++;quizRevealed=false;render();showQuiz();}));content.append(actions);}
  }
  $$('[data-page]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();navigate(a.dataset.page);}));
  $('[href="#read"].brand').addEventListener('click',e=>{e.preventDefault();navigate('read');});
  window.addEventListener('hashchange',()=>{const next=location.hash.slice(1).split('/')[0];if(['read','glossary','analysis','interpret','notebook'].includes(next)&&(next!==page||next==='analysis')){page=next;render();}});
  $('#case-search').addEventListener('input',e=>{caseSearch=e.target.value;limit=8;renderRead();});
  $('#case-category').addEventListener('change',e=>{caseCategory=e.target.value;limit=8;renderRead();});
  $('#hide-completed').addEventListener('change',e=>{hideCompleted=e.target.checked;limit=8;renderRead();});
  $('#load-more').addEventListener('click',()=>{limit+=8;renderRead();});
  $('#term-search').addEventListener('input',e=>{termSearch=e.target.value;renderGlossary();});
  $('#used-only').addEventListener('change',e=>{usedOnly=e.target.checked;renderGlossary();});
  $$('[data-notebook]').forEach(b=>b.addEventListener('click',()=>{notebookTab=b.dataset.notebook;renderNotebook();}));
  $('#close-dialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  const actions={'add-case':()=>openAddCase(),'add-stock':()=>openAddStock(),'method':openMethod,'updates':openUpdates,'export':exportBackup,'import':()=>$('#backup-file').click(),'print':()=>{termSearch='';termCategory='all';usedOnly=false;$('#term-search').value='';$('#used-only').checked=false;renderGlossary();window.print();}};
  $$('[data-action]').forEach(b=>b.addEventListener('click',()=>actions[b.dataset.action]?.()));
  $('#backup-file').addEventListener('change',importBackup);$('#start-quiz').addEventListener('click',startQuiz);
  window.addEventListener('beforeprint',()=>{const previous={termSearch,termCategory,usedOnly};termSearch='';termCategory='all';usedOnly=false;renderGlossary();({termSearch,termCategory,usedOnly}=previous);});
  window.addEventListener('afterprint',()=>{if(page==='glossary')renderGlossary();});
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!dialog.open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();if(page==='notebook')navigate('read');if(page==='analysis'&&$('#analysis-search-wrap')?.hidden){location.hash='analysis/technical';return;}$(page==='interpret'?'#interpret-text':page==='analysis'?'#analysis-search':page==='glossary'?'#term-search':'#case-search')?.focus();}});
  window.addEventListener('storage',e=>{if(e.key!==KEY)return;try{state=e.newValue?validateState(JSON.parse(e.newValue)):blankState();render();}catch{toast('다른 창의 기록을 읽지 못했습니다. 현재 기록을 백업해 주세요.');}});
  const initial=location.hash.slice(1).split('/')[0];page=['read','glossary','analysis','interpret','notebook'].includes(initial)?initial:'read';render();
  if(storageError)toast(storageError);
})();
