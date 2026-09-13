import assert from 'node:assert/strict';
import {request} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createBridge} from './bridge/server.mjs';
const calls=[];let cancelled=false;
const analyzer={async status(){return {authenticated:true,authMode:'chatgpt',email:'must-not-leak@example.com'};},async *analyze(input,{signal}){calls.push(input);yield {type:'delta',text:'요약: '};try{await delay(90,undefined,{signal});}catch{cancelled=true;throw Object.assign(new Error('private diagnostic'),{code:'cancelled'});}yield {type:'delta',text:'가상 글입니다.'};yield {type:'done'};},async close(){}};
const bridge=createBridge({analyzer,port:0,requestTimeoutMs:1000});await bridge.listen();const base=bridge.url,origin='https://stat-thon.github.io';
const localHeaders={'Origin':base,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
const call=(path,options={})=>fetch(base+path,options);
try{
  let r=await call('/health');assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,version:1});
  const hostileHost=await new Promise(resolve=>{const req=request(base+'/health',{headers:{Host:'evil.test'}},r=>{r.resume();resolve(r.statusCode);});req.end();});assert.equal(hostileHost,403);
  assert.equal((await call('/health',{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await call('/health',{headers:{Origin:'null'}})).status,403);
  assert.equal((await call('/api/session',{headers:{Origin:origin}})).status,403);
  assert.equal((await call('/api/session')).status,403);
  assert.equal((await call('/api/session',{headers:{Origin:base.replace(/:\d+$/,':1234')}})).status,403);
  r=await call('/api/session',{headers:localHeaders});assert.equal(r.status,200);const {token}=await r.json();assert(token.length>=40);
  const apiHeaders={Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  assert.equal((await call('/api/status',{headers:{Origin:origin}})).status,401);
  r=await call('/api/status',{headers:apiHeaders});assert.deepEqual(await r.json(),{authenticated:true,authMode:'chatgpt',busy:false});assert.equal(r.headers.get('access-control-allow-origin'),origin);
  r=await call('/api/analyze',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type','Access-Control-Request-Private-Network':'true'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-private-network'),'true');
  console.log('PASS bridge: loopback Host/Origin·로컬 세션·Bearer·CORS 경계');
  r=await call('/pair?origin='+encodeURIComponent(origin));assert.equal(r.status,200);const html=await r.text();assert.equal(r.headers.get('x-frame-options'),'DENY');assert(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert(!html.includes(token));
  const nonce=html.match(/name="pair-nonce" content="([a-zA-Z0-9_-]+)"/)[1];
  const pair=body=>call('/api/pair',{method:'POST',headers:localHeaders,body:JSON.stringify(body)});
  assert.equal((await pair({nonce,origin:'https://evil.test'})).status,403);
  r=await pair({nonce,origin});assert.equal(r.status,200);const paired=await r.json();assert(paired.token.length>=40);
  assert.equal((await pair({nonce,origin})).status,403);
  assert.equal((await call('/pair?origin=https://evil.test')).status,403);
  assert.equal((await call('/api/pair',{method:'POST',headers:apiHeaders,body:JSON.stringify({nonce,origin})})).status,403);
  console.log('PASS bridge: 연결 승인 nonce·origin 바인딩·재사용 거부·클릭재킹 차단');
  const analyze=(body,extra={})=>call('/api/analyze',{method:'POST',headers:apiHeaders,body:JSON.stringify(body),...extra});
  for(const body of [{text:''},{text:'a'.repeat(12001)},{text:'글',sourceUrl:'file:///etc/passwd'},{text:'글',sourceUrl:'http://user:secret@example.com'},{text:'글',model:'unexpected'}])assert.equal((await analyze(body)).status,400);
  assert.equal((await call('/api/analyze',{method:'POST',headers:apiHeaders,body:'x'.repeat(65537)})).status,413);
  assert.equal((await analyze({text:'hello'},{headers:{...apiHeaders,'Content-Type':'text/plain'}})).status,415);
  assert.equal(calls.length,0);
  assert.equal((await call('/bridge/server.mjs')).status,404);assert.equal((await call('/.git/config')).status,404);
  r=await call('/');assert.equal(r.status,200);assert((await r.text()).includes('문장 너머'));
  console.log('PASS bridge: 본문/URL/허용 필드·body byte 한도·정적 파일 경계');
  r=await analyze({text:'가상 PER 글',sourceUrl:'https://example.com/post'});assert.equal(r.status,200);assert(r.headers.get('content-type').includes('text/event-stream'));
  const reader=r.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert(first.includes('status'));
  assert.equal((await analyze({text:'동시 실행'})).status,409);
  let body=first;while(true){const chunk=await reader.read();if(chunk.done)break;body+=new TextDecoder().decode(chunk.value);}assert(body.includes('가상 글입니다.'));assert(body.includes('"type":"done"'));assert.equal(calls.length,1);
  const abort=new AbortController();r=await analyze({text:'취소할 글'},{signal:abort.signal});await r.body.getReader().read();abort.abort();await delay(140);assert(cancelled);r=await call('/api/status',{headers:apiHeaders});assert.equal((await r.json()).busy,false);
  console.log('PASS bridge: 실제 SSE 전송·동시 실행 차단·클라이언트 취소');
}finally{await bridge.close();}
const slow={...analyzer,async *analyze(input,{signal}){await delay(5000,undefined,{signal});yield {type:'done'};}};
const timeoutBridge=createBridge({analyzer:slow,port:0,requestTimeoutMs:30});await timeoutBridge.listen();
try{const local=timeoutBridge.url;const t=await (await fetch(local+'/api/session',{headers:{Origin:local,'Sec-Fetch-Site':'same-origin'}})).json();const r=await fetch(local+'/api/analyze',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${t.token}`,'Content-Type':'application/json'},body:JSON.stringify({text:'시간 제한'})});const body=await r.text();assert(body.includes('"code":"timeout"'));assert(!body.includes('"type":"done"'));console.log('PASS bridge: 서버 시간 제한·실패를 성공으로 표시하지 않음');}finally{await timeoutBridge.close();}
let clock=100000,statusCalls=0;
const counting={...analyzer,async status(){statusCalls++;await delay(20);return {authenticated:true,authMode:'chatgpt'};}};
const expiryBridge=createBridge({analyzer:counting,port:0,now:()=>clock});await expiryBridge.listen();
try{
  const local=expiryBridge.url,headers={Origin:local,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'};
  const token=(await(await fetch(local+'/api/session',{headers})).json()).token;
  const auth={...headers,Authorization:`Bearer ${token}`};
  await Promise.all(Array.from({length:3},()=>fetch(local+'/api/status',{headers:auth})));assert.equal(statusCalls,1,'상태 요청 병합');
  let r=await fetch(local+'/pair?origin='+encodeURIComponent(origin));let nonce=(await r.text()).match(/name="pair-nonce" content="([a-zA-Z0-9_-]+)"/)[1];clock+=120001;
  assert.equal((await fetch(local+'/api/pair',{method:'POST',headers,body:JSON.stringify({nonce,origin})})).status,403);
  for(let i=0;i<10;i++){r=await fetch(local+'/api/analyze',{method:'POST',headers:auth,body:JSON.stringify({text:'요청 제한 확인'})});assert.equal(r.status,200);await r.text();}
  r=await fetch(local+'/api/analyze',{method:'POST',headers:auth,body:JSON.stringify({text:'11번째 요청'})});assert.equal(r.status,429);assert.equal((await r.json()).code,'rate_limited');
  clock+=8*60*60*1000;
  assert.equal((await fetch(local+'/api/status',{headers:auth})).status,401);
  console.log('PASS bridge: 상태 요청 병합·nonce/토큰 만료·로컬 요청 제한');
}finally{await expiryBridge.close();}
