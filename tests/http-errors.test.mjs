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
