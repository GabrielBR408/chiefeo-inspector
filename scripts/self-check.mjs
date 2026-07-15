// ChiefEO Inspector — headless self-check (narrative-driven model).
// Drives segmentation, the AI-sanitizing analysis path, and both export
// renderers, asserting hard invariants. Executes for real (unzips the generated
// DOCX, inspects the PDF content model) and exits non-zero on ANY failure.
//
//   node scripts/self-check.mjs

import zlib from 'node:zlib'
import { CONDITIONS } from '../src/lib/schema.js'
import {
  segmentNarrative, splitSentences, deriveCondition, analyzeNarrative,
  tallyConditions, deterministicSummary, lastMentionedKey, mergeSections,
  effectiveRemovedKeys, prefixHash, draftBannerMessage
} from '../src/lib/segment.js'
import { parseDetails, parseDetailsSmart, extractDate } from '../src/lib/details.js'
import { buildExportModel, exportSectionKeys } from '../src/lib/exportModel.js'
import { renderPdfLines, pdfToArrayBuffer } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'
import { dataUrlToBytes, imageSize, fitBox } from '../src/lib/imageMeta.js'
import { classifyDictationError, dictationEventProps, uaClass } from '../src/lib/voiceErrors.js'

let passed = 0
const failures = []
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim()
function faithful(narrative, sectionText) {
  const N = norm(narrative)
  return splitSentences(sectionText).every((sent) => N.includes(norm(sent)))
}

// --- Synthetic walkthrough narrative ----------------------------------------
// Names five areas in order; each carries a distinct, verbatim observation with
// a condition cue. It deliberately does NOT mention a garage/pool/attic.
const NARRATIVE =
  'Starting outside, the roof was recently replaced and is in good shape. ' +
  'The kitchen countertops are worn and the faucet is leaking. ' +
  'In the primary bath the vanity is dated with minor wear. ' +
  'The basement shows a crack in the foundation wall and some water damage. ' +
  'Finally, the living room paint is dated but clean.'

const EXPECTED_KEYS = ['roof', 'kitchen', 'primarybathroom', 'basement', 'livingroom']
const EXPECTED_COND = { roof: 'Good', kitchen: 'Poor', primarybathroom: 'Fair', basement: 'Poor', livingroom: 'Fair' }
const NOT_MENTIONED = ['garage', 'attic', 'pool', 'swimming pool', 'bedroom']

const baseReport = {
  property: 'Maple Court #4', address: '123 Main St, Unit 4',
  inspector: 'Jordan Vega', date: '2026-07-01',
  walkthrough: NARRATIVE, summary: '', sections: []
}

// ---------------------------------------------------------------------------
console.log('\n[1] Sections match narrated areas exactly, in first-mention order')
{
  const secs = segmentNarrative(NARRATIVE)
  const keys = secs.map((s) => s.key)
  assert('exactly the mentioned areas, in order', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), keys.join(','))
  assert('one section per mentioned area (no duplicates)', new Set(keys).size === keys.length)
  for (const nm of NOT_MENTIONED) assert(`no section for un-mentioned "${nm}"`, !keys.includes(nm.replace(/\s+/g, '')))
  assert('every section has a display name', secs.every((s) => s.name && s.name.length > 0))
}

console.log('\n[2] Each section\'s text is a faithful, verbatim slice of the narrative')
{
  const secs = segmentNarrative(NARRATIVE)
  for (const s of secs) assert(`"${s.name}" text is verbatim from narrative`, faithful(NARRATIVE, s.text), s.text)
  // And the specific observation lands in the right section (no cross-attribution).
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('kitchen slice mentions the faucet, not the roof', /faucet/.test(byKey.kitchen.text) && !/roof/.test(byKey.kitchen.text))
  assert('basement slice mentions the foundation crack', /crack in the foundation/.test(byKey.basement.text))
}

console.log('\n[3] Ratings are DERIVED from each section\'s own text (not invented)')
{
  const secs = segmentNarrative(NARRATIVE)
  for (const s of secs) {
    assert(`${s.key} rating is legal`, CONDITIONS.includes(s.condition))
    assert(`${s.key} rating matches its narrated cue (${EXPECTED_COND[s.key]})`, s.condition === EXPECTED_COND[s.key], s.condition)
  }
  // deriveCondition is text-driven: no cue => N/A.
  assert('no condition cue yields N/A', deriveCondition('The hallway leads to the bedrooms.') === 'N/A')
  assert('a damage cue yields Poor', deriveCondition('there is a leak here') === 'Poor')
}

console.log('\n[4] AI pass cannot invent an area, observation, or rating')
{
  // A misbehaving model: proposes a real extra area ("garage" — NOT in narrative),
  // an invented area ("wine cellar"), and a bogus summary. The client must ignore
  // any label the narrative doesn\'t actually contain.
  const evilFetch = async () => ({
    ok: true,
    json: async () => ({ areas: ['garage', 'wine cellar', 'swimming pool'], summary: 'Everything is pristine.' })
  })
  const { sections, summary, source } = await analyzeNarrative(baseReport, { fetchImpl: evilFetch, makeId: (k) => `sec_${k}` })
  assert('used the AI path', source === 'ai')
  const keys = sections.map((s) => s.key)
  assert('no invented area entered the report', !keys.some((k) => ['garage', 'winecellar', 'swimmingpool', 'pool'].includes(k)), keys.join(','))
  assert('sections still equal the narrated areas', JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS), keys.join(','))
  for (const s of sections) assert(`${s.key} text still faithful after AI pass`, faithful(NARRATIVE, s.text))
  for (const s of sections) assert(`${s.key} rating still derived (${EXPECTED_COND[s.key]})`, s.condition === EXPECTED_COND[s.key], s.condition)
  assert('AI summary is accepted (prose only)', summary === 'Everything is pristine.')
}

console.log('\n[5] AI-proposed label that IS in the narrative can add a section')
{
  // "mudroom" is not in the base vocabulary; if the narrative names it and the
  // model surfaces it, it should become a faithful section.
  const rep = { ...baseReport, walkthrough: NARRATIVE + ' The mudroom floor is cracked.', sections: [] }
  const okFetch = async () => ({ ok: true, json: async () => ({ areas: ['mudroom'], summary: 'ok' }) })
  const { sections } = await analyzeNarrative(rep, { fetchImpl: okFetch, makeId: (k) => `sec_${k}` })
  const mud = sections.find((s) => s.key === 'mudroom')
  assert('narrated + AI-surfaced "mudroom" becomes a section', !!mud)
  assert('mudroom text is faithful', mud && faithful(rep.walkthrough, mud.text))
  assert('mudroom rating derived from its text (Poor)', mud && mud.condition === 'Poor', mud && mud.condition)
}

console.log('\n[6] Deterministic fallback (no AI) segments + summarizes')
{
  const { sections, summary, source } = await analyzeNarrative(baseReport, { fetchImpl: async () => ({ ok: false }), makeId: (k) => `sec_${k}` })
  assert('fell back to deterministic', source === 'deterministic')
  assert('sections equal narrated areas', JSON.stringify(sections.map((s) => s.key)) === JSON.stringify(EXPECTED_KEYS))
  assert('summary is non-empty', typeof summary === 'string' && summary.length > 20)
  assert('summary lists a detected area', summary.includes('Kitchen'))
}

