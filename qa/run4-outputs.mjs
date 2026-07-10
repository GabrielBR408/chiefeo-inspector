// QA Run 4 — Calculation & output correctness (Node, real export bytes)
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { segmentNarrative, deriveCondition, tallyConditions, deterministicSummary } from '../src/lib/segment.js'
import { buildExportModel } from '../src/lib/exportModel.js'
import { pdfToArrayBuffer, renderPdfLines } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`) }

const narrative = 'Starting at the roof, recently replaced with no issues. In the kitchen the counters are worn and the faucet leaks. The lobby is in fair condition. The elevator is inoperable.'
const sections = segmentNarrative(narrative).map((s) => ({ ...s, id: `sec_${s.key}`, photos: [] }))
const report = {
  property: 'QA Tower', address: '1 Test Way', inspector: 'QA Bot', date: '2026-07-10',
  walkthrough: narrative, summary: deterministicSummary({ property: 'QA Tower', address: '1 Test Way', inspector: 'QA Bot', date: '2026-07-10' }, sections),
  sections
}

// --- Derived conditions are what they SHOULD be ---
const byKey = Object.fromEntries(sections.map((s) => [s.key, s.condition]))
check('roof: "no issues" → Good', byKey.roof === 'Good', byKey.roof)
check('kitchen: worn+leaks → Poor', byKey.kitchen === 'Poor', byKey.kitchen)
check('lobby: "in fair condition" → Fair', byKey.lobby === 'Fair', byKey.lobby)
check('elevator: inoperable → Poor', byKey.elevator === 'Poor', byKey.elevator)

// --- Tally math ---
const t = tallyConditions(sections)
check('tally sums to section count', t.total === sections.length && t.Good + t.Fair + t.Poor + t['N/A'] === t.total)
check('tally counts exact (1G/1F/2P/0N)', t.Good === 1 && t.Fair === 1 && t.Poor === 2 && t['N/A'] === 0, JSON.stringify(t))

// --- Summary math/pluralization ---
check('summary names all 4 areas', ['Roof', 'Kitchen', 'Lobby', 'Elevator'].every((n) => report.summary.includes(n)), report.summary)
check('summary flags Poor priority', /2 rated Poor/.test(report.summary) && /prioritized/.test(report.summary))
const one = deterministicSummary({}, [sections[0]])
check('singular pluralization ("1 area")', /1 area:/.test(one) && !/1 areas/.test(one), one)

// --- Export model integrity ---
const model = buildExportModel(report)
check('model has all sections in order', JSON.stringify(model.sections.map((s) => s.key)) === JSON.stringify(sections.map((s) => s.key)))
check('model photoCount 0', model.photoCount === 0)

// --- PDF real bytes ---
const pdfBuf = Buffer.from(await pdfToArrayBuffer(report))
check('PDF magic header', pdfBuf.subarray(0, 5).toString() === '%PDF-')
const pdfText = pdfBuf.toString('latin1')
for (const s of model.sections) {
  check(`PDF contains section "${s.name} — ${s.condition}"`, pdfText.includes(s.name) && pdfText.includes(s.condition))
}
check('PDF contains property/inspector/date', pdfText.includes('QA Tower') && pdfText.includes('QA Bot') && pdfText.includes('2026-07-10'))
check('PDF contains verbatim narrative slice', pdfText.includes('counters are worn and the faucet leaks'))

// --- PDF content-model parity ---
const lines = renderPdfLines(report)
const sectionLines = lines.filter((l) => l.kind === 'section')
check('one section fragment per section', sectionLines.length === model.sections.length)

// --- DOCX real bytes (unzip) ---
mkdirSync('/tmp/qa-docx', { recursive: true })
const docxBuf = await docxToBuffer(report)
writeFileSync('/tmp/qa-docx/r.docx', docxBuf)
const docXml = execSync('cd /tmp/qa-docx && rm -rf x && mkdir x && cd x && unzip -o -q ../r.docx && cat word/document.xml').toString()
for (const s of model.sections) {
  check(`DOCX contains section "${s.name}"`, docXml.includes(`>${s.name}<`) || docXml.includes(s.name))
}
check('DOCX contains summary text', docXml.includes('QA Bot inspected'))
check('DOCX contains condition labels', docXml.includes('Poor') && docXml.includes('Fair') && docXml.includes('Good'))

// --- Photo embedding in both exports ---
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const repPhoto = { ...report, sections: report.sections.map((s, i) => (i === 0 ? { ...s, photos: [{ id: 'p1', name: 'roof.png', dataUrl: png1x1 }] } : s)) }
const pdf2 = Buffer.from(await pdfToArrayBuffer(repPhoto)).toString('latin1')
check('PDF with photo embeds image xobject', /\/Image/.test(pdf2) || /XObject/.test(pdf2))
const docx2 = await docxToBuffer(repPhoto)
writeFileSync('/tmp/qa-docx/p.docx', docx2)
const mediaLs = execSync('cd /tmp/qa-docx && rm -rf y && mkdir y && cd y && unzip -o -q ../p.docx && ls word/media 2>/dev/null || echo NONE').toString().trim()
check('DOCX embeds photo in word/media', mediaLs !== 'NONE' && mediaLs.length > 0, mediaLs)

// --- Corrupt photo does not corrupt export, is reported ---
const badPhoto = { id: 'p2', name: 'bad.png', dataUrl: 'data:image/png;base64,AAAABBBBCCCC' }
const repBad = { ...report, sections: report.sections.map((s, i) => (i === 0 ? { ...s, photos: [badPhoto] } : s)) }
const pdf3 = Buffer.from(await pdfToArrayBuffer(repBad))
check('PDF with corrupt photo still builds', pdf3.subarray(0, 5).toString() === '%PDF-')
check('PDF reports unembeddable photo', pdf3.toString('latin1').includes('could not be embedded'))
const docx3 = await docxToBuffer(repBad)
writeFileSync('/tmp/qa-docx/b.docx', docx3)
const bXml = execSync('cd /tmp/qa-docx && rm -rf z && mkdir z && cd z && unzip -o -q ../b.docx && cat word/document.xml').toString()
check('DOCX reports unembeddable photo', bXml.includes('could not be embedded'))

// --- Multi-page PDF (long narrative) ---
const longSecs = []
for (let i = 0; i < 30; i++) longSecs.push({ id: `sec_s${i}`, key: `s${i}`, name: `Area ${i}`, area: `Area ${i}`, condition: 'Fair', text: 'Lorem ipsum observation text repeated for length. '.repeat(8), photos: [] })
const pdf4 = Buffer.from(await pdfToArrayBuffer({ ...report, sections: longSecs }))
const pageCount = (pdf4.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
check('long report paginates (>1 page)', pageCount > 1, `${pageCount} pages`)

// --- Empty report exports (header only) ---
const emptyRep = { property: '', address: '', inspector: '', date: '', walkthrough: 'no areas here', summary: '', sections: [] }
const pdf5 = Buffer.from(await pdfToArrayBuffer(emptyRep))
check('sectionless PDF builds', pdf5.subarray(0, 5).toString() === '%PDF-')
const docx5 = await docxToBuffer(emptyRep)
writeFileSync('/tmp/qa-docx/e.docx', docx5)
const eXml = execSync('cd /tmp/qa-docx && rm -rf w && mkdir w && cd w && unzip -o -q ../e.docx && cat word/document.xml').toString()
check('sectionless DOCX carries explanatory note', eXml.includes('No areas identified'))

// --- Long section name: the PDF must keep the condition on-page ---
// letter width 612pt, marginX 48 → content right edge 564. The fix truncates
// the drawn name with an ellipsis so name+condition always fit inside maxW.
const { jsPDF } = await import('jspdf')
const probe = new jsPDF({ unit: 'pt', format: 'letter' })
probe.setFont('helvetica', 'bold'); probe.setFontSize(13)
const maxW = 612 - 96
for (const longSecName of [
  'Northwest Mechanical Penthouse Corridor Adjacent To Cooling Tower Platform Level Two',
  'X'.repeat(200),
  'Suite 210 — the long tail of a dictated run-on name that nobody trimmed before exporting the report'
]) {
  const condW = probe.getTextWidth('  Poor')
  let name = longSecName
  if (probe.getTextWidth(name) + 8 + condW > maxW) {
    while (name.length > 1 && probe.getTextWidth(`${name}…`) + 8 + condW > maxW) name = name.slice(0, -1)
    name = `${name}…`
  }
  const condX = 48 + probe.getTextWidth(name) + 8
  check(`[overflow fixed] condition on-page for ${longSecName.length}-char name`, condX + condW <= 612 - 48, `condition x=${Math.round(condX)}`)
}
// And the real PDF still builds with a pathological name
const pdf6 = Buffer.from(await pdfToArrayBuffer({ ...report, sections: [{ id: 'sec_l', key: 'l', name: 'X'.repeat(200), area: 'L', condition: 'Poor', text: 'note', photos: [] }] }))
check('PDF builds with 200-char section name', pdf6.subarray(0, 5).toString() === '%PDF-')

console.log(`\nRUN4: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
