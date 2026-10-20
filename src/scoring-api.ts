import type {Criterion} from './positions';
export interface EvidenceReview {
  id: string; quote: string; statement: string; reason: string;
  dimension: string; band: number; cap: number;
}
export interface CandidateProfile {name:string|null;phone:string|null;email:string|null;linkedinUrl:string|null}
export interface ScoreResult {
  candidateProfile?:CandidateProfile;
  position?: {id:string;version:number;name:string;rubric:Pick<Criterion,'id'|'title'|'max'|'bands'>[]};
  id: string; state: 'review' | 'complete'; version: number; total: number;
  dimensions: { id: string; max: number; score: number }[];
  pending: EvidenceReview[];
}
export interface ReviewDecision {
  id: string; action: 'approve' | 'reject'; dimension: string; band: number; cap: number; statement: string;
}

function workspaceToken() {
  let token = localStorage.getItem('hr-scoring-workspace-v1');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    token = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('hr-scoring-workspace-v1',token);
  }
  return token;
}

export async function scoringRequest<T>(path: string, payload?: unknown, timeoutMs = 420000): Promise<T> {
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type':'application/json', 'X-Workspace-Token':workspaceToken() },
    ...(payload === undefined ? {} : { body:JSON.stringify(payload) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({error:'Scoring is unavailable. Please try again shortly.'}));
  if (!response.ok) {
    const reference=response.status>=500&&typeof data.requestId==='string'&&/^[a-f0-9-]{36}$/.test(data.requestId)?` (Error ID: ${data.requestId})`:'';
    throw Object.assign(new Error((data.error || 'Scoring could not complete. Please retry.')+reference),{status:response.status});
  }
  return data as T;
}

export async function candidateCvRequest(id:string,positionId:string,positionVersion:number,file?:File,signal?:AbortSignal):Promise<Response>{
 const response=await fetch(`/api/jobs/${encodeURIComponent(id)}/cv?positionId=${encodeURIComponent(positionId)}&positionVersion=${positionVersion}`,{method:file?'POST':'GET',headers:{'X-Workspace-Token':workspaceToken(),...(file?{'Content-Type':'application/pdf'}:{})},...(file?{body:file}:{}),signal:signal || AbortSignal.timeout(120000)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error || 'Unable to access the original CV. Please retry.');}
 return response;
}
