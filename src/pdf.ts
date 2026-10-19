import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export interface Extraction {
  text: string;
  pages: number;
  emptyPages: number[];
}

/** Keep PDF text order, line breaks and horizontal word boundaries. */
function pageText(items: TextItem[]): string {
  const lines: string[] = [];
  let line = '';
  let previous: TextItem | undefined;
  for (const item of items) {
    if (previous && line && Math.abs(item.transform[5] - previous.transform[5]) > Math.max(2, Math.abs(item.height) * 0.45)) {
      lines.push(line.trimEnd());
      line = '';
    }
    if (line && previous && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const previousEnd = previous.transform[4] + previous.width;
      if (item.transform[4] - previousEnd > Math.max(1, Math.abs(item.height) * 0.12)) line += ' ';
    }
    line += item.str;
    if (item.hasEOL) {
      lines.push(line.trimEnd());
      line = '';
    }
    previous = item;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(
  data: Uint8Array,
  onProgress: (finished: number, total: number) => void = () => {},
  assetBase?: string,
): Promise<Extraction> {
  const task = getDocument({
    data,
    ...(assetBase ? {
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
    } : {}),
  });
  try {
    const pdf = await task.promise;
    const texts: string[] = [];
    const emptyPages: number[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = pageText(content.items.filter((item): item is TextItem => 'str' in item));
      texts.push(text);
      if (!text) emptyPages.push(number);
      page.cleanup();
      onProgress(number, pdf.numPages);
    }
    return { text: texts.filter(Boolean).join('\n\n'), pages: pdf.numPages, emptyPages };
  } finally {
    await task.destroy();
  }
}

export function pdfError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return 'This PDF is password protected. Unlock it and upload it again.';
  if (name === 'InvalidPDFException') return 'Unable to read this PDF. It may be damaged or use an invalid format.';
  return 'Unable to convert this file. Check the PDF and try again.';
}
