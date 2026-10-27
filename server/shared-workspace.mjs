import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {positionScope} from './positions.mjs';
const EMPTY_WORKSPACE=createHash('sha256').update('hr-scoring:shared-team-workspace:v1').digest('hex');
function primary(owners){return owners.sort((a,b)=>b.candidates-a.candidates||b.templates-a.templates||b.references-a.references||a.id.localeCompare(b.id))[0]?.id||EMPTY_WORKSPACE;}
// Reuse the main existing owner in place: role scopes, PDFs, references and
// signed Lark links keep their original identifiers. Never merge or delete data.
export function createSharedWorkspace({pool,directory,initialize}){
 let pending;
 return function sharedWorkspace(){
  pending??=load().catch(error=>{pending=undefined;throw error;});return pending;
 };
 async function load(){
  await initialize();
  if(pool){
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-scoring:shared-workspace:v1'))");
    await client.query('CREATE TABLE IF NOT EXISTS hr_scoring_shared_workspace (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),owner_workspace_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    let owner=(await client.query('SELECT owner_workspace_id FROM hr_scoring_shared_workspace WHERE singleton=TRUE')).rows[0]?.owner_workspace_id;
    if(!owner){
     const {rows}=await client.query(`WITH owners AS (
      SELECT workspace_id AS id FROM hr_scoring_workspaces w WHERE NOT EXISTS (SELECT 1 FROM hr_scoring_position_scopes s WHERE s.scoring_workspace_id=w.workspace_id AND s.owner_workspace_id<>w.workspace_id)
      UNION SELECT owner_workspace_id FROM hr_scoring_position_scopes
     ) SELECT o.id,
      (SELECT count(*) FROM hr_scoring_candidates c WHERE c.workspace_id=o.id OR c.workspace_id IN (SELECT scoring_workspace_id FROM hr_scoring_position_scopes WHERE owner_workspace_id=o.id))::integer AS candidates,
      (SELECT count(*) FROM hr_scoring_positions WHERE workspace_id=o.id)::integer AS templates,
      (SELECT count(*) FROM hr_scoring_references r WHERE r.workspace_id=o.id OR r.workspace_id IN (SELECT scoring_workspace_id FROM hr_scoring_position_scopes WHERE owner_workspace_id=o.id))::integer AS references
      FROM owners o`);
     owner=primary(rows);
     await client.query('INSERT INTO hr_scoring_shared_workspace(singleton,owner_workspace_id) VALUES(TRUE,$1)',[owner]);
    }
    await client.query('COMMIT');return owner;
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=resolve(directory,'shared-workspace.json');
  try{const saved=JSON.parse(await readFile(path,'utf8'));if(typeof saved.owner==='string'&&saved.owner)return saved.owner;throw new Error('Invalid saved shared workspace.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const states=new Map();
  for(const file of await readdir(directory)){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;states.set(file.slice(0,-5),JSON.parse(await readFile(resolve(directory,file),'utf8')));}
  const scopes=new Set();
  for(const [id,state] of states)for(const versions of Object.values(state.positions||{}))for(const p of versions){const scope=positionScope(id,p);if(scope!==id)scopes.add(scope);}
  const owners=[];
  for(const [id,state] of states){if(scopes.has(id))continue;const ids=new Set([id]);for(const versions of Object.values(state.positions||{}))for(const p of versions)ids.add(positionScope(id,p));
   owners.push({id,candidates:[...ids].reduce((n,key)=>n+Object.keys(states.get(key)?.candidates||states.get(key)?.jobs||{}).length,0),templates:Object.values(state.positions||{}).flat().length,references:[...ids].reduce((n,key)=>n+(states.get(key)?.references?.length||0),0)});
  }
  const owner=primary(owners);await writeFile(path+'.tmp',JSON.stringify({owner}),{mode:0o600});await rename(path+'.tmp',path);return owner;
 }
}
