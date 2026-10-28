const cell=value=>{
 let text=String(value??'');
 // Spreadsheet applications must treat candidate-provided values as text.
 if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
};
export function candidateCsv(rows){
 const headers=['Candidate','Phone','Email','Position','Scored on (GMT+7)','Score','Status','Accept','Reject','Accepted by','Rejected by','CV filename'];
 const lines=rows.map(c=>{
  const votes=Object.values(c.reviewerDecisions||{}),accepted=votes.filter(v=>v.decision==='accept'),rejected=votes.filter(v=>['denied','reject'].includes(v.decision));
  const status=c.state!=='complete'?'Review needed':c.total<=50?'Rejected':c.total<70?'Consider':'Pass';
  return [c.candidateProfile?.name||c.fileName,c.candidateProfile?.phone,c.candidateProfile?.email,c.positionName,new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'medium',timeStyle:'short'}).format(new Date(c.createdAt)),c.total,status,accepted.length,rejected.length,accepted.map(v=>v.name).join('; '),rejected.map(v=>v.name).join('; '),c.fileName];
 });
 return '\uFEFF'+[headers,...lines].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
