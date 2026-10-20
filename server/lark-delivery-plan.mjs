import {validateSelection} from './candidate-deletion.mjs';
import {recipientsForPosition} from './lark-config.mjs';
const key=c=>JSON.stringify([c.positionId,c.positionVersion,c.id]);
export async function larkDeliveryPlan(store,owner,selection){
 const items=validateSelection(selection);if(items.length>50)throw Object.assign(new Error('Send up to 50 CVs at a time.'),{status:400});
 const rows=new Map((await store.candidates(owner,items)).map(c=>[key(c),c]));
 return items.map(item=>{const candidate=rows.get(key(item));if(!candidate)throw Object.assign(new Error('A selected CV is no longer available. Refresh the list and try again.'),{status:404});return {candidate,receivers:recipientsForPosition(candidate)};});
}
export async function previewLarkDelivery(store,owner,selection){
 const plans=await larkDeliveryPlan(store,owner,selection);
 return {recipientCount:new Set(plans.flatMap(p=>p.receivers)).size,totalCount:plans.reduce((n,p)=>n+p.receivers.length,0)};
}