console.log('\n[7] Export model + DOCX + PDF contain every derived section')
let model
{
  const secs = segmentNarrative(NARRATIVE).map((s) => ({ ...s, id: `sec_${s.key}`, photos: s.key === 'kitchen' ? [{ id: 'p1', name: 'k.jpg', dataUrl: 'data:image/jpeg;base64,/9j/AA' }] : [] }))
  const report = { ...baseReport, sections: secs, summary: deterministicSummary(baseReport, secs) }
  model = buildExportModel(report)

  assert('export keys equal narrated areas, in order', JSON.stringify(exportSectionKeys(model)) === JSON.stringify(EXPECTED_KEYS))
  assert('export sectionCount matches', model.sectionCount === EXPECTED_KEYS.length, String(model.sectionCount))
  assert('export photoCount matches', model.photoCount === 1, String(model.photoCount))

  const buf = await docxToBuffer(model)
  assert('docx is a real non-trivial buffer', Buffer.isBuffer(buf) && buf.length > 1000, String(buf.length))
  const xml = unzipEntry(buf, 'word/document.xml')
  for (const s of model.sections) assert(`docx contains section "${s.name}"`, xml.includes(s.name))
  for (const s of model.sections) assert(`docx shows ${s.key} rating (${s.condition})`, xml.includes(s.condition))
  assert('docx contains a narrated observation (faucet)', xml.includes('faucet'))
  assert('docx does NOT contain an un-mentioned area (garage)', !xml.toLowerCase().includes('garage'))

  const lines = renderPdfLines(model)
  const secLines = lines.filter((l) => l.kind === 'section')
  assert('one PDF section fragment per section', secLines.length === EXPECTED_KEYS.length, String(secLines.length))
  for (const s of model.sections) assert(`PDF renders section "${s.name}"`, secLines.some((l) => l.sectionName === s.name))
  assert('PDF section fragments carry a legal rating', secLines.every((l) => CONDITIONS.includes(l.condition)))
  const photoLines = lines.filter((l) => l.kind === 'photo')
  assert('PDF emits a photo block for the section with a photo', photoLines.length === 1, String(photoLines.length))
}

console.log('\n[8] Run-on, UNPUNCTUATED multi-area dictation splits into one section per area')
{
  // Generic synthetic run-on: no periods; a capitalized word ("There") cues the
  // new spoken sentence the way phone dictation does.
  const REPRO = 'The north lobby has some debris in the corner so note that There is a water leak in the basement'
  const secs = segmentNarrative(REPRO)
  const keys = secs.map((s) => s.key)
  assert('splits into exactly two sections', secs.length === 2, keys.join(','))
  assert('sections are North Lobby then Basement', JSON.stringify(keys) === JSON.stringify(['northlobby', 'basement']), keys.join(','))
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('North Lobby text is the lobby clause (with follow-up), verbatim',
    byKey.northlobby && byKey.northlobby.text === 'The north lobby has some debris in the corner so note that',
    byKey.northlobby && byKey.northlobby.text)
  assert('Basement text is the basement clause, verbatim',
    byKey.basement && byKey.basement.text === 'There is a water leak in the basement',
    byKey.basement && byKey.basement.text)
  assert('both slices are faithful to the narrative', secs.every((s) => faithful(REPRO, s.text)))
  assert('Basement observation did NOT leak into North Lobby', !/leak in the basement/.test(byKey.northlobby.text))
  assert('North Lobby display name carries the modifier', byKey.northlobby.name === 'North Lobby', byKey.northlobby.name)
  assert('basement rating derived (Poor from "leak")', byKey.basement.condition === 'Poor', byKey.basement.condition)

  // Regression guard: a component word inside one clause must NOT split (no cue).
  const oneClause = segmentNarrative('The basement shows a crack in the foundation wall and some water damage.')
  assert('component word "foundation" does not spawn a false section', oneClause.length === 1 && oneClause[0].key === 'basement', oneClause.map((s) => s.key).join(','))
}

console.log('\n[9] Punctuated multi-area walkthrough yields one section per area (no commingling)')
{
  // Generic synthetic walkthrough: 4 sentences naming 4 distinct areas. Sentences
  // 3 & 4 name areas ("office", "loading dock") that must be recognized so they do
  // NOT fall through into the previous section (Lobby) — the commingling bug.
  const NARR =
    'On the roof there are two cracked tiles near the vent. ' +
    'The lobby floor has a scuff mark in one corner. ' +
    'The office ceiling shows a water stain overhead. ' +
    'The loading dock bumper is worn and needs replacing.'
  const secs = segmentNarrative(NARR)
  const keys = secs.map((s) => s.key)
  assert('produces exactly four sections', secs.length === 4, `${secs.length}: ${keys.join(',')}`)
  assert('sections are Roof, Lobby, Office, Loading Dock in order',
    JSON.stringify(keys) === JSON.stringify(['roof', 'lobby', 'office', 'loadingdock']), keys.join(','))
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('Lobby holds ONLY its own sentence',
    byKey.lobby && byKey.lobby.text === 'The lobby floor has a scuff mark in one corner.', byKey.lobby && byKey.lobby.text)
  assert('Lobby did NOT swallow the office sentence', byKey.lobby && !/office/.test(byKey.lobby.text))
  assert('Lobby did NOT swallow the loading-dock sentence', byKey.lobby && !/loading dock/.test(byKey.lobby.text))
  assert('Office holds its own sentence', byKey.office && /water stain/.test(byKey.office.text))
  assert('Loading Dock holds its own sentence', byKey.loadingdock && /bumper/.test(byKey.loadingdock.text))
  for (const s of secs) assert(`${s.key} slice is faithful`, faithful(NARR, s.text))
}

console.log('\n[10] Splitter keeps splitting past the FIRST transition (3+ areas in one run-on)')
{
  // Unpunctuated run-on naming three areas; iOS-style capitals cue each new one.
  const RUN = 'The kitchen sink is leaking Then the garage door is broken Also the attic has mold'
  const secs = segmentNarrative(RUN)
  assert('all three areas split out (not just the first)', secs.length === 3, secs.map((s) => s.key).join(','))
  assert('order is kitchen, garage, attic', JSON.stringify(secs.map((s) => s.key)) === JSON.stringify(['kitchen', 'garage', 'attic']), secs.map((s) => s.key).join(','))
  assert('every slice faithful', secs.every((s) => faithful(RUN, s.text)))
}

console.log('\n[11] AI-proposed labels feed LIVE (extra vocabulary) segmentation')
{
  // "mudroom" and "solarium" aren't in the base vocab; when the narrative names
  // them and they arrive as AI labels, they become sections live.
  const NARR = 'The kitchen is dated. The mudroom floor is cracked. The solarium gets great light.'
  const base = segmentNarrative(NARR)
  assert('without labels, only base-vocab areas are found', base.map((s) => s.key).join(',') === 'kitchen', base.map((s) => s.key).join(','))
  const withLabels = segmentNarrative(NARR, ['mudroom', 'solarium'])
  assert('with AI labels, mudroom + solarium become sections', JSON.stringify(withLabels.map((s) => s.key)) === JSON.stringify(['kitchen', 'mudroom', 'solarium']), withLabels.map((s) => s.key).join(','))
  assert('label-derived slices stay faithful', withLabels.every((s) => faithful(NARR, s.text)))
}

