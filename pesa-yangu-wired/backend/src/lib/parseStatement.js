"use strict";
// Best-effort extraction of a single repayment's amount/date/reference from an
// uploaded PDF or CSV statement. Heuristic, not a full bank-format parser —
// the caller always treats the result as a prefill, not a final value.

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function pad(n) { return String(n).padStart(2, "0"); }

function normaliseDate(y, m, d) {
  if (!y || !m || !d) return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function findDate(text) {
  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return normaliseDate(+m[1], +m[2], +m[3]);

  m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (m) {
    // Ambiguous DD/MM vs MM/DD — prefer DD/MM (East African convention) unless
    // the first number can't be a day.
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12) return normaliseDate(y, b, a);
    return normaliseDate(y, b, a) || normaliseDate(y, a, b);
  }

  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[2].slice(0,3).toLowerCase()];
    if (mon) return normaliseDate(+m[3], mon, +m[1]);
  }

  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mon = MONTHS[m[1].slice(0,3).toLowerCase()];
    if (mon) return normaliseDate(+m[3], mon, +m[2]);
  }

  return null;
}

function toNumber(str) {
  return parseFloat(String(str).replace(/,/g, ""));
}

function findAmount(text) {
  const labelRe = /(?:amount\s*paid|total\s*paid|payment\s*amount|amount\s*due|total\s*amount|total|amount|paid)\s*[:\-]?\s*(?:kes|ksh|kshs|usd|\$)?\s*([\d,]+\.\d{1,2}|[\d,]{2,})/gi;
  let best = null;
  let mm;
  while ((mm = labelRe.exec(text))) {
    const n = toNumber(mm[1]);
    if (n > 0 && (!best || n > best)) best = n;
  }
  if (best) return best;

  const currencyRe = /(?:kes|ksh|kshs)\s*([\d,]+\.\d{1,2}|[\d,]{2,})/gi;
  while ((mm = currencyRe.exec(text))) {
    const n = toNumber(mm[1]);
    if (n > 0 && (!best || n > best)) best = n;
  }
  if (best) return best;

  const plainRe = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+\.\d{2}\b/g;
  while ((mm = plainRe.exec(text))) {
    const n = toNumber(mm[0]);
    if (n > 0 && (!best || n > best)) best = n;
  }
  return best;
}

function findReference(text) {
  const m = text.match(/(?:reference|ref\.?\s*no\.?|receipt\s*no\.?|transaction\s*id|txn\s*id|confirmation\s*code)\s*[:\-]?\s*([A-Za-z0-9\-]{4,25})/i);
  return m ? `${m[0].split(/[:\-]/)[0].trim()}: ${m[1]}` : null;
}

function findLabeledDate(text) {
  const m = text.match(/(?:date\s*of\s*payment|payment\s*date|value\s*date|transaction\s*date|paid\s*on|received\s*on)\s*[:\-]?\s*([^\n,;]{6,25})/i);
  return m ? findDate(m[1]) : null;
}

function extractFromFreeText(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return {
    amount_kes:   findAmount(flat),
    payment_date: findLabeledDate(flat) || findDate(flat),
    note:         findReference(flat),
  };
}

function extractFromCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return extractFromFreeText(text);

  const hdrs = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/["']/g, ""));
  const get = (v, keys) => { for (const k of keys) { const i = hdrs.indexOf(k); if (i >= 0 && v[i]) return v[i]; } return ""; };

  const rows = lines.slice(1).map(line => {
    const v = line.split(",").map(x => x.trim().replace(/^"|"$/g, ""));
    return {
      date:   get(v, ["date", "payment date", "value date", "transaction date"]),
      amount: get(v, ["amount", "total", "amount paid", "total paid", "payment", "debit"]),
      note:   get(v, ["reference", "ref", "ref no", "description", "narration", "note"]),
    };
  }).filter(r => r.date || r.amount);

  if (!rows.length) return extractFromFreeText(text);
  const row = rows[rows.length - 1]; // most recent row = the repayment being recorded
  return {
    amount_kes:   row.amount ? toNumber(row.amount) : null,
    payment_date: row.date ? (findDate(row.date) || row.date.slice(0, 10)) : null,
    note:         row.note || null,
  };
}

async function extractRepaymentFromFile(file) {
  const name = (file.originalname || "").toLowerCase();
  const isPDF = file.mimetype === "application/pdf" || name.endsWith(".pdf");
  const isImage = file.mimetype.startsWith("image/") || /\.(jpe?g|png)$/.test(name);

  if (isImage) {
    return { amount_kes: null, payment_date: null, note: null, warning: "Photos aren't auto-read yet — please fill in the fields manually." };
  }

  let text;
  if (isPDF) {
    try {
      const { PDFParse } = require("pdf-parse");
      const parser = new PDFParse({ data: file.buffer });
      const result = await parser.getText();
      text = result.text || "";
    } catch {
      return { amount_kes: null, payment_date: null, note: null, warning: "Couldn't open this PDF — it may be password-protected or corrupted. Please fill in the fields manually." };
    }
  } else {
    text = file.buffer.toString("utf-8");
  }

  if (!text.trim()) {
    return { amount_kes: null, payment_date: null, note: null, warning: "Could not read any text from this file — it may be a scanned image. Please fill in the fields manually." };
  }

  const looksLikeCSV = !isPDF && /,/.test(text.split(/\r?\n/)[0] || "");
  const fields = looksLikeCSV ? extractFromCSV(text) : extractFromFreeText(text);

  if (!fields.amount_kes && !fields.payment_date) {
    fields.warning = "Couldn't confidently find an amount or date in this file — please check the fields below.";
  }
  return fields;
}

module.exports = { extractRepaymentFromFile };
