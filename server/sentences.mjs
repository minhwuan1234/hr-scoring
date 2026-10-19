import { createHash } from 'node:crypto';

export const SCORING_UNIT = 'sentence-v1';
const segmenter = new Intl.Segmenter('en', { granularity:'sentence' });
export function normalize(text) { return text.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu,' ').trim(); }
export function sentenceKey(text) {
  const canonical = normalize(text).replace(/^[\s•●▪◦‣⁃*-]+/u,'').replace(/[.!?。！？]+$/u,'').trim();
  return `${SCORING_UNIT}:${createHash('sha256').update(canonical).digest('hex')}`;
}

// Blank paragraphs and explicit bullets are boundaries; ordinary PDF wrapping
// stays inside the same sentence. Colons, commas and semicolons never split it.
export function cvSentences(text) {
  const records = [];
  for (const block of text.normalize('NFC').replace(/\r\n?/g,'\n').split(/\n\s*\n|\n(?=\s*(?:[•●▪◦‣⁃*-]|\d+[.)])\s+)/u)) {
    const clean = block.replace(/^\s*(?:[•●▪◦‣⁃*-]|\d+[.)])\s+/u,'').replace(/\s+/gu,' ').trim();
    for (const part of segmenter.segment(clean)) {
      const quote = part.segment.replace(/\s+/gu,' ').trim();
      if (quote) records.push({ sentenceId:`s${records.length+1}`, quote, key:sentenceKey(quote) });
    }
  }
  return records;
}
