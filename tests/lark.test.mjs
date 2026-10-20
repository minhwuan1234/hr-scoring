import test from 'node:test';
import assert from 'node:assert/strict';
import {createLarkClient} from '../server/lark.mjs';
const env={LARK_APP_ID:'synthetic-id',LARK_APP_SECRET:'synthetic-secret'};
const success=()=>({ok:true,json:async()=>({code:0,tenant_access_token:'private-synthetic-token',expire:7200})});
test('Lark credential check caches authentication and exposes no secrets or tokens',async()=>{
 let calls=0,time=0,release;
 const client=createLarkClient({env,now:()=>time,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal');
  assert.deepEqual(JSON.parse(options.body),{app_id:env.LARK_APP_ID,app_secret:env.LARK_APP_SECRET});
  if(calls===1)await new Promise(resolve=>{release=resolve;});return success();
 }});
 const first=client.check(),second=client.check();assert.equal(calls,1);release();
 assert.deepEqual(await first,{connected:true,recipientCount:3});await second;await client.check();assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(client.status()),/synthetic|token|secret/);
 time=7140000;await client.check();assert.equal(calls,2);
});
test('missing credentials fail without network calls; short environment variable aliases work',async()=>{
 const client=createLarkClient({env:{},fetcher:async()=>{throw new Error('Unexpected network call');}});
 assert.deepEqual(client.status(),{configured:false,missing:['LARK_APP_ID','LARK_APP_SECRET']});
 await assert.rejects(()=>client.check(),e=>e.status===503&&e.code==='LARK_NOT_CONFIGURED');
 const aliases=createLarkClient({env:{LARK_ID:'synthetic',LARK_SECRET:'synthetic'},fetcher:async()=>success()});assert.equal((await aliases.check()).connected,true);
});
test('Lark failures are safe and failed authentication can be retried',async()=>{
 for(const response of [{ok:false,status:403},{ok:true,json:async()=>({code:10003,msg:'private-synthetic-token synthetic-secret'})},{ok:true,json:async()=>({code:0,expire:7200})},{ok:true,json:async()=>{throw new Error('synthetic-secret');}}]){
  let calls=0;const client=createLarkClient({env,fetcher:async()=>++calls===1?response:success()});
  await assert.rejects(()=>client.check(),e=>e.status===502&&e.stage==='lark-auth'&&!/synthetic-secret|private-synthetic-token/.test(e.message));
  assert.equal((await client.check()).connected,true);assert.equal(calls,2);
 }
 const client=createLarkClient({env,fetcher:async()=>{throw new TypeError('synthetic-secret');}});
 await assert.rejects(()=>client.check(),e=>e.code==='LARK_CONNECTION'&&!e.message.includes('synthetic-secret'));
});

