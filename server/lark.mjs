import {LARK_RECIPIENTS} from './lark-config.mjs';
const API='https://open.larksuite.com/open-apis';
const failure=(message,status,code)=>Object.assign(new Error(message),{status,code,stage:'lark-auth'});
// Secrets and tenant tokens stay in this server-only client.
export function createLarkClient({env=process.env,fetcher=(...args)=>fetch(...args),now=Date.now}={}){
 const appId=(env.LARK_APP_ID||env.LARK_ID||'').trim(),appSecret=(env.LARK_APP_SECRET||env.LARK_SECRET||'').trim();
 let cached,pending;
 function status(){return {configured:!!appId&&!!appSecret,missing:[...(!appId?['LARK_APP_ID']:[]),...(!appSecret?['LARK_APP_SECRET']:[])]};}
 async function token(){
  if(!status().configured)throw failure('Add LARK_APP_ID and LARK_APP_SECRET to the Railway app service.',503,'LARK_NOT_CONFIGURED');
  if(cached&&now()<cached.expiresAt)return cached.value;
  if(pending)return pending;
  pending=(async()=>{
   let response;
   try{response=await fetcher(`${API}/auth/v3/tenant_access_token/internal`,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({app_id:appId,app_secret:appSecret}),signal:AbortSignal.timeout(15000)});}
   catch(error){throw failure(error.name==='TimeoutError'?'Lark connection timed out. Please retry.':'Unable to connect to Lark. Please retry.',error.name==='TimeoutError'?504:502,'LARK_CONNECTION');}
   if(!response.ok){await response.body?.cancel();throw failure('Lark could not verify the app credentials. Please retry or check the app configuration.',response.status===429?429:502,'LARK_AUTH_HTTP');}
   let data;try{data=await response.json();}catch{throw failure('Lark returned an unreadable authentication response. Please retry.',502,'LARK_AUTH_RESPONSE');}
   if(data?.code!==0)throw failure('Lark rejected the app credentials. Check the App ID and App Secret on Railway.',502,'LARK_AUTH_REJECTED');
   if(typeof data.tenant_access_token!=='string'||!data.tenant_access_token||!Number.isFinite(data.expire)||data.expire<=0)throw failure('Lark returned an invalid authentication response. Please retry.',502,'LARK_AUTH_RESPONSE');
   cached={value:data.tenant_access_token,expiresAt:now()+Math.max(0,data.expire-60)*1000};return cached.value;
  })();
  try{return await pending;}finally{pending=undefined;}
 }
 async function check(){await token();return {connected:true,recipientCount:LARK_RECIPIENTS.length};}
 async function sendCard(receiver,card,uuid){
  if(!LARK_RECIPIENTS.includes(receiver))throw failure('Choose a configured Lark recipient.',400,'LARK_RECIPIENT_INVALID');
  const content=JSON.stringify(card);
  if(Buffer.byteLength(content,'utf8')>28000)throw failure('This candidate card exceeds the Lark message size limit.',413,'LARK_CARD_TOO_LARGE');
  const accessToken=await token();let response;
  try{response=await fetcher(`${API}/im/v1/messages?receive_id_type=open_id`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({receive_id:receiver,msg_type:'interactive',content,uuid}),signal:AbortSignal.timeout(15000)});}
  catch{throw Object.assign(failure('Unable to confirm Lark delivery. Retry sending to check or complete this batch.',502,'LARK_DELIVERY_UNKNOWN'),{stage:'lark-send'});}
  if(!response.ok){await response.body?.cancel();if(response.status===401)cached=undefined;throw Object.assign(failure('Lark could not deliver this card. Check bot messaging permissions and recipient availability, then retry.',response.status===429?429:502,'LARK_SEND_HTTP'),{stage:'lark-send'});}
  let data;try{data=await response.json();}catch{throw Object.assign(failure('Unable to confirm Lark delivery. Retry sending this batch.',502,'LARK_DELIVERY_UNKNOWN'),{stage:'lark-send'});}
  if(data?.code!==0){const code=Number.isInteger(data?.code)?` (Lark code ${data.code})`:'';throw Object.assign(failure(`Lark rejected this card${code}. Check bot messaging permissions and recipient availability.`,502,'LARK_SEND_REJECTED'),{stage:'lark-send'});}
  if(typeof data.data?.message_id!=='string'||!data.data.message_id)throw Object.assign(failure('Unable to confirm Lark delivery. Retry sending this batch.',502,'LARK_DELIVERY_UNKNOWN'),{stage:'lark-send'});
  return {messageId:data.data.message_id};
 }
 return {status,check,sendCard};
}
