import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,ListChecks,LoaderCircle} from 'lucide-react';
import {notifyCandidatesChanged,type CandidateRecord} from './CandidateHistory';
import {scoringRequest,type ReviewDecision,type ScoreResult} from './scoring-api';
import ReviewDialog from './ReviewDialog';
import './review-inbox.css';

interface ReviewPage {rows:CandidateRecord[];total:number;page:number;pages:number}
interface SelectedReview {candidate:CandidateRecord;result:ScoreResult}

export default function ReviewInbox(){
  const [open,setOpen]=useState(false),[page,setPage]=useState(1);
  const [queue,setQueue]=useState<ReviewPage>({rows:[],total:0,page:1,pages:1});
  const [loadingId,setLoadingId]=useState('');
  const [error,setError]=useState(''),[reviewError,setReviewError]=useState('');
  const [selected,setSelected]=useState<SelectedReview|null>(null),[saving,setSaving]=useState(false);
  const container=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    let disposed=false,running=false;
    async function refresh(){
      if(disposed||running||document.hidden)return;
      running=true;
      try{
        const next=await scoringRequest<ReviewPage>(`/api/candidates/page?status=review&page=${page}`,undefined,12000);
        if(!disposed){setQueue(next);setError('');if(next.page!==page)setPage(next.page);}
      }catch(err){if(!disposed)setError(err instanceof Error?err.message:'Unable to load reviews.');}
      finally{running=false;}
    }
    void refresh();
    const timer=setInterval(()=>void refresh(),3000);
    const changed=()=>void refresh();
    window.addEventListener('candidates-changed',changed);
    document.addEventListener('visibilitychange',changed);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener('candidates-changed',changed);document.removeEventListener('visibilitychange',changed);};
  },[page]);

  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);

  async function choose(candidate:CandidateRecord){
    if(loadingId)return;
    setLoadingId(candidate.id);setError('');
    try{
      const params=new URLSearchParams({positionId:candidate.positionId,positionVersion:String(candidate.positionVersion)});
      const result=await scoringRequest<ScoreResult>(`/api/jobs/${candidate.id}?${params}`,undefined,12000);
      if(result.state!=='review'||!result.pending.length||!result.position){notifyCandidatesChanged();setError('This review is no longer available.');return;}
      setSelected({candidate,result});setReviewError('');setOpen(false);
    }catch(err){setError(err instanceof Error?err.message:'Unable to open this review.');notifyCandidatesChanged();}
    finally{setLoadingId('');}
  }

  async function save(decisions:ReviewDecision[]){
    if(!selected||saving)return;
    setSaving(true);setReviewError('');
    try{
      const {candidate}=selected;
      const params={positionId:candidate.positionId,positionVersion:candidate.positionVersion};
      const result=await scoringRequest<ScoreResult>(`/api/jobs/${candidate.id}/review`,{...params,decisions});
      window.dispatchEvent(new CustomEvent('candidate-review-saved',{detail:{id:candidate.id,positionId:candidate.positionId,positionVersion:candidate.positionVersion,result}}));
      notifyCandidatesChanged();
      if(result.state==='complete')setSelected(null);
      else setSelected({candidate,result});
    }catch(err){setReviewError(err instanceof Error?err.message:'Unable to save reviews. Please retry.');}
    finally{setSaving(false);}
  }

  return <div className="review-inbox" ref={container}>
    <button className="review-inbox-trigger" type="button" aria-label={`${queue.total} candidates need review`} aria-expanded={open} aria-controls="review-inbox-list" onClick={()=>setOpen(value=>!value)}>
      <ListChecks size={17}/><span>Reviews</span><strong>{queue.total}</strong>
    </button>
    {open&&<section className="review-inbox-panel" id="review-inbox-list" aria-label="Candidates awaiting review">
      <div className="review-inbox-heading"><strong>Review needed</strong><span>{queue.total} candidate{queue.total===1?'':'s'}</span></div>
      {error&&<p className="review-inbox-error" role="alert">{error}</p>}
      {queue.rows.length?<div className="review-inbox-rows">{queue.rows.map(candidate=><button className="review-inbox-row" type="button" key={`${candidate.positionId}:${candidate.positionVersion}:${candidate.id}`} disabled={!!loadingId} onClick={()=>void choose(candidate)}><span><strong>{candidate.candidateProfile?.name||candidate.fileName}</strong><small>{candidate.positionName} · {candidate.fileName}</small></span><span className="review-inbox-count">{loadingId===candidate.id?<LoaderCircle size={13} className="spin"/>:`${candidate.pendingCount} ${candidate.pendingCount===1?'sentence':'sentences'}`}</span></button>)}</div>:<p className="review-inbox-empty">{error?'The list could not be refreshed.':'All candidates have been reviewed.'}</p>}
      {queue.pages>1&&<div className="review-inbox-pagination"><button type="button" disabled={page<=1||!!loadingId} aria-label="Previous review page" onClick={()=>setPage(value=>value-1)}><ChevronLeft size={15}/></button><span>{queue.page} / {queue.pages}</span><button type="button" disabled={page>=queue.pages||!!loadingId} aria-label="Next review page" onClick={()=>setPage(value=>value+1)}><ChevronRight size={15}/></button></div>}
    </section>}
    {selected?.result.position&&selected.result.pending.length>0&&<ReviewDialog key={`${selected.result.id}:${selected.result.pending.map(item=>item.id).join(',')}`} position={selected.result.position} evidence={selected.result.pending} busy={saving} error={reviewError} onDecisions={decisions=>void save(decisions)} onClose={()=>setSelected(null)}/>}
  </div>;
}
