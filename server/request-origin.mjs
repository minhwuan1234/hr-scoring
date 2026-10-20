// Opaque origins can occur in Safari/Lark with a no-referrer decision page.
// Only the token-bound JSON action accepts them. Its custom header prevents a
// cross-origin HTML form from imitating the request; CORS preflight is not enabled.
export function allowedWriteOrigin(request,{decision=false}={}){
 const origin=request.headers.origin;
 if(!origin)return true;
 if(origin==='null')return decision&&request.headers['x-decision-intent']==='apply'&&request.headers.accept==='application/json';
 try{const url=new URL(origin);return ['http:','https:'].includes(url.protocol)&&url.host===request.headers.host;}catch{return false;}
}
