# Lab Text Extractor

A small client-side web app that turns a lab report PDF or screenshot into a
single, clean comma-separated line of `Parameter value unit (range) FLAG, ...`.

Everything runs in the browser — the PDF/image and extracted text are never
sent to a server. PDF text is read with [PDF.js](https://mozilla.github.io/pdf.js/);
scanned PDFs and images fall back to [Tesseract.js](https://tesseract.projectnaptha.com/)
OCR. Works well on PDFs with a real text layer; noticeably weaker on
scanned/photographed reports, since Tesseract has no sense of table structure.

## Usage

Just open `index.html` in a browser (or serve the folder with any static
file server, e.g. `python3 -m http.server`).

1. Drop in, choose, or paste (Ctrl+V / Cmd+V) a PDF or image (screenshot/photo)
   of a lab report.
2. Wait for text extraction / OCR to finish.
3. Review the auto-detected parameter table — check the rows you want in the
   output (nothing is included by default; use Select all / Deselect all),
   fix values, or add rows by hand. Parsing is best-effort; reports that
   interleave a prior visit's values are hardest to auto-detect correctly,
   so double-check those. It also skips everything above the results table
   (patient info, clinic letterhead) by looking for the "Test / Results /
   Reference Interval" header row.
4. Toggle **Include unit**, **Include reference range**, and **Include
   abnormal flags** to control what shows up in the output.
5. If the report includes a previous visit's results (some analyzer
   printouts show them in a right-hand column), pick how to handle them:
   don't include them, show current/previous as separate lines (with
   dates when detected), or show an inline comparison like `HCT 44.8 -> 42.4`.
6. Copy the generated output.

## Notes

- Parsing works best when each parameter is roughly on its own line in the
  source (common for most PDF exports). Very jumbled "wall of text"
  printouts may need more manual row editing.
- No build step or dependencies to install — it's plain HTML/CSS/JS with
  PDF.js and Tesseract.js loaded from a CDN.
