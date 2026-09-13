import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const PUBLIC_ORIGIN='https://stat-thon.github.io';
const TOKEN_AGE=8*60*60*1000, NONCE_AGE=2*60*1000, MAX_BODY=65536;
const random=()=>randomBytes(32).toString('base64url');
const messages={
  forbidden:'이 연결은 허용되지 않습니다.',unauthorized:'Mac 연결이 만료됐습니다. 다시 연결해 주세요.',
  invalid_input:'본문은 1~12,000자로 입력하고 출처는 http 또는 https 링크로 입력해 주세요.',
  too_large:'입력한 내용이 너무 큽니다. 본문을 줄여 주세요.',unsupported_type:'JSON 형식의 요청이 필요합니다.',
  busy:'다른 글을 분석하고 있습니다. 완료 후 다시 시도해 주세요.',
  rate_limited:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  login_required:'Mac의 Codex에서 ChatGPT 계정으로 로그인한 뒤 다시 연결해 주세요.',
  usage_limit:'Codex 사용 한도에 도달했습니다. 사용량이 갱신된 뒤 다시 시도해 주세요.',
  timeout:'분석 시간이 길어 중지했습니다. 글을 줄이거나 잠시 후 다시 시도해 주세요.',
  unavailable:'Codex에 연결하지 못했습니다. Mac의 Codex 로그인과 연결 프로그램을 확인해 주세요.',
  model_unavailable:'현재 Codex에서 분석용 모델을 사용할 수 없습니다. Codex 업데이트와 계정의 모델 사용 가능 여부를 확인해 주세요.',
  cancelled:'분석을 중지했습니다.',incomplete:'답변을 끝까지 받지 못했습니다. 다시 분석해 주세요.'
};
const fail=(code,status=400)=>Object.assign(new Error(messages[code]||messages.unavailable),{code,status});
function bodyOf(req){return new Promise((resolve,reject)=>{
  let length=0,chunks=[],settled=false;
  if(Number(req.headers['content-length'])>MAX_BODY){req.resume();reject(fail('too_large',413));return;}
  req.on('data',chunk=>{if(settled)return;length+=chunk.length;if(length>MAX_BODY){settled=true;chunks=[];reject(fail('too_large',413));return;}chunks.push(chunk);});
  req.on('end',()=>{if(settled)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(fail('invalid_input'));}});
  req.on('error',()=>reject(fail('invalid_input')));
});}
function validateInput(value){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!['text','sourceUrl'].includes(k)))throw fail('invalid_input');
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>12000)throw fail('invalid_input');
  let sourceUrl='';if(value.sourceUrl!==undefined){if(typeof value.sourceUrl!=='string'||value.sourceUrl.length>2048)throw fail('invalid_input');sourceUrl=value.sourceUrl.trim();}
  if(sourceUrl){let u;try{u=new URL(sourceUrl);}catch{throw fail('invalid_input');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw fail('invalid_input');sourceUrl=u.href;}
  return {text:value.text.trim(),sourceUrl};
}
function pairPage(origin,nonce){
  const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="pair-nonce" content="${nonce}"><title>문장 너머 · 이 Mac 연결</title>
<style nonce="${nonce}">body{margin:0;background:#f8f6ee;color:#23352f;font:16px/1.85 system-ui,sans-serif}main{max-width:520px;padding:36px 24px;margin:auto}h1{font-size:28px}strong{overflow-wrap:anywhere}button,a{font:inherit}button{padding:12px 22px;border:0;border-radius:6px;background:#155641;color:white;cursor:pointer}button:disabled{opacity:.5}p{margin:18px 0}small{color:#52635d}#result{min-height:60px;white-space:pre-line}</style>
<main><small>문장 너머 · 개인용 Codex 연결</small><h1>이 사이트를 Mac에 연결</h1><p><strong>${origin}</strong>에서 입력한 글을 이 Mac의 Codex로 분석합니다. 기존 Codex 사용 한도가 적용됩니다.</p><p>계정 인증정보는 Mac에 남습니다. 연결 권한은 이 프로그램을 끄거나 8시간이 지나면 만료됩니다.</p><button id="pair" type="button">이 사이트 연결하기</button><p id="result" role="status"></p><p><a href="/#interpret">Mac에서 바로 글 해석하기</a></p></main>
<script nonce="${nonce}">const origin=${safe(origin)},nonce=${safe(nonce)},button=document.getElementById('pair'),result=document.getElementById('result');button.addEventListener('click',async()=>{button.disabled=true;try{if(!window.opener)throw new Error('사이트에서 ‘이 Mac 연결’을 눌러 다시 열어주세요.');const response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,nonce})});if(!response.ok)throw new Error('연결 요청이 만료됐습니다. 사이트에서 다시 연결해주세요.');const data=await response.json();window.opener.postMessage({type:'stock-language-paired',token:data.token},origin);result.textContent='연결했습니다. 원래 사이트로 돌아가 글을 입력하세요.';button.textContent='연결 완료';}catch(error){result.textContent=error.message;button.disabled=false;}});</script></html>`;
}
export function createBridge({analyzer,port=8767,requestTimeoutMs=90000,now=Date.now,indexPath=new URL('../index.html',import.meta.url)}={}){
  let client=analyzer,clientPromise,statusPromise,statusAt=0,active=null,busy=false,recent=[];
  const tokens=new Map(),nonces=new Map();
  const getClient=async()=>{if(client)return client;if(!clientPromise)clientPromise=import('./codex-client.mjs').then(({CodexAnalyzer})=>(client=new CodexAnalyzer()));return clientPromise;};
  const locals=()=>new Set([`http://127.0.0.1:${server.address().port}`,`http://localhost:${server.address().port}`]);
  const allowed=origin=>origin===PUBLIC_ORIGIN||locals().has(origin);
  function clean(){for(const [token,at]of tokens)if(now()-at>TOKEN_AGE)tokens.delete(token);for(const [nonce,v]of nonces)if(now()-v.at>NONCE_AGE)nonces.delete(nonce);recent=recent.filter(at=>now()-at<60000);}
  function issueToken(){clean();if(tokens.size>=32)tokens.delete(tokens.keys().next().value);const token=random();tokens.set(token,now());return token;}
  function localOnly(req){const origin=req.headers.origin;if((origin&&!locals().has(origin))||req.headers['sec-fetch-site']!=='same-origin')throw fail('forbidden',403);}
  function authenticated(req){const header=req.headers.authorization||'';if(!header.startsWith('Bearer ')||!tokens.has(header.slice(7)))throw fail('unauthorized',401);}
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    try{
      clean();const host=req.headers.host;
      if(![`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`].includes(host))throw fail('forbidden',403);
      const origin=req.headers.origin;
      if(origin&&!allowed(origin))throw fail('forbidden',403);
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      const path=new URL(req.url,`http://${host}`);
      if(req.method==='OPTIONS'){
        if(!origin||!allowed(origin)||!['/health','/api/status','/api/analyze'].includes(path.pathname))throw fail('forbidden',403);
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;
      }
      if(req.method==='GET'&&path.pathname==='/health'){json(res,200,{ok:true,version:1});return;}
      if(req.method==='GET'&&['/','/index.html'].includes(path.pathname)){
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(indexPath));return;
      }
      if(req.method==='GET'&&path.pathname==='/pair'){
        const target=path.searchParams.get('origin');if(target!==PUBLIC_ORIGIN)throw fail('forbidden',403);
        if(nonces.size>=16)nonces.delete(nonces.keys().next().value);const nonce=random();nonces.set(nonce,{origin:target,at:now()});
        res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`);
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(pairPage(target,nonce));return;
      }
      if(req.method==='GET'&&path.pathname==='/api/session'){localOnly(req);json(res,200,{token:issueToken()});return;}
      if(req.method==='POST'&&path.pathname==='/api/pair'){
        localOnly(req);if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw fail('unsupported_type',415);
        const body=await bodyOf(req),entry=nonces.get(body?.nonce);
        if(!entry||entry.origin!==body.origin||now()-entry.at>NONCE_AGE)throw fail('forbidden',403);
        nonces.delete(body.nonce);json(res,200,{token:issueToken()});return;
      }
      if(path.pathname==='/api/status'&&req.method==='GET'){
        authenticated(req);
        if(!statusPromise||now()-statusAt>2000){
          statusAt=Infinity;
          statusPromise=getClient().then(engine=>engine.status()).then(value=>{statusAt=now();return value;},error=>{statusPromise=null;throw error;});
        }
        const status=await statusPromise;
        json(res,200,{authenticated:status.authenticated===true&&status.authMode==='chatgpt',authMode:status.authMode==='chatgpt'?'chatgpt':'none',busy});return;
      }
      if(path.pathname==='/api/analyze'&&req.method==='POST'){
        authenticated(req);if(!req.headers['content-type']?.toLowerCase().startsWith('application/json'))throw fail('unsupported_type',415);
        const input=validateInput(await bodyOf(req));if(busy)throw fail('busy',409);if(recent.length>=10)throw fail('rate_limited',429);
        busy=true;recent.push(now());const controller=new AbortController();active=controller;
        const timer=setTimeout(()=>controller.abort(fail('timeout',504)),requestTimeoutMs);timer.unref();
        res.on('close',()=>{if(!res.writableEnded)controller.abort(fail('cancelled'));});
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
        const emit=value=>{if(!res.destroyed&&!res.writableEnded)res.write(`data: ${JSON.stringify(value)}\n\n`);};
        emit({type:'status',text:'Codex가 글을 읽고 있습니다…'});
        let done=false,length=0;
        try{
          const engine=await getClient();
          for await(const event of engine.analyze(input,{signal:controller.signal})){
            if(controller.signal.aborted)throw controller.signal.reason;
            if(event.type==='delta'&&typeof event.text==='string'){length+=event.text.length;if(length>16000)throw fail('incomplete');emit({type:'delta',text:event.text});}
            if(event.type==='done'){done=true;break;}
          }
          if(!done||!length)throw fail('incomplete');emit({type:'done'});
        }catch(error){const code=controller.signal.reason?.code==='timeout'?'timeout':error?.reason==='model_unavailable'?'model_unavailable':Object.hasOwn(messages,error?.code)?error.code:'unavailable';emit({type:'error',code,message:messages[code]});}
        finally{clearTimeout(timer);busy=false;if(active===controller)active=null;res.end();}
        return;
      }
      json(res,404,{code:'not_found',message:'요청한 페이지가 없습니다.'});
    }catch(error){const code=Object.hasOwn(messages,error?.code)?error.code:'unavailable';if(!res.headersSent)json(res,error?.status||503,{code,message:messages[code]});else res.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  return {get url(){return `http://127.0.0.1:${server.address().port}`;},async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});},async close(){active?.abort(fail('cancelled'));await client?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const bridge=createBridge();try{await bridge.listen();console.log(`문장 너머 Codex 연결이 켜졌습니다.\n${bridge.url}/#interpret\n이 Mac에서만 접속합니다. 종료: Control+C`);}catch(error){console.error(error.code==='EADDRINUSE'?'8767 포트를 사용 중입니다. 이미 켜진 연결 프로그램을 확인하세요.':'연결 프로그램을 시작하지 못했습니다. Node.js와 Codex 설치를 확인하세요.');process.exitCode=1;}
  for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{await bridge.close();process.exit(0);});
}
