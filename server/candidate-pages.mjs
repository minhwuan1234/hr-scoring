import {positionScope} from './positions.mjs';
import {candidateRow} from './candidates.mjs';
export const CANDIDATE_PAGE_SIZE=10;
const invalid=message=>Object.assign(new Error(message),{status:400});
export function candidateQuery(input={}){
 const page=String(input.page??'1');if(!/^[1-9]\d{0,6}$/.test(page))throw invalid('Choose a valid candidate page.');
 const range=candidateDateRange(input.period,input.date);
 const positionId=input.positionId??'',search=input.search??'',status=input.status??'all';
 if(typeof positionId!=='string'||positionId.length>100||typeof search!=='string'||search.length>300||!['all','pass','consider','rejected','review'].includes(status))throw invalid('Use valid candidate filters.');
 return {page:Number(page),positionId,search:search.trim().toLowerCase(),status,...range};
}
// Calendar weeks start Monday; all boundaries use Vietnam time (UTC+7).
export function candidateDateRange(period='all',date){
 if(period==='all')return {};
 if(!['week','month'].includes(period)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw invalid('Choose a valid calendar period.');
 const day=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date)throw invalid('Choose a valid calendar date.');
 if(period==='month')day.setUTCDate(1);else day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7));
 const from=day.getTime()-7*3600000;
 if(period==='month')day.setUTCMonth(day.getUTCMonth()+1);else day.setUTCDate(day.getUTCDate()+7);
 return {from,to:day.getTime()-7*3600000};
}
const outcome=c=>c.state!=='complete'?'review':c.total<=50?'rejected':c.total<70?'consider':'pass';
export function fileCandidatePage(rows,query,owner,exportAll=false){
 const catalog=new Map();for(const c of rows){const p=catalog.get(c.positionId);if(!p)catalog.set(c.positionId,{id:c.positionId,name:c.positionName,count:1,version:c.positionVersion});else{p.count++;if(c.positionVersion>p.version){p.name=c.positionName;p.version=c.positionVersion;}}}
 const positions=[...catalog.values()].map(({version,...p})=>p).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 const scope=rows.filter(c=>(!query.positionId||c.positionId===query.positionId)&&(query.from==null||c.createdAt>=query.from)&&(query.to==null||c.createdAt<query.to)),stats={all:scope.length,pass:0,consider:0,rejected:0,review:0};for(const c of scope)stats[outcome(c)]++;
 const filtered=scope.filter(c=>(query.status==='all'||outcome(c)===query.status)&&[c.candidateProfile?.name,c.candidateProfile?.email,c.candidateProfile?.phone,c.candidateProfile?.linkedinUrl,c.fileName,c.positionName].filter(Boolean).join(' ').toLowerCase().includes(query.search));
 filtered.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id)||positionScope(owner,{id:a.positionId,version:a.positionVersion}).localeCompare(positionScope(owner,{id:b.positionId,version:b.positionVersion})));
 const total=filtered.length,pages=Math.max(1,Math.ceil(total/CANDIDATE_PAGE_SIZE)),page=Math.min(query.page,pages);
 return {rows:exportAll?filtered:filtered.slice((page-1)*CANDIDATE_PAGE_SIZE,page*CANDIDATE_PAGE_SIZE),total,pages,page,pageSize:CANDIDATE_PAGE_SIZE,stats,positions};
}
// All counts, rows and available roles come from one PostgreSQL statement/snapshot.
// Only the limited page serializes dimensions and candidate profiles for the browser.
export async function postgresCandidatePage(client,owner,query,exportAll=false){
 const {rows}=await client.query(`WITH owned AS MATERIALIZED (
  SELECT $1::text AS workspace_id UNION SELECT scoring_workspace_id FROM hr_scoring_position_scopes WHERE owner_workspace_id=$1
 ), scoped AS NOT MATERIALIZED (
  SELECT c.* FROM hr_scoring_candidates c JOIN owned USING(workspace_id) WHERE ($2='' OR c.position_id=$2) AND ($6::bigint IS NULL OR c.created_at_ms >= $6) AND ($7::bigint IS NULL OR c.created_at_ms < $7)
 ), filtered AS NOT MATERIALIZED (
  SELECT c.* FROM scoped c WHERE ($3='' OR strpos(lower(concat_ws(' ',c.candidate_name,c.email,c.phone,c.linkedin_url,c.file_name,c.position_name)),$3)>0)
  AND ($4='all' OR CASE WHEN c.result_state<>'complete' THEN 'review' WHEN c.total<=50 THEN 'rejected' WHEN c.total<70 THEN 'consider' ELSE 'pass' END=$4)
 ), totals AS MATERIALIZED (SELECT count(*) AS total FROM filtered), pagination AS (
  SELECT total,greatest(1,ceil(total/10.0))::integer AS pages,least($5::integer,greatest(1,ceil(total/10.0))::integer) AS page FROM totals
 ) SELECT p.*,
  COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at_ms DESC,r.job_id,r.workspace_id) FROM (
   SELECT c.* FROM filtered c ORDER BY c.created_at_ms DESC,c.job_id,c.workspace_id LIMIT CASE WHEN $8::boolean THEN NULL ELSE 10 END OFFSET CASE WHEN $8::boolean THEN 0 ELSE (SELECT (page-1)*10 FROM pagination) END
  ) r),'[]'::jsonb) AS rows,
  (SELECT jsonb_build_object('all',count(*),'pass',count(*) FILTER(WHERE result_state='complete' AND total>=70),'consider',count(*) FILTER(WHERE result_state='complete' AND total>50 AND total<70),'rejected',count(*) FILTER(WHERE result_state='complete' AND total<=50),'review',count(*) FILTER(WHERE result_state<>'complete')) FROM scoped) AS stats,
  COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.name,r.id) FROM (
   SELECT c.position_id AS id,(array_agg(c.position_name ORDER BY c.position_version DESC,c.created_at_ms DESC,c.job_id))[1] AS name,count(*) AS count
   FROM hr_scoring_candidates c JOIN owned USING(workspace_id) GROUP BY c.position_id
  ) r),'[]'::jsonb) AS positions
 FROM pagination p`,[owner,query.positionId,query.search,query.status,query.page,query.from??null,query.to??null,exportAll]);
 const row=rows[0];return {rows:row.rows.map(candidateRow),total:Number(row.total),pages:Number(row.pages),page:Number(row.page),pageSize:CANDIDATE_PAGE_SIZE,stats:row.stats,positions:row.positions.map(p=>({...p,count:Number(p.count)}))};
}
