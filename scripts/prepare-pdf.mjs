import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  const target = new URL(`public/pdfjs/${directory}`, root);
  mkdirSync(target, { recursive: true });
  cpSync(fileURLToPath(new URL(`node_modules/pdfjs-dist/${directory}`, root)), fileURLToPath(target), { recursive: true });
}
