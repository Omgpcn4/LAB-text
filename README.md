# Lab Text Extractor

A small client-side web app that turns a lab report PDF or screenshot into a
single, clean comma-separated line of `Parameter value unit (range) FLAG, ...`.

Everything runs in the browser — the PDF/image and extracted text are never
sent to a server. PDF text is read with [PDF.js](https://mozilla.github.io/pdf.js/);
scanned PDFs and images are read with [Tesseract.js](https://tesseract.projectnaptha.com/) OCR.

## Usage

Just open `index.html` in a browser (or serve the folder with any static
file server, e.g. `python3 -m http.server`).

1. Drop in or choose a PDF or image (screenshot/photo) of a lab report.
2. Wait for text extraction / OCR to finish.
3. Review the auto-detected parameter table — check/uncheck rows, fix values,
   or add rows by hand. Parsing is best-effort; reports that interleave a
   prior visit's values are hardest to auto-detect correctly, so double-check
   those.
4. Toggle **Include unit**, **Include reference range**, and **Include
   abnormal flags** to control what shows up in the output.
5. Copy the generated one-line output.

## Notes

- Automatic parsing works best when each parameter is roughly on its own
  line in the source (common for most PDF exports). Very jumbled
  "wall of text" printouts may need more manual row editing.
- No build step or dependencies to install — it's plain HTML/CSS/JS with
  PDF.js and Tesseract.js loaded from a CDN.
