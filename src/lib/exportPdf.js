// ChiefEO Inspector — PDF export via jsPDF.
// Renders the shared export model. `renderPdfText` returns the plain-text lines
// the PDF is built from (pure, no jsPDF) so the self-check can assert that the
// PDF's content includes every item without parsing a binary PDF. The actual
// jsPDF renderer iterates the SAME lines, so parity is guaranteed by construction.

import { buildExportModel } from './exportModel.js'

const NAVY = [28, 42, 58]
const ACCENT = [46, 125, 166]
const MUTED = [102, 114, 127]

function condColor(condition) {
  if (condition === 'Poor') return [180, 69, 47]
  if (condition === 'Fair') return [154, 108, 16]
  if (condition === 'Good') return [31, 111, 68]
  return MUTED
}

// The ordered list of text fragments that make up the report body. Each entry is
// { text, kind }. This is the single source of truth for PDF content and is what
// the self-check inspects. Every item name appears here exactly once.
export function renderPdfLines(reportOrModel) {
  const model = reportOrModel.sections ? reportOrModel : buildExportModel(reportOrModel)
  const lines = []
  lines.push({ text: 'ChiefEO Inspector', kind: 'brand' })
  lines.push({ text: model.header.title, kind: 'title' })
  lines.push({ text: `Property: ${model.header.property || '—'}`, kind: 'meta' })
  lines.push({ text: `Address: ${model.header.address || '—'}`, kind: 'meta' })
  lines.push({ text: `Inspector: ${model.header.inspector || '—'}`, kind: 'meta' })
  lines.push({ text: `Date: ${model.header.date || '—'}`, kind: 'meta' })
  if (model.summary) {
    lines.push({ text: 'Summary', kind: 'h2' })
    lines.push({ text: model.summary, kind: 'body' })
  }
  for (const section of model.sections) {
    lines.push({ text: section.name, kind: 'h2' })
    for (const item of section.items) {
      lines.push({ text: `${item.name} — ${item.condition}`, kind: 'item', condition: item.condition, itemName: item.name })
      if (item.notes) lines.push({ text: item.notes, kind: 'note' })
      if (item.photoCount > 0) lines.push({ text: `${item.photoCount} photo(s) attached`, kind: 'photo', photos: item.photos })
    }
  }
  return lines
}

// Browser: build and download the PDF. Photos (dataUrls) are embedded when present.
export async function downloadPdf(report, filename = 'inspection-report.pdf') {
  const { jsPDF } = await import('jspdf')
  const model = buildExportModel(report)
  const lines = renderPdfLines(model)
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const marginX = 48
  const maxW = doc.internal.pageSize.getWidth() - marginX * 2
  const pageH = doc.internal.pageSize.getHeight()
  let y = 56

  const ensure = (h) => { if (y + h > pageH - 48) { doc.addPage(); y = 56 } }

  for (const ln of lines) {
    if (ln.kind === 'brand') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ACCENT)
      ensure(16); doc.text(ln.text, marginX, y); y += 20
    } else if (ln.kind === 'title') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...NAVY)
      ensure(26); doc.text(ln.text, marginX, y); y += 28
    } else if (ln.kind === 'meta') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...NAVY)
      ensure(15); doc.text(ln.text, marginX, y); y += 15
    } else if (ln.kind === 'h2') {
      y += 10
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NAVY)
      ensure(20); doc.text(ln.text, marginX, y); y += 18
      doc.setDrawColor(227, 231, 236); doc.line(marginX, y - 6, marginX + maxW, y - 6)
    } else if (ln.kind === 'item') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
      const [r, g, b] = condColor(ln.condition)
      ensure(16)
      doc.setTextColor(...NAVY); doc.text(`${ln.itemName}`, marginX, y)
      doc.setTextColor(r, g, b); doc.text(`  ${ln.condition}`, marginX + doc.getTextWidth(ln.itemName) + 6, y)
      y += 15
    } else if (ln.kind === 'note') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
      const wrapped = doc.splitTextToSize(ln.text, maxW - 12)
      for (const w of wrapped) { ensure(13); doc.text(w, marginX + 12, y); y += 13 }
    } else if (ln.kind === 'photo') {
      const photos = ln.photos || []
      let px = marginX + 12
      const thumb = 84
      for (const p of photos) {
        if (!p || !p.dataUrl) continue
        if (px + thumb > marginX + maxW) { px = marginX + 12; y += thumb + 8 }
        ensure(thumb + 8)
        try {
          const fmt = p.dataUrl.includes('image/png') ? 'PNG' : 'JPEG'
          doc.addImage(p.dataUrl, fmt, px, y, thumb, thumb)
        } catch (_e) { /* skip unrenderable image */ }
        px += thumb + 8
      }
      y += thumb + 10
      if (photos.length === 0 || !photos.some((p) => p && p.dataUrl)) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED)
        ensure(12); doc.text(ln.text, marginX + 12, y); y += 12
      }
    }
  }
  doc.save(filename)
}
