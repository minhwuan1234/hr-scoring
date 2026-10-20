import {createHmac,timingSafeEqual} from 'node:crypto';
import {reviewerName} from './reviewers.mjs';
import {publicAppOrigin} from './cv-links.mjs';
const invalid=()=>Object.assign(new Error('This decision link is invalid or expired.'),{status:404});
export function createDecisionLinks({env=process.env,now=Date.now}={}){
 const secret=(env.CV_LINK_SECRET||env.LARK_APP_SECRET||env.LARK_SECRET||'').trim();
 const sign=payload=>createHmac('sha256',secret).update(`hr-scoring-candidate-decision-v1\0${payload}`).digest();
 function url(scope,id,receiver,decision){
  if(!secret)throw Object.assign(new Error('Configure the Lark app secret to enable candidate decisions.'),{status:503});
  if(!/^[a-f0-9]{64}$/.test(scope)||!/^[\w-]{1,100}$/.test(id)||!reviewerName(receiver)||!['accept','denied'].includes(decision))throw invalid();
  const payload=Buffer.from(JSON.stringify({scope,id,receiver,decision,exp:Math.floor(now()/1000)+30*24*60*60})).toString('base64url');
  return `${publicAppOrigin(env)}/lark/decision/v1.${payload}.${sign(payload).toString('base64url')}`;
 }
 function verify(token){
  if(!secret||typeof token!=='string'||token.length>1500)throw invalid();
  const parts=token.match(/^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);if(!parts)throw invalid();
  const supplied=Buffer.from(parts[2],'base64url'),expected=sign(parts[1]);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw invalid();
  let value;try{value=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw invalid();}
  if(!value||!/^[a-f0-9]{64}$/.test(value.scope)||!/^[\w-]{1,100}$/.test(value.id)||!['accept','denied'].includes(value.decision)||!reviewerName(value.receiver)||!Number.isSafeInteger(value.exp)||value.exp<=Math.floor(now()/1000))throw invalid();
  return {scope:value.scope,id:value.id,decision:value.decision,receiver:value.receiver};
 }
 return {url,verify};
}
