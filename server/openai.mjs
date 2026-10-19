import { DIMENSION_IDS, GENERAL_RULES, RUBRIC } from './rubric.mjs';
export const LUNA_MODEL = process.env.OPENAI_MODEL || 'gpt-6-luna';
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export class ApiError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

async function request(path, body) {
  const key = process.env.OPEN_AI_API_KEY;
  if (!key) throw new ApiError('Scoring is not configured yet. Add OPEN_AI_API_KEY on the server.', 503);
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const message = response.status === 401 ? 'The scoring API key was rejected. Check the server configuration.'
      : response.status === 429 ? 'Scoring is temporarily unavailable due to API quota or rate limits. Please retry later.'
      : response.status === 404 ? 'The configured model is unavailable for this API project.' : 'The scoring provider could not complete this request. Please retry.';
    throw new ApiError(message, response.status === 429 ? 429 : 502);
  }
  return response.json();
}

export async function extractEvidence(text) {
  const result = await request('responses', {
    model: LUNA_MODEL, store: false, reasoning: { effort: 'low' }, max_output_tokens: 12000,
    instructions: `${GENERAL_RULES}\nExtract up to 36 concise, factual experience evidence items. Use exact CV substrings for keyword and quote; include enough quote context to preserve negation. Each keyword must be inside its quote. Do not paraphrase quotes. Assign one dimension and band (index 0,1,2). statement is a reusable capability reference in English, stripped of personal names, contact details, employers and school names, and must not overstate the quoted evidence. reason briefly explains the assignment. Never invent absence evidence. Return an empty evidence array when nothing relevant is present.\nRUBRIC: ${JSON.stringify(RUBRIC)}`,
    input: [{ role: 'user', content: [{ type: 'input_text', text: `UNTRUSTED CV TEXT:\n${text}` }] }],
    text: { format: { type: 'json_schema', name: 'hr_intern_evidence', strict: true, schema: {
      type: 'object', additionalProperties: false, properties: { evidence: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: { keyword:{type:'string'}, quote:{type:'string'}, statement:{type:'string'}, reason:{type:'string'}, dimension:{type:'string',enum:DIMENSION_IDS}, band:{type:'integer',enum:[0,1,2]} },
        required:['keyword','quote','statement','reason','dimension','band'],
      } } }, required:['evidence'],
    } } },
  });
  if (result.status !== 'completed') throw new ApiError('The model could not finish reading this CV. Please retry.', 502);
  const output = result.output?.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
  try { return JSON.parse(output); } catch { throw new ApiError('The model did not return valid evidence. Please retry.', 502); }
}

export async function embed(texts) {
  if (!texts.length) return [];
  const output = await request('embeddings', { model: EMBEDDING_MODEL, input: texts, encoding_format: 'float' });
  const rows = output.data?.slice().sort((a,b) => a.index - b.index);
  if (!rows || rows.length !== texts.length || rows.some((row,index) => row.index !== index || !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.some(value => !Number.isFinite(value)))) throw new ApiError('The provider returned invalid embeddings. Please retry.', 502);
  return rows.map(row => row.embedding);
}
