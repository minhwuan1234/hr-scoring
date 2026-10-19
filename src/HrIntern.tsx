import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleAlert, FileText, FolderOpen, LoaderCircle, Plus, ScanText, X } from 'lucide-react';
import { pdfError } from './pdf';
import { readCv } from './cv-input';
import { HR_INTERN_DIMENSIONS, HR_INTERN_POSITION } from './hr-intern';
import { scoringRequest, type ScoreResult, type ReviewDecision } from './scoring-api';
import ReviewDialog from './ReviewDialog';
import './scoring.css';

type Stage = 'ready' | 'scoring' | 'review' | 'complete' | 'error';
interface Candidate { id: string; name: string; file?: File; stage: Stage; result?: ScoreResult; error?: string }
const SESSION = 'hr-scoring-jobs-v1';
function restore(): Candidate[] {
  try { return JSON.parse(sessionStorage.getItem(SESSION) || '[]').filter((item: Candidate) => typeof item.id === 'string' && typeof item.name === 'string' && item.result?.id).slice(0,50); }
  catch { return []; }
}
function message(error: unknown) {
  if (error instanceof Error && ['PasswordException','InvalidPDFException'].includes(error.name)) return pdfError(error);
  if (error instanceof Error && error.name === 'TimeoutError') return 'Scoring timed out. Please retry.';
  return error instanceof Error ? error.message : 'Scoring could not complete. Please retry.';
}

