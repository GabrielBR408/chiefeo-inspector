import React, { useEffect, useRef, useState } from 'react'
import chiefeoLogo from './assets/chiefeo-logo.png'
import AreaCard from './components/AreaCard.jsx'
import VoiceButton from './components/VoiceButton.jsx'
import { newReport, makeId } from './lib/schema.js'
import { draftReport, tallyConditions } from './lib/draft.js'
import { downloadPdf } from './lib/exportPdf.js'
import { downloadDocx } from './lib/exportDocx.js'
import { saveReport, loadReport, clearReport } from './lib/db.js'
import { registerPWA } from './pwa/registerUpdate.js'

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function App() {
  const [report, setReport] = useState(() => newReport({ date: todayISO() }))
  const [drafting, setDrafting] = useState(false)
  const [draftMsg, setDraftMsg] = useState('')
  const [exporting, setExporting] = useState('')
  const [update, setUpdate] = useState(null)
  const loaded = useRef(false)

  // Restore any offline-saved report on first mount.
  useEffect(() => {
    loadReport().then((saved) => {
      if (saved && saved.areas) setReport(saved)
      loaded.current = true
    })
    const dispose = registerPWA((apply) => setUpdate(() => apply))
    return dispose
  }, [])

  // Debounced offline autosave (includes photos).
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => saveReport(report), 400)
    return () => clearTimeout(t)
  }, [report])

  const setHeader = (patch) => setReport((r) => ({ ...r, ...patch }))
  const setArea = (id, next) =>
    setReport((r) => ({ ...r, areas: r.areas.map((a) => (a.id === id ? next : a)) }))
  const removeArea = (id) =>
    setReport((r) => ({ ...r, areas: r.areas.filter((a) => a.id !== id) }))
  const addArea = () =>
    setReport((r) => ({ ...r, areas: [...r.areas, { id: makeId('a'), name: 'New area', items: [] }] }))

  const appendWalkthrough = (chunk) =>
    setReport((r) => {
      const sep = r.walkthrough && !r.walkthrough.endsWith(' ') ? ' ' : ''
      return { ...r, walkthrough: `${r.walkthrough || ''}${sep}${chunk}`.trim() }
    })

  const onDraft = async () => {
    setDrafting(true)
    setDraftMsg('')
    try {
      const { report: drafted, source } = await draftReport(report)
      setReport(drafted)
      setDraftMsg(source === 'ai'
        ? 'Draft generated with AI. Everything below is editable.'
        : 'Draft generated (offline/deterministic). Everything below is editable.')
    } catch (_e) {
      setDraftMsg('Could not draft — please try again.')
    } finally {
      setDrafting(false)
    }
  }

  const onExport = async (kind) => {
    setExporting(kind)
    try {
      const base = (report.property || report.address || 'inspection').replace(/[^\w.-]+/g, '_').slice(0, 40)
      if (kind === 'pdf') await downloadPdf(report, `${base}.pdf`)
      else await downloadDocx(report, `${base}.docx`)
    } catch (e) {
      setDraftMsg(`Export failed: ${String(e && e.message ? e.message : e)}`)
    } finally {
      setExporting('')
    }
  }

  const onReset = async () => {
    if (!window.confirm('Start a new inspection? This clears the current one.')) return
    await clearReport()
    loaded.current = false
    setReport(newReport({ date: todayISO() }))
    setDraftMsg('')
    loaded.current = true
  }

  const t = tallyConditions(report)

  return (
    <main className="page">
      {update && (
        <div className="update-banner">
          <span className="update-banner-text">A new version is available.</span>
          <button className="update-banner-btn" onClick={() => update()}>Reload</button>
          <button className="update-banner-dismiss" onClick={() => setUpdate(null)}>×</button>
        </div>
      )}

      <header className="masthead">
        <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />
        <h1>Inspector</h1>
      </header>

      <p className="hero-line">Talk it. Snap it. Draft the report.</p>

      {/* Report header */}
      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Report details</span>
          <h2 className="step-title">Property &amp; inspector</h2>
        </div>
        <div className="header-grid">
          <label className="hg"><span>Property</span>
            <input value={report.property} onChange={(e) => setHeader({ property: e.target.value })} placeholder="e.g. Maple Court Apartments" /></label>
          <label className="hg"><span>Address</span>
            <input value={report.address} onChange={(e) => setHeader({ address: e.target.value })} placeholder="123 Main St, Unit 4" /></label>
          <label className="hg"><span>Inspector</span>
            <input value={report.inspector} onChange={(e) => setHeader({ inspector: e.target.value })} placeholder="Your name" /></label>
          <label className="hg"><span>Date</span>
            <input type="date" value={report.date} onChange={(e) => setHeader({ date: e.target.value })} /></label>
        </div>
      </section>

      {/* Walkthrough dictation */}
      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Walkthrough</span>
          <h2 className="step-title">Talk through the property</h2>
          <p className="step-note">Dictate a running commentary. The AI draft uses this for the summary — it never invents items or ratings.</p>
        </div>
        <div className="walkthrough-tools">
          <VoiceButton onText={appendWalkthrough} label="Dictate walkthrough" />
        </div>
        <textarea
          className="walkthrough-text"
          value={report.walkthrough}
          onChange={(e) => setHeader({ walkthrough: e.target.value })}
          placeholder="e.g. Starting at the exterior, the roof looks recently replaced, gutters are clear…"
          rows={3}
        />
      </section>

      {/* Areas & items */}
      <section className="step step--source">
        <div className="step-head">
          <span className="step-eyebrow">Findings</span>
          <h2 className="step-title">Areas &amp; items</h2>
          <p className="step-note">
            {report.areas.length} areas · {t.total} items · {t.Good} Good / {t.Fair} Fair / {t.Poor} Poor / {t['N/A']} N/A
          </p>
        </div>
        <div className="areas">
          {report.areas.map((a) => (
            <AreaCard key={a.id} area={a} onChange={(n) => setArea(a.id, n)} onRemove={() => removeArea(a.id)} />
          ))}
        </div>
        <button type="button" className="add-area" onClick={addArea}>+ Add area</button>
      </section>

      {/* Draft */}
      <section className="step step--generate">
        <button className="generate-btn" onClick={onDraft} disabled={drafting}>
          {drafting ? 'Drafting…' : '✨ Draft report'}
        </button>
        {draftMsg && <p className="generate-msg generate-msg--info">{draftMsg}</p>}
      </section>

      {/* Summary (editable) */}
      <section className="step step--result">
        <div className="step-head">
          <span className="step-eyebrow">Summary</span>
          <h2 className="step-title">Overall summary</h2>
        </div>
        <textarea
          className="summary-text"
          value={report.summary}
          onChange={(e) => setHeader({ summary: e.target.value })}
          placeholder="Click “Draft report” to generate — or write your own. Fully editable."
          rows={4}
        />
      </section>

      {/* Export */}
      <section className="step step--result">
        <div className="step-head">
          <span className="step-eyebrow">Export</span>
          <h2 className="step-title">Download the report</h2>
        </div>
        <div className="export-actions">
          <button className="export-btn" onClick={() => onExport('pdf')} disabled={!!exporting}>
            {exporting === 'pdf' ? 'Preparing PDF…' : '⬇ PDF'}
          </button>
          <button className="export-btn export-btn--secondary" onClick={() => onExport('docx')} disabled={!!exporting}>
            {exporting === 'docx' ? 'Preparing DOCX…' : '⬇ Editable Word (.docx)'}
          </button>
        </div>
        <button type="button" className="reset-link" onClick={onReset}>Start new inspection</button>
      </section>

      <footer className="site-footer">
        <p className="site-footer-line">ChiefEO Inspector · works offline · your photos and notes stay on this device.</p>
        <p className="site-footer-line site-footer-line--muted">AI drafting is optional and only writes prose — it never changes your ratings, items, or photos.</p>
      </footer>
    </main>
  )
}
