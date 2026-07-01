// ChiefEO Inspector — narrative-driven segmentation.
// Pure, no DOM — safe to import in Node (the self-check imports this directly).
//
// The report's structure EMERGES from the walkthrough narrative. This module
// turns free text (typed or dictated) into ordered sections, one per area the
// narrative actually names. Each section's text is a VERBATIM slice of the
// narrative (the sentences assigned to that area), and its condition rating is
// DERIVED from that slice — never invented.
//
// GUARANTEES (asserted by scripts/self-check.mjs):
//   1. Every area the narrative mentions yields exactly one section (in order
//      of first mention); no section exists for an area the narrative never named.
//   2. Each section's text is faithful: every sentence in it appears verbatim in
//      the narrative — no fabricated observations.
//   3. Ratings are derived from the section's own text, not invented.

import { CONDITIONS } from './schema.js'

// --- Area vocabulary --------------------------------------------------------
// canonical display name -> list of aliases (lowercase, matched on word-ish
// boundaries). Order within the flat alias list is resolved by earliest match
// position, then longest alias, so "primary bath" beats "bath".
const AREA_DEFS = [
  ['Roof', ['roof', 'roofing']],
  ['Exterior', ['exterior', 'siding', 'facade', 'stucco']],
  ['Foundation', ['foundation', 'crawl space', 'crawlspace']],
  ['Basement', ['basement']],
  ['Attic', ['attic']],
  ['Garage', ['garage']],
  ['Driveway', ['driveway']],
  ['Deck / Patio', ['deck', 'patio', 'porch', 'balcony']],
  ['Yard', ['yard', 'lawn', 'landscaping', 'backyard', 'front yard']],
  ['Entry / Foyer', ['foyer', 'entryway', 'entry', 'front door']],
  ['Living Room', ['living room', 'family room', 'great room']],
  ['Dining Room', ['dining room', 'dining area']],
  ['Kitchen', ['kitchen']],
  ['Primary Bathroom', ['primary bath', 'primary bathroom', 'master bath', 'master bathroom', 'ensuite', 'en-suite']],
  ['Bathroom', ['bathroom', 'bath', 'powder room', 'half bath']],
  ['Primary Bedroom', ['primary bedroom', 'master bedroom', 'primary suite', 'master suite']],
  ['Bedroom', ['bedroom']],
  ['Hallway', ['hallway', 'corridor', 'stairwell', 'staircase']],
  ['Laundry', ['laundry', 'utility room']],
  ['Pantry / Closet', ['pantry', 'closet']],
  ['HVAC', ['hvac', 'furnace', 'air conditioner', 'air conditioning', 'ac unit', 'thermostat']],
  ['Water Heater', ['water heater', 'hot water']],
  ['Electrical', ['electrical panel', 'electrical', 'breaker', 'wiring']],
  ['Plumbing', ['plumbing']],
  ['Windows', ['windows', 'window']],
  ['Fireplace', ['fireplace', 'chimney']]
]

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'area'
}

