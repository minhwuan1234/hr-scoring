import {createHash} from 'node:crypto';
import {validateSelection} from './candidate-deletion.mjs';
import {candidateCard,validateDriveUrl} from './lark-cards.mjs';
import {LARK_RECIPIENTS} from './lark-config.mjs';
const key=c=>JSON.stringify([c.positionId,c.positionVersion,c.id]);
export async function sendCandidatesToLark(store,lark,owner,payload){
 if(!payload||typeof payload.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(payload.requestId))throw Object.assign(new Error('Provide a valid Lark send request ID.'),{status:400});
 const items=validateSelection(payload.candidates);if(items.length>50)throw Object.assign(new Error('Send up to 50 CVs at a time.'),{status:400});
 // Ignore client-supplied contact details/scores/receivers. Read owned saved records.
 const links=new Map(payload.candidates.map(c=>[key(c),validateDriveUrl(c.driveUrl)]));
 const rows=new Map((await store.candidates(owner)).map(c=>[key(c),c]));
 const records=items.map(item=>{const row=rows.get(key(item));if(!row)throw Object.assign(new Error('A selected CV is no longer available. Refresh the list and try again.'),{status:404});return row;});
 const cards=records.map(row=>candidateCard(row,links.get(key(row))));
 // Check all inputs before requesting a token or sending any messages.
 await lark.check();
 let sentCount=0;const failures=[];
 // Separate recipients progress independently; each recipient sees CVs in selection order.
 await Promise.all(LARK_RECIPIENTS.map(async(receiver,recipient)=>{
  for(const [index,row] of records.entries()){
   const uuid=createHash('sha256').update(JSON.stringify([owner,payload.requestId,receiver,key(row)])).digest('hex').slice(0,40);
   try{await lark.sendCard(receiver,cards[index],uuid);sentCount++;}
   catch(error){for(const remaining of records.slice(index))failures.push({candidateId:remaining.id,recipient:recipient+1,error:error.message,code:error.code});break;}
  }
 }));
 return {complete:!failures.length,candidateCount:records.length,recipientCount:LARK_RECIPIENTS.length,sentCount,totalCount:records.length*LARK_RECIPIENTS.length,failures};
}
