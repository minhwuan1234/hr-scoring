import {useEffect,useRef,useState} from 'react';
import {Send,X} from 'lucide-react';
import {scoringRequest} from './scoring-api';
import type {CandidateRecord} from './CandidateHistory';
const key=(c:CandidateRecord)=>JSON.stringify([c.positionId,c.positionVersion,c.id]);
interface DeliveryResult {complete:boolean;candidateCount:number;recipientCount:number;sentCount:number;totalCount:number;failures:{error:string}[]}
export default function LarkSendDialog({candidates,onClose,onSent}:{candidates:CandidateRecord[];onClose:()=>void;onSent:(message:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),requestId=useRef(crypto.randomUUID());
 const [urls,setUrls]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 async function send(){
  if(busy)return;setBusy(true);setError('');setAttempted(true);
  try{
   const result=await scoringRequest<DeliveryResult>('/api/lark/send',{requestId:requestId.current,candidates:candidates.map(c=>({id:c.id,positionId:c.positionId,positionVersion:c.positionVersion,driveUrl:(urls[key(c)]||'').trim()}))},180000);
   if(result.complete){onSent(`Sent ${result.candidateCount} CV${result.candidateCount===1?'':'s'} to all ${result.recipientCount} Lark recipients.`);return;}
   setError(`${result.sentCount} of ${result.totalCount} cards delivered. ${result.failures[0]?.error || 'Some deliveries failed.'} Retry to complete this batch.`);
  }catch(err){setError(err instanceof Error?err.message:'Unable to send to Lark. Please retry.');}finally{setBusy(false);}
 }
 return <dialog ref={dialog} className="review-dialog lark-send-dialog" aria-labelledby="lark-send-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
  <header><div><h2 id="lark-send-title">Send Lark</h2><p>{candidates.length} CV{candidates.length===1?'':'s'} · 3 recipients</p></div><button className="icon-button" aria-label="Close Send Lark" disabled={busy} onClick={onClose}><X size={18}/></button></header>
  <form onSubmit={e=>{e.preventDefault();void send();}}>
   <div className="lark-send-body"><p>Send candidate details, score breakdowns and the CV and call booking buttons to:</p>
    <ul className="lark-recipients"><li>ou_f77cf794a1319628941dd689ecc97e32</li><li>ou_4eb96bd84a22b6511fcb316d35ded621</li><li>ou_9f7de713af63322b36ee7e41f5731313</li></ul>
    <p>Add a Google Drive link for each CV. Recipients need permission to open the file.</p>
    {candidates.map(c=><label className="lark-cv-field" key={key(c)}><strong>{c.candidateProfile?.name||c.fileName}</strong><span>{c.positionName} · {c.total}/100</span><input required type="url" aria-label={`Google Drive CV link for ${c.candidateProfile?.name||c.fileName}`} placeholder="https://drive.google.com/file/d/…/view" disabled={busy} value={urls[key(c)]||''} onChange={e=>{setUrls(current=>({...current,[key(c)]:e.target.value}));if(attempted){requestId.current=crypto.randomUUID();setAttempted(false);setError('');}}}/></label>)}
    {error&&<p className="history-error" role="alert">{error}</p>}
   </div>
   <footer><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="text-button send-lark" type="submit" disabled={busy}><Send size={14}/>{busy?'Sending…':attempted?'Retry sending':'Send to 3 recipients'}</button></footer>
  </form>
 </dialog>;
}