console.log('\n[12] deriveCondition: explicit self-rating wins, word boundaries, expanded vocab')
{
  // #1 explicit self-rating beats an incidental defect noun in the same sentence.
  assert('"is fair ... some cracking" -> Fair (not Poor)', deriveCondition('the foundation is fair but there is some cracking') === 'Fair', deriveCondition('the foundation is fair but there is some cracking'))
  assert('"in good condition ... small crack" -> Good', deriveCondition('the unit is in good condition despite a small crack') === 'Good', deriveCondition('the unit is in good condition despite a small crack'))
  // #2 word-boundary: "dated" must NOT fire inside "updated"/"outdated".
  assert('"excellent and recently updated" -> Good (not Fair)', deriveCondition('the appliances are excellent and recently updated') === 'Good', deriveCondition('the appliances are excellent and recently updated'))
  assert('"recently updated" alone -> Good', deriveCondition('the kitchen was recently updated') === 'Good', deriveCondition('the kitchen was recently updated'))
  assert('"outdated" still -> Fair', deriveCondition('the fixtures are outdated') === 'Fair', deriveCondition('the fixtures are outdated'))
  assert('standalone "dated" -> Fair', deriveCondition('the finishes look dated') === 'Fair', deriveCondition('the finishes look dated'))
  // #4 expanded defect vocabulary no longer silently N/A.
  assert('"discolored" -> Fair', deriveCondition('the ceiling is discolored') === 'Fair', deriveCondition('the ceiling is discolored'))
  assert('"loud" -> Fair', deriveCondition('the fan is loud') === 'Fair', deriveCondition('the fan is loud'))
  assert('"dented" -> Fair', deriveCondition('the door is dented') === 'Fair', deriveCondition('the door is dented'))
  assert('"loose" -> Poor', deriveCondition('the railing is loose') === 'Poor', deriveCondition('the railing is loose'))
  // baseline unchanged
  assert('no cue -> N/A', deriveCondition('the corridor leads to the exits') === 'N/A', deriveCondition('the corridor leads to the exits'))
}

console.log('\n[13] Unfiled photo attributes to the area currently being discussed (last mentioned)')
{
  // Kitchen -> Bathroom -> back to Kitchen. First-mention order is [kitchen, bathroom],
  // so the naive "last array element" would be Bathroom; the last MENTIONED area is Kitchen.
  const NARR = 'The kitchen sink drips. The bathroom fan is loud. Back in the kitchen the tile is cracked.'
  const secs = segmentNarrative(NARR)
  assert('sections are [kitchen, bathroom] in first-mention order', JSON.stringify(secs.map((s) => s.key)) === JSON.stringify(['kitchen', 'bathroom']), secs.map((s) => s.key).join(','))
  assert('last-mentioned area is kitchen (not the last array element bathroom)', lastMentionedKey(NARR) === 'kitchen', String(lastMentionedKey(NARR)))
  assert('empty narrative -> null (falls back to General)', lastMentionedKey('') === null, String(lastMentionedKey('')))
}

console.log('\n[14] Dictated Report Details parse into fields (deterministic + AI enhancer)')
{
  const TODAY = '2026-07-01'
  // Fully-cued utterance with an uncued address clause and a relative date.
  const a = parseDetails('Property is Maple Court Apartments, 123 Main St Unit 4, inspector Jane Doe, today', { today: TODAY })
  assert('property parsed', a.property === 'Maple Court Apartments', a.property)
  assert('uncued address split out (not merged into property)', a.address === '123 Main St Unit 4', a.address)
  assert('inspector parsed', a.inspector === 'Jane Doe', a.inspector)
  assert('relative date "today" resolved', a.date === TODAY, a.date)

  // "inspected by" + "located at" + explicit month date.
  const b = parseDetails('building North Tower located at 500 Oak Avenue inspected by Sam Lee date March 5 2026', { today: TODAY })
  assert('building->property', b.property === 'North Tower', b.property)
  assert('located at->address', b.address === '500 Oak Avenue', b.address)
  assert('inspected by->inspector', b.inspector === 'Sam Lee', b.inspector)
  assert('month-name date -> ISO', b.date === '2026-03-05', b.date)

  // Numeric date + tomorrow math + property name that contains a street-suffix word.
  assert('M/D/Y date parsed', parseDetails('date 7/4/2026', { today: TODAY }).date === '2026-07-04')
  assert('tomorrow resolved', parseDetails('inspector Pat, tomorrow', { today: TODAY }).date === '2026-07-02')
  const c = parseDetails('property is Courtyard Plaza, inspector Alex Kim', { today: TODAY })
  assert('property with "Court" is NOT mis-parsed as address', c.property === 'Courtyard Plaza' && c.address === '', `${c.property}|${c.address}`)

  // Missing fields stay blank — nothing fabricated.
  const d = parseDetails('inspector Jordan Vega', { today: TODAY })
  assert('unspoken fields stay blank', d.property === '' && d.address === '' && d.date === '' && d.inspector === 'Jordan Vega', JSON.stringify(d))
  assert('empty input -> all blank', JSON.stringify(parseDetails('', { today: TODAY })) === JSON.stringify({ property: '', address: '', inspector: '', date: '' }))

  // AI enhancer fills ONLY blanks; deterministic results always win; blanks the
  // model can't fill stay blank.
  const evilFetch = async () => ({ ok: true, json: async () => ({ property: 'FAKE HALL', address: '999 Ghost Rd', inspector: 'Nobody', date: '1900-01-01' }) })
  const smart = await parseDetailsSmart('inspector Dana Fox', { today: TODAY, fetchImpl: evilFetch })
  assert('AI did NOT overwrite deterministically-parsed inspector', smart.inspector === 'Dana Fox', smart.inspector)
  assert('AI filled a blank field (address)', smart.address === '999 Ghost Rd', smart.address)
  assert('AI source flagged', smart.source === 'ai', smart.source)
  const noNet = await parseDetailsSmart('property is Elm Center', { today: TODAY, fetchImpl: async () => ({ ok: false }) })
  assert('no-AI fallback keeps deterministic result', noNet.property === 'Elm Center' && noNet.source === 'deterministic', JSON.stringify(noNet))
}

console.log('\n[15] Commercial walkthrough vocabulary: numbered suites, distinct restrooms, location references')
{
  // Numbered tenant suites become DISTINCT sections; a mid-stream correction
  // ("...the leak is in suite 210 not 200") attributes to the corrected suite;
  // "above the break room" is a location reference, not a Break Room section.
  const NARR = 'Suite 200 is vacant and the carpet is worn. There is a leak in suite 200 above the break room. ' +
    'Actually scratch that, the leak is in suite 210 not 200. Suite 210 was recently repainted.'
  const secs = segmentNarrative(NARR)
  const keys = secs.map((s) => s.key)
  assert('suite 200 and suite 210 are distinct sections', JSON.stringify(keys) === JSON.stringify(['suite200', 'suite210']), keys.join(','))
  const byKey = Object.fromEntries(secs.map((s) => [s.key, s]))
  assert('suite names carry the number', byKey.suite200.name === 'Suite 200' && byKey.suite210.name === 'Suite 210', `${byKey.suite200 && byKey.suite200.name}|${byKey.suite210 && byKey.suite210.name}`)
  assert('correction sentence lands in Suite 210 (not 200, not a phantom area)', /scratch that/.test(byKey.suite210.text) && !/scratch that/.test(byKey.suite200.text))
  assert('"above the break room" did NOT spawn a Break Room section', !keys.includes('breakroom'))
  assert('every suite slice is faithful', secs.every((s) => faithful(NARR, s.text)))
  assert('a directly-addressed break room still anchors', segmentNarrative('The break room fridge is leaking.')[0].key === 'breakroom')
  assert('"primary suite" still maps to Primary Bedroom', segmentNarrative('The primary suite carpet is worn.')[0].key === 'primarybedroom')

  // Men's vs women's restrooms are distinct sections with their own ratings.
  const rr = segmentNarrative("The men's restroom is clean, no issues. The women's restroom has a cracked sink.")
  assert('restrooms split by gender', JSON.stringify(rr.map((s) => s.key)) === JSON.stringify(['mensrestroom', 'womensrestroom']), rr.map((s) => s.key).join(','))
  assert("men's restroom rated from its own text (Good)", rr[0].condition === 'Good', rr[0].condition)
  assert("women's restroom rated from its own text (Poor)", rr[1].condition === 'Poor', rr[1].condition)
  assert('a plain "restroom" still anchors generically', segmentNarrative('The restroom tile is chipped.')[0].key === 'restroom')

  // Location references must not split a clause or spawn a section.
  const park = segmentNarrative('Out in the parking lot, the striping is fading and there are three potholes near the entrance.')
  assert('"near the entrance" stays inside the Parking section', park.length === 1 && park[0].key === 'parking', park.map((s) => s.key).join(','))
  assert('potholes derive Poor', park[0].condition === 'Poor', park[0].condition)
  const lob = segmentNarrative('In the lobby, three ceiling tiles are stained near the east window.')
  assert('"near the east window" does not spawn a Windows section', lob.length === 1 && lob[0].key === 'lobby', lob.map((s) => s.key).join(','))
  assert('a real transition still anchors ("In the kitchen...")', segmentNarrative('The lobby is clean. In the kitchen the sink drips.').map((s) => s.key).join(',') === 'lobby,kitchen')
  assert('"fading" derives Fair', deriveCondition('the striping is fading') === 'Fair', deriveCondition('the striping is fading'))
}

