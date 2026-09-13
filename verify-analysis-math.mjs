import assert from 'node:assert/strict';
await import('./analysis-math.js');await import('./analysis-charts.js');
const m=globalThis.AnalysisMath,c=globalThis.AnalysisCharts;
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
assert.deepEqual(m.sma([1,2,3,4,5],3),[null,null,2,3,4]);assert.deepEqual(m.ema([1,2,3,4,5],3),[null,null,2,3,4]);
near(m.rsi(Array.from({length:30},(_,i)=>i)).at(-1),100);near(m.rsi(Array.from({length:30},(_,i)=>30-i)).at(-1),0);near(m.rsi(Array(30).fill(10)).at(-1),50);
const constant=Array(90).fill(100),bb=m.bollinger(constant);near(bb.upper.at(-1),100);near(bb.lower.at(-1),100);near(m.macd(constant).line.at(-1),0);near(m.macd(constant).signal.at(-1),0);assert.equal(m.macd([1,2]).line.length,2);
near(m.atr(Array.from({length:30},()=>({high:105,low:95,close:100}))).at(-1),10);near(m.stochastic(Array.from({length:30},()=>({high:110,low:90,close:100}))).k.at(-1),50);
const company=m.company();near(company.eps,900);near(company.per,1500/90);near(company.roe,18);near(company.debtRatio,450/550*100);near(company.interestCoverage,5);near(company.fcff,80);near(company.fcf,70);near(m.company(30000).per,company.per*2);
// Zero-growth perpetual cash flow must equal cash flow / required return, regardless of the explicit five-year split.
near(m.dcf({fcff:80,growth:0,discount:10,terminalGrowth:0,debt:0,cash:0,shares:10}).enterprise,800);
assert(m.dcf({discount:8}).perShare>m.dcf({discount:10}).perShare);assert(m.dcf({growth:7}).perShare>m.dcf({growth:3}).perShare);assert.equal(m.dcf({discount:2,terminalGrowth:2}),null);assert.equal(m.dcf({discount:1,terminalGrowth:2}),null);
for(const kind of ['ohlc','support','trend','ma','cross','volume','breakout','headshoulders','double','triangle','rsi','macd','bollinger','atr','stochastic','ichimoku','fibonacci','risk'])for(const fail of [false,true]){const d=c.model(kind,fail);for(const candle of d.candles){assert(candle.high>=Math.max(candle.open,candle.close));assert(candle.low<=Math.min(candle.open,candle.close));}for(const series of [...d.top,...d.bottom])assert(series.values.every(v=>v===null||Number.isFinite(v)));}
const cloud=c.model('ichimoku');assert.equal(cloud.top[1].values.findIndex(v=>v!==null),51);assert.equal(cloud.top[2].values.findIndex(v=>v!==null),77);assert.equal(cloud.top[2].values.length,116);
const gap=c.model('risk',true).top[0].values;assert(gap.some((v,i)=>i&&gap[i-1]===97&&v===85));
console.log('PASS 지표·DCF 계산: 알려진 값, 단위, 민감도, 무효 가정, 캔들 범위, 일목 시간 이동, 갭 반례');
