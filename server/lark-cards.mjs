import {SETUP_CALL_URL} from './lark-config.mjs';
export function validateDriveUrl(value){
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!['drive.google.com','docs.google.com'].includes(url.hostname)||url.pathname==='/')throw new Error();return url.href;}
 catch{throw Object.assign(new Error('Provide a valid HTTPS Google Drive CV link for each selected candidate.'),{status:400});}
}
export function candidateCard(candidate,driveUrl){
 const profile=candidate.candidateProfile||{},review=candidate.state!=='complete';
 const label=review?'Review needed':candidate.total<=50?'Rejected':candidate.total<70?'Consider':'Pass';
 const template=review?'grey':candidate.total<=50?'red':candidate.total<70?'orange':'green';
 const text=content=>({tag:'plain_text',content});
 const field=(label,value)=>({is_short:true,text:text(`${label}\n${value || '—'}`)});
 return {config:{wide_screen_mode:true},header:{template,title:text('CV Candidate Screening')},elements:[
  {tag:'div',text:text(profile.name||candidate.fileName||'Candidate')},
  {tag:'div',text:text(`Position\n${candidate.positionName}`)},
  {tag:'hr'},
  {tag:'div',fields:[field('Total score',`${candidate.total}/100${review?' (provisional)':''}`),field('Status',label)]},
  {tag:'div',fields:[field('Phone',profile.phone),field('Email',profile.email)]},
  {tag:'hr'},{tag:'div',text:text('Score breakdown')},
  ...candidate.dimensions.map((dimension,index)=>({tag:'div',text:text(`${index+1}. ${dimension.title}\nScore: ${dimension.score}/${dimension.max}`)})),
  {tag:'hr'},
  {tag:'action',actions:[
   {tag:'button',type:'primary',text:text('📄 Xem CV trên Google Drive'),url:validateDriveUrl(driveUrl)},
   {tag:'button',type:'default',text:text('📅 Setup lịch Call'),url:SETUP_CALL_URL},
  ]},
 ]};
}
