(() => {
  'use strict';
  const data=window.STUDY_DATA?.analysis||{},lessons=data.lessons||[],groups={technical:'차트 읽기',fundamental:'기업 지표',investors:'투자 대가',workflow:'종합 실습'};
  const $=(s,r=document)=>r.querySelector(s),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,cls,fn)=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
  const normalize=s=>String(s).normalize('NFKC').replace(/\s/g,'').toLowerCase();
  const safeLink=(label,url)=>{const a=el('a','',label);try{const u=new URL(url);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}}catch{}return a;};
  let initialized=false,group='technical',selected='',search='',root,options,chartMode=false,chartPeriod=5,routeSeen='';
  const state={price:15000,growth:5,discount:9,terminalGrowth:2};
  const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  function list(values,tag='ul',cls=''){const n=el(tag,cls);for(const v of values||[])n.append(el('li','',v));return n;}
  function sources(items){const d=el('details','analysis-sources');d.append(el('summary','',`설명을 확인한 자료 ${items.length}개`));const ul=el('ul');for(const s of items){const li=el('li');li.append(safeLink(s.label,s.url));ul.append(li);}d.append(ul,el('p','',`개념 설명의 근거입니다. 가상 예시나 특정 종목의 결과를 입증하는 자료는 아닙니다. 자료 확인 ${data.updatedAt||''}`));return d;}
  function section(title,content,cls=''){const s=el('section',`analysis-section ${cls}`);s.append(el('h3','',title),content);return s;}
  function matches(l){return !search||normalize([l.title,l.subtitle,l.summary,...l.terms.flatMap(t=>[t.name,t.meaning,t.formula]),...l.steps].join(' ')).includes(normalize(search));}
  function selectLesson(id,focus=false){const l=lessons.find(x=>x.id===id);if(!l)return;selected=id;group=l.group;chartMode=false;history.replaceState(null,'',`#analysis/${id}`);routeSeen=location.hash;render();if(focus)$('#analysis-lesson-title')?.focus({preventScroll:true});}
  function render(){
    for(const b of root.querySelectorAll('[data-analysis-group]')){const active=b.dataset.analysisGroup===group;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);}
    $('#analysis-library').hidden=group==='workflow';$('#analysis-workflow').hidden=group!=='workflow';$('#analysis-search-wrap').hidden=group==='workflow';
    if(group==='workflow'){renderWorkflow();return;}
    const filtered=lessons.filter(l=>(search?true:l.group===group)&&matches(l));
    const index=$('#analysis-index'),select=$('#analysis-select');index.replaceChildren();select.replaceChildren();
    $('#analysis-result-count').textContent=search?`전체 분야에서 ${filtered.length}개 수업`:`${groups[group]} · ${filtered.length}개 수업`;
    if(!filtered.some(l=>l.id===selected))selected=filtered[0]?.id||'';
    for(const l of filtered){const b=btn(l.title,'analysis-index-item',()=>selectLesson(l.id,true));b.dataset.lessonId=l.id;b.classList.toggle('active',l.id===selected);b.setAttribute('aria-current',l.id===selected?'true':'false');b.prepend(el('small','',`${groups[l.group]} · ${l.level}`));index.append(b);const o=el('option','',l.title);o.value=l.id;select.append(o);}select.value=selected;select.disabled=!filtered.length;
    const article=$('#analysis-detail');article.replaceChildren();
    if(!selected){article.append(el('div','empty-state','일치하는 수업이 없습니다. 다른 용어나 기법 이름으로 검색해 보세요.'));return;}
    renderLesson(lessons.find(l=>l.id===selected),article);
  }
  function renderLesson(l,article){
    const heading=el('header','analysis-lesson-heading'),h=el('h2','',l.title);h.id='analysis-lesson-title';h.tabIndex=-1;
    heading.append(el('p','quiet-label',`${groups[l.group]} / ${l.level}`),h,el('p','analysis-subtitle',l.subtitle),el('p','analysis-summary',l.summary));article.append(heading);
    if(l.group==='technical')article.append(chart(l.chartKind));
    if(l.group==='fundamental')article.append(btn('가상 기업의 숫자를 직접 바꿔보기 ↗','analysis-inline-link',()=>switchGroup('workflow')));
    const quote=el('div','analysis-expression');quote.append(el('small','',`${l.expression.label} · 실제 게시물·투자 대가의 발언 인용이 아닙니다`),el('blockquote','',l.expression.text),el('p','',l.expression.meaning));article.append(section('이런 표현을 만나면',quote));
    const terms=el('div','analysis-terms');
    for(const t of l.terms){const card=el('section','analysis-term'),title=el('h4','',t.name);card.append(title,el('p','',t.meaning));if(t.formula)card.append(el('p','analysis-formula',t.formula));card.append(el('div','analysis-example',t.example),el('p','analysis-pitfall',`다르게 볼 지점 · ${t.pitfall}`));
      const g=(window.STUDY_DATA.glossary||[]).find(g=>[g.name,...(g.aliases||[])].some(name=>normalize(name)===normalize(t.name)));if(g)card.append(btn('용어집 뜻·책갈피 열기','text-button',()=>options.openTerm(g.id)));terms.append(card);
    }
    article.append(section('말과 숫자를 하나씩 풀어보기',terms),section('사례를 읽는 순서',list(l.steps,'ol','analysis-steps')),section('이 해석을 반박해 본다면',list(l.critical,'ul','analysis-critical'),'analysis-critical-section'));
    const relatedMap={support:['case-09'],ma:['case-03'],fibonacci:['case-03'],volume:['case-11'],risk:['case-08']};
    let related=l.group==='technical'?relatedMap[l.chartKind]||[]:[];
    if(l.group==='fundamental'){const names=l.terms.map(t=>t.name).join(' ');if(/FCF|잉여현금|배당/.test(names))related=['case-05'];else if(/ASP|판매단가|제품.*구성/.test(names))related=['case-10'];else if(/회계|감사/.test(names))related=['case-15'];}
    if(related.length){const box=el('div','analysis-related');for(const id of related){const c=window.STUDY_DATA.cases.find(c=>c.id===id);if(c)box.append(btn(`${c.title} ↗`,'text-button',()=>options.openCase(id)));}article.append(section('직접 확인한 커뮤니티 글과 연결',box));}
    article.append(sources(l.sources),btn('이 수업 인쇄하기','button analysis-print-button',()=>window.print()));
  }
  function chart(kind){
    const wrap=el('section','analysis-chart-lab'),top=el('div','analysis-chart-toolbar');top.append(el('h3','','가상 차트로 비교하기'));
    const modes=el('div','analysis-toggle');for(const [label,value]of [['기본 예시',false],['반례 보기',true]]){const b=btn(label,chartMode===value?'active':'',()=>{chartMode=value;update();});b.dataset.chartMode=String(value);b.setAttribute('aria-pressed',chartMode===value);modes.append(b);}top.append(modes);wrap.append(top,el('p','analysis-chart-notice','실제 종목·시세가 아닌 학습용 가상 데이터입니다. 반례는 가능한 다른 상황을 보여줍니다.'));
    if(kind==='ma'){const control=el('label','analysis-period','평균에 넣을 관측값 '),range=el('input');range.type='range';range.min=3;range.max=12;range.value=chartPeriod;range.setAttribute('aria-label','이동평균 관측값 개수');const output=el('output');output.textContent=chartPeriod;range.addEventListener('input',()=>{chartPeriod=Number(range.value);output.textContent=chartPeriod;update();});control.append(range,output);wrap.append(control);}
    const target=el('div','analysis-chart'),legend=el('div','analysis-chart-legend'),caption=el('p','analysis-chart-caption');caption.setAttribute('aria-live','polite');wrap.append(target,legend,caption);
    const tableDetails=el('details','analysis-data-table');tableDetails.append(el('summary','','차트 수치 표로 읽기'));const tableWrap=el('div','analysis-table-wrap');tableDetails.append(tableWrap);wrap.append(tableDetails);
    function update(){const model=window.AnalysisCharts.model(kind,chartMode,chartPeriod);window.AnalysisCharts.draw(target,model);legend.replaceChildren();for(const line of [...model.top,...model.bottom]){const span=el('span',`legend-${line.color}`,line.name);legend.append(span);}if(kind==='ohlc')legend.append(el('span','','초록 몸통: 종가 ≥ 시가 · 붉은 몸통: 종가 < 시가'));caption.textContent=model.caption;
      modes.querySelectorAll('button').forEach(b=>{const active=b.dataset.chartMode===String(chartMode);b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
      const series=[...model.top,...model.bottom],extra=kind==='ohlc'?['시가','고가','저가']:model.volume?['가상 거래량']:[];const table=el('table'),head=el('thead'),tr=el('tr');for(const name of ['관측',...series.map(l=>l.name),...extra]){const th=el('th','',name);th.scope='col';tr.append(th);}head.append(tr);table.append(head);const body=el('tbody');const length=Math.max(...series.map(l=>l.values.length));for(let i=0;i<length;i++){const row=el('tr');row.append(el('th','',i+1));for(const line of series)row.append(el('td','',line.values[i]==null?'—':fmt(line.values[i],2)));if(kind==='ohlc')for(const key of ['open','high','low'])row.append(el('td','',fmt(model.candles[i]?.[key],2)));if(model.volume)row.append(el('td','',fmt(model.volume[i],0)));body.append(row);}table.append(body);tableWrap.replaceChildren(table);
    }update();return wrap;
  }
  function switchGroup(next){group=next;search='';$('#analysis-search').value='';selected='';chartMode=false;history.replaceState(null,'',`#analysis/${next}`);routeSeen=location.hash;render();}
  function renderWorkflow(){
    const target=$('#analysis-workflow');target.replaceChildren();const wf=data.workflow||{};
    const h=el('header','analysis-workflow-intro');h.append(el('p','quiet-label','하나의 회사, 여러 개의 질문'),el('h2','',wf.title||'가상정밀을 처음부터 분석해보기'),el('p','',wf.intro||'모든 숫자는 학습용으로 만든 가정입니다. 사실·추정·판단을 분리해서 읽어보세요.'));target.append(h,simulator());
    const steps=el('ol','analysis-workflow-steps');for(const [i,s]of (wf.steps||[]).entries()){const li=el('li'),num=el('span','analysis-step-number',String(i+1).padStart(2,'0')),content=el('div');content.append(el('h3','',s.title),el('p','analysis-workflow-question',s.question),el('p','',s.action),el('div','analysis-example',s.example),el('p','analysis-pitfall',`다시 확인할 신호 · ${s.redFlag}`));li.append(num,content);steps.append(li);}target.append(steps);
    if(wf.conclusion){const c=wf.conclusion,box=el('div','analysis-conclusion');box.append(el('h2','','분석을 한 장으로 정리하면'));for(const [key,title]of [['facts','가상 자료에서 확인한 사실'],['assumptions','우리가 넣은 추정'],['monitor','이후 확인할 변화']])if(c[key])box.append(section(title,Array.isArray(c[key])?list(c[key]):el('p','',c[key])));if(c.judgment)box.append(section('현재의 판단과 보류할 질문',el('p','',c.judgment)));target.append(box);}
    if(wf.sources?.length)target.append(sources(wf.sources));target.append(btn('종합 실습 인쇄하기','button analysis-print-button',()=>window.print()));
  }
  function simulator(){
    const wrap=el('section','analysis-simulator');wrap.append(el('div','analysis-sim-label','전제는 바꾸고, 결론은 다시 보기'),el('h3','','같은 회사의 가치는 왜 달라질까?'),el('p','analysis-sim-description','가상정밀의 현재 실적은 고정합니다. 주가를 바꾸면 가격 지표가, 성장률·할인율을 바꾸면 미래 현금흐름의 평가가 달라집니다.'));
    const fixture=el('details','analysis-fixture');fixture.append(el('summary','','계산에 사용한 가상 재무자료 보기'));
    const rows=[['매출액','전년 800 → 당기 1,000억원'],['영업이익 / 이자비용 / 세율','150억원 / 30억원 / 25%'],['순이익','전년 60 → 당기 90억원'],['감가상각 / EBITDA','40억원 / 190억원'],['영업현금흐름 / CAPEX','130억원 / 60억원'],['자산 / 부채 / 기말 자본','1,000억원 / 450억원 / 550억원'],['평균 자본 / 평균 투하자본','500억원 / 750억원'],['이자부 차입금 / 현금','300억원 / 100억원'],['가중평균·기말 주식수','전년·당기 모두 1,000만 주 (10백만 주)'],['주당배당금','300원'],['CFO−CAPEX 방식 FCF','130−60 = 70억원'],['가치평가용 FCFF','150×(1−25%)+40−60−12.5 = 80억원'],['운전자본 증가','12.5억원 · FCFF 계산에 사용'],['기타 영업현금 조정','+12.5억원 · CFO=90+40−12.5+12.5=130. 정상화 FCFF에서 이 일회성 조정은 제외']];
    const ft=el('table'),fb=el('tbody');for(const [label,value]of rows){const tr=el('tr'),th=el('th','',label);th.scope='row';tr.append(th,el('td','',value));fb.append(tr);}ft.append(fb);fixture.append(ft,el('p','','FCF라는 이름의 계산식은 문서마다 다를 수 있어요. 여기서는 CFO−CAPEX와 FCFF를 분리합니다. 소수지분·비영업자산·리스·옵션 조정은 생략한 제조업 교육 예시입니다.'));wrap.append(fixture);
    const presets=el('div','analysis-presets');for(const [label,values]of [['보수적 가정',{growth:3,discount:11,terminalGrowth:1}],['기준 가정',{growth:5,discount:9,terminalGrowth:2}],['낙관적 가정',{growth:7,discount:8,terminalGrowth:2.5}]])presets.append(btn(label,'button',()=>{Object.assign(state,values);for(const key of Object.keys(inputs)){inputs[key].value=state[key];outputs[key].textContent=key==='price'?`${fmt(state[key],0)}원`:`${fmt(state[key],1)}%`;}update();}));wrap.append(presets);
    const controls=el('div','analysis-sim-controls'),inputs={},outputs={};
    for(const [key,label,min,max,step,unit]of [['price','주가',5000,40000,500,'원'],['growth','향후 5년 FCFF 성장률',-5,15,.5,'%'],['discount','할인율 · WACC',4,15,.5,'%'],['terminalGrowth','5년 후 영구성장률',0,5,.5,'%']]){const field=el('label','analysis-slider'),head=el('span','',label),output=el('output');output.id=`sim-${key}-value`;output.textContent=`${fmt(state[key],key==='price'?0:1)}${unit}`;const input=el('input');input.type='range';input.id=`sim-${key}`;input.min=min;input.max=max;input.step=step;input.value=state[key];input.setAttribute('aria-label',label);input.setAttribute('aria-describedby',output.id);input.addEventListener('input',()=>{state[key]=Number(input.value);output.textContent=`${fmt(state[key],key==='price'?0:1)}${unit}`;update();});field.append(head,output,input);controls.append(field);inputs[key]=input;outputs[key]=output;}wrap.append(controls);
    const results=el('div','analysis-sim-results');results.setAttribute('aria-live','polite');wrap.append(results);const sensitivity=el('div','analysis-sensitivity');wrap.append(sensitivity);
    function update(){
      results.replaceChildren();const m=window.AnalysisMath.company(state.price),valuation=window.AnalysisMath.dcf(state);
      const priceBox=el('div','analysis-valuation'),value=el('strong','',valuation?`${fmt(valuation.perShare,0)}원`:'계산할 수 없어요');value.id='sim-intrinsic';priceBox.append(el('span','','가정으로 계산한 주당가치'),value,el('p','',valuation?`현재 입력 주가 ${fmt(state.price,0)}원 · 영업가치 ${fmt(valuation.enterprise,1)}억원에서 순차입금 200억원을 조정했어요.`:'이 모형은 할인율이 영구성장률보다 높아야 합니다. 가정을 조정해 주세요.'));results.append(priceBox);
      const metrics=el('dl','analysis-metric-grid');for(const [id,label,value,help]of [['eps','EPS',`${fmt(m.eps,0)}원`,'순이익 ÷ 가중평균 주식수'],['per','PER',`${fmt(m.per,2)}배`,'시가총액 ÷ 순이익'],['pbr','PBR',`${fmt(m.pbr,2)}배`,'시가총액 ÷ 기말 자본'],['roe','ROE',`${fmt(m.roe,1)}%`,'순이익 ÷ 평균 자본'],['roic','ROIC',`${fmt(m.roic,1)}%`,'세후영업이익 ÷ 평균 투하자본'],['debt','부채비율',`${fmt(m.debtRatio,1)}%`,'총부채 ÷ 기말 자본'],['coverage','이자보상',`${fmt(m.interestCoverage,1)}배`,'영업이익 ÷ 이자비용'],['ev','EV/EBITDA',`${fmt(m.evEbitda,2)}배`,'(시가총액+순차입금) ÷ EBITDA'],['yoy','매출 YoY',`${fmt(m.revenueGrowth,1)}%`,'전년 동기 대비 매출 증가'],['eps-yoy','EPS YoY',`${fmt(m.epsGrowth,1)}%`,'주식수가 같은 예시의 이익 증가'],['yield','배당수익률',`${fmt(m.dividendYield,2)}%`,'DPS ÷ 주가'],['fcff','FCFF','80억원','현재의 기업 전체 잉여현금흐름']]){const item=el('div');item.append(el('dt','',label));const dd=el('dd','',value);dd.id=`metric-${id}`;item.append(dd,el('small','',help));metrics.append(item);}results.append(metrics);
      sensitivity.replaceChildren();if(valuation){sensitivity.append(el('h4','','끝의 가정이 얼마나 큰가요?'),el('p','',`기업가치의 ${fmt(valuation.terminalShare,1)}%가 5년 이후 영구가치의 현재가치입니다. 먼 미래의 작은 가정 변화가 결론을 크게 바꿀 수 있어요.`));const bars=el('div','analysis-dcf-bars');const amounts=[...valuation.present,valuation.terminalPV],max=Math.max(...amounts);amounts.forEach((amount,i)=>{const col=el('div');const bar=el('div','analysis-dcf-bar');bar.style.height=`${Math.max(3,amount/max*140)}px`;col.append(el('span','',fmt(amount,0)),bar,el('small','',i===5?'5년 이후':`${i+1}년`));bars.append(col);});sensitivity.append(bars,el('p','analysis-chart-notice','연도별 현금흐름과 영구가치의 현재가치 · 단위 억원'));
        const table=el('table','analysis-sensitivity-table'),head=el('tr');head.append(el('th','','WACC / 영구성장률'));const gs=[Math.max(0,state.terminalGrowth-1),state.terminalGrowth,state.terminalGrowth+1];for(const g of gs)head.append(el('th','',`${fmt(g,1)}%`));const th=el('thead');th.append(head);table.append(th);const body=el('tbody');for(const r of [state.discount-1,state.discount,state.discount+1]){const tr=el('tr');tr.append(el('th','',`${fmt(r,1)}%`));for(const g of gs){const d=window.AnalysisMath.dcf({...state,discount:r,terminalGrowth:g});tr.append(el('td','',d?`${fmt(d.perShare,0)}원`:'성립 안 함'));}body.append(tr);}table.append(body);sensitivity.append(el('h4','','가정을 바꾼 주당가치 비교'),table);
      }
      sensitivity.append(el('p','analysis-sim-caution','낮은 PER이나 높은 ROIC 하나로 매수 결론을 내리지 않아요. 미래 현금흐름 추정이 틀렸는지, 업황의 고점인지, 차입·희석·투자 부담을 빠뜨렸는지 검토하세요. 이 계산은 가상 기업 학습용이며 적정주가 추천이 아닙니다.'));
    }update();return wrap;
  }
  function initialize(){
    root=$('#analysis-page');root.innerHTML='';
    const head=el('header','analysis-header');head.append(el('div','quiet-label','기법을 외우기보다, 해석을 검토하는 연습'),el('h1','','투자분석 배우기'),el('p','','차트의 모양부터 기업의 숫자까지. 예시를 읽고, 가정을 바꾸고, 다른 결론도 생각해 보세요.'));
    const stats=el('div','analysis-overview-stats');for(const [n,label]of [[lessons.filter(l=>l.group==='technical').length,'차트 수업'],[lessons.filter(l=>l.group==='fundamental').length,'기업 분석 수업'],[lessons.filter(l=>l.group==='investors').length,'투자 관점']]){const span=el('span');span.append(el('strong','',n),document.createTextNode(label));stats.append(span);}head.append(stats);root.append(head);
    const map=el('div','analysis-approach');map.append(el('p','','차트 분석은 가격·거래량의 움직임을 관찰하고, 기업 분석은 사업·현금흐름·가격의 관계를 검토해요. 두 방법 모두 가정과 실패 조건이 있습니다.'),el('span','','가상 예시는 실제 게시물과 구분해 표시했습니다.'));root.append(map);
    const nav=el('div','analysis-tabs');nav.setAttribute('aria-label','분석 학습 분야');for(const [key,label]of Object.entries(groups)){const b=btn(label,'',()=>switchGroup(key));b.dataset.analysisGroup=key;nav.append(b);}root.append(nav);
    const searchWrap=el('div','analysis-search-wrap');searchWrap.id='analysis-search-wrap';const field=el('label','search-field'),input=el('input');input.type='search';input.id='analysis-search';input.placeholder='헤드앤숄더, EPS, 부채비율, 버핏…';input.setAttribute('aria-label','투자분석 수업 검색');input.addEventListener('input',()=>{search=input.value;selected='';render();});field.append(input);searchWrap.append(field);const count=el('p','result-count');count.id='analysis-result-count';count.setAttribute('role','status');searchWrap.append(count);root.append(searchWrap);
    const library=el('div','analysis-library');library.id='analysis-library';const side=el('aside','analysis-sidebar'),selectLabel=el('label','analysis-mobile-selector','수업 선택'),select=el('select');select.id='analysis-select';select.setAttribute('aria-label','투자분석 수업 선택');select.addEventListener('change',()=>selectLesson(select.value));selectLabel.append(select);side.append(selectLabel);const index=el('nav','analysis-index');index.id='analysis-index';index.setAttribute('aria-label','수업 목록');side.append(index);const article=el('article','analysis-detail');article.id='analysis-detail';library.append(side,article);root.append(library);const workflow=el('div');workflow.id='analysis-workflow';root.append(workflow);initialized=true;
  }
  let printOpened=[];
  window.addEventListener('beforeprint',()=>{
    if(root&&!root.hidden){
      document.body.classList.add('analysis-print');
      for(const detail of root.querySelectorAll('.analysis-sources:not([open]),.analysis-fixture:not([open])')){detail.open=true;printOpened.push(detail);}
    }
  });
  window.addEventListener('afterprint',()=>{document.body.classList.remove('analysis-print');for(const detail of printOpened)detail.open=false;printOpened=[];});
  window.AnalysisLab={show(callbacks){
    options=callbacks;if(!initialized)initialize();
    const route=location.hash.split('/')[1]||'',target=lessons.find(l=>l.id===route);
    if(location.hash!==routeSeen&&(Object.hasOwn(groups,route)||target)){
      search='';$('#analysis-search').value='';chartMode=false;
      if(target){selected=target.id;group=target.group;}else{group=route;selected='';}
    }
    routeSeen=location.hash;render();
  }};
})();
