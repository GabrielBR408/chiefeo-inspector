// ChiefEO Inspector — domain schema.
// Pure data + constants. No DOM, no browser APIs — safe to import in Node
// (the headless self-check imports this directly).

// Condition ratings, Happy Inspector-style. These are the ONLY legal ratings.
// A rating is always chosen by the user (or defaulted to 'N/A'); the AI draft
// step is never allowed to fabricate or change a rating — see draft.js.
export const CONDITIONS = ['Good', 'Fair', 'Poor', 'N/A']
export const DEFAULT_CONDITION = 'N/A'

export function isValidCondition(c) {
  return CONDITIONS.includes(c)
}

// A blank inspection template mirroring Happy Inspector's area/item structure.
// Each area is a section; each item has a name, a condition rating, free-text
// notes, and attached photos. Users can add/remove areas and items freely.
export const DEFAULT_TEMPLATE = [
  { area: 'Exterior', items: ['Roof / Gutters', 'Siding / Paint', 'Landscaping', 'Driveway / Walkway'] },
  { area: 'Entry / Hallway', items: ['Front Door', 'Flooring', 'Walls / Ceiling', 'Lighting'] },
  { area: 'Living Room', items: ['Flooring', 'Walls / Ceiling', 'Windows', 'Outlets / Switches'] },
  { area: 'Kitchen', items: ['Countertops', 'Cabinets', 'Appliances', 'Sink / Plumbing', 'Flooring'] },
  { area: 'Bathroom', items: ['Toilet', 'Sink / Vanity', 'Tub / Shower', 'Ventilation', 'Flooring'] },
  { area: 'Bedroom', items: ['Flooring', 'Walls / Ceiling', 'Closet', 'Windows'] },
  { area: 'Systems', items: ['HVAC', 'Water Heater', 'Electrical Panel', 'Smoke / CO Detectors'] }
]

// Monotonic id helper. Ids must be stable strings so the AI round-trip can
// echo them back and the merge never mis-attributes notes to the wrong item.
let _seq = 0
export function makeId(prefix = 'i') {
  _seq += 1
  return `${prefix}_${_seq}_${(_seq * 2654435761 % 100000).toString(36)}`
}

// Build a fresh, empty report object from a template + header info.
export function newReport(header = {}, template = DEFAULT_TEMPLATE) {
  return {
    property: header.property || '',
    address: header.address || '',
    inspector: header.inspector || '',
    date: header.date || '',
    walkthrough: '', // global voice/text transcript used to draft the summary
    summary: '',
    areas: template.map((t) => ({
      id: makeId('a'),
      name: t.area,
      items: t.items.map((name) => ({
        id: makeId('i'),
        name,
        condition: DEFAULT_CONDITION,
        notes: '',
        photos: [] // array of { id, name, dataUrl } — dataUrl omitted in Node tests
      }))
    }))
  }
}
