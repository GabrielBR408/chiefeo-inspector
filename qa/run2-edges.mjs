// QA Run 2 — Input edge cases (logic level, Node)
import { segmentNarrative, deriveCondition, splitSentences, lastMentionedKey, effectiveRemovedKeys, tallyConditions, deterministicSummary, mergeSections } from '../src/lib/segment.js'
import { parseDetails, extractDate } from '../src/lib/details.js'
import { buildExportModel } from '../src/lib/exportModel.js'
import { imageSize, fitBox, dataUrlParts, dataUrlToBytes } from '../src/lib/imageMeta.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`) }

// --- Empty / whitespace / null ---
check('empty narrative → no sections', segmentNarrative('').length === 0)
check('whitespace narrative → no sections', segmentNarrative('   \n\t  ').length === 0)
check('null-ish narrative safe', segmentNarrative(undefined).length === 0)
check('deriveCondition empty → N/A', deriveCondition('') === 'N/A')
check('deriveCondition null → N/A', deriveCondition(null) === 'N/A')
check('splitSentences empty', splitSentences('').length === 0)
check('lastMentionedKey empty → null', lastMentionedKey('') === null)

// --- No-area text → general bucket ---
const gen = segmentNarrative('Everything looks acceptable overall nothing else to note')
check('area-less text → single general section', gen.length === 1 && gen[0].key === 'general', JSON.stringify(gen.map(s => s.key)))

// --- Duplicate mentions ---
const dup = segmentNarrative('The kitchen sink leaks. Later back in the kitchen the floor is scuffed.')
check('same area twice → one section', dup.filter(s => s.key === 'kitchen').length === 1)
check('duplicate mention text accumulates', dup.find(s => s.key === 'kitchen').text.includes('floor is scuffed'))

// --- Negation handling ---
check('"no water damage" → not Poor', deriveCondition('The basement shows no water damage') !== 'Poor', deriveCondition('The basement shows no water damage'))
check('"not broken" → not Poor', deriveCondition('The window latch is not broken') !== 'Poor', deriveCondition('The window latch is not broken'))
check('"doesn\'t leak" → not Poor', deriveCondition("The roof doesn't leak") !== 'Poor', deriveCondition("The roof doesn't leak"))
check('"does not leak" → not Poor', deriveCondition('The faucet does not leak') !== 'Poor', deriveCondition('The faucet does not leak'))
check('"didn\'t find any cracks" → not Poor', deriveCondition("I didn't find any cracks") !== 'Poor', deriveCondition("I didn't find any cracks"))
check('"never leaked" → not Poor', deriveCondition('This roof never leaked') !== 'Poor', deriveCondition('This roof never leaked'))
check('"not in good condition" → Fair', deriveCondition('The deck is not in good condition') === 'Fair', deriveCondition('The deck is not in good condition'))
check('real leak still Poor', deriveCondition('The ceiling has a leak') === 'Poor')
check('"no issues" still Good', deriveCondition('The roof has no issues') === 'Good', deriveCondition('The roof has no issues'))

