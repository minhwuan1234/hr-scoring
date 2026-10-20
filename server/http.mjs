import {createDecisionLinks} from './decision-links.mjs';
import {decisionPage,decisionHeaders} from './decision-page.mjs';
import {createCvLinks} from './cv-links.mjs';
import {sendCandidatesToLark} from './lark-send.mjs';
import {createLarkClient} from './lark.mjs';
import {randomUUID} from 'node:crypto';
import {failureReport} from './failure-report.mjs';
import {deleteCandidates} from './candidate-deletion.mjs';
import {createPositionRouter} from './position-router.mjs';
import { LUNA_MODEL } from './openai.mjs';
import { SCORING_FORMULA } from './engine.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, workspaceId } from './store.mjs';
import { MATCH_THRESHOLD } from './service.mjs';

const dist = resolve(fileURLToPath(new URL('../dist',import.meta.url)));
const store = createStore();
const {positions,scorer} = createPositionRouter(store);
const lark=createLarkClient();
const cvLinks=createCvLinks();
const decisionLinks=createDecisionLinks();
const rateLimits = new Map();
let active = 0;

function checkWriteRate(request){
  const ip = (process.env.RAILWAY_PROJECT_ID && request.headers['x-real-ip']) || request.socket.remoteAddress;
  const now = Date.now();
  if (rateLimits.size > 10000) for (const [key,item] of rateLimits) if (now > item.until) rateLimits.delete(key);
  let limit = rateLimits.get(ip);
  if (!limit || now > limit.until) { limit = {count:0,until:now+600000}; rateLimits.set(ip,limit); }
  if (++limit.count > 200) throw Object.assign(new Error('Too many requests. Please retry in a few minutes.'),{status:429});
}

