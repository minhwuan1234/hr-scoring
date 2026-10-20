import {useEffect,useRef,useState} from 'react';
import {Send,X} from 'lucide-react';
import {scoringRequest} from './scoring-api';
import type {CandidateRecord} from './CandidateHistory';
const key=(c:CandidateRecord)=>JSON.stringify([c.positionId,c.positionVersion,c.id]);
interface DeliveryResult {complete:boolean;candidateCount:number;recipientCount:number;sentCount:number;totalCount:number;failures:{error:string}[]}
export default function LarkSendDialog({candidates,onClose,onSent}:{candidates:CandidateRecord[];onClose:()=>void;onSent:(message:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),requestId=useRef(crypto.randomUUID());
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
 const [plan,setPlan]=useState<{recipientCount:number;totalCount:number}|null>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 useEffect(()=>{const controller=new AbortController();void scoringRequest<{recipientCount:number;totalCount:number}>('/api/lark/preview',{candidates:candidates.map(c=>({id:c.id,positionId:c.positionId,positionVersion:c.positionVersion}))},15000,controller.signal).then(setPlan).catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Unable to load recipients.');});return()=>controller.abort();},[candidates]);
 async function send(){
  if(busy||!plan)return;setBusy(true);setError('');setAttempted(true);
  try{
   const result=await scoringRequest<DeliveryResult>('/api/lark/send',{requestId:requestId.current,candidates:candidates.map(c=>({id:c.id,positionId:c.positionId,positionVersion:c.positionVersion}))},180000);
   if(result.complete){onSent(`Sent ${result.candidateCount} CV${result.candidateCount===1?'':'s'} to ${result.recipientCount} Lark recipient${result.recipientCount===1?'':'s'}.`);return;}
   setError(`${result.sentCount} of ${result.totalCount} cards delivered. ${result.failures[0]?.error || 'Some deliveries failed.'} Retry to complete this batch.`);
  }catch(err){setError(err instanceof Error?err.message:'Unable to send to Lark. Please retry.');}finally{setBusy(false);}
 }
 return <dialog ref={dialog} className="review-dialog lark-send-dialog" aria-labelledby="lark-send-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><div><h2 id="lark-send-title">Send Lark</h2><p>{candidates.length} CV{candidates.length===1?'':'s'} · {plan?`${plan.recipientCount} recipient${plan.recipientCount===1?'':'s'}`:'Loading recipients…'}</p></div><button className="icon-button" aria-label="Close Send Lark" disabled={busy} onClick={onClose}><X size={18}/></button></header>
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <div className="lark-send-body">
    {candidates.map(c=><div className="lark-cv-field" key={key(c)}><strong>{c.candidateProfile?.name||c.fileName}</strong><span>{c.positionName} · {c.total}/100</span>{!c.cvAvailable&&<span className="history-error">Original PDF missing. Upload and score this CV again before sending.</span>}</div>)}
    {error&&<p className="history-error" role="alert">{error}</p>}
   </div>
   <footer><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button lark-send-confirm" type="submit" disabled={busy||!plan||candidates.some(c=>!c.cvAvailable)}><Send size={14}/>{busy?'Sending…':attempted?'Retry sending':`Send to ${plan?.recipientCount||''} recipient${plan?.recipientCount===1?'':'s'}`}</button></footer>
  </form>
 </dialog>;
}
