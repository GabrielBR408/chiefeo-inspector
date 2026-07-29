# ChiefEO Inspector

Commercial property inspection tool with push-to-talk voice dictation and AI-assisted report drafting — deterministic field capture plus offline-capable PWA storage.

**Live tool:** [chiefeotool.com/chiefeoinspector](https://chiefeotool.com/chiefeoinspector) · [chiefeo-inspector.vercel.app](https://chiefeo-inspector.vercel.app)

---

## The Problem

Property inspections generate observations faster than you can type them, and typing isn't realistic anyway when you're climbing, holding a flashlight, or opening a mechanical panel with both hands occupied. The standard workaround — write it up from memory later, or transcribe a voice memo after the fact — creates a gap between what you actually saw and what ends up documented. Details get lost or flattened in that gap, and voice memos just push the reconstruction work to later instead of eliminating it.

## Who This Is For

- General managers doing regular property walkthroughs who need inspection documentation without an hour of desk time per visit
- Assistant property managers covering inspections across multiple properties who need consistent, structured output regardless of who's conducting the walkthrough
- Property managers running vendor walkthroughs, capital project punch lists, or condition assessments who need findings tied to specific locations and categories
- Anyone inspecting solo who needs both hands free during the walkthrough itself

## Key Features

- **Push-to-talk voice dictation** — capture findings hands-free, in the moment, while actually walking the property
- **Deterministic field capture** — structured data (location, category, severity) is captured as real data fields, not buried inside unstructured text the AI has to parse out later
- **AI-assisted narrative drafting, scoped narrowly** — the AI drafts readable write-ups from your captured structured data and dictation; it does not generate or decide the underlying findings
- **Offline-capable PWA with IndexedDB storage** — installable as a Progressive Web App, works in basements, parking structures, and anywhere else signal doesn't reach, and syncs once back online
- **Tested with a real self-check suite** — v0.2.1, 242/242 self-checks passing

## Real-World Example

During a walkthrough, a structured finding is captured at Location: "Parking Structure — Level 2, Bay 14," Category: "Structural / Concrete," alongside a push-to-talk dictated note describing concrete spalling with exposed rebar. The AI drafts this into a clean narrative — *"Concrete spalling observed on structural column, approximately 6 inches in diameter with visible exposed rebar. Condition appears longstanding. Recommend inclusion in next fiscal year's capital planning."* — while the structured location and category fields remain intact as data, not just text buried in a paragraph.

## Installation / Setup

```bash
git clone https://github.com/GabrielBR408/chiefeo-inspector.git
cd chiefeo-inspector
npm install
npm run dev
```

Then open the local dev URL shown in your terminal. As a PWA, it can be installed to a device home screen for offline use during walkthroughs — check your manifest/service worker config for install prompts in local dev.

Other scripts: `npm run build` (production build), `npm run preview` (serve the build), and `npm run self-check` (headless self-check suite).

## Status

v0.2.1 · 242/242 self-checks passing · PWA with IndexedDB offline storage

## Built By

Built by **Gabriel Roberts**, General Manager in Property Management at **Lincoln Property Company**, with 10+ years of hands-on commercial real estate experience, including inspections across Class A office properties. This tool is built around how inspections actually happen on-site — moving through a property, noticing things in sequence, hands often full — not a form filled out at a desk.

Full tool suite: [chiefeotool.com](https://chiefeotool.com)

## License

*(No license file currently exists in this repo — add one here: MIT, Apache 2.0, or proprietary.)*