import {LARK_RECIPIENTS,SETUP_CALL_URL} from '../server/lark-config.mjs';
import {candidateCard,validateDriveUrl} from '../server/lark-cards.mjs';
import {sendCandidatesToLark} from '../server/lark-send.mjs';
const candidate={id:'cv-one',positionId:'role',positionVersion:1,positionName:'Custom Position',fileName:'sample.pdf',candidateProfile:{name:'Synthetic Candidate',phone:'0123456789',email:'synthetic@example.test'},state:'complete',total:67,dimensions:[{id:'custom',title:'Custom criterion',score:67,max:100}]};
const driveUrl='https://drive.google.com/file/d/synthetic-cv-id/view';
const payload={requestId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',candidates:[{id:candidate.id,positionId:'role',positionVersion:1,driveUrl}],receivers:['unapproved'],total:100,name:'invented'};
const store={candidates:async owner=>owner==='owner'?[candidate]:[]};
test('configured recipients exactly match the three confirmed Open IDs',()=>{
 assert.deepEqual(LARK_RECIPIENTS,['ou_f77cf794a1319628941dd689ecc97e32','ou_4eb96bd84a22b6511fcb316d35ded621','ou_9f7de713af63322b36ee7e41f5731313']);
 assert.equal(new Set(LARK_RECIPIENTS).size,3);
});
test('candidate card preserves the two original buttons and uses dynamic saved score breakdowns',()=>{
 const card=candidateCard(candidate,driveUrl),actions=card.elements.at(-1).actions;
 assert.deepEqual(actions.map(a=>[a.text.content,a.url]),[['📄 Xem CV trên Google Drive',driveUrl],['📅 Setup lịch Call',SETUP_CALL_URL]]);
 assert.equal(actions.length,2);assert.equal(actions[0].type,'primary');assert.equal(actions[1].type,'default');
 assert.equal(card.header.template,'orange');assert.match(JSON.stringify(card),/Custom criterion/);assert.match(JSON.stringify(card),/67\/100/);
 assert.equal(candidateCard({...candidate,total:50},driveUrl).header.template,'red');
 assert.equal(candidateCard({...candidate,total:70},driveUrl).header.template,'green');
 const review=candidateCard({...candidate,state:'review',total:80},driveUrl);assert.equal(review.header.template,'grey');assert.match(JSON.stringify(review),/provisional/);
});
test('Lark client sends interactive cards only to confirmed users and validates HTTP and logical success',async()=>{
 const messages=[];
 const client=createLarkClient({env,fetcher:async(url,options)=>{
  if(url.endsWith('/internal'))return success();
  assert.equal(url,'https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=open_id');
  assert.equal(options.headers.Authorization,'Bearer private-synthetic-token');
  messages.push(JSON.parse(options.body));return {ok:true,json:async()=>({code:0,data:{message_id:'synthetic-message'}})};
 }});
 const card=candidateCard(candidate,driveUrl);
 assert.deepEqual(await client.sendCard(LARK_RECIPIENTS[0],card,'stable-id'),{messageId:'synthetic-message'});
 assert.equal(messages[0].receive_id,LARK_RECIPIENTS[0]);assert.equal(messages[0].msg_type,'interactive');assert.equal(messages[0].uuid,'stable-id');assert.deepEqual(JSON.parse(messages[0].content),card);
 await assert.rejects(()=>client.sendCard('unapproved',card,'id'),e=>e.status===400);assert.equal(messages.length,1);
 const denied=createLarkClient({env,fetcher:async url=>url.endsWith('/internal')?success():{ok:true,json:async()=>({code:230013,msg:'private upstream body'})}});
 await assert.rejects(()=>denied.sendCard(LARK_RECIPIENTS[0],card,'id'),e=>e.code==='LARK_SEND_REJECTED'&&e.message.includes('230013')&&!e.message.includes('private upstream'));
});
test('sending uses server-owned records and ignores client scores, identities and recipients',async()=>{
 const sent=[];const lark={check:async()=>({connected:true}),sendCard:async(receiver,card,uuid)=>{sent.push({receiver,card,uuid});}};
 const result=await sendCandidatesToLark(store,lark,'owner',payload);assert.equal(result.complete,true);assert.equal(result.sentCount,3);
 assert.deepEqual(sent.map(s=>s.receiver),LARK_RECIPIENTS);assert.match(JSON.stringify(sent[0].card),/Synthetic Candidate/);assert.doesNotMatch(JSON.stringify(sent[0].card),/invented/);
 assert.equal(new Set(sent.map(s=>s.uuid)).size,3);
 let networkCalls=0;const unused={check:async()=>{networkCalls++;},sendCard:async()=>{networkCalls++;}};
 await assert.rejects(()=>sendCandidatesToLark(store,unused,'different-owner',payload),e=>e.status===404);
 await assert.rejects(()=>sendCandidatesToLark(store,unused,'owner',{...payload,candidates:[{...payload.candidates[0],driveUrl:'https://example.test/private'}]}),e=>e.status===400);
 await assert.rejects(()=>sendCandidatesToLark(store,unused,'owner',{...payload,requestId:'invalid'}),e=>e.status===400);assert.equal(networkCalls,0);
});
test('partial delivery is reported and retry retains per-candidate/per-recipient deduplication IDs',async()=>{
 const calls=[],delivered=new Set();let fail=true;
 const lark={check:async()=>({connected:true}),sendCard:async(receiver,card,uuid)=>{calls.push({receiver,uuid});if(receiver===LARK_RECIPIENTS[1]&&fail)throw Object.assign(new Error('Synthetic denied delivery'),{code:'LARK_SEND_REJECTED'});delivered.add(uuid);}};
 const first=await sendCandidatesToLark(store,lark,'owner',payload);assert.equal(first.complete,false);assert.equal(first.sentCount,2);assert.equal(first.failures.length,1);
 fail=false;const retry=await sendCandidatesToLark(store,lark,'owner',payload);assert.equal(retry.complete,true);assert.equal(delivered.size,3);
 assert.deepEqual(calls.slice(0,3),calls.slice(3));
});
test('CV buttons cannot use unsafe, credential-bearing or unrelated URLs',()=>{
 for(const url of ['javascript:alert(1)','http://drive.google.com/file/d/test/view','https://drive.google.com.evil.test/file','https://private@drive.google.com/file','https://example.test/cv','https://drive.google.com/'])assert.throws(()=>validateDriveUrl(url),e=>e.status===400);
 assert.equal(validateDriveUrl(driveUrl),driveUrl);
});
