import { createHash } from 'node:crypto';

export const SCORING_UNIT = 'sentence-period-v2';
export const MAX_EVIDENCE_SENTENCES = 10;
// Keep existing canonical sentence decisions reusable across extraction policies.
const KEY_VERSION = 'sentence-v1';
const abbreviations=new Set(['mr','mrs','ms','dr','prof','sr','jr','e.g','i.e','etc','vs','inc','ltd','corp','no','fig','dept','st','b.sc','m.sc','ph.d']);
export function normalize(text) { return text.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu,' ').trim(); }
export function sentenceKey(text) {
  const canonical = normalize(text).replace(/^[\s•●▪◦‣⁃*-]+/u,'').replace(/[.!?。！？]+$/u,'').trim();
  return `${KEY_VERSION}:${createHash('sha256').update(canonical).digest('hex')}`;
}

// Paragraphs/bullets separate activities, while PDF line wraps stay in one unit.
// Only a sentence-ending period completes a unit; never invent punctuation or
// cut at commas, semicolons, question marks, exclamation marks or line wraps.
export function cvSentences(text) {
  const records = [];
  for (const block of text.normalize('NFC').replace(/\r\n?/g,'\n').split(/\n\s*\n|\n(?=\s*(?:[•●▪◦‣⁃*-]|\d+[.)])\s+)/u)) {
    const clean = block.replace(/^\s*(?:[•●▪◦‣⁃*-]|\d+[.)])\s+/u,'').replace(/\s+/gu,' ').trim();
    let start=0;
    for(let index=0;index<clean.length;index++){
      if(clean[index]!=='.')continue;
      let end=index+1;while(end<clean.length&&/[”’"')\]}]/u.test(clean[end]))end++;
      if(end<clean.length&&!/\s/u.test(clean[end]))continue; // decimals, URLs, email domains
      const token=clean.slice(0,index).match(/([\p{L}.]+)$/u)?.[1]||'';
      const rest=clean.slice(end).trim();
      if(rest&&(abbreviations.has(token.toLowerCase())||/^(?:[A-Za-z]\.)+[A-Za-z]$/u.test(token)||/^[A-Z]$/u.test(token)))continue;
      const quote=clean.slice(start,end).trim();
      if(quote&&/[\p{L}\p{N}]/u.test(quote))records.push({sentenceId:`s${records.length+1}`,quote,key:sentenceKey(quote)});
      start=end;index=end-1;
    }
    // An unfinished tail (including an unpunctuated bullet) is not evidence.
  }
  return records;
}
