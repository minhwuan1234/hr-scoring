const stages=new Set(['evidence-extraction','evidence-embedding','reference-embedding','ceiling-assessment','scoring-read','scoring-commit','review-read','review-embedding','lark-auth','lark-send']);
function route(request){
 const path=new URL(request.url,'http://localhost').pathname;
 if(['/api/score','/api/candidates','/api/candidates/delete','/api/positions','/api/lark/check','/api/lark/send'].includes(path))return path;
 if(/^\/api\/jobs\/[^/]+(?:\/(?:review|cv))?$/.test(path))return path.replace(/(\/api\/jobs\/)[^/]+/,'$1:id');
 if(path.startsWith('/lark/decision/'))return '/lark/decision/:token';
 if(path.startsWith('/api/positions/'))return '/api/positions/:id';
 return path.startsWith('/api/')?'/api/other':'/static';
}
export function failureReport(error,request,requestId,durationMs){
 const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:error.name==='TimeoutError'?504:500;
 const code=typeof error.code==='string'&&/^(?:[0-9A-Z]{5}|E[A-Z_]{2,40}|PROVIDER_[A-Z0-9_]{1,60}|MODEL_[A-Z_]{1,60}|LARK_[A-Z_]{1,60})$/.test(error.code)?error.code:'UNEXPECTED_ERROR';
 const message=status===500?'Scoring could not complete. Please retry or check server storage configuration.':error.name==='TimeoutError'?'Scoring timed out. Please retry.':error.message;
 // Whitelist metadata. Never log raw errors, SQL, URLs, CVs or upstream bodies.
 const log={event:'request_failed',requestId,route:route(request),status,code,stage:stages.has(error.stage)?error.stage:'request',durationMs};
 const site=error.stack?.match(/\/(server\/[\w-]+\.mjs:\d+:\d+)/)?.[1];if(site)log.site=site;
 if(/^req_[\w-]{1,150}$/.test(error.providerRequestId||''))log.providerRequestId=error.providerRequestId;
 return {status,data:{error:message,requestId},log};
}
