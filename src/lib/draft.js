// ChiefEO Inspector — report drafting.
// Pure, deterministic core + an AI-orchestration wrapper. No DOM.
//
// INVARIANTS (asserted by scripts/self-check.mjs):
//  1. The drafted report contains EXACTLY the areas/items the user entered —
//     none dropped, none invented. Item ids are preserved 1:1.
//  2. Condition ratings are section-driven (carried through verbatim from the
//     user's entry). The AI is NEVER allowed to set or change a rating.
//  3. Every photo the user attached survives into the draft unchanged.
//
// The AI's ONLY job is prose: an overall property summary, and optionally a
// cleaned-up version of each item's notes. It cannot add/remove items or touch
// ratings/photos. The deterministic fallback does the same job with no API.

import { isValidCondition, DEFAULT_CONDITION } from './schema.js'

// Count ratings across every item — used by both the deterministic summary and
// as ground truth the AI summary is generated from.
export function tallyConditions(report) {
  const tally = { Good: 0, Fair: 0, Poor: 0, 'N/A': 0, total: 0 }
  for (const area of report.areas || []) {
    for (const item of area.items || []) {
      const c = isValidCondition(item.condition) ? item.condition : DEFAULT_CONDITION
      tally[c] += 1
      tally.total += 1
    }
  }
  return tally
}

// Deterministic summary — always available, no network. Factual, count-based:
// it never invents findings, it just states what was rated.
export function deterministicSummary(report) {
  const t = tallyConditions(report)
  const rated = t.total - t['N/A']
  const parts = []
  const who = report.inspector ? `${report.inspector} inspected` : 'Inspection of'
  const where = report.address || report.property || 'the property'
  parts.push(`${who} ${where}${report.date ? ` on ${report.date}` : ''}.`)
  parts.push(
    `${report.areas.length} area${report.areas.length === 1 ? '' : 's'} and ` +
      `${t.total} item${t.total === 1 ? '' : 's'} were reviewed` +
      (rated > 0 ? `, of which ${rated} received a condition rating.` : '.')
  )
  const flags = []
  if (t.Poor > 0) flags.push(`${t.Poor} item${t.Poor === 1 ? '' : 's'} rated Poor`)
  if (t.Fair > 0) flags.push(`${t.Fair} rated Fair`)
  if (t.Good > 0) flags.push(`${t.Good} rated Good`)
  if (flags.length) parts.push(`${flags.join(', ')}.`)
  if (t.Poor > 0) parts.push('Items rated Poor should be prioritized for follow-up.')
  return parts.join(' ')
}

// Sanitize an AI response so it can NEVER violate the invariants. We take the
// user's report as authoritative and only graft back: the summary string, and
// per-item notes keyed by id (ratings/photos/item-set are untouched).
export function applyAIDraft(report, ai) {
  const safe = {
    ...report,
    areas: report.areas.map((area) => ({
      ...area,
      items: area.items.map((item) => ({ ...item }))
    }))
  }
  if (!ai || typeof ai !== 'object') return safe

  if (typeof ai.summary === 'string' && ai.summary.trim()) {
    safe.summary = ai.summary.trim()
  }

  // Build an id -> item lookup so AI notes can only land on items that already
  // exist. Unknown ids are ignored (cannot invent items).
  if (Array.isArray(ai.items)) {
    const byId = new Map()
    for (const area of safe.areas) for (const item of area.items) byId.set(item.id, item)
    for (const entry of ai.items) {
      if (!entry || typeof entry.id !== 'string') continue
      const item = byId.get(entry.id)
      if (!item) continue
      if (typeof entry.notes === 'string' && entry.notes.trim()) {
        item.notes = entry.notes.trim()
      }
      // Deliberately IGNORE any condition/photos the AI tries to send.
    }
  }
  return safe
}

// Client entrypoint: try the serverless AI draft, fall back to deterministic.
// `fetchImpl` is injectable for testing; defaults to global fetch in browser.
export async function draftReport(report, { fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  const payload = buildDraftPayload(report)

  if (doFetch) {
    try {
      const res = await doFetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res && res.ok) {
        const ai = await res.json()
        return { report: applyAIDraft(report, ai), source: 'ai' }
      }
    } catch (_err) {
      // fall through to deterministic
    }
  }
  return { report: { ...applyAIDraft(report, null), summary: deterministicSummary(report) }, source: 'deterministic' }
}

// The compact, PII-light payload the serverless function receives. Photos are
// sent as counts only (never bytes) — the AI writes prose, it doesn't see images.
export function buildDraftPayload(report) {
  return {
    property: report.property,
    address: report.address,
    inspector: report.inspector,
    date: report.date,
    walkthrough: report.walkthrough || '',
    tally: tallyConditions(report),
    areas: report.areas.map((area) => ({
      name: area.name,
      items: area.items.map((item) => ({
        id: item.id,
        name: item.name,
        condition: item.condition,
        notes: item.notes,
        photoCount: (item.photos || []).length
      }))
    }))
  }
}
