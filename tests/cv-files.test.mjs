import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {validatePdf} from '../server/cv-files.mjs';
import {createPositionService} from '../server/positions.mjs';
import {postgresPool} from './helpers/pglite.mjs';
const pdf=Buffer.from('%PDF-1.7\nSynthetic original CV\n%%EOF');
const snapshot=id=>({id,fileName:'Original CV.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:Date.now(),updatedAt:Date.now(),state:'complete',total:70,pendingCount:0,dimensions:[],candidateProfile:{name:'Sample Candidate',phone:null,email:null,linkedinUrl:null},cvAvailable:false});
for(const backend of ['file','postgresql'])test(`${backend}: original PDFs remain private, immutable and available independently of review jobs`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cv-files-')),pg=backend==='postgresql'?await postgresPool():null;
 const store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
 try{
  await createPositionService(store).list('owner');await createPositionService(store).list('other');
  for(const owner of ['owner','other'])await store.update(owner,s=>{s.candidates??={};s.candidates.example=snapshot('example');});
  await assert.rejects(()=>store.cvFiles.get('owner','example'),e=>e.status===404);
  await assert.rejects(()=>store.cvFiles.save('owner','missing',pdf),e=>e.status===404);
  await store.cvFiles.save('owner','example',pdf);
  assert.equal((await store.candidates('owner'))[0].cvAvailable,true);
  const saved=await store.cvFiles.get('owner','example');assert.deepEqual(saved.bytes,pdf);assert.equal(saved.fileName,'Original CV.pdf');
  await assert.rejects(()=>store.cvFiles.get('other','example'),e=>e.status===404);
  await store.cvFiles.save('owner','example',Buffer.from('%PDF-1.7\nReplacement\n%%EOF'));
  assert.deepEqual((await store.cvFiles.get('owner','example')).bytes,pdf,'retry must not replace the scored CV');
  await store.update('owner',s=>{s.jobs={};});
  const reopened=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});assert.deepEqual((await reopened.cvFiles.get('owner','example')).bytes,pdf);
  assert.ok(!JSON.stringify(await store.candidates('owner')).includes('Synthetic original CV'));
  if(pg){const snapshot=(await pg.db.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id=$1',['owner'])).rows[0].payload;delete snapshot.candidates;await pg.db.query('UPDATE hr_scoring_workspace_state SET payload=$2 WHERE workspace_id=$1',['owner',JSON.stringify(snapshot)]);await store.update('owner',()=>null);assert.equal((await store.candidates('owner'))[0].cvAvailable,true);assert.deepEqual((await store.cvFiles.get('owner','example')).bytes,pdf);}
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('PDF uploads reject non-PDFs and files exceeding 20 MB',()=>{
 assert.throws(()=>validatePdf(Buffer.from('<html>not a PDF</html>')),e=>e.status===415);
 assert.throws(()=>validatePdf(Buffer.alloc(20*1024*1024+1)),e=>e.status===413);
 assert.throws(()=>validatePdf(Buffer.alloc(0)),e=>e.status===413);
});
