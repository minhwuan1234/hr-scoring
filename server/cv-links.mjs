import {createHmac,timingSafeEqual} from 'node:crypto';
const TTL_SECONDS=30*24*60*60;
const unavailable=()=>Object.assign(new Error('This CV link is invalid or expired.'),{status:404});
export function createCvLinks({env=process.env,now=Date.now}={}){
 const secret=(env.CV_LINK_SECRET||env.LARK_APP_SECRET||env.LARK_SECRET||'').trim();
 function origin(){
  const value=env.PUBLIC_APP_URL||(env.RAILWAY_PUBLIC_DOMAIN?`https://${env.RAILWAY_PUBLIC_DOMAIN}`:'https://honest-presence-production-89d2.up.railway.app');
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error();return url.origin;}
  catch{throw Object.assign(new Error('Configure PUBLIC_APP_URL with the HTTPS application URL.'),{status:503});}
 }
 const sign=payload=>createHmac('sha256',secret).update(`hr-scoring-cv-link-v1\0${payload}`).digest();
 function url(scope,id){
  if(!secret)throw Object.assign(new Error('Configure CV_LINK_SECRET or LARK_APP_SECRET to attach CV links.'),{status:503});
  if(!/^[a-f0-9]{64}$/.test(scope)||!/^[\w-]{1,100}$/.test(id))throw unavailable();
  const payload=Buffer.from(JSON.stringify({scope,id,exp:Math.floor(now()/1000)+TTL_SECONDS})).toString('base64url');
  return `${origin()}/api/shared-cvs/v1.${payload}.${sign(payload).toString('base64url')}`;
 }
 function verify(token){
  if(!secret||typeof token!=='string'||token.length>1000)throw unavailable();
  const parts=token.match(/^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);if(!parts)throw unavailable();
  const signature=Buffer.from(parts[2],'base64url'),expected=sign(parts[1]);if(signature.length!==expected.length||!timingSafeEqual(signature,expected))throw unavailable();
  let data;try{data=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw unavailable();}
  if(!data||!/^[a-f0-9]{64}$/.test(data.scope)||!/^[\w-]{1,100}$/.test(data.id)||!Number.isSafeInteger(data.exp)||data.exp<=Math.floor(now()/1000))throw unavailable();
  return {scope:data.scope,id:data.id};
 }
 return {url,verify};
}
