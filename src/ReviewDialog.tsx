import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type {PositionTemplate} from './positions';
import type { EvidenceReview, ReviewDecision } from './scoring-api';

export default function ReviewDialog({ position, evidence, remaining, busy, error, onDecision, onClose }: {
  position:PositionTemplate; evidence: EvidenceReview; remaining: number; busy: boolean; error: string;
  onDecision: (decision: ReviewDecision) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dimension,setDimension] = useState(evidence.dimension);
  const [band,setBand] = useState(evidence.band);
  const [cap,setCap] = useState(evidence.cap);
  const [statement,setStatement] = useState(evidence.statement);
  const ranges = position.rubric.find(d=>d.id===dimension)!.bands;
  const [min,max] = ranges[band];
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  function chooseDimension(value: string) { const bands=position.rubric.find(d=>d.id===value)!.bands;const nextBand=Math.min(band,bands.length-1);setDimension(value);setBand(nextBand);setCap(bands[nextBand][1]); }
  function chooseBand(value: number) { setBand(value); setCap(ranges[value][1]); }
  function decide(action: 'approve' | 'reject') { onDecision({id:evidence.id,action,dimension,band,cap,statement}); }
  return <dialog ref={dialog} className="review-dialog" aria-labelledby="review-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span className="eyebrow">HUMAN REVIEW</span><h2 id="review-title">Review new sentence</h2></div><button className="icon-button" disabled={busy} aria-label="Review later" onClick={onClose}><X size={18} /></button></header>
    <div className="review-body"><p className="review-intro">Choose one dimension for this full sentence and set its reference score. {remaining} sentence{remaining === 1 ? '' : 's'} remaining.</p>
      <blockquote>{evidence.quote}</blockquote>
      <label>Dimension<select value={dimension} disabled={busy} onChange={event => chooseDimension(event.target.value)}>{position.rubric.map(item => <option key={item.id} value={item.id}>{item.title} / {item.max}</option>)}</select></label>
      <div className="review-fields"><label>Rubric band<select value={band} disabled={busy} onChange={event => chooseBand(Number(event.target.value))}>{ranges.map(([low,high],index) => <option key={index} value={index}>{low === high ? low : `${low}–${high}`} points</option>)}</select></label><label>Reference cap<input type="number" min={min} max={max} step="0.1" value={Number.isNaN(cap) ? '' : cap} disabled={busy} onChange={event => setCap(event.target.value === '' ? NaN : Number(event.target.value))} /><small>Allowed: {min}–{max}</small></label></div>
      <label>Reusable reference<textarea value={statement} maxLength={2500} disabled={busy} onChange={event => setStatement(event.target.value)} /></label>
      {error && <p className="review-error" role="alert">{error}</p>}
    </div>
    <footer><button className="text-button" disabled={busy} onClick={onClose}>Review later</button><div><button className="button secondary" disabled={busy} onClick={() => decide('reject')}>Reject</button><button className="button primary" disabled={busy || !statement.trim() || !Number.isFinite(cap) || cap < min || cap > max} onClick={() => decide('approve')}>{busy && <LoaderCircle size={14} className="spin" />}Approve</button></div></footer>
  </dialog>;
}