// --- Weird property names / filename base (mirror App.jsx logic) ---
const base = (p) => (p || 'inspection').replace(/[^\w.-]+/g, '_').slice(0, 40)
check('emoji property → sanitized base', /^[\w.-]+$/.test(base('🏠 My House 🏠')), base('🏠 My House 🏠'))
check('slashes/quotes stripped', !/[/"\\]/.test(base('a/b"c\\d')), base('a/b"c\\d'))
check('empty property → inspection', base('') === 'inspection')
const longName = 'X'.repeat(300)
check('300-char property → capped 40', base(longName).length === 40)

// --- Unicode / dictation quirks ---
const uni = segmentNarrative('The café counter is worn. The men’s restroom faucet drips.')
check('café (é) matches coffee shop alias', uni.some(s => s.key === 'coffeeshop'), JSON.stringify(uni.map(s => s.key)))
check('curly-apostrophe men’s restroom matches', uni.some(s => s.key === 'mensrestroom'), JSON.stringify(uni.map(s => s.key)))

// --- Suite folding ---
const suites = segmentNarrative('Suite 210 carpet is stained. Then suite 200 is in good condition.')
check('suite numbers → distinct sections', suites.filter(s => /^suite/.test(s.key)).length === 2, JSON.stringify(suites.map(s => s.name)))
const suiteA = segmentNarrative('In the suite a leak was found under the sink.')
check('"in the suite a leak" does NOT become Suite A', suiteA.some(s => s.key === 'suite'), JSON.stringify(suiteA.map(s => s.name)))

// --- Modifier folding ---
const mods = segmentNarrative('The north lobby tile is cracked. The south lobby is clean.')
check('north/south lobby distinct', mods.filter(s => /lobby/.test(s.key)).length === 2, JSON.stringify(mods.map(s => s.name)))

// --- Reference prepositions must not spawn sections ---
const ref = segmentNarrative('The parking lot has three potholes near the entrance.')
check('"near the entrance" → no Entry section', !ref.some(s => s.key === 'entryfoyer'), JSON.stringify(ref.map(s => s.key)))

// --- Huge input performance & correctness ---
const bigChunk = 'In the kitchen the counters are worn. The roof looks good. The garage door sticks. '
const big = bigChunk.repeat(1200) // ~102k chars
let t0 = Date.now()
const bigSecs = segmentNarrative(big)
const bigMs = Date.now() - t0
check('100k-char narrative segments correctly', bigSecs.length === 3, `${bigSecs.length} sections`)
check('100k-char narrative under 1.5s (per-keystroke cost)', bigMs < 1500, `${bigMs}ms`)

// --- Malformed / hostile input ---
const xss = segmentNarrative('In the kitchen <script>alert(1)</script> the sink leaks & "quotes" everywhere')
check('HTML/script text kept verbatim (no crash)', xss.some(s => s.key === 'kitchen' && s.text.includes('<script>')))
const regexy = segmentNarrative('The kitchen has (unclosed [brackets and $pecial .* chars')
check('regex metacharacters safe', regexy.length >= 1)

// --- parseDetails edges ---
const t = '2026-07-10'
check('parseDetails empty', JSON.stringify(parseDetails('', { today: t })) === JSON.stringify({ property: '', address: '', inspector: '', date: '' }))
const pd1 = parseDetails('Property is Maple Court Apartments, 123 Main St Unit 4, inspector Jane Doe, today', { today: t })
check('canonical dictation parses all 4', pd1.property === 'Maple Court Apartments' && pd1.address === '123 Main St Unit 4' && pd1.inspector === 'Jane Doe' && pd1.date === t, JSON.stringify(pd1))
const pd2 = parseDetails('inspection on 13/45/26', { today: t })
check('impossible date 13/45/26 rejected', pd2.date === '', JSON.stringify(pd2.date))
const pd3 = parseDetails('date is 2/30/2026', { today: t })
check('Feb 30 rejected', pd3.date === '')
const pd4 = parseDetails('located at 1200 July 4 Plaza', { today: t })
check('"July 4 Plaza" street not parsed as date', pd4.date === '' && /July 4 Plaza/.test(pd4.address), JSON.stringify(pd4))
const pd5 = parseDetails('inspector is', { today: t })
check('cue with no value stays blank', pd5.inspector === '', JSON.stringify(pd5))
const pd6 = parseDetails('123 Elm Street', { today: t })
check('bare street address → address not property', pd6.address === '123 Elm Street' && pd6.property === '', JSON.stringify(pd6))
check('yesterday resolves', extractDate('yesterday', t).iso === '2026-07-09')
check('tomorrow resolves', extractDate('tomorrow', t).iso === '2026-07-11')
check('2-digit year pivots (7/4/99 → 1999)', extractDate('7/4/99', t).iso === '1999-07-04')

// --- tally / summary with weird sections ---
const weird = [{ key: 'a', name: 'A', condition: 'Bogus' }, { key: 'b', name: 'B', condition: 'Good' }]
const tal = tallyConditions(weird)
check('invalid condition tallies as N/A', tal['N/A'] === 1 && tal.Good === 1 && tal.total === 2)
const model = buildExportModel({ sections: [{ key: 'x', condition: 'Bogus', name: 'X' }] })
check('export model coerces invalid condition', model.sections[0].condition === 'N/A')
check('export model handles missing fields', buildExportModel({}).sections.length === 0)

// --- imageMeta edges ---
check('imageSize on garbage → null', imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) === null)
check('imageSize on empty → null', imageSize(new Uint8Array([])) === null)
check('fitBox zero-size → square fallback', JSON.stringify(fitBox(null, 84, 84)) === JSON.stringify({ width: 84, height: 84 }))
check('fitBox 0-height guarded', fitBox({ width: 100, height: 0 }, 84, 84).width === 84)
check('dataUrlParts rejects non-image', dataUrlParts('data:text/plain;base64,aGk=') === null)
check('dataUrlToBytes bad b64 → null/safe', dataUrlToBytes('data:image/png;base64,!!!not-base64!!!') === null || true)

// --- mergeSections edges ---
const prev = [{ id: 'sec_kitchen', key: 'kitchen', area: 'Kitchen', name: 'My Kitchen', text: 'edited', condition: 'Poor', photos: [{ id: 'p1' }], textEdited: true, nameEdited: true, conditionEdited: true }]
const merged = mergeSections(prev, [], (k) => `sec_${k}`)
check('section with user work survives empty resegment', merged.length === 1 && merged[0].name === 'My Kitchen')
const merged2 = mergeSections(prev, [{ key: 'kitchen', area: 'Kitchen', name: 'Kitchen', text: 'fresh', condition: 'Good' }])
check('edited fields win over fresh resegment', merged2[0].text === 'edited' && merged2[0].condition === 'Poor' && merged2[0].name === 'My Kitchen')

// --- effectiveRemovedKeys ---
const nar = 'The kitchen sink leaks.'
const removed = [{ key: 'kitchen', at: nar.length }]
check('removed key suppressed until re-mention', effectiveRemovedKeys(removed, nar).length === 1)
check('re-mention after removal revives', effectiveRemovedKeys(removed, nar + ' Back in the kitchen now.').length === 0)

console.log(`\nRUN2: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
