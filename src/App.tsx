import {useCallback,useEffect,useState} from 'react';
import {FileText,Plus,ScanText,Settings2,Copy,LoaderCircle,LayoutDashboard} from 'lucide-react';
import ScoringWorkspace from './HrIntern';
import PositionDialog from './PositionDialog';
import {scoringRequest} from './scoring-api';
import {positionKey,type PositionTemplate,type PositionDraft} from './positions';
import './positions.css';
import Dashboard,{useCandidateHistory} from './CandidateHistory';
export default function App(){
 const [positions,setPositions]=useState<PositionTemplate[]>([]),[selectedId,setSelectedId]=useState(()=>{try{return localStorage.getItem('hr-scoring-selected-position')||'hr-intern';}catch{return 'hr-intern';}});
 const history=useCandidateHistory(selectedId==='dashboard'?'':selectedId);
 const [opened,setOpened]=useState<Record<string,PositionTemplate>>({});
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [setup,setSetup]=useState<{mode:'create'|'edit'|'duplicate';initial?:PositionTemplate}|null>(null);
 const selected=positions.find(p=>p.id===selectedId),activeKey=selected?positionKey(selected):'';
 const onBusyChange=useCallback((value:boolean)=>setBusy(value),[]);
 useEffect(()=>{document.title=selected?`${selected.name} · HR Scoring`:selectedId==='dashboard'?'Dashboard · HR Scoring':'HR Scoring';},[selected,selectedId]);
 async function load(){setLoading(true);setError('');try{const rows=await scoringRequest<PositionTemplate[]>('/api/positions');setPositions(rows);setSelectedId(id=>id==='dashboard'||rows.some(p=>p.id===id)?id:rows[0].id);}catch(err){setError(err instanceof Error?err.message:'Unable to load positions.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(selected){setOpened(current=>({...current,[positionKey(selected)]:selected}));try{localStorage.setItem('hr-scoring-selected-position',selected.id);}catch{/* Active navigation still works. */}}},[selected]);
 async function save(draft:PositionDraft){const path=setup?.mode==='edit'?`/api/positions/${setup.initial!.id}`:'/api/positions';const position=await scoringRequest<PositionTemplate>(path,draft);setPositions(current=>current.some(p=>p.id===position.id)?current.map(p=>p.id===position.id?position:p):[...current,position]);setSelectedId(position.id);setSetup(null);}
 return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#main"><span className="brand-mark"><ScanText size={20}/></span><span>HR Scoring<span className="brand-caption">Recruitment workspace</span></span></a><button className={`nav-item dashboard-nav ${selectedId==='dashboard'?'active':''}`} aria-current={selectedId==='dashboard'?'page':undefined} disabled={busy} onClick={()=>{setSelectedId('dashboard');try{localStorage.setItem('hr-scoring-selected-position','dashboard');}catch{/* Navigation works without storage. */}}}><LayoutDashboard size={17}/><span>Dashboard</span></button><p className="nav-label">POSITIONS</p><nav className="position-nav" aria-label="Positions">{positions.map(position=><button key={position.id} className={`nav-item ${selectedId===position.id?'active':''}`} aria-current={selectedId===position.id?'page':undefined} disabled={busy} onClick={()=>setSelectedId(position.id)}><FileText size={17}/><span title={position.name}>{position.name}</span></button>)}</nav><button className="text-button add-position" disabled={busy||loading||!!error} onClick={()=>setSetup({mode:'create'})}><Plus size={14}/>Add position</button><div className="sidebar-bottom"><div className="profile"><span className="profile-avatar">HR</span><div>HR Workspace<small>Candidate screening</small></div></div></div></aside>
 <main id="main" className="main">{loading?<div className="positions-loading" role="status"><LoaderCircle size={18} className="spin"/>Loading positions…</div>:error?<div className="positions-loading" role="alert"><p>{error}</p><button className="text-button" onClick={()=>void load()}>Try again</button></div>:<>{selectedId==='dashboard'&&<Dashboard data={history}/ >}{selected&&<div className="position-tools"><button className="text-button" disabled={busy} onClick={()=>setSetup({mode:'duplicate',initial:selected})}><Copy size={13}/>Duplicate</button><button className="text-button" disabled={busy} onClick={()=>setSetup({mode:'edit',initial:selected})}><Settings2 size={13}/>Edit template</button></div>}{Object.entries(opened).map(([key,position])=><div key={key} className="position-screen" hidden={key!==activeKey}><ScoringWorkspace history={history} position={position} active={key===activeKey} onBusyChange={onBusyChange}/></div>)}</>}</main>
 {setup&&<PositionDialog mode={setup.mode} initial={setup.initial} templates={positions} onSave={save} onClose={()=>setSetup(null)}/>}
 </div>;
}
