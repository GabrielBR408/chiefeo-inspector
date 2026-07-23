// ChiefEO Inspector — structured data export (CSV + JSON).
// Both formats consume the shared export model (exportModel.js), so the same
// self-check invariant holds: every derived section is present, nothing is
// invented. Builders are pure (no DOM) — the headless self-check runs them in
// Node. Browser download helpers live at the bottom, like exportDocx.js.
//
// Purpose: self-serve import into PMS platforms (Buildium / AppFolio / Yardi
// generic CSV imports) — NOT a native integration. So the CSV is a flat table
// with the report header repeated on every row: no join logic required on the
// receiving end. Photos are never embedded here (counts only) — no PMS import
// accepts base64 images, and they would bloat the JSON by megabytes.

import { buildExportModel } from './exportModel.js'
import { PKG_VERSION } from './buildInfo.js'

export const DATA_SCHEMA_VERSION = 1

// RFC 4180: quote a field if it contains a comma, quote, or line break; double
// embedded quotes. Everything else passes through untouched (verbatim narrative).
function csvField(value) {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvLine(cells) {
  return cells.map(csvField).join(',')
}

// UTF-8 BOM so Excel (the most likely first stop for these files) detects the
// encoding instead of mangling narrative text; CRLF per RFC 4180.
const BOM = '\uFEFF'
const CRLF = '\r\n'

const toModel = (reportOrModel) =>
  reportOrModel.sections && reportOrModel.header ? reportOrModel : buildExportModel(reportOrModel)

function sectionRow(header, s) {
  return [
    header.property, header.address, header.inspector, header.date,
    s.name, s.condition, s.autoSuggested ? 'yes' : 'no', s.text, s.followUp ? 'yes' : 'no', s.photoCount
  ]
}

// One row per narrative-derived section, header fields repeated on every row.
// `auto_suggested` marks a rating the inspector never confirmed, so a spreadsheet
// consumer can filter/flag them instead of trusting them as verified.
export function buildSectionsCsv(reportOrModel) {
  const model = toModel(reportOrModel)
  const lines = [csvLine([
    'property', 'address', 'inspector', 'date',
    'section', 'condition', 'auto_suggested', 'notes', 'follow_up', 'photo_count'
  ])]
  for (const s of model.sections) lines.push(csvLine(sectionRow(model.header, s)))
  return BOM + lines.join(CRLF) + CRLF
}

// The punch list as its own file — exactly the sections the exporters punch-list
// (flagged OR Poor, in section order), ready to paste into a work-order import.
// `flagged` distinguishes "user flagged it" from "rated Poor" for triage.
export function buildPunchListCsv(reportOrModel) {
  const model = toModel(reportOrModel)
  const lines = [csvLine([
    'property', 'address', 'inspector', 'date',
    'section', 'condition', 'notes', 'flagged', 'photo_count'
  ])]
  for (const s of model.followUps) {
    lines.push(csvLine([
      model.header.property, model.header.address, model.header.inspector, model.header.date,
      s.name, s.condition, s.text, s.followUp ? 'yes' : 'no', s.photoCount
    ]))
  }
  return BOM + lines.join(CRLF) + CRLF
}

// The full export model as JSON, minus photo data (photoCount only). Versioned
// so future consumers can branch on shape.
export function buildJsonExport(reportOrModel) {
  const model = toModel(reportOrModel)
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    app: 'ChiefEO Inspector',
    appVersion: PKG_VERSION,
    generatedAt: new Date().toISOString(),
    header: model.header,
    summary: model.summary,
    sections: model.sections.map((s) => ({
      id: s.id, key: s.key, name: s.name, condition: s.condition,
      // Machine-readable qualifier: true when the rating is auto-derived and not
      // yet confirmed by the inspector (mirrors the on-screen "auto-suggested" badge).
      autoSuggested: !!s.autoSuggested,
      text: s.text, followUp: s.followUp, photoCount: s.photoCount
    })),
    sectionCount: model.sectionCount,
    photoCount: model.photoCount,
    followUpCount: model.followUpCount,
    // Punch-list membership by section key — the section data itself lives
    // (once) in `sections`.
    punchListKeys: model.followUps.map((s) => s.key)
  }
}

export function buildJsonString(reportOrModel) {
  return JSON.stringify(buildJsonExport(reportOrModel), null, 2)
}

// --- Browser download helpers ------------------------------------------------

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Downloads the sections CSV, plus the punch-list CSV when there is anything on
// it (an empty second file on every export is noise, not signal). The short
// stagger keeps the second programmatic click from being swallowed by browsers
// that debounce same-tick downloads.
export async function downloadCsv(report, base = 'inspection') {
  const model = toModel(report)
  triggerDownload(
    new Blob([buildSectionsCsv(model)], { type: 'text/csv;charset=utf-8' }),
    `${base}_sections.csv`
  )
  if (model.followUps.length > 0) {
    await sleep(300)
    triggerDownload(
      new Blob([buildPunchListCsv(model)], { type: 'text/csv;charset=utf-8' }),
      `${base}_punch_list.csv`
    )
  }
}

export async function downloadJson(report, base = 'inspection') {
  triggerDownload(
    new Blob([buildJsonString(report)], { type: 'application/json' }),
    `${base}.json`
  )
}
