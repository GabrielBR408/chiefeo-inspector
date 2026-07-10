// ChiefEO Inspector — shared export model (narrative-driven).
// Both the PDF (jsPDF) and DOCX (docx) renderers consume this single model, so
// asserting the model contains every section proves both exports do too. Pure.

import { isValidCondition, DEFAULT_CONDITION } from './schema.js'

// Flatten a report into an ordered, render-agnostic structure. One block per
// narrative-derived section.
export function buildExportModel(report) {
  const header = {
    title: 'Property Inspection Report',
    property: report.property || '',
    address: report.address || '',
    inspector: report.inspector || '',
    date: report.date || ''
  }
  const sections = (report.sections || []).map((s) => ({
    id: s.id || `sec_${s.key}`,
    key: s.key,
    name: s.name || s.area || 'Area',
    condition: isValidCondition(s.condition) ? s.condition : DEFAULT_CONDITION,
    text: s.text || '',
    followUp: !!s.followUp,
    photoCount: (s.photos || []).length,
    photos: s.photos || []
  }))
  return {
    header,
    summary: report.summary || '',
    sections,
    sectionCount: sections.length,
    photoCount: sections.reduce((n, s) => n + s.photoCount, 0),
    followUpCount: sections.filter((s) => s.followUp).length,
    // The single punch list, in section order: a section belongs on it if the
    // user FLAGGED it OR it rates Poor (a Poor area is dispatchable work whether
    // or not anyone remembered to flag it). Both exporters render exactly these.
    followUps: sections.filter((s) => s.followUp || s.condition === 'Poor')
  }
}

// Every section key in the model, in order. Used by the self-check to prove no
// section is dropped or invented on the way to export.
export function exportSectionKeys(model) {
  return model.sections.map((s) => s.key)
}
