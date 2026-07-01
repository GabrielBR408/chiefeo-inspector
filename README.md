# ChiefEO Inspector

A property-inspection **PWA** in the ChiefEO family (alongside GL Down Driller and
the Owner Report Generator). It does what Happy Inspector does — but you **talk
into it** and **snap photos**, and it **drafts an editable report** you can tweak
and export to **PDF** or an **editable Word (.docx)** document.

Works offline. Your notes and photos stay on the device (IndexedDB). AI drafting
is optional and only writes prose — it never changes your ratings, items, or photos.

## Stack

React 18 + Vite 6 + `vite-plugin-pwa`, matching the ChiefEO look-and-feel
(same logo, `#1c2a3a` navy / `#2e7da6` blue tokens, card UI). AI drafting is a
Vercel serverless function (`api/draft.js`) calling the Anthropic API, with a
deterministic fallback so the app works with no key.

## Features

- **Voice**: live client-side transcription via the Web Speech API — dictate a
  walkthrough, or dictate directly into any item's notes. Manual typing always
  works as a fallback.
- **Photos**: camera capture or file upload, attached per item, downscaled and
  stored offline in IndexedDB.
- **Report structure** (Happy Inspector-style): property / address / inspector /
  date header; areas (sections); per-item name, condition rating
  (Good / Fair / Poor / N/A), notes, and photos; an overall summary. Everything
  is editable before export.
- **AI draft**: turns the walkthrough + rated items into an overall summary and
  lightly cleaned per-item notes. It is hard-constrained (prompt **and** a
  client-side sanitizer) to never invent, drop, or re-rate an item.
- **Export**: client-side **PDF** (jsPDF) and **editable .docx** (`docx`), both
  built from one shared export model.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the built app
```

## Verify (headless self-check)

```bash
npm run self-check
```

Constructs a synthetic inspection and asserts the invariants below, then exits
non-zero on any failure (unzips the generated DOCX and inspects the PDF content
model for real):

| # | Invariant |
|---|-----------|
| 1 | Deterministic draft preserves every item, rating, and photo (none dropped/invented) |
| 2 | AI draft is sanitized — it cannot invent, drop, or re-rate items; ratings stay section-driven |
| 3 | Export model carries every item and photo, in order |
| 4 | DOCX export (unzipped) contains every item, rating, and area |
| 5 | PDF content model contains every item exactly once, plus its photos |

## Deploy (Vercel)

Standalone target: `chiefeo-inspector.vercel.app`. Import the repo in Vercel
(framework preset **Vite**), then set **`ANTHROPIC_API_KEY`** in the project's
Environment Variables to enable AI drafting. Without it, the app still runs and
produces a deterministic summary.

Later this can get a button on the chiefeotool.com hub (the
`variance-narrative-generator` repo's `TOOLS` array) — not wired here.
