import { FileText, LockKeyhole, ScanText } from 'lucide-react';
import HrIntern from './HrIntern';

export default function App() {
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#main"><span className="brand-mark"><ScanText size={20} /></span><span>HR Scoring<span className="brand-caption">Recruitment workspace</span></span></a>
      <div className="workspace-name"><span className="workspace-avatar">HR</span><span>HR Workspace<small>Recruitment workspace</small></span><LockKeyhole size={13} /></div>
      <p className="nav-label">POSITIONS</p>
      <nav aria-label="Positions"><a className="nav-item active" href="#main" aria-current="page"><FileText size={17} /><span>HR Intern</span></a></nav>
      <div className="sidebar-bottom"><div className="profile"><span className="profile-avatar">HR</span><div>HR Workspace<small>Candidate screening</small></div></div></div>
    </aside>
    <main id="main" className="main"><HrIntern /></main>
  </div>;
}
