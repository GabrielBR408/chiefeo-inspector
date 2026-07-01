import React from 'react'
import ItemRow from './ItemRow.jsx'
import { makeId, DEFAULT_CONDITION } from '../lib/schema.js'

// One area/section: a titled card holding its items, with add-item / rename /
// remove-area controls.
export default function AreaCard({ area, onChange, onRemove }) {
  const setItem = (id, next) =>
    onChange({ ...area, items: area.items.map((it) => (it.id === id ? next : it)) })

  const removeItem = (id) =>
    onChange({ ...area, items: area.items.filter((it) => it.id !== id) })

  const addItem = () =>
    onChange({
      ...area,
      items: [...area.items, { id: makeId('i'), name: 'New item', condition: DEFAULT_CONDITION, notes: '', photos: [] }]
    })

  return (
    <section className="area">
      <div className="area-head">
        <input
          className="area-name"
          value={area.name}
          onChange={(e) => onChange({ ...area, name: e.target.value })}
          placeholder="Area name"
        />
        <button type="button" className="icon-btn" onClick={onRemove} title="Remove area">✕</button>
      </div>

      <div className="area-items">
        {area.items.map((it) => (
          <ItemRow key={it.id} item={it} onChange={(n) => setItem(it.id, n)} onRemove={() => removeItem(it.id)} />
        ))}
      </div>

      <button type="button" className="add-item" onClick={addItem}>+ Add item</button>
    </section>
  )
}
