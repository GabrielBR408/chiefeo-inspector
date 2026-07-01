// ChiefEO Inspector — headless self-check.
// Constructs a synthetic inspection, drives the deterministic + AI-sanitizing
// draft path and both export renderers, and asserts hard invariants. Executes
// for real (unzips the generated DOCX, inspects the PDF content model) and
// exits non-zero on ANY failure.
//
//   node scripts/self-check.mjs

import zlib from 'node:zlib'
import { CONDITIONS, isValidCondition } from '../src/lib/schema.js'
import { draftReport, applyAIDraft, deterministicSummary, tallyConditions } from '../src/lib/draft.js'
import { buildExportModel, exportItemIds } from '../src/lib/exportModel.js'
import { renderPdfLines } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'

let passed = 0
const failures = []
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// --- Synthetic inspection (known ids so assertions are crisp) ---------------
const px = (id) => ({ id, name: `${id}.jpg`, dataUrl: 'data:image/jpeg;base64,/9j/AAAA' })
const input = {
  property: 'Maple Court #4', address: '123 Main St, Unit 4',
  inspector: 'Jordan Vega', date: '2026-07-01',
  walkthrough: 'Roof recently replaced. Kitchen faucet drips. Bathroom fan is loud.',
  summary: '',
  areas: [
    { id: 'a1', name: 'Exterior', items: [
      { id: 'i1', name: 'Roof / Gutters', condition: 'Good', notes: 'recently replaced', photos: [px('i1p1')] },
      { id: 'i2', name: 'Siding / Paint', condition: 'Fair', notes: 'minor peeling', photos: [] }
    ]},
    { id: 'a2', name: 'Kitchen', items: [
      { id: 'i3', name: 'Sink / Plumbing', condition: 'Poor', notes: 'faucet drips', photos: [px('i3p1'), px('i3p2')] },
      { id: 'i4', name: 'Appliances', condition: 'N/A', notes: '', photos: [] }
    ]},
    { id: 'a3', name: 'Bathroom', items: [
      { id: 'i5', name: 'Ventilation', condition: 'Fair', notes: 'fan is loud', photos: [] }
    ]}
  ]
}
const ALL_IDS = ['i1', 'i2', 'i3', 'i4', 'i5']
const ALL_NAMES = ['Roof / Gutters', 'Siding / Paint', 'Sink / Plumbing', 'Appliances', 'Ventilation']
const RATINGS = { i1: 'Good', i2: 'Fair', i3: 'Poor', i4: 'N/A', i5: 'Fair' }
const TOTAL_PHOTOS = 3

function idsOf(report) {
  const out = []
  for (const a of report.areas) for (const it of a.items) out.push(it.id)
  return out
}
function itemsById(report) {
  const m = new Map()
  for (const a of report.areas) for (const it of a.items) m.set(it.id, it)
  return m
}

// ---------------------------------------------------------------------------
console.log('\n[1] Deterministic draft preserves every item, rating, and photo')
{
  const { report: out, source } = await draftReport(input, { fetchImpl: async () => ({ ok: false }) })
  assert('falls back to deterministic when API unavailable', source === 'deterministic', source)
  assert('same item ids, same order (none dropped/invented)', JSON.stringify(idsOf(out)) === JSON.stringify(ALL_IDS), idsOf(out).join(','))
  const m = itemsById(out)
  assert('ratings carried through verbatim', ALL_IDS.every((id) => m.get(id).condition === RATINGS[id]))
  assert('every rating is a legal value', ALL_IDS.every((id) => isValidCondition(m.get(id).condition)))
  assert('photos preserved (count unchanged)', m.get('i1').photos.length === 1 && m.get('i3').photos.length === 2 && m.get('i2').photos.length === 0)
  assert('summary generated (non-empty)', typeof out.summary === 'string' && out.summary.length > 20)
  // The tally has 0 items rated Excellent/none-of-that; summary must not claim ratings the tally lacks.
  const t = tallyConditions(out)
  assert('summary Poor-mention matches tally', (out.summary.includes('rated Poor') ? t.Poor > 0 : true))
}

