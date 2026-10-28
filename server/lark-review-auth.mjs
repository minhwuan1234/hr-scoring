import {createHmac,timingSafeEqual,randomBytes,createHash} from 'node:crypto';
import {publicAppOrigin} from './cv-links.mjs';
import {reviewerName} from './reviewers.mjs';
const failure=(message,status=401)=>Object.assign(new Error(message),{status});
export const reviewCookie='__Secure-hr-lark-review';
const options='Path=/lark/; HttpOnly; Secure; SameSite=Lax';
export const readReviewCookie=request=>(request.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${reviewCookie}=`))?.slice(reviewCookie.length+1);
export function createLarkReviewAuth({env=process.env,fetcher=(...args)=>fetch(...args),now=Date.now}={}){
 const secret=(env.CV_LINK_SECRET||env.LARK_APP_SECRET||env.LARK_SECRET||'').trim();
 const appId=(env.LARK_APP_ID||env.LARK_APP_||env.LARK_ID||'').trim(),appSecret=(env.LARK_APP_SECRET||env.LARK_SECRET||'').trim();
 const digest=token=>createHash('sha256').update(token).digest('hex');
 const sign=data=>createHmac('sha256',secret).update(`lark-review-auth-v1\0${data}`).digest();
 function seal(value){const data=Buffer.from(JSON.stringify(value)).toString('base64url');return `${data}.${sign(data).toString('base64url')}`;}
 function open(token){
  try{
   if(!secret||typeof token!=='string'||token.length>4000)throw new Error();
   const match=token.match(/^([\w-]+)\.([\w-]{43})$/);if(!match)throw new Error();
   const supplied=Buffer.from(match[2],'base64url');if(!timingSafeEqual(supplied,sign(match[1])))throw new Error();
   const value=JSON.parse(Buffer.from(match[1],'base64url'));if(!Number.isSafeInteger(value.exp)||value.exp<=now())throw new Error();return value;
  }catch{throw failure('Lark login expired. Open Reject from Lark again.');}
 }
 const cookie=(value,age)=>`${reviewCookie}=${value}; ${options}; Max-Age=${age}`;
 function start(token){
  if(!secret||!appId||!appSecret)throw failure('Configure LARK_APP_ID and LARK_APP_SECRET and the Lark login redirect URL to reject candidates.',503);
  const state=randomBytes(24).toString('base64url'),redirectUri=`${publicAppOrigin(env)}/lark/review/callback`;
  const url=new URL('https://accounts.larksuite.com/open-apis/authen/v1/authorize');
  url.search=new URLSearchParams({client_id:appId,response_type:'code',redirect_uri:redirectUri,state}).toString();
  return {location:url.href,cookie:cookie(seal({kind:'login',state,token,exp:now()+10*60000}),600)};
 }
 async function api(url,options){
  try{const response=await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const result=await response.json();if(result.code!==0)throw new Error();return result;}
  catch{throw failure('Unable to verify Lark login. Open Reject from Lark and try again.',502);}
 }
 async function finish({code,state,cookie:raw}){
  const login=open(raw);if(login.kind!=='login'||!state||state!==login.state||typeof code!=='string'||!code||code.length>2000)throw failure('Invalid Lark login callback.');
  const result=await api('https://open.larksuite.com/open-apis/authen/v2/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',client_id:appId,client_secret:appSecret,code,redirect_uri:`${publicAppOrigin(env)}/lark/review/callback`})});
  if(typeof result.access_token!=='string'||!result.access_token)throw failure('Lark did not return a user access token.',502);
  const user=(await api('https://open.larksuite.com/open-apis/authen/v1/user_info',{headers:{Authorization:`Bearer ${result.access_token}`}})).data;
  if(!reviewerName(user?.open_id)||typeof user.name!=='string'||!user.name.trim()||user.name.length>200)throw failure('This Lark account is not an authorized HR reviewer.',403);
  const reviewer={id:user.open_id,name:user.name.trim()};
  return {token:login.token,cookie:cookie(seal({kind:'review',link:digest(login.token),reviewer,exp:now()+30*60000}),1800)};
 }
 function reviewer(raw,token){const value=open(raw);if(value.kind!=='review'||value.link!==digest(token)||!reviewerName(value.reviewer?.id))throw failure('Please sign in with Lark before confirming Reject.');return value.reviewer;}
 return {start,finish,reviewer};
}
