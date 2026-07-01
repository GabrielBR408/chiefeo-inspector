// ChiefEO Inspector — shared export model.
// Both the PDF (jsPDF) and DOCX (docx) renderers consume this single model, so
// asserting the model contains every item proves both exports do too. Pure, no DOM.

import { isValidCondition, DEFAULT_CONDITION } from './schema.js'

// Flatten a report into an ordered, render-agnostic structure.
export function buildExportModel(report) {
  const header = {
    title: 'Property Inspection Report',
    property: report.property || '',
    address: report.address || '',
    inspector: report.inspector || '',
    date: report.date || ''
  }
  const sections = (report.areas || []).map((area) => ({
    name: area.name || 'Area',
    items: (area.items || []).map((item) => ({
      id: item.id,
      name: item.name || '',
      condition: isValidCondition(item.condition) ? item.condition : DEFAULT_CONDITION,
      notes: item.notes || '',
      photoCount: (item.photos || []).length,
      // Keep the actual photo payloads for the PDF renderer (dataUrls). The
      // DOCX/text paths only use photoCount.
      photos: item.photos || []
    }))
  }))
  return {
    header,
    summary: report.summary || '',
    sections,
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
    photoCount: sections.reduce((n, s) => n + s.items.reduce((m, i) => m + i.photoCount, 0), 0)
  }
}

// Every item id in the model, in order. Used by the self-check to prove no item
// is dropped or invented on the way to export.
export function exportItemIds(model) {
  const ids = []
  for (const s of model.sections) for (const i of s.items) ids.push(i.id)
  return ids
}
