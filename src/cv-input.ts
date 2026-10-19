import { extractPdf } from './pdf';

/** Shared input pipeline for every position; role scoring consumes plain text. */
export async function readCv(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a non-empty PDF up to 20 MB.');
  const result = await extractPdf(new Uint8Array(await file.arrayBuffer()), undefined, `${import.meta.env.BASE_URL}pdfjs/`);
  if (!result.text.trim()) throw new Error('This PDF has no readable text. Please use a text-based PDF.');
  return result.text;
}
