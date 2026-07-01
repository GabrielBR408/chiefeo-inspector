// ChiefEO Inspector — editable DOCX export.
// Builds a Word document from the shared export model. `buildDocxDocument` is
// pure (no DOM) so the self-check can pack it to a Buffer in Node and unzip to
// verify every item is present. The browser download helper is separate.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle
} from 'docx'
import { buildExportModel } from './exportModel.js'

const NAVY = '1C2A3A'
const ACCENT = '2E7DA6'
const MUTED = '66727F'

function headerLine(label, value) {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: NAVY }),
      new TextRun({ text: value || '—', color: NAVY })
    ]
  })
}

function conditionCellColor(condition) {
  if (condition === 'Poor') return 'B4452F'
  if (condition === 'Fair') return '9A6C10'
  if (condition === 'Good') return '1F6F44'
  return MUTED
}

// Build the docx Document object from a report (or a prebuilt model).
export function buildDocxDocument(reportOrModel) {
  const model = reportOrModel.sections ? reportOrModel : buildExportModel(reportOrModel)
  const children = []

  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: 'ChiefEO Inspector', bold: true, color: ACCENT, size: 20 })]
  }))
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: model.header.title, color: NAVY })]
  }))

  children.push(headerLine('Property', model.header.property))
  children.push(headerLine('Address', model.header.address))
  children.push(headerLine('Inspector', model.header.inspector))
  children.push(headerLine('Date', model.header.date))

  if (model.summary) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 200 },
      children: [new TextRun({ text: 'Summary', color: NAVY })]
    }))
    children.push(new Paragraph({ children: [new TextRun({ text: model.summary })] }))
  }

  for (const section of model.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: section.name, color: NAVY })]
    }))

    if (section.items.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'No items.', italics: true, color: MUTED })] }))
      continue
    }

    const rows = [
      new TableRow({
        tableHeader: true,
        children: ['Item', 'Condition', 'Notes', 'Photos'].map((h) =>
          new TableCell({
            shading: { fill: 'F3F6F8' },
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: MUTED, size: 18 })] })]
          })
        )
      })
    ]
    for (const item of section.items) {
      rows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.name, bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.condition, color: conditionCellColor(item.condition), bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item.notes || '—' })] })] }),
          new TableCell({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: String(item.photoCount) })] })] })
        ]
      }))
    }

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E3E7EC' }
      },
      rows
    }))
  }

  return new Document({ sections: [{ children }] })
}

// Node: return a Buffer. Used by the self-check.
export async function docxToBuffer(reportOrModel) {
  return Packer.toBuffer(buildDocxDocument(reportOrModel))
}

// Browser: trigger a download.
export async function downloadDocx(report, filename = 'inspection-report.docx') {
  const blob = await Packer.toBlob(buildDocxDocument(report))
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
