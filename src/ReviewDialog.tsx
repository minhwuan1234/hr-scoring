import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type {Criterion} from './positions';
import type { EvidenceReview, ReviewDecision } from './scoring-api';

type ReviewAction = ReviewDecision['action'] | null;
type Draft = Omit<ReviewDecision, 'action'> & {action: ReviewAction};

export default function ReviewDialog({ position, evidence, busy, error, onDecisions, onClose }: {
  position: {rubric: Pick<Criterion,'id'|'title'|'max'|'bands'>[]}; evidence: EvidenceReview[]; busy: boolean; error: string;
  onDecisions: (decisions: ReviewDecision[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [drafts,setDrafts] = useState<Record<string,Draft>>(() => Object.fromEntries(
    evidence.map(item => [item.id,{...item,action:null}]),
  ));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);

  function update(id: string, changes: Partial<Draft>) {
    setDrafts(current => ({...current,[id]:{...current[id],...changes}}));
  }
  function chooseDimension(id: string, value: string) {
    const draft=drafts[id],bands=position.rubric.find(item=>item.id===value)!.bands;
    const band=Math.min(draft.band,bands.length-1);
    update(id,{dimension:value,band,cap:bands[band][1]});
  }
  function chooseBand(id: string, band: number) {
    const draft=drafts[id],bands=position.rubric.find(item=>item.id===draft.dimension)!.bands;
    update(id,{band,cap:bands[band][1]});
  }
  const answered=evidence.filter(item=>drafts[item.id]?.action).length;
  const ready=evidence.length>0&&evidence.every(item=>{
    const draft=drafts[item.id];
    if(draft?.action==='reject')return true;
    if(draft?.action!=='approve'||!draft.statement.trim())return false;
    const range=position.rubric.find(d=>d.id===draft.dimension)?.bands[draft.band];
    return !!range&&Number.isFinite(draft.cap)&&draft.cap>=range[0]&&draft.cap<=range[1];
  });
  function submit() {
    if(!ready||busy)return;
    onDecisions(evidence.map(item=>drafts[item.id] as ReviewDecision));
  }

  return <dialog ref={dialog} className="review-dialog review-list-dialog" aria-labelledby="review-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span className="eyebrow">HUMAN REVIEW</span><h2 id="review-title">Review candidate sentences</h2></div><button className="icon-button" disabled={busy} aria-label="Review later" onClick={onClose}><X size={18} /></button></header>
    <div className="review-body"><p className="review-intro">Review {evidence.length} sentence{evidence.length===1?'':'s'} for this candidate. Scroll down to score each one, then save together.</p>
      <div className="review-list">{evidence.map((item,index)=>{
        const draft=drafts[item.id],ranges=position.rubric.find(d=>d.id===draft.dimension)!.bands;
        const [min,max]=ranges[draft.band];
        return <section className="review-item" key={item.id} aria-labelledby={`review-item-${item.id}`}>
          <div className="review-item-heading"><h3 id={`review-item-${item.id}`}>Sentence {index+1} of {evidence.length}</h3><span className={draft.action ? 'review-item-done' : ''}>{draft.action==='approve'?'Approve':draft.action==='reject'?'Reject':'Choose a decision'}</span></div>
          <blockquote>{item.quote}</blockquote>
          <div className="review-choice" role="group" aria-label={`Decision for sentence ${index+1}`}>
            <button type="button" className={draft.action==='approve'?'selected':''} aria-pressed={draft.action==='approve'} disabled={busy} onClick={()=>update(item.id,{action:'approve'})}>Approve</button>
            <button type="button" className={draft.action==='reject'?'selected':''} aria-pressed={draft.action==='reject'} disabled={busy} onClick={()=>update(item.id,{action:'reject'})}>Reject</button>
          </div>
          {draft.action==='approve'&&<div className="review-item-fields">
            <label>Dimension<select value={draft.dimension} disabled={busy} onChange={event=>chooseDimension(item.id,event.target.value)}>{position.rubric.map(d=><option key={d.id} value={d.id}>{d.title} / {d.max}</option>)}</select></label>
            <div className="review-fields"><label>Rubric band<select value={draft.band} disabled={busy} onChange={event=>chooseBand(item.id,Number(event.target.value))}>{ranges.map(([low,high],band)=><option key={band} value={band}>{low===high?low:`${low}–${high}`} points</option>)}</select></label><label>Reference cap<input type="number" min={min} max={max} step="0.1" value={Number.isNaN(draft.cap)?'':draft.cap} disabled={busy} onChange={event=>update(item.id,{cap:event.target.value===''?NaN:Number(event.target.value)})}/><small>Allowed: {min}–{max}</small></label></div>
            <label>Reusable reference<textarea value={draft.statement} maxLength={2500} disabled={busy} onChange={event=>update(item.id,{statement:event.target.value})}/></label>
          </div>}
        </section>;
      })}</div>
      {error&&<p className="review-error" role="alert">{error}</p>}
    </div>
    <footer><button className="text-button" disabled={busy} onClick={onClose}>Review later</button><div><span className="review-progress" aria-live="polite">{answered}/{evidence.length} reviewed</span><button className="button primary" disabled={busy||!ready} onClick={submit}>{busy&&<LoaderCircle size={14} className="spin" />}Save reviews</button></div></footer>
  </dialog>;
}
