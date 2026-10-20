// A score view needs one job's public result, not any vectors or other CVs.
export async function readPublicJob(client,workspace,id){
 const {rows}=await client.query(`SELECT j.*,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.dimension_id,'max',s.max_score,'score',s.score) ORDER BY s.sort_order) FROM hr_scoring_dimension_scores s WHERE s.workspace_id=j.workspace_id AND s.job_id=j.job_id),'[]'::jsonb) AS dimensions,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.evidence_id,'quote',e.quote,'statement',e.statement,'reason',e.reason,'dimension',e.dimension_id,'band',e.band) ORDER BY e.sort_order) FROM hr_scoring_evidence e WHERE e.workspace_id=j.workspace_id AND e.job_id=j.job_id AND e.status='pending'),'[]'::jsonb) AS pending
  FROM hr_scoring_jobs j WHERE j.workspace_id=$1 AND j.job_id=$2 AND NOT EXISTS(SELECT 1 FROM hr_scoring_deleted_candidates d WHERE d.workspace_id=j.workspace_id AND d.job_id=j.job_id)`,[workspace,id]);
 const row=rows[0];if(!row)return undefined;
 return {id:row.job_id,createdAt:Number(row.created_at_ms),scoringUnit:row.scoring_unit,scoringFormula:row.scoring_formula,embeddingModel:row.embedding_model,...(row.candidate_profile?{candidateProfile:row.candidate_profile}:{}),result:{id:row.job_id,state:row.result_state,version:row.result_version==null?undefined:Number(row.result_version),total:Number(row.total),dimensions:row.dimensions,pending:row.pending,details:[]}};
}
