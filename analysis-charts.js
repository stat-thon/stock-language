(() => {
  'use strict';
  const M=globalThis.AnalysisMath,NS='http://www.w3.org/2000/svg';
  const interpolate=anchors=>anchors.flatMap((v,i)=>i===anchors.length-1?[v]:Array.from({length:5},(_,j)=>v+(anchors[i+1]-v)*j/5));
  const descriptions={
    ohlc:['한 봉에는 시가·고가·저가·종가 네 값이 들어가요. 몸통과 꼬리를 구분하세요.','큰 양봉 뒤에도 하락할 수 있어요. 봉 하나로 다음 날 방향을 확정할 수 없어요.'],
    support:['95 부근에서 여러 번 반등한 가상 가격이에요. 지지·저항은 관찰하는 구간입니다.','반복해서 버티던 95 아래로 내려왔어요. 이전 지지가 영구적인 바닥은 아니에요.'],
    trend:['고점과 저점이 함께 높아지는지 살펴보세요. 어느 두 점을 잇느냐에 따라 선이 달라져요.','끝부분의 저점이 낮아졌어요. 이전 상승 추세를 계속 적용할 수 있는지 다시 확인해요.'],
    ma:['관측값 개수를 바꾸면 평균선의 부드러움과 반응 속도가 달라져요.','횡보 구간에서는 가격이 평균선 위아래를 오가며 잦은 매매 신호를 만들 수 있어요.'],
    cross:['빠른 평균선과 느린 평균선의 상대적인 위치를 비교해요. 기간을 명시해야 같은 신호를 비교할 수 있어요.','짧은 반등이 끝나면 교차 신호가 다시 뒤집힐 수 있어요. 수수료까지 들면 잦은 거래가 불리해질 수 있어요.'],
    volume:['아래 막대는 가상 거래량입니다. 움직임에 참여가 늘었는지 가격과 함께 살펴요.','가격이 올라도 거래량이 약할 수 있어요. 반대로 거래량이 크다고 상승이 보장되는 것도 아니에요.'],
    breakout:['이전 저항 위로 이동한 뒤 같은 구간을 다시 확인하는 모양이에요.','저항 위로 잠깐 오른 뒤 다시 아래로 돌아왔어요. 이것이 허위 돌파의 한 예예요.'],
    headshoulders:['왼쪽 어깨·더 높은 머리·오른쪽 어깨를 봅니다. 목선 이탈 전에는 완성된 하락 신호로 단정하지 않아요.','목선 아래로 잠깐 내려갔다가 위로 되돌아왔어요. 패턴이 그럴듯해도 예상이 실패할 수 있어요.'],
    double:['이중천정의 가상 예시입니다. 두 고점 사이의 저점 이탈 여부가 중요해요. 이중바닥은 반대 구조예요.','비슷한 고점 두 개 뒤에 더 높은 가격으로 돌파했어요. 모양만 보고 하락을 확정하면 틀릴 수 있어요.'],
    triangle:['고점은 120→118→116으로 낮아지고 저점은 100→102→104→106으로 높아지는 대칭 삼각수렴 예시예요. 수렴만으로 방향이 정해지지는 않아요.','위로 갈 듯하던 수렴이 아래로 깨졌어요. 삼각형·깃발은 예측을 검토하는 가설입니다.'],
    rsi:['아래 RSI(14)는 Wilder 방식으로 계산했습니다. 기준선 30·70은 널리 쓰이는 관찰값이에요.','강한 상승이 지속되면 RSI가 70 이상에 오래 머물 수 있어요. 과매수만으로 매도 시점을 정하지 않아요.'],
    macd:['MACD는 EMA(12)−EMA(26), 신호선은 그 값의 EMA(9)입니다. 가격과 별도 축으로 봐요.','횡보가 길면 MACD가 0 주변에서 자주 교차해요. 후행 신호와 거래비용을 함께 고려해요.'],
    bollinger:['20개 평균과 ±2 표준편차(모집단 방식)를 표시했어요. 폭은 최근 변동성에 따라 달라져요.','강한 추세에서는 가격이 상단 밴드 부근을 따라갈 수 있어요. 밴드는 고정된 천장이 아니에요.'],
    atr:['ATR(14)은 진폭을 보는 지표예요. 아래 값이 커져도 상승 방향이라는 뜻은 아니에요.','하락하면서 ATR도 커지는 예시예요. 큰 변동성을 상승 신호로 해석하면 안 돼요.'],
    stochastic:['최근 14개 범위 안에서 종가가 어디에 있는지 %K, 그 3개 평균을 %D로 표시했어요.','강한 추세에서는 80 이상에 계속 머물 수 있어요. 설정과 시장 상황에 따라 교차의 의미가 달라져요.'],
    ichimoku:['구름의 경계 두 선만 표시한 예시예요. 선행스팬 A·B는 과거 가격으로 계산해 26칸 앞으로 그립니다.','미래 위치에 그려졌어도 미래 정보를 안다는 뜻은 아니에요. 횡보에서는 구름을 여러 번 오갈 수 있어요.'],
    fibonacci:['저점 90·고점 130을 골랐을 때의 38.2%·50%·61.8% 되돌림 위치예요. 50%는 관행적으로 함께 쓰는 수준입니다.','61.8% 아래로도 하락할 수 있어요. 시작점 선택과 파동 구분이 달라지면 해석도 달라져요.'],
    risk:['진입 100·손절 기준 94·목표 112면 계획상 이익/손실비는 2배예요. 예상 확률과 비용은 별도로 봐요.','다음 관측가격이 97에서 85로 갭 하락했다고 가정해요. 94를 건너뛰면 계획보다 손실이 커져요. 손절 기준이 체결 가격을 보장하지 않아요.']
  };
  function model(kind,failed=false,period=5){
    let prices=Array.from({length:90},(_,i)=>100+.15*i+7*Math.sin(i*.24)+2*Math.sin(i*.73));
    if(failed)prices=Array.from({length:90},(_,i)=>110+3*Math.sin(i*.52)+1.2*Math.sin(i*1.1));
    const patterns={support:[[103,95,108,96,112,95,107,96,110],[103,95,108,96,112,95,102,91,87]],trend:[[90,103,97,113,105,123,117,132],[90,103,97,113,105,123,100,91]],breakout:[[100,115,103,115,108,119,115,124,132],[100,115,103,115,108,119,111,103,98]],headshoulders:[[90,96,110,100,122,100,110,99,92,84],[90,96,110,100,122,100,110,98,110,122]],double:[[95,110,120,105,119,105,97,89],[95,110,120,105,119,110,125,131]],triangle:[[100,120,102,118,104,116,106,118,126],[100,120,102,118,104,116,106,101,94]],fibonacci:[[90,105,100,118,113,130,119,114,119],[90,105,100,118,113,130,112,101,86]],risk:[[100,101,104,99,106,108,112],[100,101,104,99,97,85,87]],ohlc:[[100,108,103,111,107,115],[100,108,103,111,119,95]]};
    if(patterns[kind])prices=interpolate(patterns[kind][failed?1:0]);
    if(kind==='risk'&&failed)prices=[100,101,104,99,97,85,87];
    if(['rsi','stochastic','bollinger'].includes(kind)&&failed)prices=Array.from({length:90},(_,i)=>90+i*.72+Math.sin(i*.75)*.65);
    if(kind==='atr')prices=Array.from({length:90},(_,i)=>120+(failed?-1:1)*i*.2+Math.sin(i*.8)*(i<40?1:6));
    const candles=prices.map((close,i)=>{const open=i?prices[i-1]:close-2;return {open,close,high:Math.max(close,open)+1.2+(i%3)*.5,low:Math.min(close,open)-1.1-(i%4)*.3};});
    const line=(name,values,color=0)=>({name,values,color});
    const top=[line('가상 가격',prices)],bottom=[],levels=[],annotations=[];
    if(kind==='support'){levels.push({value:95,label:'관찰한 지지 95'},{value:112,label:'관찰한 저항 112'});}
    if(kind==='breakout')levels.push({value:115,label:'이전 저항 115'});
    if(kind==='headshoulders'){levels.push({value:100,label:'목선 100'});annotations.push({i:10,value:110,label:'왼쪽 어깨'},{i:20,value:122,label:'머리'},{i:30,value:110,label:'오른쪽 어깨'});}
    if(kind==='double'){levels.push({value:105,label:'두 고점 사이 저점'});annotations.push({i:10,value:120,label:'고점 1'},{i:20,value:119,label:'고점 2'});}
    if(kind==='trend'||kind==='triangle'){if(kind==='trend')top.push(line('저점을 잇는 보조선',prices.map((_,i)=>90+i*.7),2));else{top.push(line('저점을 잇는 경계',prices.map((_,i)=>100+i*.2),2),line('고점을 잇는 경계',prices.map((_,i)=>121-i*.2),1));}}
    if(kind==='fibonacci')for(const ratio of [.382,.5,.618])levels.push({value:130-40*ratio,label:`${(ratio*100).toFixed(1)}%: ${(130-40*ratio).toFixed(1)}`});
    if(kind==='risk')levels.push({value:100,label:'진입 100'},{value:94,label:'손절 기준 94'},{value:112,label:'계획 목표 112'});
    if(kind==='ma')top.push(line(`SMA(${period})`,M.sma(prices,period),1));
    if(kind==='cross')top.push(line('SMA(5)',M.sma(prices,5),1),line('SMA(20)',M.sma(prices,20),2));
    if(kind==='rsi')bottom.push(line('RSI(14)',M.rsi(prices),2));
    if(kind==='macd'){const m=M.macd(prices);bottom.push(line('MACD(12,26)',m.line,1),line('신호선(9)',m.signal,2));}
    if(kind==='bollinger'){const b=M.bollinger(prices);top.push(line('SMA(20)',b.middle,1),line('상단 +2σ',b.upper,2),line('하단 −2σ',b.lower,2));}
    if(kind==='atr')bottom.push(line('ATR(14)',M.atr(candles),1));
    if(kind==='stochastic'){const s=M.stochastic(candles);bottom.push(line('%K(14)',s.k,1),line('%D(3)',s.d,2));}
    if(kind==='ichimoku'){
      const midpoint=n=>prices.map((_,i)=>i+1<n?null:(Math.max(...candles.slice(i-n+1,i+1).map(c=>c.high))+Math.min(...candles.slice(i-n+1,i+1).map(c=>c.low)))/2);
      const tenkan=midpoint(9),kijun=midpoint(26),b=midpoint(52),a=kijun.map((v,i)=>v===null?null:(tenkan[i]+v)/2);
      top.push(line('선행스팬 A (9·26)',Array(26).fill(null).concat(a),1),line('선행스팬 B (52)',Array(26).fill(null).concat(b),2));
    }
    const volume=kind==='volume'?prices.map((_,i)=>Math.round(100+(failed?20:80)*Math.abs(Math.sin(i*.24))+i*(failed?.15:2))):null;
    return {top,bottom,levels,annotations,candles,volume,caption:(descriptions[kind]||descriptions.trend)[failed?1:0],kind};
  }
  const svgEl=(tag,attributes={},text)=>{const node=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
  function draw(target,data){
    const svg=svgEl('svg',{viewBox:'0 0 720 330',role:'img','aria-label':data.caption});svg.append(svgEl('title',{},data.caption),svgEl('desc',{},'학습용 가상 데이터. 가로축은 관측 순서, 세로축은 가상 가격 수준입니다. 계산값은 아래 표에서도 읽을 수 있습니다.'));
    const count=Math.max(...data.top.map(l=>l.values.length)),x=i=>55+i/(count-1)*625,split=data.bottom.length||data.volume,baseBottom=split?182:277;
    const all=data.top.flatMap(l=>l.values).filter(v=>v!==null);all.push(...data.levels.map(l=>l.value));if(data.kind==='ohlc')all.push(...data.candles.flatMap(c=>[c.low,c.high]));
    const min=Math.min(...all)-5,max=Math.max(...all)+8,y=v=>baseBottom-(v-min)/(max-min)*(baseBottom-35);
    const axes=(lo,hi,from,to)=>{for(let i=0;i<=4;i++){const value=lo+(hi-lo)*i/4,pos=to-(to-from)*i/4;svg.append(svgEl('line',{x1:55,x2:680,y1:pos,y2:pos,class:'analysis-gridline'}),svgEl('text',{x:46,y:pos+4,'text-anchor':'end',class:'analysis-axis'},value.toFixed(0)));}};
    axes(min,max,35,baseBottom);
    const drawLine=(l,fn)=>{let path='',started=false;l.values.forEach((v,i)=>{if(v===null){started=false;return;}path+=`${started?'L':'M'}${x(i).toFixed(2)} ${fn(v).toFixed(2)} `;started=true;});svg.append(svgEl('path',{d:path,fill:'none',class:`analysis-line line-${l.color}`,'stroke-width':l.name==='가상 가격'?2.5:1.7}));};
    if(data.kind==='ohlc')data.candles.forEach((c,i)=>{const color=c.close>=c.open?'analysis-candle-up':'analysis-candle-down',width=Math.min(10,400/count);svg.append(svgEl('line',{x1:x(i),x2:x(i),y1:y(c.high),y2:y(c.low),class:color}),svgEl('rect',{x:x(i)-width/2,y:y(Math.max(c.open,c.close)),width,height:Math.max(1,Math.abs(y(c.open)-y(c.close))),class:color}));});else data.top.forEach(l=>drawLine(l,y));
    for(const level of data.levels){svg.append(svgEl('line',{x1:55,x2:680,y1:y(level.value),y2:y(level.value),class:'analysis-guide'}),svgEl('text',{x:675,y:y(level.value)-5,'text-anchor':'end',class:'analysis-annotation'},level.label));}
    for(const a of data.annotations){svg.append(svgEl('circle',{cx:x(a.i),cy:y(a.value),r:4,class:'analysis-marker'}),svgEl('text',{x:x(a.i),y:y(a.value)-12,'text-anchor':'middle',class:'analysis-annotation'},a.label));}
    if(data.bottom.length){const vals=data.bottom.flatMap(l=>l.values).filter(v=>v!==null),bounded=['rsi','stochastic'].includes(data.kind),lo=bounded?0:Math.min(0,...vals)*1.2,hi=bounded?100:Math.max(...vals)*1.2+1,by=v=>289-(v-lo)/(hi-lo)*75;axes(lo,hi,214,289);data.bottom.forEach(l=>drawLine(l,by));if(bounded)for(const value of data.kind==='rsi'?[30,70]:[20,80])svg.append(svgEl('line',{x1:55,x2:680,y1:by(value),y2:by(value),class:'analysis-guide'}));}
    if(data.volume){const high=Math.max(...data.volume);data.volume.forEach((v,i)=>svg.append(svgEl('rect',{x:x(i)-2,y:289-v/high*65,width:4,height:v/high*65,class:'analysis-volume'})));svg.append(svgEl('text',{x:55,y:210,class:'analysis-axis'},'가상 거래량 · 상대 단위'));}
    svg.append(svgEl('text',{x:55,y:315,class:'analysis-axis'},'관측 1'),svgEl('text',{x:680,y:315,'text-anchor':'end',class:'analysis-axis'},data.kind==='ichimoku'?'관측 90 + 앞으로 26칸':`관측 ${count}`));
    target.replaceChildren(svg);
  }
  globalThis.AnalysisCharts=Object.freeze({model,draw});
})();
