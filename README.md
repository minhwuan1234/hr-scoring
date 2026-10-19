# HR Scoring

First workflow: convert user-selected PDF CVs to plain text. React + TypeScript + Vite; PDF.js runs locally in a browser worker.

## Run locally

Requires Node.js 22.13+ (Node.js 24 recommended).

```sh
npm ci
npm run dev
```

Open the Local URL printed by Vite. `predev` and `prebuild` copy PDF.js fonts, CMaps, and WASM into the ignored `public/pdfjs/` directory, so extraction does not depend on a third-party CDN.

```sh
npm test
npm run build
npm run preview
```

## Current behavior

- Select or drop up to 50 PDFs, at most 20 MB per file.
- Convert the queue sequentially and show page-level progress for the current PDF.
- View extracted text, copy it, download a UTF-8 TXT per PDF, or download all successful results in one TXT.
- Show individual errors for corrupt or password-protected files; other files continue processing.
- Report pages without readable text. OCR is not included yet.
- Files and text stay in browser memory. Reloading clears them; download results first.

No server upload, persistence, scoring, or Lark integration is implemented in this first workflow. Text follows the PDF content order; complex columns and tables may require a manual check.

## Design references

Imported Toolhub design references are preserved in `design/reference/toolhub-codex-initial-ui/`. This interface reuses its neutral palette, system typography, compact controls, and workspace layout.
