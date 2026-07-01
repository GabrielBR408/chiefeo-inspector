import React, { useRef } from 'react'
import VoiceButton from './VoiceButton.jsx'
import { CONDITIONS } from '../lib/schema.js'
import { fileToPhoto } from '../lib/db.js'

// One inspection item: name, condition rating, notes (typed or dictated), and
// attached photos (camera capture or file upload).
export default function ItemRow({ item, onChange, onRemove }) {
  const fileRef = useRef(null)
  const cameraRef = useRef(null)

  const set = (patch) => onChange({ ...item, ...patch })

  const appendNote = (chunk) => {
    const sep = item.notes && !item.notes.endsWith(' ') ? ' ' : ''
    set({ notes: `${item.notes || ''}${sep}${chunk}`.trim() })
  }

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const photos = []
    for (const f of files) {
      try { photos.push(await fileToPhoto(f)) } catch (_e) { /* skip bad file */ }
    }
    if (photos.length) set({ photos: [...(item.photos || []), ...photos] })
  }

  const removePhoto = (id) => set({ photos: (item.photos || []).filter((p) => p.id !== id) })

  const condClass = `cond cond--${(item.condition || 'N/A').toLowerCase().replace('/', '')}`

  return (
    <div className="item">
      <div className="item-head">
        <input
          className="item-name"
          value={item.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Item name"
        />
        <select
          className={condClass}
          value={item.condition}
          onChange={(e) => set({ condition: e.target.value })}
          aria-label="Condition"
        >
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="icon-btn" onClick={onRemove} title="Remove item">✕</button>
      </div>

      <textarea
        className="item-notes"
        value={item.notes}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder="Notes — type or dictate…"
        rows={2}
      />

      <div className="item-actions">
        <VoiceButton onText={appendNote} label="Dictate note" compact />
        <button type="button" className="mini-btn" onClick={() => cameraRef.current?.click()}>📷 Camera</button>
        <button type="button" className="mini-btn" onClick={() => fileRef.current?.click()}>🖼 Add photo</button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
      </div>

      {(item.photos || []).length > 0 && (
        <div className="thumbs">
          {item.photos.map((p) => (
            <div key={p.id} className="thumb">
              <img src={p.dataUrl} alt={p.name} />
              <button type="button" className="thumb-x" onClick={() => removePhoto(p.id)} title="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
