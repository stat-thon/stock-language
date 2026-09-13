/* Pure calculations shared by the learning charts and their verification. */
(() => {
  'use strict';
  const sma=(values,period)=>values.map((_,i)=>i+1<period?null:values.slice(i-period+1,i+1).reduce((a,b)=>a+b,0)/period);
  function ema(values,period){let previous=null;return values.map((v,i)=>{if(i+1<period)return null;if(previous===null)previous=values.slice(0,period).reduce((a,b)=>a+b,0)/period;else previous=v*2/(period+1)+previous*(1-2/(period+1));return previous;});}
  function rsi(values,period=14){let gain=0,loss=0;return values.map((v,i)=>{if(!i)return null;const delta=v-values[i-1];if(i<=period){gain+=Math.max(delta,0)/period;loss+=Math.max(-delta,0)/period;}else{gain=(gain*(period-1)+Math.max(delta,0))/period;loss=(loss*(period-1)+Math.max(-delta,0))/period;}return i<period?null:loss===0?(gain===0?50:100):100-100/(1+gain/loss);});}
  function macd(values){const fast=ema(values,12),slow=ema(values,26),line=values.map((_,i)=>slow[i]===null?null:fast[i]-slow[i]);const offset=line.findIndex(v=>v!==null);if(offset<0)return {line,signal:values.map(()=>null),histogram:values.map(()=>null)};const signal=Array(offset).fill(null).concat(ema(line.slice(offset),9));return {line,signal,histogram:line.map((v,i)=>v===null||signal[i]===null?null:v-signal[i])};}
  function bollinger(values,period=20){const middle=sma(values,period),sd=middle.map((v,i)=>v===null?null:Math.sqrt(values.slice(i-period+1,i+1).reduce((sum,n)=>sum+(n-v)**2,0)/period));return {middle,upper:middle.map((v,i)=>v===null?null:v+2*sd[i]),lower:middle.map((v,i)=>v===null?null:v-2*sd[i])};}
  function atr(candles,period=14){const tr=candles.map((c,i)=>i?Math.max(c.high-c.low,Math.abs(c.high-candles[i-1].close),Math.abs(c.low-candles[i-1].close)):c.high-c.low);let previous=null;return tr.map((v,i)=>{if(i+1<period)return null;previous=previous===null?tr.slice(0,period).reduce((a,b)=>a+b,0)/period:(previous*(period-1)+v)/period;return previous;});}
  function stochastic(candles,period=14){const k=candles.map((c,i)=>{if(i+1<period)return null;const part=candles.slice(i-period+1,i+1),lo=Math.min(...part.map(x=>x.low)),hi=Math.max(...part.map(x=>x.high));return hi===lo?50:100*(c.close-lo)/(hi-lo);});return {k,d:Array(period-1).fill(null).concat(sma(k.slice(period-1),3))};}
  function dcf({fcff=80,growth=5,discount=9,terminalGrowth=2,debt=300,cash=100,shares=10}={}){
    if(![fcff,growth,discount,terminalGrowth,debt,cash,shares].every(Number.isFinite)||discount<=terminalGrowth||discount<=0||shares<=0||growth<=-100||terminalGrowth<=-100)return null;
    const r=discount/100,g=growth/100,tg=terminalGrowth/100,flows=Array.from({length:5},(_,i)=>fcff*(1+g)**(i+1));
    const present=flows.map((v,i)=>v/(1+r)**(i+1)),terminal=flows[4]*(1+tg)/(r-tg),terminalPV=terminal/(1+r)**5;
    const enterprise=present.reduce((a,b)=>a+b,0)+terminalPV,equity=enterprise-debt+cash;
    return {flows,present,terminal,terminalPV,enterprise,equity,perShare:equity*100/shares,terminalShare:terminalPV/enterprise*100};
  }
  function company(price=15000){const marketCap=price*10/100;return {marketCap,eps:90*100/10,per:marketCap/90,pbr:marketCap/550,roe:90/500*100,roic:112.5/750*100,debtRatio:450/550*100,interestCoverage:150/30,evEbitda:(marketCap+300-100)/190,dividendYield:300/price*100,payout:300/900*100,revenueGrowth:(1000/800-1)*100,epsGrowth:(900/600-1)*100,fcf:130-60,fcff:112.5+40-60-12.5};}
  globalThis.AnalysisMath=Object.freeze({sma,ema,rsi,macd,bollinger,atr,stochastic,dcf,company});
})();
