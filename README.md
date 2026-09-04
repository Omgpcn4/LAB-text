# Lab Text Extractor

A small client-side web app that turns a lab report PDF or screenshot into a
single, clean comma-separated line of `Parameter value unit (range) FLAG, ...`.

It offers two extraction modes:

- **Local OCR (private, default)** — runs fully in the browser, nothing ever
  leaves the device. PDF text is read with [PDF.js](https://mozilla.github.io/pdf.js/);
  scanned PDFs and images fall back to [Tesseract.js](https://tesseract.projectnaptha.com/)
  OCR. Works well on PDFs with a real text layer; noticeably weaker on
  scanned/photographed reports, since Tesseract has no sense of table
  structure.
- **AI-read (Claude)** — sends the file directly from the browser to the
  Anthropic API (using your own API key, entered locally) for much more
  accurate reading of scans and photos. This is a real privacy trade-off:
  the file and key leave the browser. The key is stored only in browser
  `localStorage` and is never sent anywhere except Anthropic's API.

## Usage

Just open `index.html` in a browser (or serve the folder with any static
file server, e.g. `python3 -m http.server`).

1. Pick an extraction mode. For AI-read, paste in an Anthropic API key.
2. Drop in or choose a PDF or image (screenshot/photo) of a lab report.
3. Wait for text extraction / OCR to finish.
4. Review the auto-detected parameter table — check/uncheck rows, fix values,
   or add rows by hand. Local-OCR parsing is best-effort; reports that
   interleave a prior visit's values are hardest to auto-detect correctly,
   so double-check those. It also skips everything above the results table
   (patient info, clinic letterhead) by looking for the "Test / Results /
   Reference Interval" header row.
5. Toggle **Include unit**, **Include reference range**, and **Include
   abnormal flags** to control what shows up in the output.
6. Copy the generated one-line output.

## Notes

- Local-OCR parsing works best when each parameter is roughly on its own
  line in the source (common for most PDF exports). Very jumbled
  "wall of text" printouts may need more manual row editing.
- No build step or dependencies to install — it's plain HTML/CSS/JS with
  PDF.js, Tesseract.js, and (only when AI-read mode is used) the
  `@anthropic-ai/sdk` loaded from a CDN.
