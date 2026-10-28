import test from 'node:test';
import assert from 'node:assert/strict';
import {createLarkReviewAuth} from '../server/lark-review-auth.mjs';
import {LARK_REVIEWERS} from '../server/reviewers.mjs';
const id=Object.keys(LARK_REVIEWERS)[1],env={LARK_APP_ID:'test-app',LARK_APP_SECRET:'synthetic-secret',PUBLIC_APP_URL:'https://app.test'};
const raw=cookie=>cookie.split(';')[0].split('=')[1];
test('Lark login binds browser state and signed link; identity comes only from Lark user_info',async()=>{
 let time=1000;const calls=[];
 const auth=createLarkReviewAuth({env,now:()=>time,fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/token')?{code:0,access_token:'private-user-token'}:{code:0,data:{open_id:id,name:'Verified Lark Name'}}};}});
 const start=auth.start('signed-link'),url=new URL(start.location),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('redirect_uri'),'https://app.test/lark/review/callback');assert.match(start.cookie,/HttpOnly; Secure; SameSite=Lax/);
 await assert.rejects(()=>auth.finish({code:'code',state:'forged',cookie:raw(start.cookie)}),e=>e.status===401);assert.equal(calls.length,0);
 const finish=await auth.finish({code:'code',state,cookie:raw(start.cookie)});
 assert.deepEqual(auth.reviewer(raw(finish.cookie),'signed-link'),{id,name:'Verified Lark Name'});assert.equal(finish.token,'signed-link');assert.doesNotMatch(finish.cookie,/private-user-token/);
 assert.equal(JSON.parse(calls[0].options.body).grant_type,'authorization_code');assert.equal(calls[1].options.headers.Authorization,'Bearer private-user-token');
 assert.throws(()=>auth.reviewer(raw(finish.cookie),'other-link'),e=>e.status===401);
 assert.throws(()=>auth.reviewer(raw(finish.cookie)+'x','signed-link'),e=>e.status===401);
 await assert.rejects(()=>auth.finish({code:'code',state,cookie:raw(finish.cookie)}),e=>e.status===401);
 time+=31*60000;assert.throws(()=>auth.reviewer(raw(finish.cookie),'signed-link'),e=>e.status===401);
});
test('Lark login fails closed on missing config, upstream errors and unknown accounts',async()=>{
 assert.throws(()=>createLarkReviewAuth({env:{}}).start('link'),e=>e.status===503);
 for(const result of [{code:1},{code:0,data:{open_id:'ou_unknown',name:'Unknown'}}]){
  const auth=createLarkReviewAuth({env,fetcher:async url=>({ok:true,json:async()=>url.endsWith('/token')?{code:0,access_token:'test'}:result})}),start=auth.start('link');
  await assert.rejects(()=>auth.finish({code:'test',state:new URL(start.location).searchParams.get('state'),cookie:raw(start.cookie)}),e=>[502,403].includes(e.status));
 }
});