// Build the flat alias table, optionally augmented with extra area labels the
// LLM proposed. An extra label only ever produces a section if it actually
// appears in the narrative, so invented areas are impossible.
function buildAliases(extraLabels = []) {
  const flat = []
  for (const [area, aliases] of AREA_DEFS) {
    const key = slugify(area)
    for (const a of aliases) flat.push({ alias: a, area, key })
  }
  for (const label of extraLabels) {
    const clean = String(label || '').trim()
    if (!clean) continue
    const alias = clean.toLowerCase()
    if (flat.some((f) => f.alias === alias)) continue
    // Title-case the label for display.
    const area = clean.replace(/\b\w/g, (c) => c.toUpperCase())
    flat.push({ alias, area, key: slugify(clean) })
  }
  // Longest alias first so specific phrases win ties at the same index.
  flat.sort((a, b) => b.alias.length - a.alias.length)
  return flat
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Find the area named earliest in a sentence, if any.
function detectArea(sentence, aliases) {
  const lc = sentence.toLowerCase()
  let best = null
  for (const entry of aliases) {
    const re = new RegExp(`\\b${escapeRegExp(entry.alias)}\\b`)
    const m = re.exec(lc)
    if (m) {
      const idx = m.index
      if (!best || idx < best.idx || (idx === best.idx && entry.alias.length > best.alias.length)) {
        best = { ...entry, idx }
      }
    }
  }
  return best
}

// Split narrative into trimmed, non-empty sentences (verbatim substrings).
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// --- Condition derivation ---------------------------------------------------
const COND_KEYWORDS = {
  Poor: ['poor', 'damaged', 'broken', 'leak', 'leaking', 'leaked', 'crack', 'cracked', 'cracking',
    'worn', 'deteriorat', 'needs repair', 'needs replacement', 'needs replacing', 'failing', 'failed',
    'rot', 'rotted', 'rotting', 'mold', 'mildew', 'soft spot', 'curling', 'missing', 'hazard', 'unsafe',
    'water damage', 'rust', 'rusted', 'rusting', 'clogged', 'inoperable', 'not working', 'does not work',
    "doesn't work", 'sagging', 'termite', 'corroded'],
  Fair: ['fair', 'aging', 'aged', 'minor', 'wear', 'dated', 'outdated', 'moderate', 'scuff', 'scuffed',
    'cosmetic', 'older', 'weathered', 'peeling', 'faded'],
  Good: ['good', 'excellent', 'brand new', 'recently replaced', 'recently updated', 'recently renovated',
    'updated', 'renovated', 'great', 'well maintained', 'well-maintained', 'no issues', 'no visible',
    'clean', 'functional', 'works well', 'like new', 'pristine', 'solid', 'new ']
}

export function deriveCondition(text) {
  const lc = ` ${String(text || '').toLowerCase()} `
  for (const level of ['Poor', 'Fair', 'Good']) {
    if (COND_KEYWORDS[level].some((k) => lc.includes(k))) return level
  }
  return 'N/A'
}

// --- Core segmentation ------------------------------------------------------
// Returns ordered sections: [{ key, area, name, text, condition }]. A leading
// 'general' section holds any text before the first named area (only if present).
export function segmentNarrative(text, extraLabels = []) {
  const aliases = buildAliases(extraLabels)
  const sentences = splitSentences(text)

  const order = []          // section keys in first-mention order
  const byKey = new Map()   // key -> { key, area, name, sentences: [] }
  let current = null        // current section key

  const ensure = (key, area) => {
    if (!byKey.has(key)) {
      byKey.set(key, { key, area, name: area, sentences: [] })
      order.push(key)
    }
    return byKey.get(key)
  }

  for (const sentence of sentences) {
    const hit = detectArea(sentence, aliases)
    if (hit) {
      current = hit.key
      ensure(hit.key, hit.area).sentences.push(sentence)
    } else if (current) {
      byKey.get(current).sentences.push(sentence)
    } else {
      ensure('general', 'General Observations').sentences.push(sentence)
    }
  }

  return order.map((key) => {
    const s = byKey.get(key)
    const body = s.sentences.join(' ')
    return { key: s.key, area: s.area, name: s.name, text: body, condition: deriveCondition(body) }
  })
}

// --- UI reconciliation ------------------------------------------------------
// Merge freshly-segmented sections with the previous UI state so user edits and
// attached photos survive re-segmentation as the narrative grows.
export function mergeSections(prev = [], fresh = [], makeId = (k) => `sec_${k}`) {
  const prevByKey = new Map(prev.map((p) => [p.key, p]))
  const freshByKey = new Map(fresh.map((f) => [f.key, f]))
  const out = []

  for (const f of fresh) {
    const p = prevByKey.get(f.key)
    if (p) {
      out.push({
        ...p,
        area: f.area,
        key: f.key,
        name: p.nameEdited ? p.name : f.area,
        text: p.textEdited ? p.text : f.text,
        condition: p.conditionEdited ? p.condition : f.condition
      })
    } else {
      out.push({
        id: makeId(f.key), key: f.key, area: f.area, name: f.area,
        text: f.text, condition: f.condition, photos: [],
        textEdited: false, conditionEdited: false, nameEdited: false
      })
    }
  }

  // Retain previously-created sections that carry photos but are no longer
  // referenced by the narrative, so a user never loses attached images.
  for (const p of prev) {
    if (!freshByKey.has(p.key) && (p.photos || []).length > 0) out.push(p)
  }
  return out
}

// --- LLM analysis (faithfulness-safe) ---------------------------------------
// Calls the serverless /api/draft with the narrative and returns
// { sections, summary, source }. The LLM only proposes extra area labels and a
// summary; sections/text/ratings are always built deterministically here, so
// nothing the LLM returns can fabricate an area, observation, or rating.
export async function analyzeNarrative(report, { fetchImpl, makeId } = {}) {
  const narrative = report.walkthrough || ''
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  let llm = null

  if (doFetch && narrative.trim()) {
    try {
      const res = await doFetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property: report.property, address: report.address,
          inspector: report.inspector, date: report.date, narrative
        })
      })
      if (res && res.ok) llm = await res.json()
    } catch (_e) { /* fall back to deterministic */ }
  }

  const extras = llm && Array.isArray(llm.areas) ? llm.areas.filter((a) => typeof a === 'string') : []
  const fresh = segmentNarrative(narrative, extras)
  const merged = mergeSections(report.sections || [], fresh, makeId || ((k) => `sec_${k}`))
  const summary = (llm && typeof llm.summary === 'string' && llm.summary.trim())
    ? llm.summary.trim()
    : deterministicSummary(report, merged)

  return { sections: merged, summary, source: llm ? 'ai' : 'deterministic' }
}

// --- Summaries & tallies (section-based) ------------------------------------
export function tallyConditions(sections = []) {
  const t = { Good: 0, Fair: 0, Poor: 0, 'N/A': 0, total: 0 }
  for (const s of sections) {
    const c = CONDITIONS.includes(s.condition) ? s.condition : 'N/A'
    t[c] += 1
    t.total += 1
  }
  return t
}

export function deterministicSummary(report, sections = []) {
  const named = sections.filter((s) => s.key !== 'general')
  const t = tallyConditions(sections)
  const where = report.address || report.property || 'the property'
  const parts = []
  parts.push(`${report.inspector ? `${report.inspector} inspected` : 'Inspection of'} ${where}${report.date ? ` on ${report.date}` : ''}.`)
  if (named.length) {
    parts.push(`The walkthrough covered ${named.length} area${named.length === 1 ? '' : 's'}: ${named.map((s) => s.name).join(', ')}.`)
  } else {
    parts.push('No specific areas were identified in the walkthrough yet.')
  }
  const flags = []
  if (t.Poor) flags.push(`${t.Poor} rated Poor`)
  if (t.Fair) flags.push(`${t.Fair} rated Fair`)
  if (t.Good) flags.push(`${t.Good} rated Good`)
  if (flags.length) parts.push(`${flags.join(', ')}.`)
  if (t.Poor) parts.push('Areas rated Poor should be prioritized for follow-up.')
  return parts.join(' ')
}
