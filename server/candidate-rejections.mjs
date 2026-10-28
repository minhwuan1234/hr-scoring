import {createHash} from 'node:crypto';
import {reviewerName} from './reviewers.mjs';
const bad=message=>Object.assign(new Error(message),{status:400});
export function rejectionInput({reviewer,reason,requestId}){
 if(!reviewerName(reviewer?.id)||typeof reviewer.name!=='string'||!reviewer.name.trim()||reviewer.name.length>200)throw bad('Unknown Lark reviewer.');
 if(reason!=null&&(typeof reason!=='string'||reason.length>2000))throw bad('Rejection reason must be at most 2000 characters.');
 if(typeof requestId!=='string'||!/^[a-f0-9]{64}$/.test(requestId))throw bad('Invalid rejection request.');
 return {reviewer_id:reviewer.id,reviewer_name:reviewer.name.trim(),reject_reason:reason?.trim()||null,request_id:requestId};
}
export const rejectionRequestId=(token,reviewerId)=>createHash('sha256').update(`reject-v1\0${token}\0${reviewerId}`).digest('hex');
export function rejectionDecision(input,previous){
 const decidedAt=Math.max(Date.now(),(previous?.decidedAt||0)+1);
 return {decision:'reject',reviewer_id:input.reviewer_id,reviewer_name:input.reviewer_name,reject_reason:input.reject_reason,reviewed_at:new Date(decidedAt).toISOString(),name:input.reviewer_name,decidedAt};
}
// The same advisory lock used by scoring, Accept and deletion serializes all writers.
export async function persistRejection(pool,scope,id,input){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[scope]);
  const row=(await client.query('SELECT * FROM hr_scoring_candidates WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE',[scope,id])).rows[0];
  if(!row)throw Object.assign(new Error('This CV is no longer available.'),{status:404});
  const saved=(await client.query('SELECT * FROM hr_scoring_candidate_rejections WHERE workspace_id=$1 AND job_id=$2 AND request_id=$3',[scope,id,input.request_id])).rows[0];
  if(saved){await client.query('COMMIT');return {saved:true,decision:'reject',duplicate:true};}
  const decision=rejectionDecision(input,row.reviewer_decisions?.[input.reviewer_id]);
  await client.query(`INSERT INTO hr_scoring_candidate_rejections(workspace_id,job_id,request_id,decision,reviewer_id,reviewer_name,reject_reason,reviewed_at) VALUES($1,$2,$3,'reject',$4,$5,$6,$7)`,[scope,id,input.request_id,input.reviewer_id,input.reviewer_name,input.reject_reason,decision.reviewed_at]);
  await client.query('UPDATE hr_scoring_candidates SET reviewer_decisions=reviewer_decisions || $3::jsonb,updated_at_ms=GREATEST(updated_at_ms,$4) WHERE workspace_id=$1 AND job_id=$2',[scope,id,JSON.stringify({[input.reviewer_id]:decision}),decision.decidedAt]);
  await client.query('COMMIT');return {saved:true,decision:'reject',duplicate:false};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