function json(response,status,data) {
  response.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  response.end(JSON.stringify(data));
}
async function body(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Expected JSON.'), {status:415});
  const chunks = []; let length = 0;
  for await (const chunk of request) { chunks.push(chunk); length += chunk.length; if (length > 450000) throw Object.assign(new Error('This request is too large.'), {status:413}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON request.'), {status:400}); }
}

const server = createServer(async (request,response) => {
  const requestId=randomUUID(),started=Date.now();response.setHeader('X-Request-Id',requestId);
  try {
    const requestUrl=new URL(request.url,'http://localhost');
    const path=requestUrl.pathname;
    if((request.method==='GET'||request.method==='HEAD')&&path.startsWith('/api/shared-cvs/')){
      const {scope,id}=cvLinks.verify(path.slice('/api/shared-cvs/'.length));
      const {bytes,fileName}=await store.cvFiles.get(scope,id);
      response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
      return response.end(request.method==='HEAD'?undefined:bytes);
    }
    if(path.startsWith('/lark/decision/')){
      if(!['GET','HEAD','POST'].includes(request.method))return json(response,405,{error:'Method not allowed.'});
      const {scope,id,decision}=decisionLinks.verify(path.slice('/lark/decision/'.length));
      if(request.method==='POST'){
        checkWriteRate(request);
        const origin=request.headers.origin;
        if(origin&&new URL(origin).host!==request.headers.host)return json(response,403,{error:'Cross-origin requests are not allowed.'});
      }
      const candidate=request.method==='POST'?await store.decideCandidate(scope,id,decision):await store.candidate(scope,id);
      if(!candidate) return json(response,404,{error:'Candidate not found.'});
      response.writeHead(200,decisionHeaders);
      return response.end(request.method==='HEAD'?undefined:decisionPage(candidate,decision,request.method==='POST'));
    }
    if (path === '/api/health') return json(response,200,{ok:true});
    if (path === '/api/status') return json(response,200,{performanceVersion:'isolated-io-v1',errorHandlingVersion:'scoring-recovery-v1',paginationVersion:'candidate-pages-v1',decisionVersion:'lark-decisions-v1',configured:!!process.env.OPEN_AI_API_KEY,persistent:store.persistent,storage:store.backend,datasetVersion:store.datasetVersion,schemaVersion:store.schemaVersion,model:LUNA_MODEL,scoringFormula:SCORING_FORMULA,matchThreshold:MATCH_THRESHOLD});
    if (path.startsWith('/api/')) {
      const workspace = workspaceId(request.headers['x-workspace-token']);
      if(request.method==='GET' && /^\/api\/jobs\/[\w-]+\/cv$/.test(path)){
        const {scope}=await scorer(workspace,requestUrl.searchParams.get('positionId') || 'hr-intern',Number(requestUrl.searchParams.get('positionVersion') || 1));
        const {bytes,fileName}=await store.cvFiles.get(scope,path.split('/')[3]);
        response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return response.end(bytes);
      }
      if(request.method==='GET' && path==='/api/lark/status')return json(response,200,lark.status());
      if(request.method==='GET' && path==='/api/candidates/page')return json(response,200,await store.candidatePage(workspace,Object.fromEntries(requestUrl.searchParams)));
      if(request.method==='GET' && path==='/api/candidates')return json(response,200,await store.candidates(workspace));
      if(request.method==='GET' && path==='/api/positions')return json(response,200,await positions.list(workspace));
      if (request.method === 'GET' && /^\/api\/jobs\/[\w-]+$/.test(path)){const {service,scope}=await scorer(workspace,requestUrl.searchParams.get('positionId') || 'hr-intern',Number(requestUrl.searchParams.get('positionVersion') || 1));return json(response,200,await service.get(scope,path.split('/')[3]));}
      if (request.method !== 'POST') return json(response,405,{error:'Method not allowed.'});
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return json(response,403,{error:'Cross-origin requests are not allowed.'});
      checkWriteRate(request);
      if(active>=3)return json(response,429,{error:'Too many scoring requests. Please retry in a few minutes.'});
      if(/^\/api\/jobs\/[\w-]+\/cv$/.test(path)){
        if(request.headers['content-type']?.split(';')[0]!=='application/pdf')return json(response,415,{error:'Choose a PDF file.'});
        const {scope}=await scorer(workspace,requestUrl.searchParams.get('positionId') || 'hr-intern',Number(requestUrl.searchParams.get('positionVersion') || 1));
        const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>20*1024*1024)return json(response,413,{error:'Choose a PDF up to 20 MB.'});chunks.push(chunk);}
        await store.cvFiles.save(scope,path.split('/')[3],Buffer.concat(chunks));return json(response,200,{cvAvailable:true});
      }
      if(path==='/api/lark/send'){const payload=await body(request);active++;try{const result=await sendCandidatesToLark(store,lark,workspace,payload,cvLinks,decisionLinks);if(!result.complete)console.warn(JSON.stringify({event:'lark_partial_delivery',requestId,sentCount:result.sentCount,totalCount:result.totalCount,codes:[...new Set(result.failures.map(f=>f.code))]}));return json(response,200,result);}finally{active--;}}
      if(path==='/api/lark/check'){await body(request);return json(response,200,await lark.check());}
      if(path==='/api/candidates/delete')return json(response,200,await deleteCandidates(store,positions,workspace,(await body(request)).candidates));
      if(path==='/api/positions')return json(response,201,await positions.create(workspace,await body(request)));
      if(/^\/api\/positions\/[^/]+$/.test(path))return json(response,200,await positions.update(workspace,decodeURIComponent(path.split('/')[3]),await body(request)));
      if (!process.env.OPEN_AI_API_KEY) return json(response,503,{error:'Scoring is not configured yet. Add OPEN_AI_API_KEY on Railway.'});
      const payload = await body(request);
      active++;
      try {
        if (path === '/api/score'){const {service,scope}=await scorer(workspace,payload.positionId || 'hr-intern',payload.positionVersion ?? 1);return json(response,200,await service.analyze(scope,payload.text,{fileName:payload.fileName}));}
        if (/^\/api\/jobs\/[\w-]+\/review$/.test(path)){const {service,scope}=await scorer(workspace,payload.positionId || 'hr-intern',payload.positionVersion ?? 1);return json(response,200,await service.review(scope,path.split('/')[3],payload.decisions));}
        return json(response,404,{error:'Not found.'});
      } finally { active--; }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response,405,{error:'Method not allowed.'});
    let file = resolve(dist,decodeURIComponent(path).replace(/^\//,''));
    if (!file.startsWith(dist+sep) && file !== dist) return json(response,403,{error:'Not allowed.'});
    try { if (!(await stat(file)).isFile()) file = resolve(dist,'index.html'); }
    catch { if (extname(path)) return json(response,404,{error:'Not found.'}); file = resolve(dist,'index.html'); }
    const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml','.ttf':'font/ttf','.bcmap':'application/octet-stream','.pfb':'application/octet-stream'}[extname(file)] || 'application/octet-stream';
    response.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'});
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).on('error',()=>response.destroy()).pipe(response);
  } catch (error) {
    const {status,data,log}=failureReport(error,request,requestId,Date.now()-started);
    if(status>=500)console.error(JSON.stringify(log));
    if (!response.headersSent) json(response,status,data);
    else response.destroy();
  }
});
server.requestTimeout = 240000;
await store.initialize();
server.listen(Number(process.env.PORT || 3001),'0.0.0.0',()=>console.log('HR Scoring server ready.'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await store.close();process.exit(0);}));
