import {CandidateHistory,notifyCandidatesChanged,wasCandidateDeleted,type HistoryData} from './CandidateHistory';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleAlert, FileText, FolderOpen, LoaderCircle, Plus, ScanText, X } from 'lucide-react';
import { pdfError } from './pdf';
import { readCv } from './cv-input';
import {positionKey,type PositionTemplate} from './positions';
import { candidateCvRequest, scoringRequest, type ScoreResult, type ReviewDecision } from './scoring-api';
import ReviewDialog from './ReviewDialog';
import './scoring.css';

type Stage = 'ready' | 'scoring' | 'review' | 'complete' | 'error';
interface Candidate { id: string; name: string; file?: File; stage: Stage; result?: ScoreResult; error?: string; cvUploadFailed?:boolean }
const SESSION = 'hr-scoring-jobs-v2';
function restore(key:string,position:PositionTemplate): Candidate[] {
  try { return JSON.parse(sessionStorage.getItem(key) || (position.id==='hr-intern' && position.version===1 ? sessionStorage.getItem(SESSION) : null) || '[]').filter((item: Candidate) => typeof item.id === 'string' && typeof item.name === 'string' && item.result?.id).slice(0,50); }
  catch { return []; }
}
function message(error: unknown) {
  if (error instanceof Error && ['PasswordException','InvalidPDFException'].includes(error.name)) return pdfError(error);
  if (error instanceof Error && error.name === 'TimeoutError') return 'Scoring timed out. Please retry.';
  return error instanceof Error ? error.message : 'Scoring could not complete. Please retry.';
}

