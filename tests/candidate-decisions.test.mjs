import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createDecisionLinks} from '../server/decision-links.mjs';
import {createCvLinks} from '../server/cv-links.mjs';
import {candidateCard} from '../server/lark-cards.mjs';
import {decisionPage} from '../server/decision-page.mjs';
import {LARK_REVIEWERS,decisionCounts} from '../server/reviewers.mjs';
import {LARK_RECIPIENTS} from '../server/lark-config.mjs';
import {postgresPool} from './helpers/pglite.mjs';
const receivers=Object.keys(LARK_REVIEWERS),[quan,trang,chi]=receivers;
const owner='d'.repeat(64),env={CV_LINK_SECRET:'synthetic-only-secret'},id='synthetic-decision';
const record={id,fileName:'Synthetic.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:1000,updatedAt:1000,state:'review',total:20,pendingCount:1,dimensions:[{id:'learning-drive',title:'Learning',score:20,max:30}],candidateProfile:{name:'Synthetic Candidate'},cvAvailable:false};
test('decision links bind action, candidate, recipient and expiry separately from read-only PDF links',()=>{
 const links=createDecisionLinks({env,now:()=>100000}),url=links.url(owner,id,LARK_RECIPIENTS[0],'accept'),token=url.split('/').at(-1);
 assert.deepEqual(links.verify(token),{scope:owner,id,decision:'accept',receiver:quan});
 const denied=links.url(owner,id,LARK_RECIPIENTS[0],'denied').split('/').at(-1);assert.equal(links.verify(denied).decision,'denied');
 const parts=token.split('.'),value=JSON.parse(Buffer.from(parts[1],'base64url'));value.decision='denied';parts[1]=Buffer.from(JSON.stringify(value)).toString('base64url');
 for(const invalid of [parts.join('.'),token+'x',new URL(createCvLinks({env}).url(owner,id)).pathname.split('/').at(-1)])assert.throws(()=>links.verify(invalid),e=>e.status===404);
 assert.throws(()=>createDecisionLinks({env,now:()=>100000+30*86400000}).verify(token),e=>e.status===404);
 assert.throws(()=>createDecisionLinks({env:{CV_LINK_SECRET:'rotated'}}).verify(token),e=>e.status===404);
 assert.throws(()=>links.url(owner,id,'ou_unknown','accept'),e=>e.status===404);
});
for(const backend of ['file','postgresql'])test(`${backend}: reviewers have independent decisions, counts, persistence and scoring isolation`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'candidate-decisions-')),pg=backend==='postgresql'?await postgresPool():null;
 const store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
 try{
  await store.update(owner,state=>{state.candidates={[id]:structuredClone(record)};});
  const before=await store.candidatePage(owner,{});
  const accepted=await store.decideCandidate(owner,id,'accept',quan);assert.equal(accepted.reviewerDecisions[quan].name,'Minh Quân');assert.equal(accepted.total,20);assert.equal(accepted.state,'review');assert.deepEqual(accepted.dimensions,record.dimensions);
  const repeated=await store.decideCandidate(owner,id,'accept',quan);assert.deepEqual(repeated.reviewerDecisions,accepted.reviewerDecisions);
  await Promise.all([store.decideCandidate(owner,id,'denied',trang),store.decideCandidate(owner,id,'accept',chi)]);
  let current=await store.candidate(owner,id);assert.deepEqual(decisionCounts(current),{accept:2,reject:1});assert.equal(current.reviewerDecisions[trang].name,'Trang Liu');assert.equal(current.reviewerDecisions[chi].name,'Quỳnh Chi');
  const others=structuredClone(current.reviewerDecisions);
  current=await store.decideCandidate(owner,id,'denied',quan);assert.deepEqual(decisionCounts(current),{accept:1,reject:2});assert.deepEqual(current.reviewerDecisions[trang],others[trang]);assert.deepEqual(current.reviewerDecisions[chi],others[chi]);
  assert.deepEqual((await store.candidatePage(owner,{})).stats,before.stats,'decisions never change scoring counts');
  assert.equal((await store.candidatePage(owner,{status:'pass'})).total,0);
  const decisions=structuredClone(current.reviewerDecisions);
  await store.update(owner,state=>{state.jobs[id]={id,createdAt:1000,embeddingModel:'synthetic-model',referenceVersion:1,evidence:[],result:{state:'complete',total:72,pending:[],dimensions:record.dimensions}};});
  const final=await store.candidate(owner,id);assert.equal(final.total,72);assert.deepEqual(final.reviewerDecisions,decisions);assert.equal(final.state,'complete');
  assert.deepEqual((await store.candidatePage(owner,{status:'pass'})).rows[0].reviewerDecisions,decisions);
  const reopened=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});assert.deepEqual((await reopened.candidate(owner,id)).reviewerDecisions,decisions);
  if(pg){
   await pg.db.query(`UPDATE hr_scoring_workspace_state SET payload=jsonb_set(payload,'{candidates}',$2::jsonb) WHERE workspace_id=$1`,[owner,JSON.stringify({[id]:{...record,reviewerDecisions:{[quan]:{name:'Minh Quân',decision:'accept',decidedAt:1}}}})]);
   await store.update(owner,()=>{});assert.deepEqual((await store.candidate(owner,id)).reviewerDecisions,decisions,'stale imports preserve newer votes and other reviewers');
  }
  await assert.rejects(()=>store.decideCandidate(owner,id,'other',quan),e=>e.status===400);
  await assert.rejects(()=>store.decideCandidate(owner,id,'accept','unknown'),e=>e.status===400);
  await assert.rejects(()=>store.decideCandidate('f'.repeat(64),id,'accept',quan),e=>e.status===404);
  await store.removeCandidates([{scope:owner,ids:[id]}]);assert.equal(await store.candidate(owner,id),undefined);
  await assert.rejects(()=>store.decideCandidate(owner,id,'accept',quan),e=>e.status===404);assert.equal((await store.candidatePage(owner,{})).total,0);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('cards and decision pages keep scoring status separate and escape candidate text',()=>{
 const links=createCvLinks({env}),url=links.url(owner,id),card=candidateCard({...record,state:'complete',total:20,reviewerDecisions:{[quan]:{name:'Minh Quân',decision:'accept',decidedAt:1}}},url);
 assert.equal(card.header.template,'red');assert.match(JSON.stringify(card),/Rejected/);assert.match(JSON.stringify(card),/Accept: 1 · Reject: 0/);
 const page=decisionPage({...record,candidateProfile:{name:'<script>bad()</script>'}},'accept');assert.doesNotMatch(page,/<script>bad/);assert.match(page,/&lt;script&gt;/);assert.match(page,/Saving decision/);assert.match(page,/decision-client.js/);assert.doesNotMatch(page,/Confirm candidate|<form/);
});

import {allowedWriteOrigin} from '../server/request-origin.mjs';
test('origin checks reject malformed origins and restrict opaque Safari origins to the signed JSON flow',()=>{
 const request=origin=>({headers:{origin,host:'app.test',accept:'application/json','x-decision-intent':'apply'}});
 assert.equal(allowedWriteOrigin(request('null')),false);
 assert.equal(allowedWriteOrigin(request('null'),{decision:true}),true);
 for(const origin of ['malformed-origin','https://other.test','javascript:alert(1)'])assert.equal(allowedWriteOrigin(request(origin),{decision:true}),false);
 assert.equal(allowedWriteOrigin(request('https://app.test'),{decision:true}),true);
 assert.equal(allowedWriteOrigin({headers:{origin:'null',host:'app.test'}},{decision:true}),false);
});
