import test from 'node:test';
import assert from 'node:assert/strict';
import { embed, extractEvidence, LUNA_MODEL } from '../server/openai.mjs';

test('Luna Responses request uses server key, structured evidence and no response storage', async () => {
 const original = globalThis.fetch, key = process.env.OPEN_AI_API_KEY;
 process.env.OPEN_AI_API_KEY = 'test-only-placeholder';
 try {
  globalThis.fetch = async (url,options) => {
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.equal(options.headers.Authorization,'Bearer test-only-placeholder');
   const body = JSON.parse(options.body);
   assert.equal(body.model,LUNA_MODEL); assert.equal(body.store,false);
   assert.equal(body.text.format.type,'json_schema'); assert.equal(body.text.format.strict,true);
   assert.ok(body.input[0].content[0].text.includes('synthetic CV text'));
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