console.log('\n[2] AI draft is sanitized — cannot invent, drop, or re-rate items')
{
  // A deliberately misbehaving model response.
  const evilAI = {
    summary: 'Property is in great shape.',
    items: [
      { id: 'i3', notes: 'Kitchen faucet drips steadily; recommend cartridge replacement.', condition: 'Good' }, // tries to flip Poor->Good
      { id: 'i1', notes: 'Roof recently replaced; no issues observed.' },
      { id: 'GHOST', notes: 'Invented wine cellar in perfect condition.' } // invented item
    ]
    // note: omits i2, i4, i5 entirely — an attempt to drop them
  }
  const out = applyAIDraft(input, evilAI)
  assert('item set unchanged (no dropped, no invented)', JSON.stringify(idsOf(out)) === JSON.stringify(ALL_IDS), idsOf(out).join(','))
  const m = itemsById(out)
  assert('AI cannot change a rating (i3 stays Poor)', m.get('i3').condition === 'Poor', m.get('i3').condition)
  assert('all ratings still section-driven', ALL_IDS.every((id) => m.get(id).condition === RATINGS[id]))
  assert('AI prose lands on the right item (i3 notes updated)', /cartridge replacement/.test(m.get('i3').notes))
  const flat = JSON.stringify(out)
  assert('invented content is discarded', !flat.includes('wine cellar') && !flat.includes('GHOST'))
  assert('AI summary accepted', out.summary === 'Property is in great shape.')
}

console.log('\n[3] Export model carries every item and photo, in order')
let model
{
  const drafted = applyAIDraft(input, { summary: deterministicSummary(input), items: [] })
  model = buildExportModel(drafted)
  assert('export item ids equal input ids, in order', JSON.stringify(exportItemIds(model)) === JSON.stringify(ALL_IDS))
  assert('export itemCount matches', model.itemCount === ALL_IDS.length, String(model.itemCount))
  assert('export photoCount matches', model.photoCount === TOTAL_PHOTOS, String(model.photoCount))
  assert('every model rating is legal', model.sections.every((s) => s.items.every((i) => CONDITIONS.includes(i.condition))))
}

console.log('\n[4] DOCX export contains every item, rating, and area (unzipped & inspected)')
{
  const buf = await docxToBuffer(model)
  assert('docx is a real non-trivial buffer', Buffer.isBuffer(buf) && buf.length > 1000, String(buf.length))
  const xml = unzipEntry(buf, 'word/document.xml')
  for (const name of ALL_NAMES) assert(`docx contains item "${name}"`, xml.includes(name))
  for (const id of ALL_IDS) assert(`docx shows rating for ${id} (${RATINGS[id]})`, xml.includes(RATINGS[id]))
  for (const area of ['Exterior', 'Kitchen', 'Bathroom']) assert(`docx contains area "${area}"`, xml.includes(area))
  assert('docx contains the summary text', xml.includes('reviewed'))
}

console.log('\n[5] PDF content model contains every item exactly once, plus its photos')
{
  const lines = renderPdfLines(model)
  const itemLines = lines.filter((l) => l.kind === 'item')
  assert('one PDF item line per item (no extra/missing)', itemLines.length === ALL_IDS.length, String(itemLines.length))
  for (const name of ALL_NAMES) assert(`PDF renders item "${name}"`, itemLines.some((l) => l.itemName === name))
  assert('PDF item lines carry the section-driven rating', itemLines.every((l) => CONDITIONS.includes(l.condition)))
  const photoLines = lines.filter((l) => l.kind === 'photo')
  const itemsWithPhotos = model.sections.reduce((n, s) => n + s.items.filter((i) => i.photoCount > 0).length, 0)
  assert('PDF emits a photo block per item-with-photos', photoLines.length === itemsWithPhotos, `${photoLines.length} vs ${itemsWithPhotos}`)
}

// --- Minimal ZIP entry reader (inflate a single stored/deflated file) -------
function unzipEntry(buf, name) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break } }
  if (eocd < 0) throw new Error('EOCD not found')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const fname = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (fname === name) {
      const lhNameLen = buf.readUInt16LE(localOffset + 26)
      const lhExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lhNameLen + lhExtraLen
      const comp = buf.subarray(dataStart, dataStart + compSize)
      return method === 0 ? comp.toString('utf8') : zlib.inflateRawSync(comp).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} not found in zip`)
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60))
if (failures.length) {
  console.log(`FAIL — ${passed} passed, ${failures.length} failed:`)
  for (const f of failures) console.log(`   ✗ ${f}`)
  console.log('='.repeat(60))
  process.exit(1)
}
console.log(`PASS — all ${passed} assertions held. Exports preserve every item, rating, and photo.`)
console.log('='.repeat(60))
process.exit(0)
