const heading=document.getElementById('decision-heading'),notice=document.getElementById('decision-notice'),retry=document.getElementById('decision-retry');
const form=document.getElementById('reject-form'),confirmButton=document.getElementById('reject-confirm');
let running=false;
async function save(){
 if(running)return;running=true;if(confirmButton)confirmButton.disabled=true;retry.hidden=true;heading.textContent='Saving decision…';notice.textContent='Please wait.';
 try{
  const response=await fetch(location.pathname,{method:'POST',headers:{Accept:'application/json','X-Decision-Intent':'apply',...(form?{'Content-Type':'application/json'}:{})},credentials:form?'same-origin':'omit',...(form?{body:JSON.stringify({confirm:true,reject_reason:document.getElementById('reject-reason').value})}:{}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok)throw new Error(`${result.error||'Unable to save this decision.'}${result.requestId?` (Error ID: ${result.requestId})`:''}`);
  heading.textContent=result.decision==='accept'?'Candidate accepted':'Candidate rejected';
  if(form)form.hidden=true;
  notice.textContent='Decision saved. Dashboard and position history will update automatically. You can return to Lark.';
 }catch(error){heading.textContent='Decision not saved';notice.textContent=error.name==='TimeoutError'?'The request timed out. Please retry.':error.message;retry.hidden=false;}
 finally{running=false;if(confirmButton)confirmButton.disabled=false;}
}
retry.addEventListener('click',save);
if(form){notice.textContent='Add a reason or leave it blank, then confirm.';form.addEventListener('submit',event=>{event.preventDefault();void save();});}
else void save();