export default function ScoringWorkspace({history,position,active,onBusyChange}:{history:HistoryData;position:PositionTemplate;active:boolean;onBusyChange:(busy:boolean)=>void}) {
  const [view,setView]=useState<'screening'|'history'>('screening');
  const sessionKey=`${SESSION}:${positionKey(position)}`;
  const restoreCurrent=()=>restore(sessionKey,position);
  const [candidates,setCandidates] = useState<Candidate[]>(restoreCurrent);
  const [selectedId,setSelectedId] = useState<string | null>(() => restoreCurrent()[0]?.id ?? null);
  const [busy,setBusy] = useState(false);
  const [reviewBusy,setReviewBusy] = useState(false);
  const [reviewId,setReviewId] = useState<string | null>(null);
  const [reviewError,setReviewError] = useState('');
  const [errors,setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const selected = candidates.find(item => item.id === selectedId);
  const reviewing = candidates.find(item => item.id === reviewId);
  const evidence = reviewing?.result?.pending[0];
  const pending = candidates.filter(item => item.stage === 'ready' && item.file);
  const completed = candidates.filter(item => item.stage === 'complete').length;
  const patch = (id: string, changes: Partial<Candidate>) => { if (mounted.current) setCandidates(current => current.map(item => item.id === id ? {...item,...changes} : item)); };

  useEffect(() => {
    mounted.current = true;
    try { sessionStorage.removeItem('hr-scoring-jobs-v1'); } catch { /* Keep working if browser storage is unavailable. */ }
    for (const item of restoreCurrent()) {
      void scoringRequest<ScoreResult>(`/api/jobs/${item.result!.id}?positionId=${encodeURIComponent(position.id)}&positionVersion=${position.version}`).then(result => patch(item.id,{result,stage:result.state})).catch(error => {if(error?.status===404)setCandidates(current=>current.filter(c=>c.id!==item.id));else patch(item.id,{stage:'error',error:message(error)});});
    }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(sessionKey,JSON.stringify(candidates.filter(item => item.result).map(({id,name,stage,result}) => ({id,name,stage,result})))); } catch { /* The active page still works if browser storage is full. */ }
  }, [candidates]);

  useEffect(()=>{const deleted=(event:Event)=>{const items=(event as CustomEvent<{id:string;positionId:string;positionVersion:number}[]>).detail.filter(c=>c.positionId===position.id&&c.positionVersion===position.version);if(!items.length)return;const ids=new Set(items.map(c=>c.id));setCandidates(current=>current.filter(c=>!c.result||!ids.has(c.result.id)));setReviewId(null);};window.addEventListener('candidates-deleted',deleted);return()=>window.removeEventListener('candidates-deleted',deleted);},[position.id,position.version]);
  useEffect(()=>{if(selectedId&&!candidates.some(c=>c.id===selectedId))setSelectedId(candidates[0]?.id || null);},[candidates,selectedId]);
  useEffect(()=>{if(active)onBusyChange(busy||reviewBusy);},[active,busy,reviewBusy,onBusyChange]);

  function addFiles(files: File[]) {
    if (running.current) return;
    const issues: string[] = [], additions: Candidate[] = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) { issues.push(`${file.name}: please choose a PDF.`); continue; }
      if (!file.size || file.size > 20 * 1024 * 1024) { issues.push(`${file.name}: choose a non-empty PDF up to 20 MB.`); continue; }
      if (candidates.length + additions.length >= 50) { issues.push('Choose up to 50 files per batch.'); break; }
      additions.push({id:crypto.randomUUID(),name:file.name,file,stage:'ready'});
    }
    setErrors(issues);
    if (additions.length) { setCandidates(current => [...current,...additions]); setSelectedId(current => current ?? additions[0].id); }
  }

  async function score(queue: Candidate[]) {
    if (running.current || !queue.length) return;
    running.current = true; setBusy(true);
    try {
      for (const candidate of queue) {
        if (!mounted.current) break;
        setSelectedId(candidate.id); patch(candidate.id,{stage:'scoring',error:undefined});
        try {
          const text = await readCv(candidate.file!);
          const result = await scoringRequest<ScoreResult>('/api/score',{text,fileName:candidate.name,positionId:position.id,positionVersion:position.version});
          if(wasCandidateDeleted(result.id)){setCandidates(current=>current.filter(c=>c.id!==candidate.id));continue;}
          patch(candidate.id,{result,stage:result.state});
          try{await candidateCvRequest(result.id,position.id,position.version,candidate.file);patch(candidate.id,{cvUploadFailed:false});}catch{patch(candidate.id,{cvUploadFailed:true});setErrors(current=>[...current,'Score saved, but the original CV could not be saved. Retry the CV upload below.']);}
          notifyCandidatesChanged();
          if (result.state === 'review') { setReviewError(''); setReviewId(candidate.id); break; }
        } catch (error) { patch(candidate.id,{stage:'error',error:message(error)}); }
      }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }

  async function decide(decision: ReviewDecision) {
    if (!reviewing?.result || reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    try {
      const result = await scoringRequest<ScoreResult>(`/api/jobs/${reviewing.result.id}/review`,{decisions:[decision],positionId:position.id,positionVersion:position.version});
      if(wasCandidateDeleted(result.id)){setCandidates(current=>current.filter(c=>c.id!==reviewing.id));setReviewId(null);return;}
      patch(reviewing.id,{result,stage:result.state});
      notifyCandidatesChanged();
      if (result.state === 'complete') setReviewId(null);
    } catch (error) { setReviewError(message(error)); }
    finally { setReviewBusy(false); }
  }

  async function retryCvUploads(){
    if(busy)return;setBusy(true);
    try{for(const c of candidates.filter(c=>c.cvUploadFailed&&c.file&&c.result)){try{await candidateCvRequest(c.result!.id,position.id,position.version,c.file);patch(c.id,{cvUploadFailed:false});notifyCandidatesChanged();}catch(error){setErrors([message(error)]);}}}finally{setBusy(false);}
  }
  function downloadResult() {
    if (!selected?.result || selected.stage !== 'complete') return;
    const report = [`Position: ${position.name}`,`File: ${selected.name}`,`Total: ${selected.result.total}/100`,'',...position.rubric.map(d => `${d.title}: ${selected.result!.dimensions.find(item => item.id === d.id)?.score ?? 0}/${d.max}`)].join('\n');
    const url = URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = selected.name.replace(/\.pdf$/i,'')+'-scores.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const total = selected?.result?.total ?? 0;

  return <>
    <header className="topbar"><div className="breadcrumb"><FolderOpen size={15} /><span>Workspace</span><ChevronRight size={13} /><strong>{position.name}</strong></div></header>
    <div className="content scoring-content">
      <div className="page-heading"><div><h1>{position.name}<span className="title-dot">.</span></h1>{position.description&&<p>{position.description}</p>}</div></div>
      <div className="workspace-tabs" role="tablist" aria-label="Position views"><button role="tab" aria-selected={view==='screening'} disabled={busy||reviewBusy} onClick={()=>setView('screening')}>Screening</button><button role="tab" aria-selected={view==='history'} disabled={busy||reviewBusy} onClick={()=>setView('history')}>History <span className="count-badge">{history.rows.filter(c=>c.positionId===position.id).length}</span></button></div>
      <div hidden={view!=='screening'}>
      <input className="visually-hidden" ref={input} type="file" accept=".pdf,application/pdf" multiple disabled={busy} aria-label="Choose candidate CVs" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {errors.length > 0 && <div className="alert" role="alert"><CircleAlert size={15} /><div>{errors.map((error,index) => <p key={index}>{error}</p>)}</div><button className="icon-button" aria-label="Dismiss upload errors" onClick={() => setErrors([])}><X size={15} /></button></div>}
      {candidates.some(c=>c.cvUploadFailed&&c.file)&&<button className="text-button" disabled={busy} onClick={()=>void retryCvUploads()}>Retry CV upload</button>}
      <section className="workspace-panel scoring-workspace" aria-label={`${position.name} candidate scoring`}>
        <div className="queue-panel"><div className="panel-heading"><h2>Candidates <span className="count-badge">{candidates.length}</span></h2><div className="candidate-actions">{!!candidates.length && <button className="text-button add-cv-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={14} />Add CV</button>}{!!candidates.length && <button className="text-button" disabled={busy} onClick={() => { setCandidates([]); setSelectedId(null); }}>Clear all</button>}</div></div>
          <div className="queue-list scoring-queue">{!candidates.length ? <div className="queue-empty"><div className="empty-file-stack"><FileText size={28} strokeWidth={1.2} /></div><strong>Your next talent starts here</strong><p>Add CVs to review candidates<br />for {position.name}.</p><button className="text-button add-cv-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={15} />Add CV</button></div> : candidates.map(candidate => <div className={`file-row ${selectedId === candidate.id ? 'selected' : ''}`} key={candidate.id}>
            <button className="file-select" aria-pressed={selectedId === candidate.id} onClick={() => setSelectedId(candidate.id)}><span className="file-symbol"><FileText size={18} /><small>PDF</small></span><span className="file-detail"><strong title={candidate.name}>{candidate.name}</strong><span>{position.name}</span><span className={`status ${candidate.stage === 'complete' ? `candidate-outcome-${(candidate.result?.total ?? 0)<=50?'rejected':(candidate.result?.total ?? 0)<70?'consider':'pass'}` : candidate.stage === 'error' ? 'error' : ''}`}>{candidate.stage === 'scoring' ? <LoaderCircle size={11} className="spin" /> : candidate.stage === 'complete' ? <Check size={11} /> : candidate.stage === 'error' ? <CircleAlert size={11} /> : <span className="status-dot" />}{({ready:'Ready',scoring:'Scoring…',review:'Review needed',complete:(candidate.result?.total ?? 0)<=50?'Rejected':(candidate.result?.total ?? 0)<70?'Consider':'Pass',error:'Needs attention'})[candidate.stage]}</span></span></button><button className="icon-button remove-file" disabled={busy} aria-label={`Remove ${candidate.name}`} onClick={() => { const remaining = candidates.filter(item => item.id !== candidate.id); setCandidates(remaining); if (selectedId === candidate.id) setSelectedId(remaining[0]?.id ?? null); }}><X size={14} /></button>
          </div>)}</div>
          <div className="queue-footer"><button className="button primary convert-button" disabled={busy || !pending.length} onClick={() => void score(pending)}>{busy ? <LoaderCircle size={16} className="spin" /> : <ScanText size={16} />}{busy ? 'Scoring…' : 'Score CVs'}{!busy && <ArrowRight size={16} />}</button>{(busy || completed > 0) && <p>{busy ? 'Please keep this tab open' : `${completed} CV${completed === 1 ? '' : 's'} scored`}</p>}</div>
        </div>
        <div className="output-panel scoring-output" aria-busy={selected?.stage === 'scoring'}><div className="panel-heading"><h2>Candidate score</h2>{selected?.stage === 'complete' && <button className="button secondary download-button" onClick={downloadResult}><ArrowDownToLine size={14} />Download</button>}</div>
          {selected?.stage === 'complete' ? <div className="score-result"><div className="score-total" data-score-band={total <= 50 ? 'low' : total < 70 ? 'medium' : 'high'}><div><span className="score-label">TOTAL SCORE</span><div className="score-number"><strong>{total}</strong><span>/ 100</span></div><p>{position.name}</p><span className={`outcome ${total<=50?'rejected':total<70?'consider':'pass'}`}>{total<=50?'Rejected':total<70?'Consider':'Pass'}</span></div><div className="score-ring" style={{'--score':total} as CSSProperties}><span><Check size={25} strokeWidth={1.7} /></span></div></div><div className="dimension-heading"><h3>Score breakdown</h3><span>Score / Max</span></div><div className="dimension-list">{position.rubric.map((d,index) => { const points = selected.result?.dimensions.find(item => item.id === d.id)?.score ?? 0; return <div className="dimension-row" key={d.id}><span className="dimension-index">{String(index+1).padStart(2,'0')}</span><div className="dimension-name"><span>{d.title}</span><div className="dimension-track"><span style={{width:`${points/d.max*100}%`}} /></div></div><span className="dimension-points"><strong>{points}</strong><span>/ {d.max}</span></span></div>; })}</div></div>
          : selected?.stage === 'scoring' ? <div className="scoring-loading" role="status"><div className="loading-orbit"><ScanText size={27} strokeWidth={1.5} /><span /></div><h3>Scoring CV…</h3><p>Please wait while we review this CV.</p><div className="indeterminate-track"><span /></div></div>
          : selected?.stage === 'review' ? <div className="output-empty"><div className="preview-illustration"><FileText size={28} /></div><h3>A quick review is needed</h3><p>Confirm {selected.result?.pending.length} new sentence{selected.result?.pending.length === 1 ? '' : 's'} to finish scoring.</p><button className="button primary" onClick={() => {setReviewError('');setReviewId(selected.id);}}>Review sentences</button></div>
          : selected?.stage === 'error' ? <div className="output-empty"><div className="preview-illustration warning"><CircleAlert size={28} /></div><h3>Unable to score this CV</h3><p>{selected.error}</p>{selected.file && <button className="button secondary" disabled={busy} onClick={() => patch(selected.id,{stage:'ready',error:undefined})}>Try again</button>}</div>
          : <div className="output-empty score-empty"><div className="score-preview-paper"><span /><span /><span /><span /></div><h3>{selected ? 'Ready when you are' : 'A clearer view of potential'}</h3><p>{selected ? 'Score this CV to see the total experience score and a breakdown for each part.' : 'Add candidate CVs to get started.'}</p></div>}
        </div>
      </section>
      </div>
      {view==='history'&&<CandidateHistory data={history} positionId={position.id}/>}
    </div>
    {evidence && <ReviewDialog key={evidence.id} position={position} evidence={evidence} remaining={reviewing!.result!.pending.length} busy={reviewBusy} error={reviewError} onDecision={decision => void decide(decision)} onClose={() => {setReviewId(null);setReviewError('');}} />}
  </>;
}
