import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('HTTP scoring failure exposes a traceable 502 and private-safe stage diagnostics',async()=>{
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'hr-http-errors-'));
 // No real API/database access: only the child process provider is replaced.
 const script=`globalThis.fetch=async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({evidence:[{sentenceId:'s999',statement:'Synthetic capability.',reason:'Synthetic reason.',dimension:'learning-drive',band:1}]})}]}]})});await import('./server/http.mjs');`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:'',RAILWAY_PROJECT_ID:'',SCORING_DATA_DIR:directory,OPEN_AI_API_KEY:'test-only-placeholder',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Synthetic server did not start.')),10000);
   child.stdout.on('data',chunk=>{if(chunk.toString().includes('server ready')){clearTimeout(timer);resolve();}});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Synthetic server exited: ${code}`));});
  });
  const response=await fetch(`http://127.0.0.1:${port}/api/score`,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':'b'.repeat(64)},body:JSON.stringify({text:'Private Synthetic Person learned Sheets and applied it to a project.'}),signal:AbortSignal.timeout(10000)});
  const payload=await response.json();assert.equal(response.status,502);assert.match(payload.error,/verified/);
  assert.match(payload.requestId,/^[a-f0-9-]{36}$/);assert.equal(response.headers.get('x-request-id'),payload.requestId);
  const log=JSON.parse(stderr.trim().split('\n').find(line=>line.includes('request_failed')));
  assert.equal(log.requestId,payload.requestId);assert.equal(log.stage,'evidence-extraction');assert.equal(log.code,'MODEL_SENTENCE_INVALID');
  assert.doesNotMatch(stderr,/Private Synthetic Person|test-only-placeholder/);
 }finally{
  const exit=once(child,'exit');child.kill('SIGTERM');await exit;await rm(directory,{recursive:true,force:true});
 }
});

test('shared CV URL opens only its signed PDF without a workspace token and stops working after deletion',async()=>{
 const {createStore}=await import('../server/store.mjs');
 const {createCvLinks}=await import('../server/cv-links.mjs');
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'hr-shared-cv-')),owner='c'.repeat(64),id='synthetic-shared-cv';
 const store=createStore({databaseUrl:null,directory});
 await store.update(owner,state=>{state.candidates??={};state.candidates[id]={id,fileName:'Synthetic CV.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:Date.now(),updatedAt:Date.now(),state:'complete',total:70,pendingCount:0,dimensions:[],cvAvailable:false};});
 const bytes=Buffer.from('%PDF-1.7\nSynthetic shared original\n%%EOF');await store.cvFiles.save(owner,id,bytes);
 const links=createCvLinks({env:{CV_LINK_SECRET:'synthetic-share-secret'}}),path=new URL(links.url(owner,id)).pathname;
 const child=spawn(process.execPath,['server/http.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:'',RAILWAY_PROJECT_ID:'',SCORING_DATA_DIR:directory,CV_LINK_SECRET:'synthetic-share-secret',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Synthetic server did not start.')),10000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('server ready')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Synthetic server exited early.'));});});
  const base=`http://127.0.0.1:${port}`;
  const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const head=await fetch(base+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(`${base}/api/jobs/${id}/cv`)).status,401);
  assert.equal((await fetch(base+path.replace('v1.','v2.'))).status,404);
  await store.removeCandidates([{scope:owner,ids:[id]}]);assert.equal((await fetch(base+path)).status,404);
 }finally{if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}await store.close();await rm(directory,{recursive:true,force:true});}
});

test('Lark decision links show a read-only confirmation and POST only the signed decision, independent of scoring',async()=>{
 const {createStore}=await import('../server/store.mjs'),{createDecisionLinks}=await import('../server/decision-links.mjs'),{LARK_RECIPIENTS}=await import('../server/lark-config.mjs');
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 const directory=await mkdtemp(join(tmpdir(),'hr-http-decision-')),owner='e'.repeat(64),id='synthetic-decision';
 const store=createStore({databaseUrl:null,directory});
 const record={id,fileName:'Synthetic CV.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:1000,updatedAt:1000,state:'complete',total:25,pendingCount:0,dimensions:[],cvAvailable:false};
 await store.update(owner,state=>{state.candidates={[id]:record};});
 const links=createDecisionLinks({env:{CV_LINK_SECRET:'synthetic-decision-secret'}}),path=new URL(links.url(owner,id,LARK_RECIPIENTS[0],'accept')).pathname;
 const child=spawn(process.execPath,['server/http.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:'',RAILWAY_PROJECT_ID:'',SCORING_DATA_DIR:directory,CV_LINK_SECRET:'synthetic-decision-secret',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Synthetic server did not start.')),10000);child.stdout.on('data',chunk=>{if(chunk.toString().includes('server ready')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Synthetic server exited early.'));});});
  const base=`http://127.0.0.1:${port}`;
  const get=await fetch(base+path);assert.equal(get.status,200);assert.match(await get.text(),/Confirm candidate decision/);assert.equal(get.headers.get('referrer-policy'),'no-referrer');assert.equal(get.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+path,{method:'HEAD'})).status,200);assert.equal((await store.candidate(owner,id)).manualDecision,undefined);
  assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await fetch(base+path+'tampered',{method:'POST'})).status,404);
  assert.equal((await store.candidate(owner,id)).manualDecision,undefined);
  const post=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:base},body:'decision=denied&total=100'});assert.equal(post.status,200);assert.match(await post.text(),/Decision saved/);
  const saved=await store.candidate(owner,id);assert.equal(saved.manualDecision,'accept');assert.equal(saved.total,25);assert.equal(saved.state,'complete');
  await fetch(base+path,{method:'POST'});assert.equal((await store.candidate(owner,id)).decisionAt,saved.decisionAt);
  await store.removeCandidates([{scope:owner,ids:[id]}]);assert.equal((await fetch(base+path,{method:'POST'})).status,404);assert.equal((await fetch(base+path)).status,404);
 }finally{if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}await store.close();await rm(directory,{recursive:true,force:true});}
});
