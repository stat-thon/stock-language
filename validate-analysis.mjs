import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=JSON.parse(await readFile(new URL('analysis.json',import.meta.url),'utf8'));
const text=(v,label)=>assert(typeof v==='string'&&v.trim()&&v.length<5000,label);
const items=(v,label,min=1)=>assert(Array.isArray(v)&&v.length>=min&&v.length<=200,label);
const strings=(v,label,min=1)=>{items(v,label,min);for(const s of v)text(s,label);};
const sources=(v,label)=>{items(v,label);for(const s of v){text(s.label,label);const u=new URL(s.url);assert(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password,label);}};
assert.equal(data.version,1);text(data.updatedAt,'자료 확인일');items(data.lessons,'수업');
const ids=new Set();const kinds=new Set(['ohlc','support','trend','ma','cross','volume','breakout','headshoulders','double','triangle','rsi','macd','bollinger','atr','stochastic','ichimoku','fibonacci','risk','financial','investor']);
for(const l of data.lessons){assert(/^(tech|fund|investor)-[a-z0-9-]+$/.test(l.id)&&!ids.has(l.id),`수업 ID ${l.id}`);ids.add(l.id);assert(['technical','fundamental','investors'].includes(l.group));for(const key of ['title','subtitle','summary','level'])text(l[key],`${l.id}.${key}`);assert(['기초','중급','심화'].includes(l.level));assert(kinds.has(l.chartKind));assert(l.group==='technical'?!['financial','investor'].includes(l.chartKind):l.chartKind===(l.group==='fundamental'?'financial':'investor'));
 items(l.terms,`${l.id}.terms`,2);for(const t of l.terms){for(const key of ['name','meaning','example','pitfall'])text(t[key],`${l.id}.${key}`);assert(typeof t.formula==='string');}assert.equal(l.expression.label,'학습용 가상 표현');text(l.expression.text,l.id);text(l.expression.meaning,l.id);strings(l.steps,l.id,3);strings(l.critical,l.id,3);sources(l.sources,l.id);
}
for(const group of ['technical','fundamental','investors'])assert(data.lessons.some(l=>l.group===group),`학습 분야 ${group}`);
const wf=data.workflow;text(wf.title,'실습 제목');text(wf.intro,'실습 소개');items(wf.steps,'실습 단계',8);for(const s of wf.steps)for(const key of ['title','question','action','example','redFlag'])text(s[key],`실습 ${key}`);for(const key of ['facts','assumptions','monitor'])strings(wf.conclusion[key],key);text(wf.conclusion.judgment,'판단');sources(wf.sources,'실습 출처');
console.log(`PASS 분석 자료: ${data.lessons.length}개 수업 · ${data.lessons.reduce((n,l)=>n+l.terms.length,0)}개 어휘 설명 · ${wf.steps.length}단계 실습`);
