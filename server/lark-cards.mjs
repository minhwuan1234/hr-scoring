import {decisionCounts} from './reviewers.mjs';
import {SETUP_CALL_URL} from './lark-config.mjs';
export function validateCvUrl(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!/^\/api\/shared-cvs\/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.pathname)||url.search||url.hash)throw new Error();return url.href;}
 catch{throw Object.assign(new Error('A valid generated CV file link is required.'),{status:400});}
}
export function candidateCard(candidate,cvUrl,decisionUrls){
 const profile=candidate.candidateProfile||{},review=candidate.state!=='complete';
 const label=review?'Review needed':candidate.total<=50?'Rejected':candidate.total<70?'Consider':'Pass';
 const template=label==='Pass'?'green':label==='Rejected'?'red':label==='Consider'?'orange':'grey';
 const text=content=>({tag:'plain_text',content});
 const field=(label,value)=>({is_short:true,text:text(`${label}\n${value || '—'}`)});
 return {config:{wide_screen_mode:true},header:{template,title:text('CV Candidate Screening')},elements:[
  {tag:'div',text:text(profile.name||candidate.fileName||'Candidate')},
  {tag:'div',text:text(`Position\n${candidate.positionName}`)},
  {tag:'hr'},
  {tag:'div',fields:[field('Total score',`${candidate.total}/100${review?' (provisional)':''}`),field('Status',label)]},
  {tag:'div',fields:[field('Phone',profile.phone),field('Email',profile.email)]},
  {tag:'div',text:text(`Decision\nAccept: ${decisionCounts(candidate).accept} · Reject: ${decisionCounts(candidate).reject}`)},
  {tag:'hr'},{tag:'div',text:text('Score breakdown')},
  ...candidate.dimensions.map((dimension,index)=>({tag:'div',text:text(`${index+1}. ${dimension.title}\nScore: ${dimension.score}/${dimension.max}`)})),
  {tag:'hr'},
  {tag:'action',actions:[
   {tag:'button',type:'primary',text:text('📄 Xem CV'),url:validateCvUrl(cvUrl)},
   {tag:'button',type:'default',text:text('📅 Setup lịch Call'),url:SETUP_CALL_URL},
  ]},
  ...(decisionUrls?[{tag:'action',actions:[
   {tag:'button',type:'primary',text:text('Accept'),url:decisionUrls.accept},
   {tag:'button',type:'danger',text:text('Denied'),url:decisionUrls.denied},
  ]}]:[]),
 ]};
}
