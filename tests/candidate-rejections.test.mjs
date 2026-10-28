import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createStore} from '../server/store.mjs';
import {LARK_REVIEWERS,decisionCounts} from '../server/reviewers.mjs';
import {postgresPool} from './helpers/pglite.mjs';
import {rejectionRequestId} from '../server/candidate-rejections.mjs';
import {decisionPage} from '../server/decision-page.mjs';
const [a,b]=Object.keys(LARK_REVIEWERS),scope='d'.repeat(64),id='reject-synthetic';
const record={id,fileName:'Test.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:1000,updatedAt:1000,state:'complete',total:85,pendingCount:0,dimensions:[]};
const input=(who=a,reason=null,token='link')=>({reviewer:{id:who,name:`Lark ${LARK_REVIEWERS[who]}`},reason,requestId:rejectionRequestId(token,who)});
for(const backend of ['file','postgresql'])test(`${backend}: reject metadata, optional reason, concurrency, durable dedupe and scoring isolation`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'reject-')),pg=backend==='postgresql'?await postgresPool():null;
 const store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
 try{
  await store.update(scope,s=>{s.candidates={[id]:structuredClone(record)};});
  const before=await store.candidatePage(scope,{});
  const outcomes=await Promise.all([store.rejectCandidate(scope,id,input(a,'  missing experience  ')),store.rejectCandidate(scope,id,input(a,'retry must not replace reason')),store.rejectCandidate(scope,id,input(b,'   '))]);
  assert.deepEqual(outcomes.map(o=>o.duplicate),[false,true,false]);
  let current=await store.candidate(scope,id),vote=current.reviewerDecisions[a];
  assert.equal(vote.decision,'reject');assert.equal(vote.reviewer_id,a);assert.equal(vote.reviewer_name,`Lark ${LARK_REVIEWERS[a]}`);assert.equal(vote.reject_reason,'missing experience');assert.equal(Date.parse(vote.reviewed_at),vote.decidedAt);assert.equal(current.reviewerDecisions[b].reject_reason,null);
  assert.deepEqual(decisionCounts(current),{accept:0,reject:2});assert.equal(current.total,85);assert.equal(current.state,'complete');assert.deepEqual((await store.candidatePage(scope,{})).stats,before.stats);
  const snapshot=structuredClone(current.reviewerDecisions);
  await store.update(scope,s=>{s.jobs[id]={id,createdAt:1000,embeddingModel:'test',referenceVersion:1,evidence:[],result:{state:'complete',total:72,pending:[],dimensions:[]}};});
  assert.deepEqual((await store.candidatePage(scope,{})).rows[0].reviewerDecisions,snapshot);
  await store.decideCandidate(scope,id,'accept',a);
  // Old callback remains a no-op even after Accept, including a new store instance.
  const reopened=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
  assert.equal((await reopened.rejectCandidate(scope,id,input(a,'old retry'))).duplicate,true);
  assert.equal((await store.candidate(scope,id)).reviewerDecisions[a].decision,'accept');
  for(const reason of [42,{},'x'.repeat(2001)])await assert.rejects(()=>store.rejectCandidate(scope,id,input(a,reason,'bad')),e=>e.status===400);
  await assert.rejects(()=>store.rejectCandidate(scope,id,input('ou_unknown')),e=>e.status===400);
  if(pg){
   const audit=(await pg.db.query('SELECT * FROM hr_scoring_candidate_rejections')).rows;assert.equal(audit.length,2);assert.equal(audit.find(r=>r.reviewer_id===a).reject_reason,'missing experience');assert.equal(audit[0].decision,'reject');
   // Force the second write to fail; the receipt insert must roll back too.
   await pg.db.exec(`ALTER TABLE hr_scoring_candidates ADD CONSTRAINT reject_failure CHECK (NOT (reviewer_decisions ? '${a}') OR reviewer_decisions->'${a}'->>'decision'='accept')`);
   await assert.rejects(()=>store.rejectCandidate(scope,id,input(a,'rollback','new-link')));
   assert.equal((await pg.db.query('SELECT count(*)::int AS n FROM hr_scoring_candidate_rejections')).rows[0].n,2);
   assert.equal((await store.candidate(scope,id)).reviewerDecisions[a].decision,'accept');
  }
  await store.removeCandidates([{scope,ids:[id]}]);
  await assert.rejects(()=>store.rejectCandidate(scope,id,input()),e=>e.status===404);
  if(pg)assert.equal((await pg.db.query('SELECT count(*)::int AS n FROM hr_scoring_candidate_rejections')).rows[0].n,0);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('reject page escapes names and requires Confirm; browser never saves on page load',async()=>{
 const html=decisionPage({...record,candidateProfile:{name:'<script>bad</script>'}},'denied',false,{name:'<img src=x>'});
 assert.match(html,/Rejection reason \(optional\)/);assert.match(html,/id="reject-confirm"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>bad/);
 const handlers={},elements=Object.fromEntries(['decision-heading','decision-notice','decision-retry','reject-form','reject-confirm','reject-reason'].map(id=>[id,{value:'optional <reason>',addEventListener:(kind,fn)=>{handlers[`${id}:${kind}`]=fn;}}]));
 let calls=0,payload;
 vm.runInNewContext(await readFile(new URL('../server/decision-client.js',import.meta.url),'utf8'),{document:{getElementById:id=>elements[id]},location:{pathname:'/lark/decision/test'},AbortSignal,fetch:async(url,options)=>{calls++;payload=options;return {ok:true,json:async()=>({saved:true,decision:'reject'})};}});
 assert.equal(calls,0);handlers['reject-form:submit']({preventDefault(){}});await new Promise(r=>setImmediate(r));
 assert.equal(calls,1);assert.equal(payload.credentials,'same-origin');assert.deepEqual(JSON.parse(payload.body),{confirm:true,reject_reason:'optional <reason>'});assert.equal(elements['reject-form'].hidden,true);assert.equal(elements['decision-heading'].textContent,'Candidate rejected');
});