console.log('\n[16] Details AI enhancer cannot overwrite what is already on screen')
{
  const TODAY = '2026-07-01'
  const evilFetch = async () => ({ ok: true, json: async () => ({ property: 'FAKE HALL', address: '999 Ghost Rd', inspector: 'Nobody', date: '1900-01-01' }) })
  const smart = await parseDetailsSmart('inspector Dana Fox', { today: TODAY, fetchImpl: evilFetch, current: { property: 'Typed Tower', date: '2026-06-30' } })
  assert('AI did NOT replace the typed property', smart.property === 'Typed Tower', smart.property)
  assert('AI did NOT replace the on-screen date', smart.date === '2026-06-30', smart.date)
  assert('deterministic inspector still wins', smart.inspector === 'Dana Fox', smart.inspector)
  assert('AI fills a field blank everywhere (address)', smart.address === '999 Ghost Rd', smart.address)
  const full = await parseDetailsSmart('inspector Dana Fox', {
    today: TODAY, fetchImpl: evilFetch,
    current: { property: 'P', address: 'A', inspector: '', date: '2026-06-30' }
  })
  assert('nothing blank anywhere -> AI not needed, deterministic source', full.source === 'deterministic', full.source)
}

// A real 1x1 PNG for photo-embedding tests (valid, minimal).
const TEST_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

console.log('\n[17] DOCX embeds photos with captions (owner-facing document carries the images)')
{
  const secs = segmentNarrative(NARRATIVE).map((s) => ({
    ...s, id: `sec_${s.key}`,
    photos: s.key === 'kitchen' ? [{ id: 'p1', name: 'kitchen-sink.png', dataUrl: TEST_PNG }] : []
  }))
  const report = { ...baseReport, sections: secs, summary: 'ok' }
  const buf = await docxToBuffer(buildExportModel(report))
  const xml = unzipEntry(buf, 'word/document.xml')
  assert('docx has a drawing element for the photo', xml.includes('<w:drawing>'))
  assert('docx has the photo caption (section + filename)', xml.includes('Kitchen — kitchen-sink.png'))
  const raw = buf.toString('latin1')
  assert('docx contains the actual image bytes (word/media/*.png)', raw.includes('word/media/') && raw.includes('.png'))
  assert('no fallback "could not be embedded" note for a good photo', !xml.includes('could not be embedded'))
  // imageMeta helpers behave.
  const size = imageSize(dataUrlToBytes(TEST_PNG))
  assert('imageSize reads PNG dimensions', size && size.width === 1 && size.height === 1, JSON.stringify(size))
  const fit = fitBox({ width: 400, height: 300 }, 280, 210)
  assert('fitBox preserves aspect ratio', fit.width === 280 && fit.height === 210, JSON.stringify(fit))
  const fit2 = fitBox(null, 84, 84)
  assert('fitBox falls back to a square for unknown size', fit2.width === 84 && fit2.height === 84, JSON.stringify(fit2))
}

console.log('\n[18] Real PDF bytes: every section, details, photo + caption (headless)')
{
  const secs = segmentNarrative(NARRATIVE).map((s) => ({
    ...s, id: `sec_${s.key}`,
    photos: s.key === 'kitchen' ? [{ id: 'p1', name: 'kitchen-sink.png', dataUrl: TEST_PNG }] : []
  }))
  const report = { ...baseReport, sections: secs, summary: deterministicSummary(baseReport, secs) }
  const pdf = Buffer.from(await pdfToArrayBuffer(buildExportModel(report)))
  const s = pdf.toString('latin1')
  assert('pdf output is a real PDF', s.startsWith('%PDF-'), s.slice(0, 8))
  for (const name of ['Roof', 'Kitchen', 'Primary Bathroom', 'Basement', 'Living Room']) {
    assert(`pdf bytes contain section "${name}"`, s.includes(name))
  }
  assert('pdf bytes contain a narrated observation (faucet)', s.includes('faucet'))
  assert('pdf embeds the photo as an image object', s.includes('/Subtype /Image'))
  assert('pdf carries the photo caption', s.includes('kitchen-sink.png'))
  assert('pdf has no "undefined" text', !s.includes('undefined'))
}

console.log('\n[19] User work survives re-segmentation; removed sections stay removed')
{
  // An EDITED section (no photos) must be retained when its area word drops out
  // of the narrative — user edits are never silently destroyed.
  let ui = mergeSections([], segmentNarrative('the kitchen sink leaks'))
  ui = ui.map((s) => (s.key === 'kitchen' ? { ...s, text: 'MY CAREFUL EDIT', textEdited: true } : s))
  const afterEdit = mergeSections(ui, segmentNarrative('the sink leaks'))
  const keptKitchen = afterEdit.find((s) => s.key === 'kitchen')
  assert('edited section survives narrative losing its area word', !!keptKitchen)
  assert('the user\'s edited text is intact', keptKitchen && keptKitchen.text === 'MY CAREFUL EDIT', keptKitchen && keptKitchen.text)
  // An UNTOUCHED, photoless section still disappears with its area word.
  const plain = mergeSections(mergeSections([], segmentNarrative('the kitchen sink leaks')), segmentNarrative('the sink leaks'))
  assert('untouched photoless section still follows the narrative', !plain.some((s) => s.key === 'kitchen'), plain.map((s) => s.key).join(','))

  // Removal suppression: a removed key stays removed against the SAME narrative…
  const narr = 'the kitchen sink leaks'
  const removed = [{ key: 'kitchen', at: narr.length }]
  assert('removed key stays suppressed on re-segmentation', effectiveRemovedKeys(removed, narr).length === 1)
  // …but mentioning the area anew (after the removal point) revives it.
  assert('a NEW mention after removal revives the area', effectiveRemovedKeys(removed, `${narr} back in the kitchen now`).length === 0)
  // The Draft (AI/deterministic analysis) path must respect removals too.
  const rep = { walkthrough: narr, sections: [], removedKeys: removed, aiAreas: [] }
  const { sections: drafted } = await analyzeNarrative(rep, { fetchImpl: async () => ({ ok: false }), makeId: (k) => `sec_${k}` })
  assert('Draft does not resurrect a removed section', !drafted.some((s) => s.key === 'kitchen'), drafted.map((s) => s.key).join(','))

  // Rewritten-narrative revival: the position rule only applies while the text
  // it referred to still exists. Clearing the walkthrough and retyping the area
  // must NOT leave it suppressed forever (mention position < old `at`).
  const removedH = [{ key: 'kitchen', at: narr.length, h: prefixHash(narr) }]
  assert('removed key stays suppressed while its narrative is intact (hashed entry)',
    effectiveRemovedKeys(removedH, narr).length === 1)
  assert('clearing + retyping the area revives it (hashed entry)',
    effectiveRemovedKeys(removedH, 'kitchen cabinets are cracked').length === 0)
  assert('clearing + retyping withOUT the area keeps the entry (harmless)',
    effectiveRemovedKeys(removedH, 'roof is fine').length === 1)
  assert('legacy entry (no hash): shrunken narrative + new mention revives',
    effectiveRemovedKeys([{ key: 'kitchen', at: 500 }], 'kitchen cabinets are cracked').length === 0)
  assert('rewritten same-length-or-longer narrative revives on mention (hash mismatch)',
    effectiveRemovedKeys(removedH, 'we looked at the kitchen area again today').length === 0)
}

