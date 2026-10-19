import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_VERSION, initializePostgres } from '../server/database.mjs';

function database({ applied=false, failArchive=false }={}) {
  const calls=[];
  let released=false;
  const client={
    async query(sql,args) {
      calls.push({sql,args});
      if(sql.startsWith('SELECT dataset_version')) return {rows:applied ? [{dataset_version:DATASET_VERSION}] : []};
      if(sql.startsWith('INSERT INTO hr_scoring_test_data_archive')) {
        if(failArchive) throw new Error('archive unavailable');
        return {rowCount:7,rows:[]};
      }
      return {rows:[]};
    },
    release(){released=true;},
  };
  return {pool:{connect:async()=>client},calls,get released(){return released;}};
}

test('clean start archives application data before clearing it and records the reset atomically', async()=>{
  const db=database();
  await initializePostgres(db.pool);
  const archive=db.calls.findIndex(c=>c.sql.startsWith('INSERT INTO hr_scoring_test_data_archive'));
  const clear=db.calls.findIndex(c=>c.sql.startsWith('DELETE FROM hr_scoring_workspace_state'));
  assert.ok(archive>=0 && clear>archive);
  assert.deepEqual(db.calls.find(c=>c.sql.startsWith('INSERT INTO hr_scoring_data_migrations')).args,[DATASET_VERSION,7]);
  assert.equal(db.calls.at(-1).sql,'COMMIT');
  assert.equal(db.released,true);
});

test('future deployments do not clear newly created data after the reset is recorded', async()=>{
  const db=database({applied:true});
  await initializePostgres(db.pool);
  assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE') || c.sql.startsWith('INSERT')),false);
  assert.equal(db.calls.at(-1).sql,'COMMIT');
});

test('failed archival rolls back and never clears active data', async()=>{
  const db=database({failArchive:true});
  await assert.rejects(()=>initializePostgres(db.pool),/archive unavailable/);
  assert.equal(db.calls.some(c=>c.sql.startsWith('DELETE') || c.sql==='COMMIT'),false);
  assert.equal(db.calls.at(-1).sql,'ROLLBACK');
  assert.equal(db.released,true);
});
