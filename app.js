(() => {
  "use strict";

  // ---------- DOM ----------
  const fileInput = document.getElementById("file-input");
  const browseBtn = document.getElementById("browse-btn");
  const dropZone = document.getElementById("drop-zone");
  const statusEl = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const rawTextSection = document.getElementById("raw-text-section");
  const rawTextEl = document.getElementById("raw-text");
  const reparseBtn = document.getElementById("reparse-btn");
  const tableSection = document.getElementById("table-section");
  const tbody = document.getElementById("params-tbody");
  const addRowBtn = document.getElementById("add-row-btn");
  const clearRowsBtn = document.getElementById("clear-rows-btn");
  const selectAllBtn = document.getElementById("select-all-btn");
  const deselectAllBtn = document.getElementById("deselect-all-btn");
  const outputSection = document.getElementById("output-section");
  const outputText = document.getElementById("output-text");
  const optUnit = document.getElementById("opt-unit");
  const optRange = document.getElementById("opt-range");
  const optFlag = document.getElementById("opt-flag");
  const copyBtn = document.getElementById("copy-btn");
  const copyConfirm = document.getElementById("copy-confirm");

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  let rowIdCounter = 0;

  // ---------- Status helpers ----------
  function setStatus(msg) {
    statusEl.hidden = false;
    statusText.textContent = msg;
  }
  function clearStatus() {
    statusEl.hidden = true;
  }

  // ---------- File input wiring ----------
  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
        }
        break;
      }
    }
  });

  async function handleFile(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      alert("Unsupported file type. Please choose a PDF or an image.");
      return;
    }

    try {
      const text = isPdf ? await extractFromPdf(file) : await extractFromImage(file);
      rawTextEl.value = text.trim();
      rawTextSection.hidden = false;
      runParseAndRender();
    } catch (err) {
      console.error(err);
      alert("Something went wrong while reading the file: " + err.message);
    } finally {
      clearStatus();
    }
  }

  // ---------- PDF extraction ----------

  // PDF.js's own hasEOL hint is a per-generator heuristic and unreliable —
  // some report engines (this one included) never set it, which collapses
  // an entire page into one unbroken line. Every text item always carries a
  // real page position, though, so rebuild lines by clustering items that
  // share a y-coordinate (same row) and ordering each row left-to-right.
  function reconstructPageText(items) {
    const Y_TOLERANCE = 2; // PDF points
    const lines = [];
    for (const item of items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      let line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
      if (!line) {
        line = { y, entries: [] };
        lines.push(line);
      }
      line.entries.push({ x, str: item.str });
    }
    // PDF page coordinates increase upward, so sort top-to-bottom by descending y.
    lines.sort((a, b) => b.y - a.y);
    return lines
      .map((line) =>
        line.entries
          .sort((a, b) => a.x - b.x)
          .map((e) => e.str)
          .join(" ")
      )
      .join("\n");
  }

  async function extractFromPdf(file) {
    setStatus("Reading PDF…");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    let fullText = "";
    let totalChars = 0;
    const pageTexts = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus(`Reading PDF page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = reconstructPageText(content.items);
      pageTexts.push({ page, pageText });
      totalChars += pageText.trim().length;
    }

    const avgCharsPerPage = totalChars / pdf.numPages;

    if (avgCharsPerPage > 20) {
      // Text layer looks real — use it.
      fullText = pageTexts.map((p) => p.pageText).join("\n");
      return fullText;
    }

    // Likely a scanned PDF with no usable text layer — OCR each page image.
    // Render at higher resolution than the on-screen default: small print in
    // a results table needs more source pixels than a screen viewport does.
    for (let i = 0; i < pageTexts.length; i++) {
      setStatus(`OCR on scanned PDF page ${i + 1} of ${pageTexts.length}…`);
      const { page } = pageTexts[i];
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      binarizeCanvas(canvas);
      const ocrText = await ocrCanvas(canvas, (p) =>
        setStatus(`OCR on page ${i + 1} of ${pageTexts.length}… ${p}%`)
      );
      fullText += ocrText + "\n";
    }
    return fullText;
  }

  // ---------- Image OCR ----------
  async function extractFromImage(file) {
    setStatus("Preparing image…");
    const url = URL.createObjectURL(file);
    try {
      const canvas = await loadImageToCanvas(url);
      binarizeCanvas(canvas);
      return await ocrCanvas(canvas, (p) => setStatus(`Running OCR on image… ${p}%`));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Decode an image into a canvas, upscaling small photos/screenshots —
  // Tesseract does noticeably better with more source pixels per character.
  function loadImageToCanvas(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MIN_WIDTH = 1600;
        const scale = img.width < MIN_WIDTH ? MIN_WIDTH / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = url;
    });
  }

  // Grayscale + Otsu binarization, in place. Printed report tables OCR far
  // more reliably as clean black-on-white than as anti-aliased color/gray —
  // this removes table-line and pale-background noise that trips up Tesseract.
  function binarizeCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const pixelCount = width * height;
    const gray = new Uint8ClampedArray(pixelCount);
    const histogram = new Array(256).fill(0);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      gray[p] = g;
      histogram[g]++;
    }

    const threshold = otsuThreshold(histogram, pixelCount);

    for (let p = 0; p < pixelCount; p++) {
      const v = gray[p] > threshold ? 255 : 0;
      const i = p * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function otsuThreshold(histogram, total) {
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * histogram[t];

    let sumBackground = 0;
    let weightBackground = 0;
    let bestVariance = -1;
    let threshold = 127;

    for (let t = 0; t < 256; t++) {
      weightBackground += histogram[t];
      if (weightBackground === 0) continue;
      const weightForeground = total - weightBackground;
      if (weightForeground === 0) break;

      sumBackground += t * histogram[t];
      const meanBackground = sumBackground / weightBackground;
      const meanForeground = (sumAll - sumBackground) / weightForeground;
      const variance =
        weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = t;
      }
    }
    return threshold;
  }

  async function ocrCanvas(source, onProgress) {
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(Math.round((m.progress || 0) * 100));
        }
      },
    });
    try {
      // PSM 6 ("a single uniform block of text") reads a results table's rows
      // left-to-right in order far more reliably than the fully-automatic
      // default, which tends to fragment tabular layouts.
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      });
      const { data } = await worker.recognize(source);
      return data.text || "";
    } finally {
      await worker.terminate();
    }
  }

  // ---------- Parsing ----------
  const NOISE_PATTERNS = [
    /reference\s*interval/i,
    /reference\s*range/i,
    /^low\s+normal\s+high$/i,
    /^patient/i,
    /^client/i,
    /^clinic/i,
    /^doctor/i,
    /^vet(erinarian)?/i,
    /^species/i,
    /^breed/i,
    /^sex/i,
    /^age/i,
    /^weight/i,
    /^accession/i,
    /^page\s+\d+/i,
    /^printed/i,
    /^date/i,
    /^comment/i,
    /^sample/i,
    /^requisition/i,
    /^report/i,
    /^\d+\.\s/,
    /^test\s+results?\b/i,
    // A previous-visit date/time can land on its own line after the
    // y-coordinate line reconstruction (see reconstructPageText) — without
    // these, "1:13 PM" alone would otherwise parse as a bogus row.
    /^\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/,
  ];

  function isNoiseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return NOISE_PATTERNS.some((re) => re.test(trimmed));
  }

  // A section/instrument header, e.g. "ProCyte Dx (September 2, 2026, 11:59 AM)"
  // — some analyzer printouts show a previous visit's date to the right of
  // this line (and its time on the next line), which this also picks up.
  function matchSectionHeader(line) {
    const m = line.match(
      /^(.+?)\s*\(([A-Za-z]+ \d{1,2},\s*\d{4},\s*\d{1,2}:\d{2}\s*[AP]M)\)\s*(.*)$/i
    );
    if (!m) return null;
    return { name: m[1].trim(), date: m[2].trim(), trailing: m[3].trim() };
  }

  // Turn one line of "NAME VALUE UNIT [FLAG] [RANGE] [PREV_VALUE PREV_UNIT]"
  // into a row. The trailing PREV_VALUE/PREV_UNIT is optional: some analyzer
  // printouts add a previous-visit result in a right-hand column, after the
  // reference range.
  function parseLine(rawLine) {
    let line = rawLine.trim();
    if (!line || isNoiseLine(line)) return null;

    // Normalize a couple of common OCR/unicode quirks.
    line = line.replace(/µ/g, "μ").replace(/–|—/g, "-");

    // Drop bare "*" footnote markers (e.g. this row is asterisked with "*
    // Confirm with blood morphology..." printed elsewhere on the page) —
    // they can sit between the current result and a previous-value column,
    // which would otherwise break the "one clean value at the end" parse
    // below and make it grab the previous value as if it were current.
    line = line.replace(/\*/g, " ").replace(/\s+/g, " ").trim();

    // 1. Pull off a LOW/HIGH flag (word boundary, from anywhere in the line)
    //    — it can sit between the range and a previous-value column.
    let flag = "";
    const flagMatch = line.match(/\b(LOW|HIGH)\b/i);
    if (flagMatch) {
      flag = flagMatch[1].toUpperCase();
      line = (line.slice(0, flagMatch.index) + line.slice(flagMatch.index + flagMatch[0].length)).trim();
    }

    // 2. Pull off a reference range like "6.54 - 12.20" or "<10" — search
    //    anywhere rather than anchoring to the end, since a previous-value
    //    column (if present) trails the range rather than sitting after it.
    let range = "";
    const rangeMatch = line.match(/([<>]?\d+\.?\d*)\s*-\s*([<>]?\d+\.?\d*)/);
    if (rangeMatch) {
      range = `${rangeMatch[1]}-${rangeMatch[2]}`;
      line = (line.slice(0, rangeMatch.index) + " " + line.slice(rangeMatch.index + rangeMatch[0].length))
        .replace(/\s+/g, " ")
        .trim();
    }

    // 3. Split remaining "NAME VALUE UNIT [PREV_VALUE PREV_UNIT]".
    const m = line.match(
      /^(.*?)[\s:]+([<>]?-?\d+\.?\d*)\s*([A-Za-zμ%][A-Za-zμ%0-9/^.]*)?(?:\s+([<>]?-?\d+\.?\d*)\s*([A-Za-zμ%][A-Za-zμ%0-9/^.]*)?)?\s*$/
    );
    if (!m) return null;

    const name = m[1].trim().replace(/[,:\-]+$/, "").trim();
    const value = m[2].trim();
    const unit = (m[3] || "").trim();
    const prevValue = (m[4] || "").trim();

    if (!name || name.length < 2 || !/[A-Za-z]/.test(name)) return null;
    // Reject names that are themselves just numbers/noise.
    if (/^\d+$/.test(name)) return null;
    // A bare 5+ digit whole number with no unit is a zip/street/ID number
    // (e.g. a clinic address line ending "...Phuket 83110"), never a lab
    // value — real results are unitted, or short unitless ratios/counts.
    if (!unit && /^\d{5,}$/.test(value)) return null;

    return { name, value, unit, range, flag, prevValue };
  }

  function parseText(text) {
    const lines = text.split(/\r?\n/);
    // Skip everything above the results table (patient info, clinic letterhead)
    // by starting after the first "Test Results ..." header row, if one is found.
    const headerIdx = lines.findIndex((l) => /^test\s+results?\b/i.test(l.trim()));
    const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

    // First pass: locate every section/instrument header and its metadata.
    // These headers TRAIL their own block of rows on typical analyzer
    // printouts (e.g. "ProCyte Dx (Sep 2, 2026, 11:59 AM)" appears AFTER the
    // CBC rows it labels, as a run-timestamp line) — so a row's section is
    // whichever header comes NEXT, not whichever header came last.
    const sections = [];
    for (let i = 0; i < dataLines.length; i++) {
      const raw = dataLines[i].trim();
      if (!raw) continue;
      const header = matchSectionHeader(raw);
      if (!header) continue;
      const dateToken = (header.trailing.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || [""])[0];
      const timeInline = (header.trailing.match(/\d{1,2}:\d{2}\s*[AP]M/i) || [""])[0];
      const timeNextLine =
        !timeInline && dataLines[i + 1]
          ? (dataLines[i + 1].match(/^\s*(\d{1,2}:\d{2}\s*[AP]M)/i) || [, ""])[1]
          : "";
      sections.push({
        index: i,
        name: header.name,
        date: header.date,
        prevDate: [dateToken, timeInline || timeNextLine].filter(Boolean).join(" "),
      });
    }

    function sectionForIndex(i) {
      return sections.find((s) => s.index >= i) || { name: "", date: "", prevDate: "" };
    }

    const rows = [];
    for (let i = 0; i < dataLines.length; i++) {
      const raw = dataLines[i].trim();
      if (!raw || matchSectionHeader(raw)) continue;
      const row = parseLine(raw);
      if (row) {
        const section = sectionForIndex(i);
        rows.push({ ...row, section: section.name, sectionDate: section.date, sectionPrevDate: section.prevDate });
      }
    }
    return rows;
  }

  function runParseAndRender() {
    const rows = parseText(rawTextEl.value);
    renderRows(rows);
  }

  reparseBtn.addEventListener("click", runParseAndRender);

  // ---------- Table rendering ----------
  function renderRows(rows) {
    tbody.innerHTML = "";
    rows.forEach((r) => addRow(r));
    tableSection.hidden = false;
    outputSection.hidden = false;
    updateOutput();
  }

  function addRow(data) {
    const id = ++rowIdCounter;
    const tr = document.createElement("tr");
    tr.dataset.id = id;
    tr.dataset.section = data.section || "";
    tr.dataset.sectionDate = data.sectionDate || "";
    tr.dataset.sectionPrevDate = data.sectionPrevDate || "";

    tr.innerHTML = `
      <td class="col-include"><input type="checkbox" class="row-include" /></td>
      <td class="col-name"><input type="text" class="row-name" value="${escapeAttr(data.name || "")}" /></td>
      <td class="col-value"><input type="text" class="row-value" value="${escapeAttr(data.value || "")}" /></td>
      <td class="col-unit"><input type="text" class="row-unit" value="${escapeAttr(data.unit || "")}" /></td>
      <td class="col-prev"><input type="text" class="row-prev" value="${escapeAttr(data.prevValue || "")}" placeholder="—" /></td>
      <td class="col-range"><input type="text" class="row-range" value="${escapeAttr(data.range || "")}" /></td>
      <td class="col-flag">
        <select class="flag-select">
          <option value="" ${!data.flag ? "selected" : ""}></option>
          <option value="LOW" ${data.flag === "LOW" ? "selected" : ""}>LOW</option>
          <option value="HIGH" ${data.flag === "HIGH" ? "selected" : ""}>HIGH</option>
        </select>
      </td>
      <td class="col-remove"><button type="button" class="row-remove-btn" title="Remove row">✕</button></td>
    `;

    tbody.appendChild(tr);

    tr.querySelectorAll("input, select").forEach((el) =>
      el.addEventListener("input", updateOutput)
    );
    tr.querySelector(".row-remove-btn").addEventListener("click", () => {
      tr.remove();
      updateOutput();
    });
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  addRowBtn.addEventListener("click", () => {
    addRow({ name: "", value: "", unit: "", range: "", flag: "", prevValue: "" });
    tableSection.hidden = false;
    outputSection.hidden = false;
  });

  clearRowsBtn.addEventListener("click", () => {
    if (confirm("Remove all rows?")) {
      tbody.innerHTML = "";
      updateOutput();
    }
  });

  selectAllBtn.addEventListener("click", () => {
    tbody.querySelectorAll(".row-include").forEach((cb) => (cb.checked = true));
    updateOutput();
  });

  deselectAllBtn.addEventListener("click", () => {
    tbody.querySelectorAll(".row-include").forEach((cb) => (cb.checked = false));
    updateOutput();
  });

  // ---------- Output generation ----------
  function readRows() {
    const rows = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      if (!tr.querySelector(".row-include").checked) return;
      const name = tr.querySelector(".row-name").value.trim();
      const value = tr.querySelector(".row-value").value.trim();
      if (!name || !value) return;
      rows.push({
        name,
        value,
        unit: tr.querySelector(".row-unit").value.trim(),
        range: tr.querySelector(".row-range").value.trim(),
        flag: tr.querySelector(".flag-select").value,
        prevValue: tr.querySelector(".row-prev").value.trim(),
        section: tr.dataset.section || "",
        sectionDate: tr.dataset.sectionDate || "",
        sectionPrevDate: tr.dataset.sectionPrevDate || "",
      });
    });
    return rows;
  }

  function formatEntry(name, value, unit, range, flag, opts) {
    let s = `${name} ${value}`;
    if (opts.includeUnit && unit) s += ` ${unit}`;
    if (opts.includeRange && range) s += ` (${range})`;
    if (opts.includeFlag && flag) s += ` ${flag}`;
    return s;
  }

  function getPrevMode() {
    const el = document.querySelector('input[name="prev-mode"]:checked');
    return el ? el.value : "none";
  }

  function updateOutput() {
    const opts = {
      includeUnit: optUnit.checked,
      includeRange: optRange.checked,
      includeFlag: optFlag.checked,
    };
    const rows = readRows();
    const prevMode = getPrevMode();

    if (prevMode === "compare") {
      const parts = rows.map((r) => {
        if (r.prevValue) {
          let s = `${r.name} ${r.prevValue} -> ${r.value}`;
          if (opts.includeUnit && r.unit) s += ` ${r.unit}`;
          if (opts.includeRange && r.range) s += ` (${r.range})`;
          if (opts.includeFlag && r.flag) s += ` ${r.flag}`;
          return s;
        }
        return formatEntry(r.name, r.value, r.unit, r.range, r.flag, opts);
      });
      outputText.value = parts.join(", ");
      return;
    }

    if (prevMode === "separate") {
      // Group by the section (panel/instrument run) each row came from, since
      // a single report can have multiple panels each with their own current
      // and previous visit dates.
      const groups = [];
      const groupIndex = new Map();
      rows.forEach((r) => {
        const key = `${r.sectionDate}|${r.sectionPrevDate}`;
        if (!groupIndex.has(key)) {
          groupIndex.set(key, groups.length);
          groups.push({ date: r.sectionDate, prevDate: r.sectionPrevDate, rows: [] });
        }
        groups[groupIndex.get(key)].rows.push(r);
      });

      const lines = [];
      groups.forEach((g) => {
        const currentParts = g.rows.map((r) =>
          formatEntry(r.name, r.value, r.unit, r.range, r.flag, opts)
        );
        lines.push(
          (g.date ? `Current (${g.date}): ` : "Current: ") + currentParts.join(", ")
        );

        const withPrev = g.rows.filter((r) => r.prevValue);
        if (withPrev.length) {
          const prevParts = withPrev.map((r) =>
            formatEntry(r.name, r.prevValue, r.unit, "", "", opts)
          );
          lines.push(
            (g.prevDate ? `Previous (${g.prevDate}): ` : "Previous: ") + prevParts.join(", ")
          );
        }
      });
      outputText.value = lines.join("\n");
      return;
    }

    // "none" — ignore previous-visit data entirely.
    outputText.value = rows
      .map((r) => formatEntry(r.name, r.value, r.unit, r.range, r.flag, opts))
      .join(", ");
  }

  [optUnit, optRange, optFlag].forEach((el) =>
    el.addEventListener("change", updateOutput)
  );
  document.querySelectorAll('input[name="prev-mode"]').forEach((el) =>
    el.addEventListener("change", updateOutput)
  );

  // ---------- Copy button ----------
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputText.value);
    } catch (e) {
      outputText.select();
      document.execCommand("copy");
    }
    copyConfirm.hidden = false;
    setTimeout(() => (copyConfirm.hidden = true), 1500);
  });
})();
