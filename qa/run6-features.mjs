// QA Run 6 — punch-list export (#1) and branding header (#3)
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { segmentNarrative } from '../src/lib/segment.js'
import { buildExportModel } from '../src/lib/exportModel.js'
import { pdfToArrayBuffer, renderPdfLines } from '../src/lib/exportPdf.js'
import { docxToBuffer } from '../src/lib/exportDocx.js'
import { BRAND } from '../src/lib/brand.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`) }
const docXmlOf = async (rep, tag) => {
  mkdirSync('/tmp/qa-f', { recursive: true })
  writeFileSync(`/tmp/qa-f/${tag}.docx`, await docxToBuffer(rep))
  return execSync(`cd /tmp/qa-f && rm -rf ${tag} && mkdir ${tag} && cd ${tag} && unzip -o -q ../${tag}.docx && cat word/document.xml`).toString()
}

const narrative = 'The roof is in good condition. The kitchen faucet leaks badly. The elevator is inoperable. The lobby shows minor wear.'
const sections = segmentNarrative(narrative).map((s) => ({ ...s, id: `sec_${s.key}`, photos: [] }))
const report = { property: 'QA Tower', address: '', inspector: 'QA Bot', date: '2026-07-10', walkthrough: narrative, summary: 'Test summary.', sections }

// --- #1 punch list: single list, membership = flagged OR Poor (no flags here,
// so it is exactly the Poor sections). Heading is the repo's existing
// "Follow-up / Punch list" — the merged block, not a second one.
const model = buildExportModel(report)
check('followUps = the Poor sections (no flags set)', JSON.stringify(model.followUps.map((f) => f.key)) === JSON.stringify(['kitchen', 'elevator']), JSON.stringify(model.followUps.map((f) => f.key)))
const pdfText = Buffer.from(await pdfToArrayBuffer(report)).toString('latin1')
check('PDF has Follow-up / Punch list heading', pdfText.includes('Follow-up / Punch list'))
check('PDF punch list carries the verbatim note', pdfText.includes('faucet leaks badly'))
const xml = await docXmlOf(report, 'fu')
check('DOCX has Follow-up / Punch list heading', xml.includes('Follow-up / Punch list'))
check('DOCX punch list lists both Poor areas', /Kitchen \(Poor\)/.test(xml) && /Elevator \(Poor\)/.test(xml))
// No Poor ratings and nothing flagged → no punch list anywhere
const cleanRep = { ...report, sections: sections.filter((s) => s.condition !== 'Poor') }
const pdfClean = Buffer.from(await pdfToArrayBuffer(cleanRep)).toString('latin1')
check('no Poor → no Follow-up block in PDF', !pdfClean.includes('Follow-up / Punch list'))
check('no Poor → no Follow-up block in DOCX', !(await docXmlOf(cleanRep, 'clean')).includes('Follow-up / Punch list'))
// Section fragment count unchanged (self-check parity)
const secFrags = renderPdfLines(report).filter((l) => l.kind === 'section')
check('punch list adds no section fragments', secFrags.length === model.sections.length)

// --- #3 branding: defaults reproduce current output exactly ---
check('default brand line unchanged', renderPdfLines(report)[0].text === 'ChiefEO Inspector')
check('default: no license meta line', !renderPdfLines(report).some((l) => l.kind === 'meta' && /License/.test(l.text)))
check('default DOCX has no license line', !xml.includes('CA HIS License'))

// --- #3 branding: configured brand flows into both exports ---
BRAND.name = 'Lincoln Property Inspections'
BRAND.licenseLine = 'CA HIS License #123456 · (415) 555-0100'
BRAND.logoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pdfBrand = Buffer.from(await pdfToArrayBuffer(report))
const pdfBrandText = pdfBrand.toString('latin1')
check('PDF carries brand name', pdfBrandText.includes('Lincoln Property Inspections'))
check('PDF carries license line', pdfBrandText.includes('CA HIS License #123456'))
check('PDF embeds logo image', /XObject/.test(pdfBrandText))
const xmlBrand = await docXmlOf(report, 'brand')
check('DOCX carries brand name', xmlBrand.includes('Lincoln Property Inspections'))
check('DOCX carries license line', xmlBrand.includes('CA HIS License #123456'))
const media = execSync('ls /tmp/qa-f/brand/word/media 2>/dev/null || echo NONE').toString().trim()
check('DOCX embeds logo in word/media', media !== 'NONE' && media.length > 0, media)

// --- #3 branding: garbage logo never breaks an export ---
BRAND.logoDataUrl = 'data:image/png;base64,not-a-real-image!!!'
const pdfBad = Buffer.from(await pdfToArrayBuffer(report))
check('garbage logo → PDF still builds', pdfBad.subarray(0, 5).toString() === '%PDF-')
check('garbage logo → DOCX still builds', (await docXmlOf(report, 'badlogo')).includes('Lincoln Property Inspections'))
BRAND.name = 'ChiefEO Inspector'; BRAND.licenseLine = ''; BRAND.logoDataUrl = ''

console.log(`\nRUN6: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
