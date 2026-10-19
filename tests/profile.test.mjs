import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfile,emptyProfile} from '../server/profile.mjs';
import {extractEvidence} from '../server/openai.mjs';
import {createStore} from '../server/store.mjs';
import {createScoringService} from '../server/service.mjs';
import {postgresPool} from './helpers/pglite.mjs';

const profile={name:'Nguyễn Minh An',phone:'+84 912 345 678',email:'an@example.com',linkedinUrl:'https://www.linkedin.com/in/sample-candidate'};
const cv='Nguyễn Minh An\n+84 912 345 678 | an@example.com\nlinkedin.com/in/sample-candidate\n\nLearned Sheets and applied it to a project tracker.';

test('only explicitly present contacts survive verification, retaining accents and country codes',()=>{
 assert.deepEqual(validateProfile(profile,cv),profile);
 assert.deepEqual(validateProfile(undefined,cv),emptyProfile());
 assert.deepEqual(validateProfile({name:'Someone Else',phone:'0987654321',email:'invented@example.com',linkedinUrl:'https://www.linkedin.com/in/invented'},cv),emptyProfile());
 for(const linkedinUrl of ['javascript:alert(1)','https://linkedin.com.evil.test/in/sample-candidate','https://evil@linkedin.com/in/sample-candidate','https://linkedin.com/company/sample-candidate','https://linkedin.com:123/in/sample-candidate'])assert.equal(validateProfile({linkedinUrl},`${cv} ${linkedinUrl}`).linkedinUrl,null);
 assert.equal(validateProfile({linkedinUrl:'linkedin.com/in/sample-candidate?tracking=1'},cv).linkedinUrl,profile.linkedinUrl);
 assert.equal(validateProfile({email:'an@example.com\r\nBcc:someone@else.test'},cv).email,null);
});

test('Luna extracts contacts and scoring evidence in one structured response with nullable fields',async()=>{
 const original=globalThis.fetch,key=process.env.OPEN_AI_API_KEY;process.env.OPEN_AI_API_KEY='test-only-placeholder';let calls=0;
 try{
  globalThis.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);const schema=body.text.format.schema;
   assert.deepEqual(schema.required,['candidateProfile','evidence']);assert.equal(schema.properties.candidateProfile.additionalProperties,false);
   for(const field of ['name','phone','email','linkedinUrl'])assert.deepEqual(schema.properties.candidateProfile.properties[field].type,['string','null']);
   assert.match(body.instructions,/metadata only/);assert.match(body.instructions,/never guess/);assert.equal(body.store,false);
   return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({candidateProfile:profile,evidence:[]})}]}]})};
  };
  assert.deepEqual((await extractEvidence(cv)).candidateProfile,profile);assert.equal(calls,1);
 }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPEN_AI_API_KEY;else process.env.OPEN_AI_API_KEY=key;}
});

test('PostgreSQL retains profile after review, job expiry, restart and legacy writes; contacts do not enter matching',async()=>{
 const {pool,db}=await postgresPool();const store=createStore({databaseUrl:null,pool});
 try{
  const provider={
   extractEvidence:async()=>({candidateProfile:profile,evidence:[{sentenceId:'s2',statement:'Applied learning.',reason:'Applied a tool.',dimension:'learning-drive',band:1}]}),
   embed:async texts=>{for(const text of texts){assert.ok(!text.includes(profile.name));assert.ok(!text.includes(profile.email));}return texts.map(t=>t==='Applied learning.'?[1,0]:[0,1]);},
   assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.5,reason:'Partial application.'})),
  };
  const service=createScoringService(store,provider,'test-model');
  // Read the actual segmented sentence ID to keep the fixture independent of header segmentation.
  const {cvSentences}=await import('../server/sentences.mjs');const sentenceId=cvSentences(cv).find(s=>s.quote.startsWith('Learned Sheets')).sentenceId;
  provider.extractEvidence=async()=>({candidateProfile:profile,evidence:[{sentenceId,statement:'Applied learning.',reason:'Applied a tool.',dimension:'learning-drive',band:1}]});
  const result=await service.analyze('owner',cv,{fileName:'candidate.pdf'});assert.equal(result.state,'review');assert.deepEqual(result.candidateProfile,profile);
  let rows=await store.candidates('owner');assert.deepEqual(rows[0].candidateProfile,profile);
  await service.review('owner',result.id,[{...result.pending[0],action:'approve',statement:'Applied learning.'}]);
  assert.deepEqual((await service.get('owner',result.id)).candidateProfile,profile);
  const saved=(await db.query('SELECT candidate_name,phone,email,linkedin_url FROM hr_scoring_candidates WHERE workspace_id=$1',['owner'])).rows[0];assert.equal(saved.candidate_name,profile.name);assert.equal(saved.email,profile.email);
  const reopened=createStore({databaseUrl:null,pool});assert.deepEqual((await reopened.candidates('owner'))[0].candidateProfile,profile);
  const snapshot=(await db.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id=$1',['owner'])).rows[0].payload;
  delete snapshot.candidates;for(const job of Object.values(snapshot.jobs))delete job.candidateProfile;
  await db.query('UPDATE hr_scoring_workspace_state SET payload=$2 WHERE workspace_id=$1',['owner',JSON.stringify(snapshot)]);
  await store.update('owner',()=>null);
  assert.deepEqual((await store.candidates('owner'))[0].candidateProfile,profile);
  await store.update('owner',s=>{s.jobs={};});
  rows=await store.candidates('owner');assert.deepEqual(rows[0].candidateProfile,profile);assert.equal(rows.length,1);
  assert.deepEqual(await store.candidates('other'),[]);
 }finally{await store.close();}
});
