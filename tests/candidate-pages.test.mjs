import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createPositionService,positionScope,DEFAULT_POSITION} from '../server/positions.mjs';
import {candidateQuery} from '../server/candidate-pages.mjs';
import {postgresPool} from './helpers/pglite.mjs';
const draft={name:'Account',rubric:[{title:'Delivery',max:100,bands:[[0,100,'Delivered projects.']],examples:[]}]};
for(const backend of ['file','postgresql'])test(`${backend}: pages are fixed at ten, tenant-scoped and searchable across the complete history`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'candidate-pages-')),pg=backend==='postgresql'?await postgresPool():null;
 const store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})}),owner='owner';
 try{
  const positions=createPositionService(store);await positions.list(owner);await positions.list('other');
  const a=await positions.create(owner,draft),b=await positions.update(owner,a.id,{...a,name:'Account II'}),templates=[DEFAULT_POSITION,a,b];
  const records=Array.from({length:25},(_,i)=>({id:`cv-${String(i).padStart(2,'0')}`,fileName:i===7?'Special_% CV.pdf':`CV ${i}.pdf`,positionId:templates[i%3].id,positionVersion:templates[i%3].version,positionName:templates[i%3].name,createdAt:1000+Math.floor(i/2),updatedAt:1000,state:i%7===0?'review':'complete',total:[0,50,50.5,69,70,100][i%6],pendingCount:i%7===0?1:0,dimensions:[{id:'test',title:'Test',score:0,max:100}],cvAvailable:false,candidateProfile:{name:i===0?'Vũ Lâm Nhi':`Candidate ${i}`,email:`cv-${i}@example.test`,phone:`0900${String(i).padStart(6,'0')}`,linkedinUrl:null}}));
  for(const p of templates){const rows=records.filter(c=>c.positionId===p.id&&c.positionVersion===p.version);await store.update(positionScope(owner,p),state=>{state.candidates=Object.fromEntries(rows.map(c=>[c.id,c]));});}
  await store.update('other',state=>{state.candidates={private:{...records[0],id:'private',candidateProfile:{name:'Private candidate'}}};});
  const first=await store.candidatePage(owner,{}),second=await store.candidatePage(owner,{page:2}),last=await store.candidatePage(owner,{page:3});
  assert.equal(first.pageSize,10);assert.equal(first.rows.length,10);assert.equal(second.rows.length,10);assert.equal(last.rows.length,5);assert.equal(first.total,25);assert.equal(first.pages,3);
  assert.deepEqual([...first.rows,...second.rows,...last.rows].map(c=>c.id),(await store.candidates(owner)).map(c=>c.id));
  assert.equal(new Set([...first.rows,...second.rows,...last.rows].map(c=>c.id)).size,25);
  assert.equal(first.positions.find(p=>p.id===a.id).count,16);assert.equal(first.positions.find(p=>p.id===a.id).name,'Account II');
  assert.equal(first.stats.all,25);assert.equal(Object.entries(first.stats).filter(([key])=>key!=='all').reduce((n,[,count])=>n+count,0),25);
  const named=await store.candidatePage(owner,{search:'vũ lâm nhi'});assert.equal(named.total,1);assert.equal(named.rows[0].id,'cv-00','search finds a CV outside the first page');
  assert.equal((await store.candidatePage(owner,{search:'%'})).total,1,'search punctuation stays literal');
  assert.equal((await store.candidatePage(owner,{search:'cv-2@example.test'})).rows[0].id,'cv-02');
  const role=await store.candidatePage(owner,{positionId:a.id});assert.equal(role.total,16);assert.equal(role.stats.all,16);assert.equal(role.positions.length,2);assert.ok(role.rows.every(c=>c.positionId===a.id));
  for(const status of ['review','rejected','consider','pass']){
   const expected=records.filter(c=>status==='review'?c.state==='review':c.state==='complete'&&(status==='rejected'?c.total<=50:status==='consider'?c.total>50&&c.total<70:c.total>=70));
   const result=await store.candidatePage(owner,{status});assert.equal(result.total,expected.length);assert.equal(result.stats.all,25);assert.ok(result.rows.every(c=>expected.some(e=>e.id===c.id)));
  }
  assert.equal((await store.candidatePage(owner,{page:9999})).page,3);
  assert.equal((await store.candidatePage('other',{})).total,1);assert.equal((await store.candidatePage('stranger',{})).total,0);assert.deepEqual((await store.candidatePage('stranger',{})).positions,[]);
  const subset=await store.candidates(owner,[records[0],records[24],{id:'private',positionId:'hr-intern',positionVersion:1}]);assert.equal(subset.length,2);assert.deepEqual(new Set(subset.map(c=>c.id)),new Set(['cv-00','cv-24']));
  if(pg){
   const indexes=await pg.db.query("SELECT indexname FROM pg_indexes WHERE tablename='hr_scoring_candidates' AND indexname LIKE 'hr_scoring_candidates_page_%'");assert.equal(indexes.rows.length,2);
   const restarted=createStore({databaseUrl:null,directory,pool:pg.pool});assert.equal((await restarted.candidatePage(owner,{})).total,25,'additive indexes do not reimport or reset records');
  }
  const groups=new Map();for(const c of last.rows){const scope=positionScope(owner,{id:c.positionId,version:c.positionVersion});if(!groups.has(scope))groups.set(scope,[]);groups.get(scope).push(c.id);}
  await store.removeCandidates([...groups].map(([scope,ids])=>({scope,ids})));
  const clamped=await store.candidatePage(owner,{page:3});assert.equal(clamped.total,20);assert.equal(clamped.page,2);assert.equal(clamped.rows.length,10);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('candidate paging validates filters and fixes page size on the server',()=>{
 for(const input of [{page:0},{page:-1},{page:'01'},{page:'1; DROP TABLE x'},{page:'10000000'},{status:'unknown'},{search:'x'.repeat(301)},{positionId:[]}])assert.throws(()=>candidateQuery(input),e=>e.status===400);
 assert.deepEqual(candidateQuery({page:'2',pageSize:1000,search:'  Name  '}),{page:2,positionId:'',search:'name',status:'all'});
});
