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
   const fields = body.text.format.schema.properties.evidence.items.properties;
   assert.ok(fields.sentenceId); assert.equal(fields.keyword,undefined); assert.equal(fields.quote,undefined);
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
