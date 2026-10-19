import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPdf, pdfError } from '../src/pdf.ts';

// A real PDF with xref offsets and one content stream per page, no network fixtures.
export function pdfFixture(pages: string[]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, index) => {
    const stream = text ? `BT /F1 12 Tf 50 700 Td (${text}) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let source = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(source);
}

test('reads actual text from every PDF page and reports measured progress', async () => {
  const progress: [number, number][] = [];
  const result = await extractPdf(pdfFixture(['Candidate: Linh Nguyen', 'Experience: five years']), (done, total) => progress.push([done, total]));
  assert.equal(result.text, 'Candidate: Linh Nguyen\n\nExperience: five years');
  assert.equal(result.pages, 2);
  assert.deepEqual(result.emptyPages, []);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});

test('keeps readable pages and flags pages requiring OCR', async () => {
  const result = await extractPdf(pdfFixture(['Experience: Recruiting', '', 'Education: University']));
  assert.equal(result.pages, 3);
  assert.deepEqual(result.emptyPages, [2]);
  assert.equal(result.text, 'Experience: Recruiting\n\nEducation: University');
});

test('does not invent text when the PDF has no text layer', async () => {
  const result = await extractPdf(pdfFixture(['']));
  assert.equal(result.text, '');
  assert.deepEqual(result.emptyPages, [1]);
});

test('rejects corrupt files and supplies an actionable message', async () => {
  await assert.rejects(() => extractPdf(new TextEncoder().encode('This is not a PDF.')), error => {
    assert.match(pdfError(error), /may be damaged/);
    return true;
  });
});

test('explains why a password-protected PDF cannot be read', () => {
  const error = new Error('Password required');
  error.name = 'PasswordException';
  assert.match(pdfError(error), /password protected/);
});
