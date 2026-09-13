import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { access } from 'node:fs/promises';
import { CodexAnalyzer } from './bridge/codex-client.mjs';

// Only this fake transport runs by default. --live explicitly adds ONE model turn.
const spawned=[];
function fakeSpawn(scenario={}) {
  return (command,args,options)=>{
    const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.exitCode=null; child.signalCode=null; child.killed=false; child.requests=[];
    child.send=msg=>child.stdout.write(JSON.stringify(msg)+'\n');
    child.notify=(method,params)=>child.send({method,params});
    child.reply=(req,result)=>child.send({id:req.id,result});
    child.finish=()=>child.notify('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed',items:[]}});
    child.kill=signal=>{if(child.killed)return true;child.killed=true;child.signalCode=signal;queueMicrotask(()=>{child.emit('exit',null,signal);child.emit('close',null,signal);});return true;};
    let input='';
    child.stdin=new Writable({write(chunk,encoding,callback){input+=chunk.toString();let index;while((index=input.indexOf('\n'))>=0){const line=input.slice(0,index);input=input.slice(index+1);if(line){const req=JSON.parse(line);child.requests.push(req);queueMicrotask(()=>handle(req));}}callback();}});
    function handle(req){
      if(!req.method)return;
      if(scenario.onRequest?.(req,child)===true)return;
      if(req.method==='initialize')child.reply(req,{});
      else if(req.method==='account/read')child.reply(req,{account:scenario.unauthenticated?null:{type:'chatgpt',email:'must-not-leak@example.invalid',planType:'pro'},requiresOpenaiAuth:true});
      else if(req.method==='model/list')child.reply(req,{data:[{id:'gpt-5.5',model:'gpt-5.5',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null});
      else if(req.method==='config/read')child.reply(req,{config:{mcp_servers:{fake:{enabled:true,command:'never-execute',env:{SECRET:'must-not-leak'}}}}});
      else if(req.method==='mcpServerStatus/list')child.reply(req,{data:[],nextCursor:null});
      else if(req.method==='skills/list')child.reply(req,{data:[{cwd:options.cwd,skills:[{path:'/fake/skill/SKILL.md',enabled:true}],errors:[]}]});
      else if(req.method==='thread/start')child.reply(req,{thread:{id:'thread-1'},sandbox:{type:'readOnly',networkAccess:false},instructionSources:[]});
      else if(req.method==='turn/start'){
        child.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});
        if(!scenario.stall){child.notify('item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',itemId:'item-1',delta:'핵심 요약\n'});if(!scenario.hold)child.finish();}
      } else if(req.method==='turn/interrupt')child.reply(req,{});
      else if(req.method!=='initialized')child.send({id:req.id,error:{code:-32601,message:'Unsupported fake method'}});
    }
    spawned.push({child,command,args,options}); return child;
  };
}
function analyzer(scenario={},options={}){return new CodexAnalyzer({spawnImpl:fakeSpawn(scenario),rpcTimeoutMs:1000,timeoutMs:2000,...options});}
const input={text:'가상 글: 매출 YoY 20%, PER 10배라 무조건 오른다.',sourceUrl:'https://example.invalid/post/1'};
const collect=async iterable=>{const result=[];for await(const event of iterable)result.push(event);return result;};
const errorCode=code=>error=>{assert.equal(error.code,code);assert.match(error.message,/[가-힣]/);assert.doesNotMatch(error.message,/must-not-leak|SECRET|Bearer|example\.invalid/);return true;};
let checks=0;
async function test(name,run){await run();checks++;console.log('PASS',name);}

