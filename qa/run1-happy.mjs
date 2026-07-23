// QA Run 1 — Core happy path (browser)
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ acceptDownloads: true })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
// Block analytics so tests don't hit Supabase
await ctx.route('**/dsmbppzvembacitwdrsj.supabase.co/**', (r) => r.fulfill({ status: 201, body: '' }))

await page.goto(BASE)
await page.waitForSelector('.brand-logo')
check('app loads with brand-logo', true)

// Details fields
await page.fill('input[placeholder="e.g. Maple Court Apartments"]', '350 Rhode Island North')
await page.fill('input[placeholder="123 Main St, Unit 4"]', '350 Rhode Island St, San Francisco')
await page.fill('input[placeholder="Your name"]', 'Gabe Roberts')
const dateVal = await page.inputValue('input[type="date"]')
check('date defaults to today (local)', /^\d{4}-\d{2}-\d{2}$/.test(dateVal), dateVal)

// Walkthrough drives sections
const narrative = 'Starting at the roof — recently replaced, no issues. In the kitchen, the countertops are worn and the faucet drips. The primary bath fan is loud. The garage door is broken.'
await page.fill('textarea.walkthrough-text', narrative)
await page.waitForTimeout(300)
const names = await page.$$eval('.area-name', (els) => els.map((e) => e.value))
check('4 sections detected', names.length === 4, JSON.stringify(names))
check('sections in first-mention order', names[0] === 'Roof' && names[1] === 'Kitchen' && names[2] === 'Primary Bathroom' && names[3] === 'Garage', JSON.stringify(names))
const conds = await page.$$eval('select.cond', (els) => els.map((e) => e.value))
check('conditions derived (Good, Poor-worn, Fair-loud, Poor-broken)', JSON.stringify(conds) === JSON.stringify(['Good', 'Poor', 'Fair', 'Poor']), JSON.stringify(conds))

// Tally line
const note = await page.textContent('.step-note >> nth=2') // sections card note is 3rd step-note
check('tally line shows counts', /4 areas detected/.test(note) && /1 Good \/ 1 Fair \/ 2 Poor \/ 0 N\/A/.test(note), note.trim())

// Draft (no API key → deterministic; api route 404s on preview → fallback)
await page.click('button.generate-btn')
await page.waitForSelector('.generate-msg', { timeout: 15000 })
const draftMsg = await page.textContent('.generate-msg')
check('draft completes with message', /Drafted/.test(draftMsg), draftMsg.trim())
const summary = await page.inputValue('textarea.summary-text')
check('summary generated mentions inspector+areas', summary.includes('Gabe Roberts inspected') && summary.includes('Roof') && summary.includes('Kitchen'), summary.slice(0, 140))

// Export PDF + DOCX
const [dl1] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('button.export-btn >> nth=0')])
check('PDF downloads with property-based name', dl1.suggestedFilename() === '350_Rhode_Island_North.pdf', dl1.suggestedFilename())
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('button.export-btn--secondary')])
check('DOCX downloads', dl2.suggestedFilename() === '350_Rhode_Island_North.docx', dl2.suggestedFilename())
const p1 = await dl1.path(); const p2 = await dl2.path()
const fs = await import('node:fs')
check('PDF non-trivial size', fs.statSync(p1).size > 2000, `${fs.statSync(p1).size}b`)
check('DOCX non-trivial size', fs.statSync(p2).size > 2000, `${fs.statSync(p2).size}b`)

// Photo upload to a section (1x1 png)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
fs.writeFileSync('/tmp/qa-photo.png', png)
await page.setInputFiles('.area >> nth=1 >> input[type=file] >> nth=1', '/tmp/qa-photo.png')
await page.waitForSelector('.thumb img', { timeout: 5000 })
check('photo attaches and thumbnail renders', true)

// Save inspection
await page.click('button.new-inspection-btn >> nth=1')
await page.waitForSelector('.masthead-msg', { timeout: 5000 })
const libMsg = await page.textContent('.masthead-msg')
check('save inspection confirms', /Saved under/.test(libMsg), libMsg.trim())
await page.waitForSelector('.saved-toggle')
const savedToggle = await page.textContent('.saved-toggle')
check('saved panel appears with count', /Saved inspections \(1\)/.test(savedToggle), savedToggle.trim())

// Persistence across reload
await page.reload()
await page.waitForSelector('.brand-logo')
await page.waitForTimeout(600)
const wtAfter = await page.inputValue('textarea.walkthrough-text')
check('report persists across reload', wtAfter === narrative)
const namesAfter = await page.$$eval('.area-name', (els) => els.map((e) => e.value))
check('sections persist across reload', namesAfter.length === 4)

// New inspection resets
page.on('dialog', (d) => d.accept())
await page.click('button.new-inspection-btn >> nth=0')
await page.waitForTimeout(400)
const wtReset = await page.inputValue('textarea.walkthrough-text')
const secCount = await page.$$('.area').then((a) => a.length)
check('new inspection clears walkthrough+sections', wtReset === '' && secCount === 0)

// Open saved inspection back
await page.click('.saved-toggle')
await page.click('.saved-row button.mini-btn')
await page.waitForTimeout(400)
const wtOpened = await page.inputValue('textarea.walkthrough-text')
check('open saved inspection restores content', wtOpened === narrative)
const photosRestored = await page.$$('.thumb img').then((a) => a.length)
check('saved inspection restores photo', photosRestored === 1)

check('no console errors across happy path', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
await browser.close()
const fails = results.filter((r) => !r.ok)
console.log(`\nRUN1: ${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
