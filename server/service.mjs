import { SCORING_UNIT } from './sentences.mjs';
import { randomUUID } from 'node:crypto';
import { RUBRIC, getBand } from './rubric.mjs';
import { SCORING_FORMULA, calculate, nearest, validateDecision, validateEvidence } from './engine.mjs';
import { EMBEDDING_MODEL, embed, extractEvidence } from './openai.mjs';

export function createScoringService(store, provider = { embed, extractEvidence }, embeddingModel = EMBEDDING_MODEL) {
  let baseline;
  const threshold = Number(process.env.MATCH_THRESHOLD || 0.82);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('MATCH_THRESHOLD must be between 0 and 1.');

  async function initialReferences() {
    if (!baseline) baseline = (async () => {
      const records = RUBRIC.flatMap(d => d.bands.map(([min,max,statement],band) => ({ id:`rubric-${d.id}-${band}`, dimension:d.id, band, cap:max, statement, source:'user-rubric', embeddingModel })));
      const vectors = await provider.embed(records.map(record => record.statement));
      return records.map((record,index) => ({ ...record, vector:vectors[index] }));
    })().catch(error => { baseline = undefined; throw error; });
    return baseline;
  }

  function publicJob(job) {
    const { details, pending, ...result } = job.result;
    return { ...result, pending: pending.map(({id,quote,statement,reason,dimension,band}) => ({id,quote,statement,reason,dimension,band,cap:getBand(dimension,band)[1]})) };
  }

  async function analyze(workspace, text) {
    if (typeof text !== 'string' || text.trim().length < 10 || text.length > 100000) throw Object.assign(new Error('Use a CV containing 10–100,000 characters of readable text.'), { status:400 });
    const output = validateEvidence(await provider.extractEvidence(text), text);
    const vectors = await provider.embed(output.map(item => item.statement));
    const seeds = await initialReferences();
    return store.update(workspace, state => {
      const now = Date.now();
      for (const [id,job] of Object.entries(state.jobs)) if (now - job.createdAt > 24 * 3600000) delete state.jobs[id];
      const jobs = Object.values(state.jobs).sort((a,b) => a.createdAt - b.createdAt);
      while (jobs.length >= 20) delete state.jobs[jobs.shift().id];
      // Embedding spaces cannot be mixed when a configured model changes.
      if (!state.references.some(ref => ref.embeddingModel === embeddingModel)) state.references.push(...structuredClone(seeds));
      const job = { id:randomUUID(), scoringUnit:SCORING_UNIT, scoringFormula:SCORING_FORMULA, createdAt:now, embeddingModel, referenceVersion:state.version, evidence: output.map((item,index) => {
        const mapping = state.mappings[item.key];
        const evidence = { ...item, id:randomUUID(), vector:vectors[index], status:'pending' };
        if (mapping?.action === 'reject') return { ...evidence, status:'rejected' };
        if (mapping?.dimension) {
          evidence.dimension = mapping.dimension;
        }
        const match = nearest(evidence,state.references,embeddingModel);
        if (match) evidence.band = match.ref.band;
        if (match && match.similarity > 0 && match.similarity >= threshold) {
          evidence.status = 'approved';
          evidence.referenceId = match.ref.id;
        }
        return evidence;
      }) };
      job.result = calculate(job,state.references,embeddingModel);
      state.jobs[job.id] = job;
      return publicJob(job);
    });
  }

  async function review(workspace, jobId, decisions) {
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > 36) throw Object.assign(new Error('Provide review decisions.'), { status:400 });
    decisions.forEach(validateDecision);
    if (new Set(decisions.map(decision => decision.id)).size !== decisions.length) throw Object.assign(new Error('Duplicate decisions are not allowed.'), { status:400 });
    return store.update(workspace, async state => {
      const job = state.jobs[jobId];
      if (!job || Date.now() - job.createdAt > 24 * 3600000) throw Object.assign(new Error('This review has expired. Please score the CV again.'), { status:404 });
      if (job.scoringUnit !== SCORING_UNIT) throw Object.assign(new Error('Scoring now uses full sentences. Please upload and score this CV again.'), { status:409 });
      if (job.scoringFormula !== SCORING_FORMULA) throw Object.assign(new Error('Scoring rules changed. Please upload and score this CV again.'), { status:409 });
      if (job.embeddingModel !== embeddingModel) throw Object.assign(new Error('The embedding configuration changed. Please score the CV again.'), { status:409 });
      if (decisions.some(decision => !job.evidence.some(item => item.id === decision.id && item.status === 'pending'))) throw Object.assign(new Error('This review changed. Reload the result and try again.'), { status:409 });
      const approved = decisions.filter(decision => decision.action === 'approve');
      const vectors = await provider.embed(approved.map(decision => decision.statement.trim()));
      for (const decision of decisions) {
        const item = job.evidence.find(item => item.id === decision.id);
        item.status = decision.action === 'approve' ? 'approved' : 'rejected';
        if (decision.action === 'approve') {
          item.dimension = decision.dimension;
          item.band = decision.band;
          const ref = { id:randomUUID(), dimension:decision.dimension, band:decision.band, cap:decision.cap, statement:decision.statement.trim(), vector:vectors[approved.indexOf(decision)], embeddingModel, source:'human', approvedAt:new Date().toISOString() };
          state.references.push(ref);
          item.referenceId = ref.id;
          state.mappings[item.key] = { action:'approve', dimension:decision.dimension, referenceId:ref.id };
        } else state.mappings[item.key] = { action:'reject' };
      }
      state.version++;
      job.referenceVersion = state.version;
      job.result = calculate(job,state.references,embeddingModel);
      return publicJob(job);
    });
  }

  async function get(workspace,id) {
    return store.update(workspace,state => {
      const job = state.jobs[id];
      if (!job || Date.now() - job.createdAt > 24 * 3600000) throw Object.assign(new Error('This review has expired. Please score the CV again.'), { status:404 });
      if (job.scoringUnit !== SCORING_UNIT) throw Object.assign(new Error('Scoring now uses full sentences. Please upload and score this CV again.'), { status:409 });
      if (job.scoringFormula !== SCORING_FORMULA) throw Object.assign(new Error('Scoring rules changed. Please upload and score this CV again.'), { status:409 });
      return publicJob(job);
    });
  }
  return { analyze, review, get };
}
