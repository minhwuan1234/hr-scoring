import { useRef, useState, type DragEvent } from 'react';
import {
  ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronRight, CircleAlert,
  Copy, FileText, Files, FolderOpen, HelpCircle, LoaderCircle, LockKeyhole,
  Plus, ScanText, ShieldCheck, Upload, X,
} from 'lucide-react';
import { extractPdf, pdfError, type Extraction } from './pdf';

type Status = 'queued' | 'processing' | 'done' | 'scan' | 'error';
interface DocumentItem {
  id: string;
  file: File;
  status: Status;
  finished: number;
  total: number;
  result?: Extraction;
  error?: string;
}
const labels: Record<Status, string> = {
  queued: 'Ready to convert', processing: 'Reading', done: 'Completed', scan: 'Needs OCR', error: 'File error',
};
const MAX_SIZE = 20 * 1024 * 1024;
const MAX_FILES = 50;
const nf = new Intl.NumberFormat('en-US');
function plural(count: number, word: string) { return `${nf.format(count)} ${word}${count === 1 ? '' : 's'}`; }
function sizeLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function textName(name: string) { return name.replace(/\.pdf$/i, '') + '.txt'; }
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selected = documents.find(doc => doc.id === selectedId);
  const ready = documents.filter(doc => doc.result?.text);
  const pending = documents.filter(doc => doc.status === 'queued');
  const complete = documents.filter(doc => ['done', 'scan', 'error'].includes(doc.status)).length;
  const progress = documents.length ? Math.round(complete / documents.length * 100) : 0;
  const patch = (id: string, changes: Partial<DocumentItem>) => setDocuments(current => current.map(doc => doc.id === id ? { ...doc, ...changes } : doc));

  function addFiles(files: File[]) {
    if (busyRef.current) return;
    const messages: string[] = [];
    const added: DocumentItem[] = [];
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name)) { messages.push(`${file.name}: only PDF files are supported.`); continue; }
      if (file.size > MAX_SIZE) { messages.push(`${file.name}: exceeds the 20 MB limit.`); continue; }
      if (!file.size) { messages.push(`${file.name}: this file is empty. Please choose another file.`); continue; }
      if (documents.length + added.length >= MAX_FILES) { messages.push('You can process up to 50 files at a time.'); break; }
      added.push({ id: crypto.randomUUID(), file, status: 'queued', finished: 0, total: 0 });
    }
    setAlerts(messages);
    setNotice('');
    if (added.length) {
      setDocuments(current => [...current, ...added]);
      setSelectedId(current => current ?? added[0].id);
    }
  }

  async function convert() {
    if (busyRef.current || !pending.length) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    let successes = 0;
    try {
      for (const doc of pending) {
        patch(doc.id, { status: 'processing', error: undefined });
        setSelectedId(doc.id);
        try {
          const data = new Uint8Array(await doc.file.arrayBuffer());
          const result = await extractPdf(data, (finished, total) => patch(doc.id, { finished, total }), `${import.meta.env.BASE_URL}pdfjs/`);
          patch(doc.id, { result, status: result.text ? 'done' : 'scan' });
          if (result.text) successes++;
        } catch (error) {
          patch(doc.id, { status: 'error', error: pdfError(error) });
        }
      }
      setNotice(`Processed ${plural(pending.length, 'file')}. Text is available to view and download for ${plural(successes, 'file')}.`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function remove(id: string) {
    const remaining = documents.filter(doc => doc.id !== id);
    setDocuments(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
    setNotice('');
  }
  async function copyText() {
    if (!selected?.result?.text) return;
    try { await navigator.clipboard.writeText(selected.result.text); setNotice('Text copied to clipboard.'); }
    catch { setNotice('Clipboard access is unavailable. Select the text below or download the TXT file.'); }
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    dragDepth.current = 0;
    addFiles(Array.from(event.dataTransfer.files));
  }
  const selectedText = selected?.result?.text ?? '';

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#main"><span className="brand-mark"><ScanText size={20} /></span><span>HR Scoring<span className="brand-caption">Recruitment workspace</span></span></a>
      <div className="workspace-name"><span className="workspace-avatar">HR</span><span>HR Workspace<small>Recruitment workspace</small></span><LockKeyhole size={13} /></div>
      <p className="nav-label">CV WORKFLOW</p>
      <nav aria-label="Recruitment workflow">
        <a className="nav-item active" href="#main" aria-current="page"><ScanText size={17} /><span>PDF to text</span><span className="nav-count">01</span></a>
        <div className="nav-item upcoming"><FileText size={17} /><span>CV scoring</span><small>Coming soon</small></div>
      </nav>
      <div className="sidebar-note"><span className="tiny-label">THE FIRST STEP</span><p>From candidate files<br />to readable information.</p><div className="mini-flow"><Files size={16} /><span /><ScanText size={16} /><span /><CheckCheck size={16} /></div></div>
      <div className="sidebar-bottom"><button className="help-button" onClick={() => setHelp(!help)} aria-expanded={help}><HelpCircle size={16} />How it works<ChevronRight size={14} /></button><div className="profile"><span className="profile-avatar">HR</span><div>HR Workspace<small>PDF extraction · v0.1</small></div></div></div>
    </aside>

    <main id="main" className="main">
      <header className="topbar"><div className="breadcrumb"><FolderOpen size={15} /><span>Workspace</span><ChevronRight size={13} /><strong>CV preparation</strong></div><span className="local-indicator"><span />Processed on your device</span></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span>01</span>DATA PREPARATION</div><h1>PDF to text<span className="title-dot">.</span></h1><p>Bring in your CVs. Extract the text. Get ready for what’s next.</p></div><button className="button secondary guide-button" onClick={() => setHelp(!help)} aria-expanded={help}><HelpCircle size={15} />How it works</button></div>

        {help && <section className="help-panel"><div><strong>Three steps to extract CV text</strong><p>1. Select or drop your PDFs. 2. Click “Convert to text”. 3. Select a file to view, copy, or download its text.</p><p>Supports PDFs with a text layer. Scanned PDFs need OCR; pages without readable text are flagged. Text follows the PDF content order, so multi-column CVs may need a manual check.</p></div><button className="icon-button" aria-label="Close instructions" onClick={() => setHelp(false)}><X size={16} /></button></section>}

        <section className="upload-section" aria-label="Upload PDFs">
          <div className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'disabled' : ''}`} onDragEnter={event => { event.preventDefault(); if (!busy) { dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={drop}>
            <span className="upload-icon"><Upload size={22} strokeWidth={1.6} /></span><div className="upload-copy"><h2>Drop your PDF CVs here</h2><p>Select multiple files · Up to 20 MB each · 50 files per batch</p></div><button className="button primary browse-button" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} />Choose PDF files</button>
            <input ref={input} className="visually-hidden" type="file" accept=".pdf,application/pdf" multiple disabled={busy} aria-label="Choose PDF files" onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
          </div>
          <div className="upload-footnote"><span><ShieldCheck size={14} />Files stay in your browser and are never uploaded to a server.</span><span>Text-based PDFs supported</span></div>
        </section>

        {alerts.length > 0 && <div className="alert" role="alert"><CircleAlert size={16} /><div>{alerts.map((message, i) => <p key={i}>{message}</p>)}</div><button className="icon-button" aria-label="Dismiss errors" onClick={() => setAlerts([])}><X size={15} /></button></div>}

        <section className="workspace-panel" aria-label="PDF conversion">
          <div className="queue-panel">
            <div className="panel-heading"><h2>File queue <span className="count-badge">{documents.length}</span></h2>{documents.length > 0 && <button className="text-button" disabled={busy} onClick={() => { setDocuments([]); setSelectedId(null); setNotice(''); setAlerts([]); }}>Clear all</button>}</div>
            <div className="queue-list">
              {!documents.length ? <div className="queue-empty"><div className="empty-file-stack"><FileText size={30} strokeWidth={1.2} /></div><strong>No files yet</strong><p>Add your PDF CVs to start<br />extracting their text.</p></div> : documents.map(doc => <div className={`file-row ${selectedId === doc.id ? 'selected' : ''}`} key={doc.id}>
                <button className="file-select" onClick={() => setSelectedId(doc.id)} aria-pressed={selectedId === doc.id}><span className="file-symbol"><FileText size={18} /><small>PDF</small></span><span className="file-detail"><strong title={doc.file.name}>{doc.file.name}</strong><span>{sizeLabel(doc.file.size)}{doc.result ? ` · ${plural(doc.result.pages, 'page')}` : ''}</span><span className={`status ${doc.status}`}>{doc.status === 'processing' ? <LoaderCircle size={11} className="spin" /> : doc.status === 'done' ? <Check size={11} /> : ['scan', 'error'].includes(doc.status) ? <CircleAlert size={11} /> : <span className="status-dot" />}{labels[doc.status]}{doc.status === 'processing' && doc.total > 0 ? ` ${doc.finished}/${doc.total} pages` : ''}</span></span></button><button className="icon-button remove-file" disabled={busy} aria-label={`Remove ${doc.file.name}`} onClick={() => remove(doc.id)}><X size={14} /></button>
              </div>)}
            </div>
            <div className="queue-footer">{busy && <div className="batch-progress"><span>Processed {complete}/{documents.length} {documents.length === 1 ? 'file' : 'files'}</span><progress value={progress} max={100} aria-label="Batch progress" /></div>}<button className="button primary convert-button" disabled={!pending.length || busy} onClick={convert}>{busy ? <LoaderCircle size={16} className="spin" /> : <ScanText size={16} />}{busy ? 'Converting…' : 'Convert to text'}{!busy && <ArrowRight size={16} />}</button><p>{documents.length ? `${plural(pending.length, 'file')} ready to convert` : 'Add files to get started'}</p></div>
          </div>

          <div className="output-panel">
            <div className="panel-heading"><div className="output-title"><h2>Extracted text</h2><span className="format-label">TXT</span></div><div className="output-actions"><button className="icon-button" disabled={!selectedText} title="Copy text" aria-label="Copy text" onClick={copyText}><Copy size={15} /></button><button className="button secondary download-button" disabled={!selectedText} onClick={() => selected && download(selectedText, textName(selected.file.name))}><ArrowDownToLine size={15} />Download .txt</button></div></div>
            {selectedText ? <><div className="result-info"><FileText size={13} /><span title={selected?.file.name}>{selected?.file.name}</span><span>{plural(selected?.result?.pages ?? 0, 'page')}</span></div>{!!selected?.result?.emptyPages.length && <div className="inline-warning"><CircleAlert size={14} /><span>No text found on {selected.result.emptyPages.length === 1 ? 'page' : 'pages'} {selected.result.emptyPages.join(', ')}. These pages may need OCR.</span></div>}<textarea className="text-output" readOnly value={selectedText} aria-label="Text extracted from PDF" spellCheck={false} /><div className="output-footer"><span>{plural(selectedText.trim().split(/\s+/).length, 'word')}<span className="dot-divider">·</span>{plural(selectedText.length, 'character')}</span><span className="success-label"><Check size={12} />Extracted</span></div></> : <div className="output-empty" aria-live="polite">
              {selected?.status === 'processing' ? <><div className="preview-illustration"><LoaderCircle size={28} className="spin" /></div><h3>Reading your PDF</h3><p>{selected.total ? `Page ${selected.finished}/${selected.total}` : 'Opening file…'}</p></> : selected?.status === 'error' ? <><div className="preview-illustration warning"><CircleAlert size={28} /></div><h3>Unable to read this file</h3><p>{selected.error}</p><button className="button secondary" disabled={busy} onClick={() => patch(selected.id, { status: 'queued', finished: 0, total: 0, error: undefined })}>Try again</button></> : selected?.status === 'scan' ? <><div className="preview-illustration warning"><ScanText size={28} /></div><h3>This PDF needs OCR</h3><p>No text layer was found across {plural(selected.result?.pages ?? 0, 'page')}. Use a PDF with selectable text. OCR support can be added in the next step.</p></> : <><div className="preview-illustration"><div className="paper-icon"><span /><span /><span /><span /></div><span className="txt-sticker">Aa</span></div><h3>{selected ? 'Your file is ready' : 'Your text will appear here'}</h3><p>{selected ? 'Click “Convert to text” to extract content from your selected PDFs.' : 'Once converted, select a file to review its text, copy it, or download it as a .txt file.'}</p><span className="preview-hint"><FileText size={13} />PDF<ArrowRight size={13} /><span>Plain text</span></span></>}
            </div>}
          </div>
        </section>

        <div className="below-workspace"><div className="live-message" role="status">{notice || <><LockKeyhole size={13} />Results stay in this session. Download your text before closing the page.</>}</div>{ready.length > 1 && <button className="text-button download-all" onClick={() => download(ready.map(doc => `===== ${doc.file.name} =====\n\n${doc.result!.text}`).join('\n\n\n'), 'hr-scoring-text.txt')}><ArrowDownToLine size={14} />Download all text ({ready.length})</button>}</div>
        <footer className="page-footer"><span>HR SCORING</span><p>Better preparation. Smarter screening.</p></footer>
      </div>
    </main>
  </div>;
}
