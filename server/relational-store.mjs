import {persistPositionCatalog} from './position-store.mjs';
import {archiveCandidates,candidateRow} from './candidates.mjs';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { RUBRIC } from './rubric.mjs';

export const SCHEMA_VERSION = 'candidate-deletion-v6';
export const emptyWorkspace = () => ({version:1,references:[],mappings:{},jobs:{}});
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const identity = ref => JSON.stringify([ref.id,ref.embeddingModel]);
const numeric = value => value == null ? undefined : Number(value);

export async function loadRelationalWorkspace(client,id,{syncLegacy=true,scoringOnly=false,jobId,embeddingModel,mappingKeys}={}) {
  const metadata = (await client.query('SELECT version,legacy_fingerprint FROM hr_scoring_workspaces WHERE workspace_id=$1',[id])).rows[0];
  // Compatibility bridge: rolling deployments may briefly include an older
  // server writing the old table under the same per-workspace advisory lock.
  if (syncLegacy) {
    const legacy = (await client.query('SELECT payload,md5(payload::text) AS fingerprint FROM hr_scoring_workspace_state WHERE workspace_id=$1',[id])).rows[0];
    if (legacy && legacy.fingerprint !== metadata?.legacy_fingerprint) {
      const previous = await loadRelationalWorkspace(client,id,{syncLegacy:false});
      await writeRelationalWorkspace(client,id,legacy.payload,previous);
      return loadRelationalWorkspace(client,id,{syncLegacy:false});
    }
  }
  if (!metadata) return emptyWorkspace();
  const state = {...emptyWorkspace(),version:metadata.version};
  if(!scoringOnly){
  const positions=await client.query('SELECT definition FROM hr_scoring_positions WHERE workspace_id=$1 ORDER BY position_id,version',[id]);
  if(positions.rows.length){state.positions={};for(const {definition} of positions.rows)(state.positions[definition.id]??=[]).push(definition);}
  const candidates=await client.query('SELECT * FROM hr_scoring_candidates WHERE workspace_id=$1',[id]);
  state.candidates=Object.fromEntries(candidates.rows.map(row=>[row.job_id,candidateRow(row)]));
  const deleted=await client.query('SELECT job_id,details FROM hr_scoring_deleted_candidates WHERE workspace_id=$1',[id]);
  if(deleted.rows.length)state.deletedCandidates=Object.fromEntries(deleted.rows.map(row=>[row.job_id,row.details || {}]));
  }
  const refs = await client.query(`SELECT * FROM hr_scoring_references WHERE workspace_id=$1${scoringOnly?' AND embedding_model=$2':''} ORDER BY sort_order,reference_id,embedding_model`,scoringOnly?[id,embeddingModel]:[id]);
  state.references = refs.rows.map(row=>({id:row.reference_id,dimension:row.dimension_id,band:row.band,cap:Number(row.cap),statement:row.context,vector:row.embedding,source:row.source,...(row.source_job_id?{sourceJobId:row.source_job_id}:{}),embeddingModel:row.embedding_model,...(row.approved_at ? {approvedAt:new Date(row.approved_at).toISOString()} : {})}));
  const decisions = await client.query(`SELECT * FROM hr_scoring_sentence_decisions WHERE workspace_id=$1${scoringOnly?(jobId?' AND sentence_key IN (SELECT sentence_key FROM hr_scoring_evidence WHERE workspace_id=$1 AND job_id=$2)':' AND sentence_key=ANY($2::text[])'):''} ORDER BY sentence_key`,scoringOnly?[id,jobId || mappingKeys || []]:[id]);
  for (const row of decisions.rows) state.mappings[row.sentence_key] = row.action === 'reject' ? {action:'reject',...(row.source_job_id?{sourceJobId:row.source_job_id}:{})} : {action:'approve',dimension:row.dimension_id,referenceId:row.reference_id,...(row.source_job_id?{sourceJobId:row.source_job_id}:{})};
  if(scoringOnly&&!jobId)return state;
  const jobs = await client.query(`SELECT * FROM hr_scoring_jobs WHERE workspace_id=$1${scoringOnly?' AND job_id=$2':''} ORDER BY created_at_ms,job_id`,scoringOnly?[id,jobId]:[id]);
  for (const row of jobs.rows) {
    const job = {id:row.job_id,...(row.candidate_profile?{candidateProfile:row.candidate_profile}:{}),...(row.file_name?{fileName:row.file_name}:{}),createdAt:Number(row.created_at_ms),embeddingModel:row.embedding_model,referenceVersion:row.reference_version,evidence:[],...(row.scoring_unit ? {scoringUnit:row.scoring_unit} : {}),...(row.scoring_formula ? {scoringFormula:row.scoring_formula} : {}),...(row.position_snapshot ? {position:row.position_snapshot} : {})};
    job.result = {id:job.id,state:row.result_state,version:numeric(row.result_version),total:Number(row.total),dimensions:[],pending:[],details:[]};
    state.jobs[job.id]=job;
  }
  const evidence = await client.query(`SELECT * FROM hr_scoring_evidence WHERE workspace_id=$1${scoringOnly?' AND job_id=$2':''} ORDER BY job_id,sort_order`,scoringOnly?[id,jobId]:[id]);
  for (const row of evidence.rows) {
    const job=state.jobs[row.job_id];
    const item={id:row.evidence_id,key:row.sentence_key,quote:row.quote,statement:row.statement,reason:row.reason,dimension:row.dimension_id,band:row.band,vector:row.embedding,status:row.status,...(row.sentence_id ? {sentenceId:row.sentence_id} : {}),...(row.reference_id ? {referenceId:row.reference_id} : {})};
    if (row.ceiling_fulfillment != null) item.assessment={referenceId:row.reference_id,fulfillment:row.ceiling_fulfillment,reason:row.assessment_reason,model:row.assessment_model};
    job.evidence.push(item);
    if(item.status === 'pending') job.result.pending.push(item);
    if(row.score != null) job.result.details.push({key:item.key,dimension:item.dimension,referenceId:row.reference_id,similarity:row.match_similarity,floor:Number(row.score_floor),cap:Number(row.score_cap),score:Number(row.score),...(row.ceiling_fulfillment == null ? {} : {fulfillment:row.ceiling_fulfillment})});
  }
  const scores = await client.query(`SELECT * FROM hr_scoring_dimension_scores WHERE workspace_id=$1${scoringOnly?' AND job_id=$2':''} ORDER BY job_id,sort_order`,scoringOnly?[id,jobId]:[id]);
  for(const row of scores.rows) state.jobs[row.job_id].result.dimensions.push({id:row.dimension_id,max:Number(row.max_score),score:Number(row.score)});
  return state;
}

