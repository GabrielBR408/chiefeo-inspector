// ChiefEO Inspector — shared export model (narrative-driven).
// Both the PDF (jsPDF) and DOCX (docx) renderers consume this single model, so
// asserting the model contains every section proves both exports do too. Pure.

import { isValidCondition, DEFAULT_CONDITION } from './schema.js'

// Major building systems an owner would expect a full inspection to touch. The
// free-form "just talk" model never forces coverage, so a system that was never
// mentioned simply produces no section — indistinguishable, on a skim, from a
// system that was inspected and found fine. We surface the gap explicitly: any
// system whose keywords never appear in the walkthrough is reported as "not
// mentioned", so an owner never reads silence as a clean bill of health.
const CRITICAL_SYSTEMS = [
  { label: 'Roof', re: /\b(roof|roofing|rooftop)\b/i },
  { label: 'HVAC / heating & cooling', re: /\b(hvac|furnace|air condition\w*|\bac\b|ac unit|heating|cooling|thermostat|rooftop unit|rtu|boiler)\b/i },
  { label: 'Electrical', re: /\b(electrical|breaker|panel|wiring|outlet|receptacle)\b/i },
  { label: 'Plumbing', re: /\b(plumbing|pipe|piping|drain|sewer|faucet|fixture|water heater|hot water)\b/i },
  { label: 'Foundation / structure', re: /\b(foundation|structural|structure|slab|crawl\s?space|footing)\b/i },
  { label: 'Life-safety (smoke/fire/egress)', re: /\b(smoke detector|smoke alarm|fire alarm|fire extinguisher|sprinkler|life[- ]safety|egress|emergency exit|carbon monoxide|co detector)\b/i }
]

// The critical systems whose keywords never appear in the walkthrough. Returned
// as plain labels for the exporters and the on-screen coverage note. An empty
// walkthrough returns [] (nothing to warn about on a blank report).
export function coverageGaps(walkthrough) {
  const text = String(walkthrough || '')
  if (!text.trim()) return []
  return CRITICAL_SYSTEMS.filter((s) => !s.re.test(text)).map((s) => s.label)
}

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
  const sections = (report.sections || []).map((s) => {
    const condition = isValidCondition(s.condition) ? s.condition : DEFAULT_CONDITION
    return {
      id: s.id || `sec_${s.key}`,
      key: s.key,
      name: s.name || s.area || 'Area',
      condition,
      // An auto-derived rating the inspector has NOT confirmed (no conditionEdited).
      // The on-screen "auto-suggested" badge must survive into every export so a
      // downstream reader can't mistake an unconfirmed rating for a human-verified
      // one. N/A carries no claim, so it is never flagged (mirrors the UI badge).
      autoSuggested: !s.conditionEdited && condition !== 'N/A',
      text: s.text || '',
      followUp: !!s.followUp,
      photoCount: (s.photos || []).length,
      photos: s.photos || []
    }
  })
  // Condition tallies, so exports can carry a ratings summary without recomputing.
  const conditionCounts = sections.reduce((acc, s) => {
    acc[s.condition] = (acc[s.condition] || 0) + 1
    return acc
  }, { Good: 0, Fair: 0, Poor: 0, 'N/A': 0 })
  return {
    header,
    summary: report.summary || '',
    sections,
    sectionCount: sections.length,
    photoCount: sections.reduce((n, s) => n + s.photoCount, 0),
    followUpCount: sections.filter((s) => s.followUp).length,
    conditionCounts,
    // Major systems the walkthrough never mentioned — reported so silence is
    // never mistaken for a passing inspection.
    coverageGaps: coverageGaps(report.walkthrough),
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
