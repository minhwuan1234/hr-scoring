import {isDeepStrictEqual} from 'node:util';
import {positionScope} from './positions.mjs';

export async function readPositionCatalog(client,owner){
 const {rows}=await client.query('SELECT definition FROM hr_scoring_positions WHERE workspace_id=$1 ORDER BY position_id,version',[owner]);
 const catalog={};for(const {definition} of rows)(catalog[definition.id]??=[]).push(definition);return catalog;
}
export async function persistPositionCatalog(client,owner,catalog){
 const existing=await readPositionCatalog(client,owner);
 for(const versions of Object.values(catalog))for(const p of versions){
  const old=existing[p.id]?.find(v=>v.version===p.version);if(old){if(!isDeepStrictEqual(old,p))throw new Error('Position versions cannot be overwritten.');continue;}
  for(const [index,d] of p.rubric.entries()){
   await client.query('INSERT INTO hr_scoring_dimensions(dimension_id,max_score,sort_order) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[d.id,d.max,index]);
   for(const [band,[floor,ceiling,guide]] of d.bands.entries())await client.query('INSERT INTO hr_scoring_bands(dimension_id,band,floor,ceiling,guide) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[d.id,band,floor,ceiling,guide]);
  }
  await client.query('INSERT INTO hr_scoring_positions(workspace_id,position_id,version,name,definition) VALUES($1,$2,$3,$4,$5)',[owner,p.id,p.version,p.name,JSON.stringify(p)]);
  const scope=positionScope(owner,p);await client.query('INSERT INTO hr_scoring_workspaces(workspace_id,version) VALUES($1,1) ON CONFLICT DO NOTHING',[scope]);
  await client.query('INSERT INTO hr_scoring_position_scopes(owner_workspace_id,position_id,position_version,scoring_workspace_id) VALUES($1,$2,$3,$4)',[owner,p.id,p.version,scope]);
 }
}
