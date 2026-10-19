import {createPositionService,positionScope} from './positions.mjs';
import {createScoringService} from './service.mjs';
export function createPositionRouter(store){
 const positions=createPositionService(store),services=new Map();
 async function scorer(workspace,positionId='hr-intern',version=1){
  if(typeof positionId!=='string'||positionId.length>100||!Number.isInteger(version)||version<1)throw Object.assign(new Error('Choose a valid position version.'),{status:400});
  const position=await positions.get(workspace,positionId,version),scope=positionScope(workspace,position);
  const key=`${workspace}:${positionId}:${version}`;
  if(!services.has(key)){if(services.size>=1000)services.delete(services.keys().next().value);services.set(key,createScoringService(store,undefined,undefined,position));}
  return {service:services.get(key),scope};
 }
 return {positions,scorer};
}
