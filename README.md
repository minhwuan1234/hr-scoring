# HR Scoring

HR Intern scoring UI preview and PDF-to-text conversion. React + TypeScript + Vite; PDF.js runs locally in a browser worker.

## HR Intern UI preview

The default screen focuses on the Talent Acquisition & Employer Branding Intern position. It supports batch PDF selection, a scoring loading state, and a result with a total score out of 100 and nine dimension scores. Internal keyword rules, model prompts, and approval mechanics are not shown in this HR review workflow.

The scoring result is explicitly illustrative. It always uses the same sample values and is not an evaluation of the selected CV. No model is connected. Uploaded PDFs are read locally to validate readable text; scanned, damaged, or protected PDFs show their own errors rather than sample results. Use **Preview sample** to explore the full interface without a file.

The agreed rubric and keyword ownership rules are recorded in `docs/hr-intern-scoring.md`. The existing real PDF text converter remains available under **PDF to text**.

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

No server upload, persistence, model scoring, or Lark integration is implemented. Text follows the PDF content order; complex columns and tables may require a manual check.

## Design references

Imported Toolhub design references are preserved in `design/reference/toolhub-codex-initial-ui/`. This interface reuses its neutral palette, system typography, compact controls, and workspace layout.
