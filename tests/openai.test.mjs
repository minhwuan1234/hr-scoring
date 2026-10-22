import test from 'node:test';
import assert from 'node:assert/strict';
import { embed, extractEvidence, assessCeilings, LUNA_MODEL } from '../server/openai.mjs';

test('Luna Responses request uses server key, structured evidence and no response storage', async () => {
 const original = globalThis.fetch, key = process.env.OPEN_AI_API_KEY;
 process.env.OPEN_AI_API_KEY = 'test-only-placeholder';
 try {
  globalThis.fetch = async (url,options) => {
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(options.headers.Authorization,'Bearer test-only-placeholder');
   const body = JSON.parse(options.body);
   assert.equal(body.model,LUNA_MODEL);
   if (!process.env.OPENAI_MODEL) assert.equal(body.model,'gpt-5.6-luna'); assert.equal(body.store,false);
   assert.equal(body.text.format.type,'json_schema'); assert.equal(body.text.format.strict,true);
   assert.ok(body.input[0].content[0].text.includes('synthetic CV text'));
   const fields = body.text.format.schema.properties.evidence.items.anyOf[0].properties;
   assert.ok(fields.sentenceId); assert.equal(fields.keyword,undefined); assert.equal(fields.quote,undefined);
   assert.equal(body.text.format.schema.properties.evidence.maxItems,10);assert.match(body.instructions,/at most 10/);assert.match(body.instructions,/sentence-ending period/);
   return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"evidence":[]}'}]}]})};
  };
  assert.deepEqual(await extractEvidence('synthetic CV text'),{evidence:[]});
 } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPEN_AI_API_KEY; else process.env.OPEN_AI_API_KEY = key; }
});

test('embeddings are reordered by provider indices and provider errors do not leak raw bodies', async () => {
 const original = globalThis.fetch, key = process.env.OPEN_AI_API_KEY;
 process.env.OPEN_AI_API_KEY = 'test-only-placeholder';
 try {
  globalThis.fetch = async () => ({ok:true,json:async()=>({data:[{index:1,embedding:[0,1]},{index:0,embedding:[1,0]}]})});
  assert.deepEqual(await embed(['first','second']),[[1,0],[0,1]]);
  globalThis.fetch = async () => ({ok:false,status:401,json:async()=>({secret:'should never appear'})});
  await assert.rejects(()=>embed(['first']),e=>e.status === 502 && !e.message.includes('should never appear'));
 } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPEN_AI_API_KEY; else process.env.OPEN_AI_API_KEY = key; }
});


test('ceiling evaluation receives original evidence and target standard without retrieval scores',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;
 process.env.OPEN_AI_API_KEY='test-only-placeholder';
 try {
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');
   const body=JSON.parse(options.body);
   assert.equal(body.model,LUNA_MODEL);assert.equal(body.store,false);
   assert.equal(body.text.format.name,'hr_intern_ceiling_assessments');
   const [item]=JSON.parse(body.input[0].content[0].text);
   assert.deepEqual(Object.keys(item).sort(),['bandFloor','ceilingStandard','dimension','id','referenceCap','rubricGuide','sentence']);
   assert.equal(item.sentence,'Only attended a course; did not apply it.');
   assert.equal(item.bandFloor,21);assert.equal(item.referenceCap,30);
   assert.equal(item.ceilingStandard,'Independently learned and applied skills repeatedly.');
   return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({assessments:[{id:'e',fulfillment:0.4,reason:'Partial evidence.'}]})}]}]})};
  };
  const result=await assessCeilings([{id:'e',quote:'Only attended a course; did not apply it.',dimension:'learning-drive',similarity:0.99,vector:[1,0],reference:{id:'r',statement:'Independently learned and applied skills repeatedly.',band:2,cap:30}}]);
  assert.equal(result[0].fulfillment,0.4);
 } finally {globalThis.fetch=original;if(key===undefined) delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});

test('structured evidence binds each criterion to its own valid bands',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;process.env.OPEN_AI_API_KEY='test-only-placeholder';
 try{
  globalThis.fetch=async(url,options)=>{
   const schema=JSON.parse(options.body).text.format.schema.properties.evidence.items;
   const short=schema.anyOf.find(branch=>branch.properties.dimension.enum.includes('short'));
   const long=schema.anyOf.find(branch=>branch.properties.dimension.enum.includes('long'));
   assert.deepEqual(short.properties.band.enum,[0]);assert.deepEqual(long.properties.band.enum,[0,1,2]);
   assert.notEqual(short,long);assert.equal(short.additionalProperties,false);
   return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"evidence":[]}'}]}]})};
  };
  await extractEvidence('Synthetic custom role CV',{name:'Custom',generalRules:'',rubric:[{id:'short',bands:[[0,10,'One band']]},{id:'long',bands:[[0,1,'Low'],[2,3,'Mid'],[4,5,'High']]}]});
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});

test('transport and upstream 5xx failures retry once, with no raw error leakage',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;process.env.OPEN_AI_API_KEY='test-only-placeholder';
 try{
  let calls=0;
  globalThis.fetch=async()=>{if(++calls===1)throw new TypeError('secret CV in network error');return {ok:true,json:async()=>({data:[{index:0,embedding:[1,0]}]})};};
  assert.deepEqual(await embed(['Synthetic evidence']),[[1,0]]);assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:503};};
  await assert.rejects(()=>embed(['Synthetic evidence']),e=>e.status===502&&e.code==='PROVIDER_HTTP_503');assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('secret CV in network error');};
  await assert.rejects(()=>embed(['Synthetic evidence']),e=>e.status===502&&e.code==='PROVIDER_CONNECTION'&&!e.message.includes('secret CV'));assert.equal(calls,2);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});

test('quota, credentials, timeouts and unreadable responses are explicit, without blind retries',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;process.env.OPEN_AI_API_KEY='test-only-placeholder';
 try{
  for(const [status,expected] of [[401,502],[404,502],[429,429]]){
   let calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status};};
   await assert.rejects(()=>embed(['Synthetic']),e=>e.status===expected&&e.code===`PROVIDER_HTTP_${status}`);assert.equal(calls,1);
  }
  let calls=0;globalThis.fetch=async()=>{calls++;throw Object.assign(new Error('secret timeout'),{name:'TimeoutError'});};
  await assert.rejects(()=>embed(['Synthetic']),e=>e.status===504&&e.code==='PROVIDER_TIMEOUT');assert.equal(calls,1);
  globalThis.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('secret raw provider body');}});
  await assert.rejects(()=>embed(['Synthetic']),e=>e.status===502&&e.code==='PROVIDER_RESPONSE_INVALID'&&!e.message.includes('secret'));
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});

test('long provider Retry-After is surfaced without retrying early, and malformed embeddings are 502',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;process.env.OPEN_AI_API_KEY='test-only-placeholder';
 try{
  let calls=0;globalThis.fetch=async()=>{calls++;return {ok:false,status:503,headers:new Headers({'retry-after':'120'})};};
  await assert.rejects(()=>embed(['Synthetic']),e=>e.code==='PROVIDER_HTTP_503');assert.equal(calls,1);
  for(const output of [null,{data:{}},{data:[null]},{data:[{index:0,embedding:[1]},{index:1,embedding:[1,0]}]}]){
   globalThis.fetch=async()=>({ok:true,json:async()=>output});
   await assert.rejects(()=>embed(['One','Two']),e=>e.status===502&&e.code==='PROVIDER_EMBEDDINGS_INVALID');
  }
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});