await test('status returns only authentication metadata',async()=>{
 const a=analyzer();assert.deepEqual(await a.status(),{authenticated:true,authMode:'chatgpt'});await a.close();
 const b=analyzer({unauthenticated:true});assert.deepEqual(await b.status(),{authenticated:false,authMode:'none'});await assert.rejects(collect(b.analyze(input)),errorCode('login_required'));await b.close();
});
await test('streams a delta before completion and closes its ephemeral process',async()=>{
 const a=analyzer({hold:true});const it=a.analyze(input);assert.deepEqual(await it.next(),{done:false,value:{type:'delta',text:'핵심 요약\n'}});
 const s=spawned.at(-1);assert.equal(s.child.killed,false);s.child.finish();assert.deepEqual(await it.next(),{done:false,value:{type:'done'}});assert.equal((await it.next()).done,true);
 assert.equal(s.child.killed,true);await assert.rejects(access(s.options.cwd));
 assert.equal(s.options.shell,false);assert.ok(s.args.includes('stdio://'));assert.ok(!s.args.some(v=>v.includes(input.text)));
 const req=s.child.requests.find(r=>r.method==='thread/start');assert.equal(req.params.ephemeral,true);assert.equal(req.params.sandbox,'read-only');assert.deepEqual(req.params.environments,[]);assert.deepEqual(req.params.dynamicTools,[]);
 assert.ok(req.params.baseInstructions.includes('신뢰할 수 없는'));assert.equal(req.params.config.skills.config[0].enabled,false);assert.deepEqual(req.params.config.mcp_servers,{fake:{enabled:false}});assert.ok(!JSON.stringify(req.params).includes('must-not-leak'));
 const turn=s.child.requests.find(r=>r.method==='turn/start');assert.deepEqual(turn.params.environments,[]);assert.equal(turn.params.sandboxPolicy.networkAccess,false);assert.ok(turn.params.input[0].text.includes(input.text));await a.close();
});
await test('UTF-8 chunk boundaries and notifications preceding turn/start reply',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;const packet=Buffer.from(JSON.stringify({method:'item/agentMessage/delta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'i',delta:'한글 ✓'}})+'\n');const split=packet.indexOf(Buffer.from('한'))+1;c.stdout.write(packet.subarray(0,split));c.stdout.write(packet.subarray(split));c.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});c.finish();return true;}});
 assert.deepEqual(await collect(a.analyze(input)),[{type:'delta',text:'한글 ✓'},{type:'done'}]);await a.close();
});
await test('abort interrupts the turn and rejects with sanitized cancellation',async()=>{
 const controller=new AbortController(),a=analyzer({hold:true}),it=a.analyze(input,{signal:controller.signal});await it.next();const child=spawned.at(-1).child;controller.abort();await assert.rejects(it.next(),errorCode('cancelled'));assert.ok(child.requests.some(x=>x.method==='turn/interrupt'));assert.equal(child.killed,true);await a.close();
});
await test('aborted setup and stalled output are bounded',async()=>{
 const a=analyzer({stall:true},{timeoutMs:30});await assert.rejects(collect(a.analyze(input)),errorCode('timeout'));await a.close();
 const controller=new AbortController();controller.abort();const b=analyzer();const before=spawned.length;await assert.rejects(collect(b.analyze(input,{signal:controller.signal})),errorCode('cancelled'));assert.equal(spawned.length,before);await b.close();
});
await test('usage errors never expose provider messages',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;c.reply(req,{turn:{id:'turn-1',status:'failed',items:[],error:{message:'SECRET Bearer must-not-leak',codexErrorInfo:'usageLimitExceeded'}}});return true;}});await assert.rejects(collect(a.analyze(input)),errorCode('usage_limit'));await a.close();
});
await test('unexpected child exit fails promptly',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;c.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});queueMicrotask(()=>c.kill('SIGTERM'));return true;}});await assert.rejects(collect(a.analyze(input)),errorCode('unavailable'));await a.close();
});
await test('server initiated tool requests are denied',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;c.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});c.send({id:'tool-request',method:'item/commandExecution/requestApproval',params:{command:'SECRET'}});return true;}});await assert.rejects(collect(a.analyze(input)),errorCode('unavailable'));assert.ok(spawned.at(-1).child.requests.some(r=>r.id==='tool-request'&&r.error));await a.close();
});
await test('one analysis at a time and consumer break cleanup',async()=>{
 const a=analyzer({hold:true}),first=a.analyze(input);await first.next();await assert.rejects(collect(a.analyze(input)),errorCode('busy'));const child=spawned.at(-1).child;await first.return();assert.equal(child.killed,true);await a.close();
});
await test('fresh process for every analysis and unrelated deltas are ignored',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;c.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});c.notify('item/agentMessage/delta',{threadId:'other',turnId:'other',itemId:'i',delta:'must-not-leak'});c.notify('item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',itemId:'i',delta:'정상'});c.finish();return true;}});const before=spawned.length;for(let i=0;i<2;i++)assert.deepEqual(await collect(a.analyze(input)),[{type:'delta',text:'정상'},{type:'done'}]);assert.equal(spawned.length-before,2);await a.close();
});
await test('protocol corruption and tool execution notifications fail closed',async()=>{
 for(const mode of ['malformed','tool']){const a=analyzer({onRequest(req,c){if(req.method!=='turn/start')return false;c.reply(req,{turn:{id:'turn-1',status:'inProgress',items:[]}});if(mode==='malformed')c.stdout.write('{BROKEN\n');else c.notify('item/started',{threadId:'thread-1',turnId:'turn-1',item:{id:'tool',type:'commandExecution'}});return true;}});await assert.rejects(collect(a.analyze(input)),errorCode('unavailable'));await a.close();}
});
await test('closing an active analyzer aborts the iterator',async()=>{const a=analyzer({hold:true}),it=a.analyze(input);await it.next();await a.close();await assert.rejects(it.next(),errorCode('cancelled'));});
await test('malformed preflight metadata and remaining MCP servers fail closed',async()=>{
 for(const mode of ['config','instructions','mcp']){
  let turned=false;
  const a=analyzer({onRequest(req,c){
   if(req.method==='turn/start')turned=true;
   if(mode==='config'&&req.method==='config/read'){c.reply(req,{config:null});return true;}
   if(mode==='instructions'&&req.method==='thread/start'){c.reply(req,{thread:{id:'thread-1'},sandbox:{type:'readOnly',networkAccess:false}});return true;}
   if(mode==='mcp'&&req.method==='mcpServerStatus/list'){c.reply(req,{data:[{name:'resource-only',tools:{}}]});return true;}
   return false;
  }});
  await assert.rejects(collect(a.analyze(input)),errorCode('unavailable'));assert.equal(turned,false);await a.close();
 }
});
await test('missing compatible model is an explicit preflight error',async()=>{
 let turned=false;const a=analyzer({onRequest(req,c){if(req.method==='turn/start')turned=true;if(req.method==='model/list'){c.reply(req,{data:[],nextCursor:null});return true;}return false;}});
 await assert.rejects(collect(a.analyze(input)),e=>{errorCode('unavailable')(e);assert.match(e.message,/모델/);return true;});assert.equal(turned,false);await a.close();
});
await test('disabled configured MCP entries may remain as empty status records',async()=>{
 const a=analyzer({onRequest(req,c){if(req.method==='mcpServerStatus/list'){c.reply(req,{data:[{name:'fake',tools:{},resources:[],resourceTemplates:[],serverInfo:null}],nextCursor:null});return true;}return false;}});
 assert.equal((await collect(a.analyze(input))).at(-1).type,'done');await a.close();
});
console.log(`Codex adapter: ${checks} fake-transport checks passed.`);

if(process.argv.includes('--live')){
 const a=new CodexAnalyzer({timeoutMs:120000});const start=Date.now();let first=null,text='',deltas=0,done=false;
 try{
   assert.deepEqual(await a.status(),{authenticated:true,authMode:'chatgpt'});
   for await(const event of a.analyze({text:'학습용 가상 글: 매출은 전년 같은 분기보다 20% 늘었지만 영업현금흐름은 줄었다. PER이 10배니까 반드시 상승한다.'})){
     if(event.type==='delta'){first??=Date.now()-start;deltas++;text+=event.text;}else if(event.type==='done')done=true;
   }
   assert.ok(done&&deltas>0&&text.length>40);assert.match(text,/PER|주가수익/);assert.match(text,/현금/);assert.match(text,/추정|단정|보장|근거/);
   console.log(JSON.stringify({live:'passed',deltas,characters:text.length,firstDeltaMs:first,totalMs:Date.now()-start}));console.log(text);
 }finally{await a.close();}
}
