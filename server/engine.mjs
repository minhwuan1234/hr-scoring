import { RUBRIC, getBand } from './rubric.mjs';

import { cvSentences, sentenceKey } from './sentences.mjs';
export { normalize } from './sentences.mjs';
export const SCORING_FORMULA = 'band-interpolation-v1';

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) throw new Error('Incompatible embeddings.');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Invalid embedding.');
    dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  return aa && bb ? Math.max(0, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}

export function nearest(evidence, references, embeddingModel) {
  return references.filter(ref => ref.dimension === evidence.dimension && ref.embeddingModel === embeddingModel && (!evidence.referenceId || ref.id === evidence.referenceId))
    .map(ref => ({ ref, similarity: cosine(evidence.vector, ref.vector) }))
    .sort((a,b) => b.similarity - a.similarity)[0];
}

export function validateEvidence(output, cvText) {
  if (!Array.isArray(output?.evidence) || output.evidence.length > 36) throw new Error('The model returned invalid evidence.');
  const sentences = new Map(cvSentences(cvText).map(sentence => [sentence.sentenceId,sentence]));
  const seen = new Set();
  return output.evidence.map(item => {
    if (!item || ['sentenceId','statement','reason'].some(key => typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 2500)) throw new Error('The model returned invalid sentence evidence.');
    if (!Number.isInteger(item.band)) throw new Error('The model returned an invalid rubric band.');
    getBand(item.dimension, item.band);
    const sentence = sentences.get(item.sentenceId);
    if (!sentence) throw new Error('A model evidence sentence could not be verified against the CV. Please retry.');
    // Only server-defined full sentences can be selected. Model fragments and
    // several proposed dimensions for one sentence collapse to the first item.
    return { sentenceId:sentence.sentenceId, quote:sentence.quote, key:sentence.key,
      statement:item.statement, reason:item.reason, dimension:item.dimension, band:item.band };
  }).filter(item => { if (seen.has(item.key)) return false; seen.add(item.key); return true; });
}

export function calculate(job, references, embeddingModel) {
  const details = [];
  const used = new Set();
  for (const evidence of job.evidence) {
    const key = sentenceKey(evidence.quote);
    if (used.has(key) || evidence.status !== 'approved') continue;
    used.add(key);
    const match = nearest(evidence, references, embeddingModel);
    if (!match) continue;
    // Stage 1 selects the closest reference. Stage 2 reuses its cosine
    // similarity to interpolate between that band's floor and this cap.
    const floor = getBand(match.ref.dimension,match.ref.band)[0];
    const cap = match.ref.cap;
    if (!Number.isFinite(cap) || cap < floor || cap > getBand(match.ref.dimension,match.ref.band)[1]) throw new Error('Invalid reference cap.');
    details.push({ key, dimension: evidence.dimension, referenceId: match.ref.id, similarity: match.similarity, floor, cap, score: floor + match.similarity * (cap - floor) });
  }
  const dimensions = RUBRIC.map(dimension => {
    const matches = details.filter(detail => detail.dimension === dimension.id);
    const score = Math.round(Math.min(dimension.max, Math.max(0, ...matches.map(match => match.score))) * 10) / 10;
    return { id: dimension.id, max: dimension.max, score };
  });
  const pending = job.evidence.filter(evidence => evidence.status === 'pending');
  return { id: job.id, state: pending.length ? 'review' : 'complete', version: job.referenceVersion, total: Math.round(dimensions.reduce((sum,d) => sum + d.score, 0) * 10) / 10, dimensions, pending, details };
}

export function validateDecision(decision) {
  if (!decision || typeof decision.id !== 'string' || !['approve','reject'].includes(decision.action)) throw Object.assign(new Error('Invalid review decision.'),{status:400});
  if (decision.action === 'reject') return;
  let range;
  try { range = getBand(decision.dimension, decision.band); } catch { throw Object.assign(new Error('Choose a valid dimension and rubric band.'),{status:400}); }
  const [min,max] = range;
  if (!Number.isInteger(decision.band) || !Number.isFinite(decision.cap) || decision.cap < min || decision.cap > max) throw Object.assign(new Error('The reference cap must be inside its selected rubric band.'),{status:400});
  if (typeof decision.statement !== 'string' || !decision.statement.trim() || decision.statement.length > 2500) throw Object.assign(new Error('Provide a reference description.'),{status:400});
}
