import {positionScope} from './positions.mjs';
export function validateSelection(items){
 if(!Array.isArray(items)||!items.length||items.length>1000)throw Object.assign(new Error('Select between 1 and 1,000 CVs.'),{status:400});
 const seen=new Set();return items.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id.length||item.id.length>100||!/^[\w-]+$/.test(item.id)||['__proto__','constructor','prototype'].includes(item.id)||typeof item.positionId!=='string'||!item.positionId.length||['__proto__','constructor','prototype'].includes(item.positionId)||item.positionId.length>100||!Number.isInteger(item.positionVersion)||item.positionVersion<1)throw Object.assign(new Error('Select valid candidate records.'),{status:400});
  const key=JSON.stringify([item.positionId,item.positionVersion,item.id]);if(seen.has(key))throw Object.assign(new Error('Duplicate candidate selection.'),{status:400});seen.add(key);
  return {id:item.id,positionId:item.positionId,positionVersion:item.positionVersion};
 });
}
export async function deleteCandidates(store,positions,owner,selection){
 const items=validateSelection(selection),groups=new Map();
 // Resolve every owned role/version before any deletion begins.
 for(const item of items){const key=`${item.positionId}:${item.positionVersion}`;let group=groups.get(key);if(!group){const position=await positions.get(owner,item.positionId,item.positionVersion);group={scope:positionScope(owner,position),ids:[]};groups.set(key,group);}group.ids.push(item.id);}
 await store.removeCandidates([...groups.values()]);
 return {deleted:items};
}