console.log('\n[20] deriveCondition understands negation')
{
  assert('"not in good condition" -> Fair (not Good)', deriveCondition('The deck is not in good condition') === 'Fair', deriveCondition('The deck is not in good condition'))
  assert('"isn\'t looking great" -> Fair', deriveCondition("the hallway carpet isn't looking great") === 'Fair', deriveCondition("the hallway carpet isn't looking great"))
  assert('"no water damage" is NOT Poor', deriveCondition('no water damage was observed anywhere') === 'N/A', deriveCondition('no water damage was observed anywhere'))
  assert('"not loose" is NOT Poor', deriveCondition('the railing is not loose') === 'N/A', deriveCondition('the railing is not loose'))
  assert('"without any cracks" is NOT Poor', deriveCondition('the slab is without any cracks') === 'N/A', deriveCondition('the slab is without any cracks'))
  // Un-negated cues still fire exactly as before.
  assert('"in good condition" still -> Good', deriveCondition('the unit is in good condition') === 'Good')
  assert('"no issues" still -> Good', deriveCondition('roof recently replaced, no issues') === 'Good')
  assert('a real leak still -> Poor', deriveCondition('there is a leak here') === 'Poor')
  assert('negated good + real defect -> stated Poor wins', deriveCondition('not in great shape, the wall is in poor condition') === 'Poor', deriveCondition('not in great shape, the wall is in poor condition'))
}

console.log('\n[21] Date parsing: impossible dates rejected, street names are not dates')
{
  const TODAY = '2026-07-02'
  assert('impossible "13/45/26" yields NO date', extractDate('13/45/26', TODAY) === null)
  assert('Feb 30 yields NO date', extractDate('2/30/2026', TODAY) === null)
  assert('two-digit year 99 -> 1999 (not 2099)', extractDate('6/3/99', TODAY).iso === '1999-06-03', JSON.stringify(extractDate('6/3/99', TODAY)))
  const plaza = parseDetails('Property is July 4 Plaza, 12 Oak St', { today: TODAY })
  assert('"July 4 Plaza" stays a property name, not a date', plaza.property === 'July 4 Plaza' && plaza.date === '', JSON.stringify(plaza))
  const ave = parseDetails('address is 1200 March 5th Avenue', { today: TODAY })
  assert('"March 5th Avenue" stays an address, not a date', ave.address === '1200 March 5th Avenue' && ave.date === '', JSON.stringify(ave))
  assert('a real month date still parses', parseDetails('date March 5 2026', { today: TODAY }).date === '2026-03-05')
  assert('"today" still resolves', parseDetails('inspector Pat, today', { today: TODAY }).date === TODAY)
}

console.log('\n[22] Suite letter designators work in lowercase dictation')
{
  const secs = segmentNarrative('Suite b has worn carpet. Suite c was repainted.')
  assert('lowercase "suite b"/"suite c" become distinct sections', JSON.stringify(secs.map((s) => s.name)) === JSON.stringify(['Suite B', 'Suite C']), secs.map((s) => s.name).join(','))
  const article = segmentNarrative('in the suite a leak was found')
  assert('"the suite a leak" does NOT fold the article into "Suite A"', article.length === 1 && article[0].key === 'suite', article.map((s) => s.key).join(','))
  assert('and the leak still derives Poor', article[0].condition === 'Poor', article[0].condition)
}

console.log('\n[23] Exports never silently drop an undecodable photo')
{
  const secs = segmentNarrative('the kitchen sink leaks').map((s) => ({
    ...s, id: `sec_${s.key}`,
    photos: [
      { id: 'ok', name: 'good.png', dataUrl: TEST_PNG },
      { id: 'bad', name: 'bad.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' }
    ]
  }))
  const model = buildExportModel({ ...baseReport, walkthrough: 'the kitchen sink leaks', sections: secs, summary: 'ok' })
  const pdf = Buffer.from(await pdfToArrayBuffer(model)).toString('latin1')
  assert('PDF embeds the good photo', pdf.includes('/Subtype /Image'))
  assert('PDF reports the undecodable photo instead of dropping it', pdf.includes('could not be embedded'))
  const xml = unzipEntry(await docxToBuffer(model), 'word/document.xml')
  assert('DOCX embeds the good photo', xml.includes('<w:drawing>'))
  assert('DOCX reports the undecodable photo', xml.includes('could not be embedded'))
}

console.log('\n[24] Dictation error classification: benign ends are not errors, real failures explain themselves')
{
  const noSpeech = classifyDictationError('no-speech')
  assert('silence timeout (no-speech) is benign', noSpeech.benign === true)
  assert('no-speech still hints the user to retry', noSpeech.message.length > 0, noSpeech.message)
  const aborted = classifyDictationError('aborted')
  assert('deliberate stop (aborted) is benign', aborted.benign === true)
  assert('aborted is SILENT (our own mic-switch must not flash a message)', aborted.message === '', aborted.message)
  const denied = classifyDictationError('not-allowed')
  assert('mic permission denial is a real failure', denied.benign === false)
  assert('denial message names the microphone', /microphone|mic/i.test(denied.message), denied.message)
  assert('service-not-allowed maps like not-allowed', classifyDictationError('service-not-allowed').benign === false)
  const net = classifyDictationError('network')
  assert('offline recognition is a real failure', net.benign === false)
  assert('offline message says to type instead', /type instead/i.test(net.message), net.message)
  assert('no-mic-device is a real failure with a message', classifyDictationError('audio-capture').benign === false && classifyDictationError('audio-capture').message.length > 0)
  const unknown = classifyDictationError(undefined)
  assert('unknown/absent code is a real failure with a generic message', unknown.benign === false && unknown.message.length > 0)
  assert('the raw code is preserved for analytics', classifyDictationError('language-not-supported').code === 'language-not-supported')
}