export async function writeRelationalWorkspace(client,id,state,previous=emptyWorkspace()) {
  await client.query('INSERT INTO hr_scoring_workspaces(workspace_id,version) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET version=EXCLUDED.version,updated_at=NOW()',[id,state.version]);
  // Position versions are immutable. Older replicas may omit them from the
  // compatibility snapshot; never delete them when importing such snapshots.
  if(previous.positions)state.positions??=previous.positions;
  if(state.positions)await persistPositionCatalog(client,id,state.positions);
  const deleted=await client.query('SELECT job_id,details FROM hr_scoring_deleted_candidates WHERE workspace_id=$1',[id]);
  if(deleted.rows.length||state.deletedCandidates||previous.deletedCandidates)state.deletedCandidates={...previous.deletedCandidates,...state.deletedCandidates,...Object.fromEntries(deleted.rows.map(row=>[row.job_id,row.details || {}]))};
  const incomingRefs=new Set(state.references.map(r=>r.id));
  const cleanupEntries=Object.entries(state.deletedCandidates || {}).filter(([jobId,details])=>!previous.deletedCandidates?.[jobId]||state.jobs[jobId]||state.candidates?.[jobId]||(details?.referenceIds || []).some(id=>incomingRefs.has(id))||(details?.sentenceKeys || []).some(key=>state.mappings[key]));
  for(const [jobId] of cleanupEntries){
    await client.query('INSERT INTO hr_scoring_deleted_candidates(workspace_id,job_id,details) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,jobId,JSON.stringify(state.deletedCandidates[jobId])]);
    await client.query('DELETE FROM hr_scoring_jobs WHERE workspace_id=$1 AND job_id=$2',[id,jobId]);
    await client.query('DELETE FROM hr_scoring_candidates WHERE workspace_id=$1 AND job_id=$2',[id,jobId]);
  }
  state.candidates??=previous.candidates;
  archiveCandidates(state);
  for(const c of Object.values(state.candidates || {})){
    if(isDeepStrictEqual(c,previous.candidates?.[c.id]))continue;
    await client.query(`INSERT INTO hr_scoring_candidates(workspace_id,job_id,file_name,position_id,position_version,position_name,created_at_ms,updated_at_ms,result_state,total,pending_count,dimensions,candidate_name,phone,email,linkedin_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(workspace_id,job_id) DO UPDATE SET file_name=EXCLUDED.file_name,updated_at_ms=EXCLUDED.updated_at_ms,result_state=EXCLUDED.result_state,total=EXCLUDED.total,pending_count=EXCLUDED.pending_count,dimensions=EXCLUDED.dimensions,candidate_name=COALESCE(EXCLUDED.candidate_name,hr_scoring_candidates.candidate_name),phone=COALESCE(EXCLUDED.phone,hr_scoring_candidates.phone),email=COALESCE(EXCLUDED.email,hr_scoring_candidates.email),linkedin_url=COALESCE(EXCLUDED.linkedin_url,hr_scoring_candidates.linkedin_url)`,[id,c.id,c.fileName,c.positionId,c.positionVersion,c.positionName,c.createdAt,c.updatedAt,c.state,c.total,c.pendingCount,JSON.stringify(c.dimensions),c.candidateProfile?.name || null,c.candidateProfile?.phone || null,c.candidateProfile?.email || null,c.candidateProfile?.linkedinUrl || null]);
  }
  if(cleanupEntries.length){
    const tables=['hr_scoring_schema_backups'];if((await client.query("SELECT to_regclass('hr_scoring_test_data_archive') AS name")).rows[0]?.name)tables.push('hr_scoring_test_data_archive');
    for(const table of tables)for(const [jobId,details] of cleanupEntries){
      await client.query(`UPDATE ${table} SET payload=(payload #- ARRAY['jobs',$2] #- ARRAY['candidates',$2]) WHERE workspace_id=$1`,[id,jobId]);
      for(const key of details?.sentenceKeys || [])await client.query(`UPDATE ${table} SET payload=payload #- ARRAY['mappings',$2] WHERE workspace_id=$1`,[id,key]);
      const refs=details?.referenceIds || [];if(refs.length)await client.query(`UPDATE ${table} SET payload=jsonb_set(payload,'{references}',COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(payload->'references') r WHERE NOT (r->>'id'=ANY($2::text[]))),'[]'::jsonb)) WHERE workspace_id=$1 AND jsonb_typeof(payload->'references')='array'`,[id,refs]);
    }
  }
  const priorRefs=new Map(previous.references.map(ref=>[identity(ref),ref]));
  for(const [index,ref] of state.references.entries()) {
    if(equal(ref,priorRefs.get(identity(ref))) && previous.references[index]?.id === ref.id && previous.references[index]?.embeddingModel === ref.embeddingModel) continue;
    const bandRow=(await client.query('SELECT floor,ceiling FROM hr_scoring_bands WHERE dimension_id=$1 AND band=$2',[ref.dimension,ref.band])).rows[0];
    if(!bandRow)throw new Error('Reference band not found.');
    const floor=Number(bandRow.floor),ceiling=Number(bandRow.ceiling);
    await client.query(`INSERT INTO hr_scoring_references(workspace_id,reference_id,embedding_model,dimension_id,band,floor,band_ceiling,cap,context,embedding,source,approved_at,sort_order,source_job_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(workspace_id,reference_id,embedding_model) DO UPDATE SET dimension_id=EXCLUDED.dimension_id,band=EXCLUDED.band,floor=EXCLUDED.floor,band_ceiling=EXCLUDED.band_ceiling,cap=EXCLUDED.cap,context=EXCLUDED.context,embedding=EXCLUDED.embedding,source=EXCLUDED.source,approved_at=EXCLUDED.approved_at,sort_order=EXCLUDED.sort_order,source_job_id=EXCLUDED.source_job_id`,
      [id,ref.id,ref.embeddingModel,ref.dimension,ref.band,floor,ceiling,ref.cap,ref.statement,ref.vector,ref.source,ref.approvedAt || null,index,ref.sourceJobId || null]);
  }
  for(const key of Object.keys(previous.mappings)) if(!state.mappings[key]) await client.query('DELETE FROM hr_scoring_sentence_decisions WHERE workspace_id=$1 AND sentence_key=$2',[id,key]);
  for(const [key,decision] of Object.entries(state.mappings)) {
    if(equal(decision,previous.mappings[key])) continue;
    const ref=decision.action === 'approve' ? state.references.find(ref=>ref.id === decision.referenceId) : null;
    if(decision.action === 'approve' && !ref) throw new Error('Approved sentence reference not found.');
    await client.query(`INSERT INTO hr_scoring_sentence_decisions(workspace_id,sentence_key,action,dimension_id,reference_id,reference_model,source_job_id) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(workspace_id,sentence_key) DO UPDATE SET action=EXCLUDED.action,dimension_id=EXCLUDED.dimension_id,reference_id=EXCLUDED.reference_id,reference_model=EXCLUDED.reference_model,source_job_id=EXCLUDED.source_job_id,updated_at=NOW()`,
      [id,key,decision.action,decision.action === 'approve' ? decision.dimension : null,ref?.id || null,ref?.embeddingModel || null,decision.sourceJobId || null]);
  }
  for(const jobId of Object.keys(previous.jobs)) if(!state.jobs[jobId]) await client.query('DELETE FROM hr_scoring_jobs WHERE workspace_id=$1 AND job_id=$2',[id,jobId]);
  for(const job of Object.values(state.jobs)) {
    if(equal(job,previous.jobs[job.id])) continue;
    const result=job.result;
    await client.query(`INSERT INTO hr_scoring_jobs(workspace_id,job_id,created_at_ms,embedding_model,reference_version,scoring_unit,scoring_formula,result_version,result_state,total,position_id,position_version,position_snapshot,file_name,candidate_profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(workspace_id,job_id) DO UPDATE SET reference_version=EXCLUDED.reference_version,scoring_unit=EXCLUDED.scoring_unit,scoring_formula=EXCLUDED.scoring_formula,result_version=EXCLUDED.result_version,result_state=EXCLUDED.result_state,total=EXCLUDED.total,position_id=EXCLUDED.position_id,position_version=EXCLUDED.position_version,position_snapshot=EXCLUDED.position_snapshot,file_name=EXCLUDED.file_name,candidate_profile=COALESCE(EXCLUDED.candidate_profile,hr_scoring_jobs.candidate_profile)`,
      [id,job.id,job.createdAt,job.embeddingModel,job.referenceVersion,job.scoringUnit || null,job.scoringFormula || null,result.version ?? null,result.state,result.total,job.position?.id || null,job.position?.version || null,job.position ? JSON.stringify(job.position) : null,job.fileName || null,job.candidateProfile?JSON.stringify(job.candidateProfile):null]);
    // Replace this job's children atomically, leaving other jobs/references intact.
    await client.query('DELETE FROM hr_scoring_evidence WHERE workspace_id=$1 AND job_id=$2',[id,job.id]);
    await client.query('DELETE FROM hr_scoring_dimension_scores WHERE workspace_id=$1 AND job_id=$2',[id,job.id]);
    for(const [index,item] of job.evidence.entries()) {
      const detail=result.details.find(detail=>detail.key === item.key);
      const selectedId=item.referenceId || detail?.referenceId || null;
      if(item.assessment && item.assessment.referenceId !== selectedId) throw new Error('Ceiling assessment reference does not match selection.');
      await client.query(`INSERT INTO hr_scoring_evidence(workspace_id,job_id,evidence_id,sentence_id,sentence_key,quote,statement,reason,dimension_id,band,embedding_model,embedding,status,reference_id,match_similarity,ceiling_fulfillment,assessment_reason,assessment_model,score_floor,score_cap,score,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [id,job.id,item.id,item.sentenceId || null,item.key,item.quote,item.statement,item.reason,item.dimension,item.band,job.embeddingModel,item.vector,item.status,selectedId,detail?.similarity ?? null,item.assessment?.fulfillment ?? detail?.fulfillment ?? null,item.assessment?.reason || null,item.assessment?.model || null,detail?.floor ?? null,detail?.cap ?? null,detail?.score ?? null,index]);
    }
    for(const [index,score] of result.dimensions.entries()) await client.query('INSERT INTO hr_scoring_dimension_scores(workspace_id,job_id,dimension_id,max_score,score,sort_order) VALUES($1,$2,$3,$4,$5,$6)',[id,job.id,score.id,score.max,score.score,index]);
  }
  const currentRefs=new Set(state.references.map(identity));
  for(const ref of previous.references) if(!currentRefs.has(identity(ref))) await client.query('DELETE FROM hr_scoring_references WHERE workspace_id=$1 AND reference_id=$2 AND embedding_model=$3',[id,ref.id,ref.embeddingModel]);
  // Retained for rolling deployment compatibility and rollback; the active
  // application reads references, decisions, jobs and evidence from their tables.
  const snapshot=JSON.stringify(state);
  await client.query('INSERT INTO hr_scoring_workspace_state(workspace_id,payload) VALUES($1,$2) ON CONFLICT(workspace_id) DO UPDATE SET payload=EXCLUDED.payload',[id,snapshot]);
  await client.query('UPDATE hr_scoring_workspaces SET legacy_fingerprint=md5($2::jsonb::text) WHERE workspace_id=$1',[id,snapshot]);
}

export async function initializeRelationalSchema(client) {
  await client.query(await readFile(new URL('./schema/relational.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('./schema/positions.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('./schema/candidates.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('./schema/profiles.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('./schema/cv-files.sql',import.meta.url),'utf8'));
  await client.query(await readFile(new URL('./schema/candidate-deletion.sql',import.meta.url),'utf8'));
  const applied=await client.query('SELECT schema_version FROM hr_scoring_schema_migrations WHERE schema_version=$1',[SCHEMA_VERSION]);
  if(applied.rows.length) return;
  await client.query('LOCK TABLE hr_scoring_workspace_state IN ACCESS EXCLUSIVE MODE');
  for(const [index,dimension] of RUBRIC.entries()) {
    await client.query('INSERT INTO hr_scoring_dimensions(dimension_id,max_score,sort_order) VALUES($1,$2,$3) ON CONFLICT(dimension_id) DO UPDATE SET max_score=EXCLUDED.max_score,sort_order=EXCLUDED.sort_order',[dimension.id,dimension.max,index]);
    for(const [band,[floor,ceiling,guide]] of dimension.bands.entries()) await client.query('INSERT INTO hr_scoring_bands(dimension_id,band,floor,ceiling,guide) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dimension_id,band) DO UPDATE SET floor=EXCLUDED.floor,ceiling=EXCLUDED.ceiling,guide=EXCLUDED.guide',[dimension.id,band,floor,ceiling,guide]);
  }
  const legacy=await client.query('SELECT workspace_id,payload FROM hr_scoring_workspace_state ORDER BY workspace_id');
  for(const row of legacy.rows) {
    await client.query('INSERT INTO hr_scoring_schema_backups(schema_version,workspace_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[SCHEMA_VERSION,row.workspace_id,JSON.stringify(row.payload)]);
    await writeRelationalWorkspace(client,row.workspace_id,row.payload);
  }
  await client.query('INSERT INTO hr_scoring_schema_migrations(schema_version) VALUES($1)',[SCHEMA_VERSION]);
}
