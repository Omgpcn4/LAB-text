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
  const outputSection = document.getElementById("output-section");
  const outputText = document.getElementById("output-text");
  const optUnit = document.getElementById("opt-unit");
  const optRange = document.getElementById("opt-range");
  const optFlag = document.getElementById("opt-flag");
  const copyBtn = document.getElementById("copy-btn");
  const copyConfirm = document.getElementById("copy-confirm");
  const modeLocal = document.getElementById("mode-local");
  const modeAi = document.getElementById("mode-ai");
  const aiKeyRow = document.getElementById("ai-key-row");
  const apiKeyInput = document.getElementById("api-key-input");

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  let rowIdCounter = 0;

  // ---------- Extraction mode ----------
  const API_KEY_STORAGE_KEY = "lab-text-extractor-anthropic-key";
  apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  apiKeyInput.addEventListener("input", () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
  });
  [modeLocal, modeAi].forEach((el) =>
    el.addEventListener("change", () => {
      aiKeyRow.hidden = !modeAi.checked;
    })
  );

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

  async function handleFile(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      alert("Unsupported file type. Please choose a PDF or an image.");
      return;
    }

    try {
      if (modeAi.checked) {
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
          alert("Enter your Anthropic API key above, or switch to Local OCR.");
          return;
        }
        setStatus("Reading with Claude…");
        const rows = await extractWithClaude(file, isPdf, apiKey);
        rawTextSection.hidden = false;
        rawTextEl.value = rows
          .map((r) => [r.name, r.value, r.unit, r.range, r.flag].filter(Boolean).join(" "))
          .join("\n");
        renderRows(rows);
      } else {
        const text = isPdf ? await extractFromPdf(file) : await extractFromImage(file);
        rawTextEl.value = text.trim();
        rawTextSection.hidden = false;
        runParseAndRender();
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong while reading the file: " + err.message);
    } finally {
      clearStatus();
    }
  }

  // ---------- AI-read extraction (Claude) ----------
  let AnthropicSDK = null;
  async function loadAnthropicSDK() {
    if (!AnthropicSDK) {
      const mod = await import("https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.123.0/+esm");
      AnthropicSDK = mod.default;
    }
    return AnthropicSDK;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  const CLAUDE_EXTRACTION_PROMPT = `Read the attached lab report (a CBC/hematology and/or chemistry panel, veterinary or human) and return ONLY a JSON array — no markdown fences, no commentary — of objects shaped like:
{"name": string, "value": string, "unit": string, "range": string, "flag": "LOW" | "HIGH" | ""}

Rules:
- Include only rows from the actual test-results table (the Test/Result/Reference Interval section).
- Skip all patient demographics, clinic letterhead, doctor's notes, and footer/print text entirely.
- Use the exact parameter abbreviation as printed (e.g. RBC, HCT, %NEU, BUN/CREA).
- If more than one visit's values appear, use only the current/most recent visit.
- "unit" and "range" are "" when the source gives none (e.g. ratios like BUN/CREA or ALB/GLOB).
- "flag" is "LOW" or "HIGH" only when the source explicitly marks that row abnormal; otherwise "".
- Preserve the original top-to-bottom order of parameters.
Return valid JSON only.`;

  async function extractWithClaude(file, isPdf, apiKey) {
    const Anthropic = await loadAnthropicSDK();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const base64 = await fileToBase64(file);
    const block = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: base64 } };

    let response;
    try {
      response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        messages: [
          { role: "user", content: [block, { type: "text", text: CLAUDE_EXTRACTION_PROMPT }] },
        ],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error("That API key was rejected. Check it and try again.");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error("Rate limited by the Anthropic API — wait a moment and try again.");
      }
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error (${err.status}): ${err.message}`);
      }
      throw err;
    }

    const textBlock = response.content.find((b) => b.type === "text");
    const jsonText = (textBlock && textBlock.text ? textBlock.text : "")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    let rows;
    try {
      rows = JSON.parse(jsonText);
    } catch (e) {
      throw new Error("Claude's response wasn't valid JSON — try again, or switch to Local OCR.");
    }
    if (!Array.isArray(rows)) {
      throw new Error("Unexpected response shape from Claude.");
    }
    return rows.map((r) => ({
      name: r.name || "",
      value: r.value != null ? String(r.value) : "",
      unit: r.unit || "",
      range: r.range || "",
      flag: r.flag || "",
    }));
  }

  // ---------- PDF extraction ----------
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
      const pageText = content.items.map((item) => item.str).join(" ");
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
    for (let i = 0; i < pageTexts.length; i++) {
      setStatus(`OCR on scanned PDF page ${i + 1} of ${pageTexts.length}…`);
      const { page } = pageTexts[i];
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const ocrText = await ocrCanvas(canvas, (p) =>
        setStatus(`OCR on page ${i + 1} of ${pageTexts.length}… ${p}%`)
      );
      fullText += ocrText + "\n";
    }
    return fullText;
  }

  // ---------- Image OCR ----------
  async function extractFromImage(file) {
    setStatus("Running OCR on image… 0%");
    const url = URL.createObjectURL(file);
    try {
      const text = await ocrCanvas(url, (p) =>
        setStatus(`Running OCR on image… ${p}%`)
      );
      return text;
    } finally {
      URL.revokeObjectURL(url);
    }
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
  ];

  function isNoiseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return NOISE_PATTERNS.some((re) => re.test(trimmed));
  }

  // Turn one line of "NAME VALUE UNIT [FLAG] [RANGE]"-ish text into a row.
  function parseLine(rawLine) {
    let line = rawLine.trim();
    if (!line || isNoiseLine(line)) return null;

    // Normalize a couple of common OCR/unicode quirks.
    line = line.replace(/µ/g, "μ").replace(/–|—/g, "-");

    // 1. Pull off a LOW/HIGH/asterisk flag (word boundary, from anywhere in
    //    the line) — it can appear right after the value or after the range.
    let flag = "";
    const flagMatch = line.match(/\b(LOW|HIGH)\b/i);
    if (flagMatch) {
      flag = flagMatch[1].toUpperCase();
      line = (line.slice(0, flagMatch.index) + line.slice(flagMatch.index + flagMatch[0].length)).trim();
    } else if (/\*\s*$/.test(line)) {
      flag = "*";
      line = line.replace(/\*\s*$/, "").trim();
    }

    // 2. Pull off a trailing reference range like "6.54 - 12.20" or "<10".
    let range = "";
    const rangeMatch = line.match(
      /([<>]?\d+\.?\d*)\s*-\s*([<>]?\d+\.?\d*)\s*$/
    );
    if (rangeMatch) {
      range = `${rangeMatch[1]}-${rangeMatch[2]}`;
      line = line.slice(0, rangeMatch.index).trim();
    }

    // 3. Split remaining "NAME VALUE UNIT".
    const m = line.match(
      /^(.*?)[\s:]+([<>]?-?\d+\.?\d*)\s*([A-Za-zμ%][A-Za-zμ%0-9/^.]*)?\s*$/
    );
    if (!m) return null;

    const name = m[1].trim().replace(/[,:\-]+$/, "").trim();
    const value = m[2].trim();
    const unit = (m[3] || "").trim();

    if (!name || name.length < 2 || !/[A-Za-z]/.test(name)) return null;
    // Reject names that are themselves just numbers/noise.
    if (/^\d+$/.test(name)) return null;

    return { name, value, unit, range, flag };
  }

  function parseText(text) {
    const lines = text.split(/\r?\n/);
    // Skip everything above the results table (patient info, clinic letterhead)
    // by starting after the first "Test Results ..." header row, if one is found.
    const headerIdx = lines.findIndex((l) => /^test\s+results?\b/i.test(l.trim()));
    const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
    const rows = [];
    for (const line of dataLines) {
      const row = parseLine(line);
      if (row) rows.push(row);
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

    tr.innerHTML = `
      <td class="col-include"><input type="checkbox" class="row-include" checked /></td>
      <td class="col-name"><input type="text" class="row-name" value="${escapeAttr(data.name || "")}" /></td>
      <td class="col-value"><input type="text" class="row-value" value="${escapeAttr(data.value || "")}" /></td>
      <td class="col-unit"><input type="text" class="row-unit" value="${escapeAttr(data.unit || "")}" /></td>
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
    addRow({ name: "", value: "", unit: "", range: "", flag: "" });
    tableSection.hidden = false;
    outputSection.hidden = false;
  });

  clearRowsBtn.addEventListener("click", () => {
    if (confirm("Remove all rows?")) {
      tbody.innerHTML = "";
      updateOutput();
    }
  });

  // ---------- Output generation ----------
  function updateOutput() {
    const includeUnit = optUnit.checked;
    const includeRange = optRange.checked;
    const includeFlag = optFlag.checked;

    const parts = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const include = tr.querySelector(".row-include").checked;
      if (!include) return;
      const name = tr.querySelector(".row-name").value.trim();
      const value = tr.querySelector(".row-value").value.trim();
      const unit = tr.querySelector(".row-unit").value.trim();
      const range = tr.querySelector(".row-range").value.trim();
      const flag = tr.querySelector(".flag-select").value;

      if (!name || !value) return;

      let s = `${name} ${value}`;
      if (includeUnit && unit) s += ` ${unit}`;
      if (includeRange && range) s += ` (${range})`;
      if (includeFlag && flag) s += ` ${flag}`;
      parts.push(s);
    });

    outputText.value = parts.join(", ");
  }

  [optUnit, optRange, optFlag].forEach((el) =>
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
