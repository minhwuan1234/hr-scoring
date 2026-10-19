import { RUBRIC, getBand } from './rubric.mjs';

export function normalize(text) { return text.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim(); }

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
  const seen = new Set();
  return output.evidence.map(item => {
    if (!item || ['keyword','quote','statement','reason'].some(key => typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 2500)) throw new Error('The model returned invalid evidence.');
    if (!Number.isInteger(item.band)) throw new Error('The model returned an invalid rubric band.');
    getBand(item.dimension, item.band);
    if (!normalize(cvText).includes(normalize(item.quote)) || !normalize(item.quote).includes(normalize(item.keyword))) throw new Error('A model evidence quote could not be verified against the CV. Please retry.');
    return { ...item, key: normalize(item.keyword) };
  }).filter(item => { if (seen.has(item.key)) return false; seen.add(item.key); return true; });
}

export function calculate(job, references, embeddingModel) {
  const details = [];
  const used = new Set();
  for (const evidence of job.evidence) {
    if (used.has(evidence.key) || evidence.status !== 'approved') continue;
    used.add(evidence.key);
    const match = nearest(evidence, references, embeddingModel);
    if (!match) continue;
    // Requested rule: percentage of this reference's human-approved cap.
    // Band underflow is retained as an explicit unresolved rubric policy.
    details.push({ key: evidence.key, dimension: evidence.dimension, referenceId: match.ref.id, similarity: match.similarity, cap: match.ref.cap, score: match.similarity * match.ref.cap });
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