export default function HrIntern() {
  const [candidates,setCandidates] = useState<Candidate[]>(restore);
  const [selectedId,setSelectedId] = useState<string | null>(() => restore()[0]?.id ?? null);
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
    for (const item of restore()) {
      void scoringRequest<ScoreResult>(`/api/jobs/${item.result!.id}`).then(result => patch(item.id,{result,stage:result.state})).catch(error => patch(item.id,{stage:'error',error:message(error)}));
    }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(SESSION,JSON.stringify(candidates.filter(item => item.result).map(({id,name,stage,result}) => ({id,name,stage,result})))); } catch { /* The active page still works if browser storage is full. */ }
  }, [candidates]);

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
          const result = await scoringRequest<ScoreResult>('/api/score',{text});
          patch(candidate.id,{result,stage:result.state});
          if (result.state === 'review') { setReviewError(''); setReviewId(candidate.id); break; }
        } catch (error) { patch(candidate.id,{stage:'error',error:message(error)}); }
      }
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }

  async function decide(decision: ReviewDecision) {
    if (!reviewing?.result || reviewBusy) return;
    setReviewBusy(true); setReviewError('');
    try {
      const result = await scoringRequest<ScoreResult>(`/api/jobs/${reviewing.result.id}/review`,{decisions:[decision]});
      patch(reviewing.id,{result,stage:result.state});
      if (result.state === 'complete') setReviewId(null);
    } catch (error) { setReviewError(message(error)); }
    finally { setReviewBusy(false); }
  }

  function downloadResult() {
    if (!selected?.result || selected.stage !== 'complete') return;
    const report = [`Position: ${HR_INTERN_POSITION}`,`File: ${selected.name}`,`Total: ${selected.result.total}/100`,'',...HR_INTERN_DIMENSIONS.map(d => `${d.title}: ${selected.result!.dimensions.find(item => item.id === d.id)?.score ?? 0}/${d.max}`)].join('\n');
    const url = URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = selected.name.replace(/\.pdf$/i,'')+'-scores.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const total = selected?.result?.total ?? 0;

  return <>
    <header className="topbar"><div className="breadcrumb"><FolderOpen size={15} /><span>Workspace</span><ChevronRight size={13} /><strong>HR Intern</strong></div></header>
    <div className="content scoring-content">
      <div className="page-heading"><div><div className="eyebrow"><span>01</span>CANDIDATE SCREENING</div><h1>HR Intern<span className="title-dot">.</span></h1><p>Review experience. Discover potential.</p></div></div>
      <input className="visually-hidden" ref={input} type="file" accept=".pdf,application/pdf" multiple disabled={busy} aria-label="Choose candidate CVs" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {errors.length > 0 && <div className="alert" role="alert"><CircleAlert size={15} /><div>{errors.map((error,index) => <p key={index}>{error}</p>)}</div><button className="icon-button" aria-label="Dismiss upload errors" onClick={() => setErrors([])}><X size={15} /></button></div>}
      <section className="workspace-panel scoring-workspace" aria-label="HR Intern experience scoring">
        <div className="queue-panel"><div className="panel-heading"><h2>Candidates <span className="count-badge">{candidates.length}</span></h2><div className="candidate-actions">{!!candidates.length && <button className="text-button add-cv-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={14} />Add CV</button>}{!!candidates.length && <button className="text-button" disabled={busy} onClick={() => { setCandidates([]); setSelectedId(null); }}>Clear all</button>}</div></div>
          <div className="queue-list scoring-queue">{!candidates.length ? <div className="queue-empty"><div className="empty-file-stack"><FileText size={28} strokeWidth={1.2} /></div><strong>Your next talent starts here</strong><p>Add CVs to review their<br />HR Intern experience.</p><button className="text-button add-cv-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={15} />Add CV</button></div> : candidates.map(candidate => <div className={`file-row ${selectedId === candidate.id ? 'selected' : ''}`} key={candidate.id}>
            <button className="file-select" aria-pressed={selectedId === candidate.id} onClick={() => setSelectedId(candidate.id)}><span className="file-symbol"><FileText size={18} /><small>PDF</small></span><span className="file-detail"><strong title={candidate.name}>{candidate.name}</strong><span>HR Intern</span><span className={`status ${candidate.stage === 'complete' ? 'done' : candidate.stage === 'error' ? 'error' : ''}`}>{candidate.stage === 'scoring' ? <LoaderCircle size={11} className="spin" /> : candidate.stage === 'complete' ? <Check size={11} /> : candidate.stage === 'error' ? <CircleAlert size={11} /> : <span className="status-dot" />}{({ready:'Ready',scoring:'Scoring…',review:'Review needed',complete:'Scored',error:'Needs attention'})[candidate.stage]}</span></span></button><button className="icon-button remove-file" disabled={busy} aria-label={`Remove ${candidate.name}`} onClick={() => { const remaining = candidates.filter(item => item.id !== candidate.id); setCandidates(remaining); if (selectedId === candidate.id) setSelectedId(remaining[0]?.id ?? null); }}><X size={14} /></button>
          </div>)}</div>
          <div className="queue-footer"><button className="button primary convert-button" disabled={busy || !pending.length} onClick={() => void score(pending)}>{busy ? <LoaderCircle size={16} className="spin" /> : <ScanText size={16} />}{busy ? 'Scoring…' : 'Score CVs'}{!busy && <ArrowRight size={16} />}</button>{(busy || completed > 0) && <p>{busy ? 'Please keep this tab open' : `${completed} CV${completed === 1 ? '' : 's'} scored`}</p>}</div>
        </div>
        <div className="output-panel scoring-output" aria-busy={selected?.stage === 'scoring'}><div className="panel-heading"><h2>Experience score</h2>{selected?.stage === 'complete' && <button className="button secondary download-button" onClick={downloadResult}><ArrowDownToLine size={14} />Download</button>}</div>
          {selected?.stage === 'complete' ? <div className="score-result"><div className="score-total" data-score-band={total <= 50 ? 'low' : total < 70 ? 'medium' : 'high'}><div><span className="score-label">TOTAL SCORE</span><div className="score-number"><strong>{total}</strong><span>/ 100</span></div><p>Experience · HR Intern</p></div><div className="score-ring" style={{'--score':total} as CSSProperties}><span><Check size={25} strokeWidth={1.7} /></span></div></div><div className="dimension-heading"><h3>Score breakdown</h3><span>Score / Max</span></div><div className="dimension-list">{HR_INTERN_DIMENSIONS.map((d,index) => { const points = selected.result?.dimensions.find(item => item.id === d.id)?.score ?? 0; return <div className="dimension-row" key={d.id}><span className="dimension-index">{String(index+1).padStart(2,'0')}</span><div className="dimension-name"><span>{d.title}</span><div className="dimension-track"><span style={{width:`${points/d.max*100}%`}} /></div></div><span className="dimension-points"><strong>{points}</strong><span>/ {d.max}</span></span></div>; })}</div></div>
          : selected?.stage === 'scoring' ? <div className="scoring-loading" role="status"><div className="loading-orbit"><ScanText size={27} strokeWidth={1.5} /><span /></div><h3>Scoring experience…</h3><p>Please wait while we review this CV.</p><div className="indeterminate-track"><span /></div></div>
          : selected?.stage === 'review' ? <div className="output-empty"><div className="preview-illustration"><FileText size={28} /></div><h3>A quick review is needed</h3><p>Confirm {selected.result?.pending.length} new sentence{selected.result?.pending.length === 1 ? '' : 's'} to finish scoring.</p><button className="button primary" onClick={() => {setReviewError('');setReviewId(selected.id);}}>Review sentences</button></div>
          : selected?.stage === 'error' ? <div className="output-empty"><div className="preview-illustration warning"><CircleAlert size={28} /></div><h3>Unable to score this CV</h3><p>{selected.error}</p>{selected.file && <button className="button secondary" disabled={busy} onClick={() => patch(selected.id,{stage:'ready',error:undefined})}>Try again</button>}</div>
          : <div className="output-empty score-empty"><div className="score-preview-paper"><span /><span /><span /><span /></div><h3>{selected ? 'Ready when you are' : 'A clearer view of potential'}</h3><p>{selected ? 'Score this CV to see the total experience score and a breakdown for each part.' : 'Add candidate CVs to get started.'}</p></div>}
        </div>
      </section>
    </div>
    {evidence && <ReviewDialog key={evidence.id} evidence={evidence} remaining={reviewing!.result!.pending.length} busy={reviewBusy} error={reviewError} onDecision={decision => void decide(decision)} onClose={() => {setReviewId(null);setReviewError('');}} />}
  </>;
}
