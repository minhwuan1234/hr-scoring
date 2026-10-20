import {createDecisionLinks} from './decision-links.mjs';
import {positionScope} from './positions.mjs';
import {createCvLinks} from './cv-links.mjs';
import {createHash} from 'node:crypto';
import {larkDeliveryPlan} from './lark-delivery-plan.mjs';
import {candidateCard} from './lark-cards.mjs';
const key=c=>JSON.stringify([c.positionId,c.positionVersion,c.id]);
export async function sendCandidatesToLark(store,lark,owner,payload,links=createCvLinks(),decisions=createDecisionLinks()){
 if(!payload||typeof payload.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(payload.requestId))throw Object.assign(new Error('Provide a valid Lark send request ID.'),{status:400});
 const plans=await larkDeliveryPlan(store,owner,payload.candidates),deliveries=new Map();
 for(const {candidate:row,receivers} of plans){
  if(!row.cvAvailable)throw Object.assign(new Error('The original PDF is missing for a selected CV. Upload and score the file again before sending.'),{status:404});
  const scope=positionScope(owner,{id:row.positionId,version:row.positionVersion});
  for(const receiver of receivers){
   const card=candidateCard(row,links.url(scope,row.id),{accept:decisions.url(scope,row.id,receiver,'accept'),denied:decisions.url(scope,row.id,receiver,'denied')});
   if(!deliveries.has(receiver))deliveries.set(receiver,[]);deliveries.get(receiver).push({row,card});
  }
 }
 // Check all inputs before requesting a token or sending any messages.
 await lark.check();
 let sentCount=0;const failures=[];
 // Separate recipients progress independently; each recipient sees CVs in selection order.
 await Promise.all([...deliveries].map(async([receiver,items],recipient)=>{
  for(const [index,{row,card}] of items.entries()){
   const uuid=createHash('sha256').update(JSON.stringify([owner,payload.requestId,receiver,key(row)])).digest('hex').slice(0,40);
   try{await lark.sendCard(receiver,card,uuid);sentCount++;}
   catch(error){for(const {row:remaining} of items.slice(index))failures.push({candidateId:remaining.id,recipient:recipient+1,error:error.message,code:error.code});break;}
  }
 }));
 return {complete:!failures.length,candidateCount:plans.length,recipientCount:deliveries.size,sentCount,totalCount:[...deliveries.values()].reduce((n,items)=>n+items.length,0),failures};
}
