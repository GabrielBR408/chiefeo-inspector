# QA suite (deep QA pass, July 2026)

Independent verification runs used for the deep QA pass. Runs 2, 4, and 6 are
pure Node (no browser) and run directly:

```
node qa/run2-edges.mjs
node qa/run4-outputs.mjs
node qa/run6-features.mjs
```

Runs 1, 3, 5, and verify-disable drive the built app in Chromium and need
Playwright (`npm i --no-save playwright`) plus a preview server
(`npm run build && npm run preview -- --port 4173`).

- run1-happy.mjs        — core happy path: details, segmentation, draft, exports, save/open/reset
- run2-edges.mjs        — input edge cases: empty/huge/hostile input, negation, unicode, dates, filenames
- run3-state.mjs        — state & interaction: edit survival, remove/revive, stale messages, dialogs, races
- run4-outputs.mjs      — output correctness: real PDF/DOCX bytes, tallies, pagination, photo embeds
- run5-robustness.mjs   — robustness & UX: console errors, a11y labels, touch targets, offline PWA
- run6-features.mjs     — punch-list export + report branding (defaults reproduce current output)
- verify-disable.mjs    — focused check that Draft disables while in flight (needs a delayed route)

These runs are an as-authored artifact of the QA pass; the authoritative,
CI-wired gate for this repo remains `npm run self-check` (`scripts/self-check.mjs`).
