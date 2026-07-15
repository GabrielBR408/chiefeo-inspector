// ChiefEO Inspector — editable DOCX export (narrative-driven).
// Builds a Word document from the shared export model. `buildDocxDocument` is
// pure (no DOM) so the self-check can pack it to a Buffer in Node and unzip to
// verify every section is present. The browser download helper is separate.

import { buildExportModel } from './exportModel.js'
import { dataUrlParts, dataUrlToBytes, imageSize, fitBox } from './imageMeta.js'
import { BRAND } from './brand.js'

// The docx library is heavy (~150 KB gzipped) and only needed at export time,
// so it is loaded lazily — like jsPDF in exportPdf.js — keeping it out of the
// main bundle the PWA must download and precache. Works in Node (self-check)
// and the browser alike.
const loadDocx = () => import('docx')

const NAVY = '1C2A3A'
const ACCENT = '2E7DA6'
const MUTED = '66727F'

function condColor(condition) {
  if (condition === 'Poor') return 'B4452F'
  if (condition === 'Fair') return '9A6C10'
  if (condition === 'Good') return '1F6F44'
  return MUTED
}

export async function buildDocxDocument(reportOrModel) {
  const {
    Document, Paragraph, TextRun, HeadingLevel, ImageRun,
    Table, TableRow, TableCell, WidthType, AlignmentType, LevelFormat, BorderStyle
  } = await loadDocx()
  const headerLine = (label, value) => new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: NAVY }),
      new TextRun({ text: value || '—', color: NAVY })
    ]
  })
  const model = reportOrModel.sections && reportOrModel.header ? reportOrModel : buildExportModel(reportOrModel)
  const children = []

  // Optional brand logo above the brand line. Validated like section photos —
  // bad data is skipped silently, never a broken document.
  try {
    const lp = dataUrlParts(BRAND.logoDataUrl)
    const lbytes = lp && /image\/(png|jpe?g)/.test(lp.mime) ? dataUrlToBytes(BRAND.logoDataUrl) : null
    const lsize = lbytes && imageSize(lbytes)
    if (lsize) {
      const { width, height } = fitBox(lsize, 128, 48)
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new ImageRun({ type: lp.mime.includes('png') ? 'png' : 'jpg', data: lbytes, transformation: { width, height } })]
      }))
    }
  } catch (_e) { /* skip bad logo */ }
  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: BRAND.name || 'ChiefEO Inspector', bold: true, color: ACCENT, size: 20 })]
  }))
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: model.header.title, color: NAVY })]
  }))

  children.push(headerLine('Property', model.header.property))
  children.push(headerLine('Address', model.header.address))
  children.push(headerLine('Inspector', model.header.inspector))
  children.push(headerLine('Date', model.header.date))
  if (BRAND.licenseLine) {
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: BRAND.licenseLine, color: MUTED, size: 18 })]
    }))
  }

  if (model.summary) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 200 },
      children: [new TextRun({ text: 'Summary', color: NAVY })]
    }))
    children.push(new Paragraph({ children: [new TextRun({ text: model.summary })] }))
  }

  // Ratings summary table: one row per area with its condition and follow-up
  // status, so a reader gets the whole picture at a glance before the detailed
  // section-by-section write-up. This is the owner-facing "at a glance" the
  // hand-built document lacked.
  if (model.sections.length) {
    const cell = (runs, { header = false, width } = {}) => new TableCell({
      width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
      shading: header ? { fill: 'F0F3F6' } : undefined,
      children: [new Paragraph({ children: Array.isArray(runs) ? runs : [runs] })]
    })
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        cell(new TextRun({ text: 'Area', bold: true, color: NAVY }), { header: true, width: 55 }),
        cell(new TextRun({ text: 'Condition', bold: true, color: NAVY }), { header: true, width: 25 }),
        cell(new TextRun({ text: 'Follow-up', bold: true, color: NAVY }), { header: true, width: 20 })
      ]
    })
    const bodyRows = model.sections.map((s) => new TableRow({
      children: [
        cell(new TextRun({ text: s.name, color: NAVY })),
        cell(new TextRun({ text: s.condition, bold: true, color: condColor(s.condition) })),
        cell(new TextRun({ text: (s.followUp || s.condition === 'Poor') ? 'Yes' : '—', color: MUTED }))
      ]
    }))
    const c = model.conditionCounts || {}
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 240 },
      children: [new TextRun({ text: 'Ratings summary', color: NAVY })]
    }))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'D7DEE5' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D7DEE5' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'D7DEE5' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'D7DEE5' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E3E7EC' },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E3E7EC' }
      },
      rows: [headerRow, ...bodyRows]
    }))
    children.push(new Paragraph({
      spacing: { before: 80 },
      children: [new TextRun({
        text: `Totals — Good: ${c.Good || 0}, Fair: ${c.Fair || 0}, Poor: ${c.Poor || 0}, N/A: ${c['N/A'] || 0}.`,
        color: MUTED, size: 18
      })]
    }))
  }

  // Coverage note: major systems the walkthrough never named. Reported so a
  // reader never mistakes an unmentioned system for one inspected and found fine.
  if (model.coverageGaps && model.coverageGaps.length) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 240 },
      children: [new TextRun({ text: 'Coverage note', color: NAVY })]
    }))
    children.push(new Paragraph({
      children: [new TextRun({
        text: `This walkthrough did not mention the following major systems, so they are NOT covered by this report and should not be assumed to be in good condition: ${model.coverageGaps.join(', ')}.`,
        color: NAVY
      })]
    }))
  }

  if (model.sections.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'No areas identified from the walkthrough.', italics: true, color: MUTED })] }))
  }

  for (const section of model.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 40 },
      children: [
        new TextRun({ text: section.name, color: NAVY }),
        new TextRun({ text: `   ${section.condition}`, bold: true, color: condColor(section.condition), size: 20 }),
        ...(section.followUp ? [new TextRun({ text: '   FOLLOW-UP', bold: true, color: ACCENT, size: 16 })] : [])
      ]
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: section.text || '—' })]
    }))
    if (section.photoCount > 0) {
      // Embed each photo (with a caption) so the owner-facing document carries
      // the images themselves, not just a count. Unembeddable photos fall back
      // to the count line so nothing is silently lost.
      let embedded = 0
      for (const p of section.photos || []) {
        try {
          const parts = dataUrlParts(p && p.dataUrl)
          const bytes = dataUrlToBytes(p && p.dataUrl)
          // Only PNG/JPEG with a parseable header embed reliably; anything else
          // (e.g. webp that failed downscale) falls through to the count note
          // instead of risking a corrupt document.
          const size = imageSize(bytes)
          if (!parts || !bytes || !size || !/image\/(png|jpe?g)/.test(parts.mime)) continue
          const type = parts.mime.includes('png') ? 'png' : 'jpg'
          const { width, height } = fitBox(size, 280, 210)
          children.push(new Paragraph({
            spacing: { before: 80 },
            children: [new ImageRun({ type, data: bytes, transformation: { width, height } })]
          }))
          children.push(new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: `${section.name} — ${p.name || 'photo'}`, italics: true, color: MUTED, size: 16 })]
          }))
          embedded += 1
        } catch (_e) { /* skip unrenderable photo; counted below */ }
      }
      if (embedded < section.photoCount) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${section.photoCount - embedded} photo(s) attached (could not be embedded)`, italics: true, color: MUTED, size: 18 })]
        }))
      }
    }
  }

  // Punch list: numbered follow-up items at the end — the actionable summary a
  // PM hands to a vendor or engineer. Membership is flagged OR Poor (see
  // exportModel.followUps). Mirrors the PDF's punch list exactly.
  const flagged = model.followUps || model.sections.filter((s) => s.followUp)
  if (flagged.length) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 320 },
      children: [new TextRun({ text: 'Follow-up / Punch list', color: NAVY })]
    }))
    flagged.forEach((s) => {
      children.push(new Paragraph({
        // Native Word numbering (auto-renumbers, survives edits) instead of a
        // hand-typed "1." prefix that breaks the moment a line is inserted.
        numbering: { reference: 'punch-list', level: 0 },
        spacing: { before: 80 },
        children: [
          new TextRun({ text: `${s.name} (${s.condition})`, bold: true, color: NAVY }),
          ...(s.text ? [new TextRun({ text: ` — ${s.text}` })] : []),
          ...(s.photoCount ? [new TextRun({ text: ` [${s.photoCount} photo(s)]`, italics: true, color: MUTED })] : [])
        ]
      }))
    })
  }

  const title = (model.header && model.header.title) || 'Property Inspection Report'
  const inspector = (model.header && model.header.inspector) || ''
  const where = (model.header && (model.header.property || model.header.address)) || ''
  return new Document({
    // Real document metadata so Word shows the inspector as author instead of a
    // generic "Un-named" — the file is owner-facing and often forwarded.
    creator: inspector || 'ChiefEO Inspector',
    title: where ? `${title} — ${where}` : title,
    description: `Property inspection report generated by ChiefEO Inspector${inspector ? ` for inspector ${inspector}` : ''}.`,
    numbering: {
      config: [{
        reference: 'punch-list',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } }
        }]
      }]
    },
    sections: [{ children }]
  })
}

// Node: return a Buffer. Used by the self-check.
export async function docxToBuffer(reportOrModel) {
  const { Packer } = await loadDocx()
  return Packer.toBuffer(await buildDocxDocument(reportOrModel))
}

// Browser: trigger a download.
export async function downloadDocx(report, filename = 'inspection-report.docx') {
  const { Packer } = await loadDocx()
  const blob = await Packer.toBlob(await buildDocxDocument(report))
  triggerDownload(blob, filename)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