console.log('\n[25] Dictation diagnostics are bounded and privacy-safe (no free text, no transcript)')
{
  // UA classing on representative strings — bounded browser-os enums only.
  assert('Chrome on Android classes', uaClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36') === 'chrome-android')
  assert('Safari on iPhone classes', uaClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1') === 'safari-ios')
  assert('Edge on Windows classes', uaClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0') === 'edge-windows')
  assert('Firefox on Mac classes', uaClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0') === 'firefox-mac')
  assert('empty UA still yields a bounded class', uaClass('') === 'other-other', uaClass(''))

  // The props builder emits ONLY the expected keys with bounded values —
  // hostile/free-form input cannot smuggle text into the analytics event.
  const props = dictationEventProps({
    code: 'network'.padEnd(500, 'x'), // oversized code gets clamped
    source: 'the entire spoken transcript should never end up here',
    online: false,
    mic: 'granted',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1'
  })
  assert('props expose exactly the five diagnostic keys', JSON.stringify(Object.keys(props).sort()) === JSON.stringify(['code', 'mic', 'online', 'source', 'ua']), Object.keys(props).join(','))
  assert('code is clamped to 32 chars', props.code.length <= 32, String(props.code.length))
  assert('unrecognized source collapses to "unknown"', props.source === 'unknown', props.source)
  assert('offline flag is a boolean', props.online === false)
  assert('mic state passes through only known values', props.mic === 'granted' && dictationEventProps({ mic: 'PII here' }).mic === 'unknown')
  assert('ua is the bounded class, never the raw string', props.ua === 'safari-ios', props.ua)
  assert('known sources pass through', dictationEventProps({ source: 'details' }).source === 'details' && dictationEventProps({ source: 'walkthrough' }).source === 'walkthrough')
  assert('empty input yields safe defaults', JSON.stringify(dictationEventProps({})) === JSON.stringify({ code: 'unknown', source: 'unknown', online: true, mic: 'unknown', ua: 'other-other' }), JSON.stringify(dictationEventProps({})))
}

console.log('\n[26] Follow-up flags: preserved, exported, punch-listed — never invented')
{
  // A flag set by the user survives re-segmentation (merge keeps extra props).
  let ui = mergeSections([], segmentNarrative('the kitchen sink leaks and the roof is fine'))
  assert('fresh sections default to followUp: false', ui.every((s) => s.followUp === false), JSON.stringify(ui.map((s) => s.followUp)))
  ui = ui.map((s) => (s.key === 'kitchen' ? { ...s, followUp: true } : s))
  const regrown = mergeSections(ui, segmentNarrative('the kitchen sink leaks and the roof is fine now with new gutters'))
  const k = regrown.find((s) => s.key === 'kitchen')
  assert('follow-up flag survives re-segmentation', k && k.followUp === true)

  // A flagged section is USER WORK: it is retained when the narrative drops it.
  const kept = mergeSections(ui, segmentNarrative('the roof is fine'))
  assert('flagged section retained when its area leaves the narrative', kept.some((s) => s.key === 'kitchen' && s.followUp))

  // Export model carries flags + count.
  const model = buildExportModel({ property: 'P', sections: regrown, summary: '' })
  assert('model carries followUp per section', model.sections.find((s) => s.key === 'kitchen').followUp === true && model.sections.find((s) => s.key === 'roof').followUp === false)
  assert('model followUpCount matches flagged sections', model.followUpCount === 1, String(model.followUpCount))

  // PDF fragments: section line carries the flag; exactly one punch-list line
  // per flagged section, none invented for unflagged ones.
  const lines = renderPdfLines(model)
  assert('PDF section fragment carries followUp', lines.some((l) => l.kind === 'section' && l.key === 'kitchen' && l.followUp === true))
  const punch = lines.filter((l) => l.kind === 'followup')
  assert('exactly one punch-list fragment per flagged section', punch.length === 1 && punch[0].key === 'kitchen', JSON.stringify(punch.map((l) => l.key)))
  assert('punch-list heading present only when something is flagged', lines.some((l) => l.kind === 'h2' && /punch list/i.test(l.text)))
  const noneFlagged = renderPdfLines(buildExportModel({ sections: segmentNarrative('the roof is fine') }))
  assert('no punch list when nothing is flagged', !noneFlagged.some((l) => l.kind === 'followup' || (l.kind === 'h2' && /punch list/i.test(l.text))))

  // Real bytes: PDF and DOCX both carry the marker and the punch list.
  const pdf = Buffer.from(await pdfToArrayBuffer(model)).toString('latin1')
  assert('real PDF bytes contain the punch-list heading', pdf.includes('Follow-up / Punch list'))
  assert('real PDF bytes flag the section inline', pdf.includes('FOLLOW-UP'))
  const docBuf = await docxToBuffer(model)
  const xml = unzipEntry(docBuf, 'word/document.xml')
  assert('real DOCX contains the punch-list heading', xml.includes('Follow-up / Punch list'))
  assert('real DOCX flags the section inline', xml.includes('FOLLOW-UP'))
  // Punch list now uses NATIVE Word numbering (auto-renumbering) rather than a
  // hand-typed "1." prefix: the flagged item carries a numbering property, and a
  // numbering definition backs it.
  assert('DOCX punch-list item uses native numbering', /Kitchen/.test(xml) && /w:numPr/.test(xml))
  const numXml = (() => { try { return unzipEntry(docBuf, 'word/numbering.xml') } catch (_e) { return '' } })()
  assert('DOCX ships a numbering definition for the punch list', numXml.includes('w:abstractNum') || numXml.includes('<w:num '))

  // Deterministic summary mentions the flagged count (and stays silent at zero).
  const sum = deterministicSummary({ inspector: 'I' }, regrown)
  assert('summary mentions flagged count', sum.includes('1 item flagged for follow-up'))
  const sum0 = deterministicSummary({ inspector: 'I' }, segmentNarrative('the roof is fine'))
  assert('summary silent when nothing is flagged', !sum0.includes('flagged for follow-up'))
}

console.log('\n[28] Coverage gaps: unmentioned major systems are reported, mentioned ones are not')
{
  const { coverageGaps } = await import('../src/lib/exportModel.js')
  // The base NARRATIVE mentions roof, kitchen (plumbing via faucet), primary
  // bath, basement/foundation, living room — but no HVAC, electrical, or life-safety.
  const gaps = coverageGaps(NARRATIVE)
  assert('roof is NOT reported as a gap (it was mentioned)', !gaps.includes('Roof'), gaps.join(','))
  assert('foundation is NOT a gap (basement/foundation mentioned)', !gaps.some((g) => /Foundation/.test(g)), gaps.join(','))
  assert('HVAC IS reported as a gap', gaps.some((g) => /HVAC/.test(g)), gaps.join(','))
  assert('Electrical IS reported as a gap', gaps.includes('Electrical'), gaps.join(','))
  assert('Life-safety IS reported as a gap', gaps.some((g) => /Life-safety/.test(g)), gaps.join(','))
  assert('empty walkthrough yields no gaps (nothing to warn on blank report)', coverageGaps('').length === 0)
  // The coverage note reaches both exports.
  const secs = segmentNarrative(NARRATIVE).map((s) => ({ ...s, id: `sec_${s.key}`, photos: [] }))
  const covModel = buildExportModel({ ...baseReport, sections: secs, summary: 'ok' })
  assert('export model carries coverageGaps', Array.isArray(covModel.coverageGaps) && covModel.coverageGaps.length > 0)
  const covPdf = Buffer.from(await pdfToArrayBuffer(covModel)).toString('latin1')
  assert('PDF renders the coverage note', covPdf.includes('Coverage note') && covPdf.includes('HVAC'))
  const covXml = unzipEntry(await docxToBuffer(covModel), 'word/document.xml')
  assert('DOCX renders the coverage note', covXml.includes('Coverage note') && covXml.includes('HVAC'))
}

console.log('\n[29] DOCX ratings summary table + real author metadata')
{
  const secs = segmentNarrative(NARRATIVE).map((s) => ({ ...s, id: `sec_${s.key}`, photos: [] }))
  const model = buildExportModel({ ...baseReport, sections: secs, summary: 'ok' })
  assert('model exposes conditionCounts', model.conditionCounts && typeof model.conditionCounts.Good === 'number')
  const buf = await docxToBuffer(model)
  const xml = unzipEntry(buf, 'word/document.xml')
  assert('DOCX contains a ratings summary heading', xml.includes('Ratings summary'))
  assert('DOCX renders a real table', xml.includes('<w:tbl>'))
  assert('ratings table has the Area/Condition/Follow-up header', xml.includes('Area') && xml.includes('Condition') && xml.includes('Follow-up'))
  assert('DOCX carries a totals line', xml.includes('Totals — Good:'))
  // Author metadata: docx writes core properties to docProps/core.xml.
  const core = unzipEntry(buf, 'docProps/core.xml')
  assert('DOCX core props name the inspector as creator', core.includes('Jordan Vega'), core.slice(0, 400))
  assert('DOCX title metadata is set (not Un-named)', /<dc:title>.+<\/dc:title>/.test(core))
}

console.log('\n[27] CSV/JSON data export: every section present, punch-list parity, no photo data, RFC 4180 escaping')
{
  const { buildSectionsCsv, buildPunchListCsv, buildJsonExport, buildJsonString } = await import('../src/lib/exportData.js')

  // Narrative with a comma, a quote, and a Poor rating — exercises escaping and
  // the punch-list rule (Poor lands on the list without a flag).
  const secs = mergeSections([], segmentNarrative(
    'The kitchen counter is cracked, stained, and in poor shape. ' +
    'The roof looks good. The basement wall reads "moisture" on the meter and is in poor condition.'
  )).map((s) => (s.key === 'roof' ? { ...s, followUp: true } : s))
  const report = { property: 'Maple, Court #4', address: '123 "A" St', inspector: 'Jordan Vega', date: '2026-07-01', summary: 'Overall fair.', sections: secs.map((s) => ({ ...s, photos: s.key === 'kitchen' ? [{ dataUrl: 'data:image/png;base64,AAAA' }] : [] })) }
  const model = buildExportModel(report)

  // Sections CSV: header row + one row per section, every section name present.
  const csv = buildSectionsCsv(model)
  const rows = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
  assert('CSV starts with UTF-8 BOM', csv.charCodeAt(0) === 0xfeff)
  assert('CSV has one row per section plus header', rows.length === model.sections.length + 1, String(rows.length))
  for (const s of model.sections) assert(`CSV carries section "${s.name}"`, csv.includes(csvCell(s.name)))
  assert('CSV quotes the comma-bearing property name', csv.includes('"Maple, Court #4"'))
  assert('CSV doubles embedded quotes (RFC 4180)', csv.includes('""moisture""') && csv.includes('123 ""A"" St'))
  assert('CSV never embeds photo data', !csv.includes('data:image'))
  assert('CSV photo_count column reflects photos', rows.some((r) => r.endsWith(',1')))

  // Punch-list CSV: exactly the model's followUps (flagged roof + both Poors).
  const punchCsv = buildPunchListCsv(model)
  const punchRows = punchCsv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).slice(1)
  assert('punch-list CSV has exactly the punch-listed sections', punchRows.length === model.followUps.length && model.followUps.length === 3, `${punchRows.length} vs ${model.followUps.length}`)
  assert('flagged column distinguishes user flags from Poor ratings', punchRows.some((r) => r.includes(',yes,')) && punchRows.some((r) => r.includes(',no,')))

  // JSON: versioned, every section key, punch-list keys match, no photo data.
  const json = buildJsonExport(model)
  assert('JSON is schema-versioned', json.schemaVersion === 1)
  assert('JSON carries every section key in order', JSON.stringify(json.sections.map((s) => s.key)) === JSON.stringify(exportSectionKeys(model)))
  assert('JSON punchListKeys match the model punch list', JSON.stringify(json.punchListKeys) === JSON.stringify(model.followUps.map((s) => s.key)))
  assert('JSON strips photo data to counts', !buildJsonString(model).includes('data:image') && json.sections.every((s) => !('photos' in s)))
  assert('JSON string round-trips', JSON.parse(buildJsonString(model)).sectionCount === model.sectionCount)

  function csvCell(v) { return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }
}

console.log('\n[30] Draft source reflects the server RESPONSE, not just fetch success (no AI mislabeling)')
{
  // Server without an API key returns HTTP 200 but {source:'deterministic'} —
  // the banner must NOT claim "Drafted with AI".
  const detFetch = async () => ({ ok: true, json: async () => ({ areas: [], summary: 'x', source: 'deterministic' }) })
  const det = await analyzeNarrative(baseReport, { fetchImpl: detFetch, makeId: (k) => `sec_${k}` })
  assert('a deterministic server response is labeled deterministic (not ai)', det.source === 'deterministic', det.source)
  assert('deterministic banner does NOT contain "Drafted with AI"', !draftBannerMessage(det.source).includes('Drafted with AI'), draftBannerMessage(det.source))
  assert('deterministic banner explains AI was unavailable', /AI unavailable/i.test(draftBannerMessage(det.source)))
  // A genuine AI response still says "Drafted with AI".
  const aiFetch = async () => ({ ok: true, json: async () => ({ areas: [], summary: 'x', source: 'ai' }) })
  const ai = await analyzeNarrative(baseReport, { fetchImpl: aiFetch, makeId: (k) => `sec_${k}` })
  assert('an ai server response is labeled ai', ai.source === 'ai', ai.source)
  assert('ai banner contains "Drafted with AI"', draftBannerMessage(ai.source).includes('Drafted with AI'))
  // A response that omits source but did return stays 'ai' (backward compat).
  const legacyFetch = async () => ({ ok: true, json: async () => ({ areas: [], summary: 'x' }) })
  const legacy = await analyzeNarrative(baseReport, { fetchImpl: legacyFetch, makeId: (k) => `sec_${k}` })
  assert('a source-less response is treated as ai (back-compat)', legacy.source === 'ai', legacy.source)
}

console.log('\n[31] deriveCondition: life-safety vocab, un-inverted positives, mild≠Poor, hedges stay N/A')
{
  const d = deriveCondition
  // Bullet 1 — life-safety / compliance vocabulary that used to default to N/A.
  assert('"overdue" -> Poor', d('the fire extinguisher tag is overdue') === 'Poor', d('the fire extinguisher tag is overdue'))
  assert('"does not latch" -> Poor', d('the stairwell door does not latch') === 'Poor', d('the stairwell door does not latch'))
  assert('"flickering" -> Poor', d('the exit sign is flickering') === 'Poor', d('the exit sign is flickering'))
  assert('"needs immediate service" -> Poor', d('the panel needs immediate service') === 'Poor', d('the panel needs immediate service'))
  assert('"deficiency" -> Poor', d('inspection noted a deficiency') === 'Poor', d('inspection noted a deficiency'))
  // Bullet 2 — explicit positives that were inverted to N/A or Poor.
  assert('"serviced ... running fine" -> Good (was N/A)', d('the unit was serviced in March and is running fine') === 'Good', d('the unit was serviced in March and is running fine'))
  assert('"no signs of overheating or corrosion" -> Good (was Poor)', d('no signs of overheating or corrosion') === 'Good', d('no signs of overheating or corrosion'))
  // Bullet 3 — mild wording must not auto-escalate to Poor.
  assert('"worn ... drips steadily" -> Fair (not Poor)', d('the gasket is worn and the valve drips steadily') === 'Fair', d('the gasket is worn and the valve drips steadily'))
  // Bullet 4 — hedged/unconfirmed language must not harden into Poor/Fair.
  assert('"might be leaking" -> N/A (not Poor)', d('the water heater might be leaking') === 'N/A', d('the water heater might be leaking'))
  assert('"possibly ... could not confirm" -> N/A (not Poor)', d('possibly some corrosion, not sure, could not confirm') === 'N/A', d('possibly some corrosion, not sure, could not confirm'))
  // Guards — a stated rating still wins even when hedged elsewhere; negations hold.
  assert('explicit "in poor condition" wins over a stray hedge', d('the wall is in poor condition but I could not confirm the cause') === 'Poor', d('the wall is in poor condition but I could not confirm the cause'))
  assert('"free of rot and rust" -> Good (list-negation)', d('the beams are free of rot and rust') === 'Good', d('the beams are free of rot and rust'))
  assert('a real leak still -> Poor', d('there is a leak here') === 'Poor')
  assert('"no water damage" still N/A', d('no water damage was observed anywhere') === 'N/A')
}

console.log('\n[32] Auto-suggested (unconfirmed) ratings are flagged in PDF, DOCX, CSV, and JSON')
{
  const { buildSectionsCsv, buildJsonExport } = await import('../src/lib/exportData.js')
  // Fresh, never-confirmed section (conditionEdited falsy) -> auto-suggested.
  const secs = mergeSections([], segmentNarrative('the kitchen sink leaks'))
  const model = buildExportModel({ ...baseReport, walkthrough: 'the kitchen sink leaks', sections: secs, summary: 'ok' })
  const kitchen = model.sections.find((s) => s.key === 'kitchen')
  assert('model marks the unconfirmed section autoSuggested', kitchen && kitchen.autoSuggested === true, kitchen && String(kitchen.autoSuggested))
  const pdf = Buffer.from(await pdfToArrayBuffer(model)).toString('latin1')
  assert('PDF flags the rating as auto-suggested', /auto-suggested/i.test(pdf))
  const xml = unzipEntry(await docxToBuffer(model), 'word/document.xml')
  assert('DOCX flags the rating as auto-suggested', /auto-suggested/i.test(xml))
  const csv = buildSectionsCsv(model)
  assert('CSV has an auto_suggested column', /,auto_suggested,/.test(csv))
  assert('CSV marks the unconfirmed row auto_suggested = yes', /,Poor,yes,/.test(csv))
  const json = buildJsonExport(model)
  assert('JSON carries an autoSuggested key per section', json.sections.every((s) => 'autoSuggested' in s))
  assert('JSON marks the unconfirmed section autoSuggested true', json.sections.find((s) => s.key === 'kitchen').autoSuggested === true)
  // A CONFIRMED rating (conditionEdited) is NOT flagged, in any format.
  const confirmed = buildExportModel({ ...baseReport, walkthrough: 'the kitchen sink leaks', sections: secs.map((s) => ({ ...s, conditionEdited: true })), summary: 'ok' })
  assert('confirmed section is not autoSuggested', confirmed.sections.find((s) => s.key === 'kitchen').autoSuggested === false)
  assert('confirmed PDF has no auto-suggested caveat', !/auto-suggested/i.test(Buffer.from(await pdfToArrayBuffer(confirmed)).toString('latin1')))
  assert('confirmed DOCX has no auto-suggested caveat', !/auto-suggested/i.test(unzipEntry(await docxToBuffer(confirmed), 'word/document.xml')))
  assert('confirmed CSV row marks auto_suggested = no', /,Poor,no,/.test(buildSectionsCsv(confirmed)))
  // N/A carries no claim, so it is never flagged as auto-suggested.
  const naModel = buildExportModel({ ...baseReport, sections: [{ id: 'sec_hall', key: 'hall', name: 'Hallway', condition: 'N/A', conditionEdited: false, photos: [] }], summary: '' })
  assert('an N/A section is not auto-suggested', naModel.sections[0].autoSuggested === false)
}

console.log('\n[33] AI-resolved corrected area name syncs the already-created section title')
{
  // Narrative first names "break room"; /api/draft resolves the display name to
  // "Kitchenette" via `renames`. The already-created section must adopt it so the
  // header agrees with the AI summary — but the key/text/rating are untouched.
  const rep = { ...baseReport, walkthrough: 'The break room sink is clean.', sections: [] }
  const fetchImpl = async () => ({ ok: true, json: async () => ({
    areas: [], summary: 'The kitchenette sink is clean.', source: 'ai',
    renames: [{ from: 'break room', to: 'Kitchenette' }]
  }) })
  const { sections } = await analyzeNarrative(rep, { fetchImpl, makeId: (k) => `sec_${k}` })
  const s = sections.find((x) => x.key === 'breakroom')
  assert('section exists for the first-detected area', !!s)
  assert('section name is the AI-resolved "Kitchenette", not "Break Room"', s && s.name === 'Kitchenette', s && s.name)
  assert('rename leaves the key untouched', s && s.key === 'breakroom', s && s.key)
  assert('rename leaves the text faithful/untouched', s && s.text === 'The break room sink is clean.', s && s.text)
  // A user-edited name is NOT overwritten by an AI rename.
  const rep2 = { ...baseReport, walkthrough: 'The break room sink is clean.', sections: [
    { id: 'sec_breakroom', key: 'breakroom', area: 'Break Room', name: 'My Custom Name', text: 'The break room sink is clean.', condition: 'Good', photos: [], textEdited: false, conditionEdited: false, nameEdited: true, followUp: false }
  ] }
  const r2 = await analyzeNarrative(rep2, { fetchImpl, makeId: (k) => `sec_${k}` })
  const s2 = r2.sections.find((x) => x.key === 'breakroom')
  assert('user-edited name wins over the AI rename', s2 && s2.name === 'My Custom Name', s2 && s2.name)
}

console.log('\n[34] Re-draft summarizes CURRENT (edited) section text, not the stale raw narrative')
{
  // The inspector edited the Roof section to correct the dictation. A re-draft must
  // send the corrected section text to the summary generator, not the original
  // walkthrough, so the regenerated summary can't revert to contradicting the edit.
  const edited = {
    ...baseReport,
    walkthrough: 'The roof is failing and needs replacement.',
    sections: [{ id: 'sec_roof', key: 'roof', area: 'Roof', name: 'Roof',
      text: 'The roof was recently replaced and is in good condition.', // inspector's correction
      condition: 'Good', photos: [], textEdited: true, conditionEdited: true, nameEdited: false, followUp: false }]
  }
  let sent = null
  const echoFetch = async (_url, opts) => {
    sent = JSON.parse(opts.body).narrative
    return { ok: true, json: async () => ({ areas: [], summary: `Summary: ${JSON.parse(opts.body).narrative}`, source: 'ai' }) }
  }
  const { summary } = await analyzeNarrative(edited, { fetchImpl: echoFetch, makeId: (k) => `sec_${k}` })
  assert('AI request used the edited section text, not the raw narrative', sent && /recently replaced/.test(sent) && !/is failing/.test(sent), sent)
  assert('regenerated summary reflects the inspector edit (not the stale dictation)', /recently replaced/.test(summary) && !/is failing/.test(summary), summary)
  // With NO manual edits, the raw walkthrough is still the source (unchanged behavior).
  let sent2 = null
  const echo2 = async (_u, opts) => { sent2 = JSON.parse(opts.body).narrative; return { ok: true, json: async () => ({ areas: [], summary: 'ok', source: 'ai' }) } }
  await analyzeNarrative({ ...baseReport, sections: [] }, { fetchImpl: echo2, makeId: (k) => `sec_${k}` })
  assert('no edits -> the raw walkthrough is still sent verbatim', sent2 === baseReport.walkthrough, sent2)
}

// --- Minimal ZIP entry reader ----------------------------------------------
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
console.log('\n' + '='.repeat(64))
if (failures.length) {
  console.log(`FAIL — ${passed} passed, ${failures.length} failed:`)
  for (const f of failures) console.log(`   ✗ ${f}`)
  console.log('='.repeat(64))
  process.exit(1)
}
console.log(`PASS — all ${passed} assertions held. Sections come only from the narrative; nothing is invented.`)
console.log('='.repeat(64))
process.exit(0)
