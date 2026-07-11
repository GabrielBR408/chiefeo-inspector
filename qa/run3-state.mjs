// QA Run 3 — State & interaction (browser)
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext()
const page = await ctx.newPage()
await ctx.route('**/dsmbppzvembacitwdrsj.supabase.co/**', (r) => r.fulfill({ status: 201, body: '' }))
const dialogs = []
let dialogAction = 'accept'
page.on('dialog', (d) => { dialogs.push({ type: d.type(), msg: d.message() }); dialogAction === 'accept' ? d.accept('Prompted Property') : d.dismiss() })

await page.goto(BASE)
await page.waitForSelector('.brand-logo')

// 1) Section edits survive continued typing
await page.fill('textarea.walkthrough-text', 'The kitchen sink leaks.')
await page.waitForTimeout(200)
await page.fill('.area >> nth=0 >> textarea.item-notes', 'My custom edited note')
await page.click('textarea.walkthrough-text')
await page.type('textarea.walkthrough-text', ' The roof is in good condition.')
await page.waitForTimeout(300)
const kText = await page.inputValue('.area >> nth=0 >> textarea.item-notes')
check('edited section text survives more typing', kText === 'My custom edited note', kText)

// 2) Renamed section survives
await page.fill('.area >> nth=0 >> input.area-name', 'Chef Kitchen')
await page.type('textarea.walkthrough-text', ' The garage is fine.')
await page.waitForTimeout(300)
const kName = await page.inputValue('.area >> nth=0 >> input.area-name')
check('renamed section survives more typing', kName === 'Chef Kitchen', kName)

// 3) Condition override survives
await page.selectOption('.area >> nth=1 >> select.cond', 'Poor')
await page.type('textarea.walkthrough-text', ' More text here.')
await page.waitForTimeout(300)
const rCond = await page.inputValue('.area >> nth=1 >> select.cond')
check('condition override survives more typing', rCond === 'Poor', rCond)

// 4) Remove pristine section — no confirm, stays removed on keystroke
const before = await page.$$('.area').then((a) => a.length)
dialogs.length = 0
await page.click('.area >> nth=2 >> .icon-btn') // garage, pristine
await page.waitForTimeout(150)
check('pristine section removes without confirm', dialogs.length === 0)
const after = await page.$$('.area').then((a) => a.length)
check('section count decremented', after === before - 1, `${before}→${after}`)
await page.type('textarea.walkthrough-text', ' extra words.')
await page.waitForTimeout(300)
const after2 = await page.$$('.area').then((a) => a.length)
check('removed section does not resurrect on keystroke', after2 === after, `${after2}`)

// 5) Re-mentioning the area revives it
await page.type('textarea.walkthrough-text', ' Back at the garage the opener works well.')
await page.waitForTimeout(300)
const names5 = await page.$$eval('.area-name', (els) => els.map((e) => e.value))
check('re-mentioned removed area revives', names5.some((n) => n === 'Garage'), JSON.stringify(names5))

// 6) Removing a section WITH work asks for confirm
dialogs.length = 0
await page.click('.area >> nth=0 >> .icon-btn') // edited kitchen
await page.waitForTimeout(150)
check('editing section removal asks confirm', dialogs.length === 1 && /Remove/.test(dialogs[0].msg), dialogs[0] && dialogs[0].msg)

// 7) Draft then check summary; hand-edited summary is guarded by a confirm
await page.click('button.generate-btn')
await page.waitForSelector('.generate-msg')
const sum1 = await page.inputValue('textarea.summary-text')
check('draft generates summary', sum1.length > 10)
await page.fill('textarea.summary-text', 'MY HAND WRITTEN SUMMARY')
dialogAction = 'dismiss'; dialogs.length = 0
await page.click('button.generate-btn')
await page.waitForTimeout(700)
check('re-draft over edited summary asks confirm', dialogs.length === 1 && /Replace your edited summary/.test(dialogs[0].msg), dialogs[0] && dialogs[0].msg)
const sumKept = await page.inputValue('textarea.summary-text')
check('declining keeps hand-written summary', sumKept === 'MY HAND WRITTEN SUMMARY', sumKept.slice(0, 60))
dialogAction = 'accept'; dialogs.length = 0
await page.click('button.generate-btn')
await page.waitForTimeout(700)
const sum2 = await page.inputValue('textarea.summary-text')
check('accepting replaces with drafted summary', sum2 !== 'MY HAND WRITTEN SUMMARY', JSON.stringify(sum2.slice(0, 60)))

// 8) Save prompts for property when blank, uses prompted value
dialogs.length = 0
await page.click('button.new-inspection-btn >> nth=1') // Save inspection
await page.waitForTimeout(400)
check('save with blank property prompts', dialogs.some((d) => d.type === 'prompt'))
const lib1 = await page.textContent('.masthead-msg').catch(() => '')
check('saved under prompted property', /Prompted Property/.test(lib1), lib1.trim())
const propField = await page.inputValue('input[placeholder="e.g. Maple Court Apartments"]')
check('prompted property fills header field', propField === 'Prompted Property', propField)

// 9) Save twice → still 1 entry (update, not duplicate)
await page.click('button.new-inspection-btn >> nth=1')
await page.waitForTimeout(400)
const togText = await page.textContent('.saved-toggle')
check('re-save updates instead of duplicating', /\(1\)/.test(togText), togText.trim())

// 10) Reset then check stale messages
await page.click('button.reset-link')
await page.waitForTimeout(400)
const libAfterReset = await page.$('.masthead-msg')
const libAfterResetText = libAfterReset ? (await libAfterReset.textContent()).trim() : ''
check('[stale-state probe] library message cleared on reset', libAfterResetText === '', libAfterResetText)

// 11) Export with empty report → helpful message, no download
await page.click('button.export-btn >> nth=0')
await page.waitForTimeout(400)
const exMsg = await page.textContent('.generate-msg').catch(() => '')
check('empty export shows guidance message', /Nothing to export yet/.test(exMsg), exMsg.trim())
// then adding content and checking the stale message
await page.fill('textarea.walkthrough-text', 'The lobby is clean.')
await page.waitForTimeout(400)
const exMsg2 = await page.$$eval('section.step--result .generate-msg', (els) => els.map((e) => e.textContent.trim()).join('|')).catch(() => '')
check('[stale-state probe] "nothing to export" message clears once content exists', !/Nothing to export yet/.test(exMsg2), exMsg2)

// 12) Open saved over current work asks confirm; decline keeps work
await page.click('.saved-toggle')
dialogAction = 'dismiss'; dialogs.length = 0
await page.click('.saved-row button.mini-btn')
await page.waitForTimeout(300)
check('open-saved over work asks confirm', dialogs.length === 1)
const wtKept = await page.inputValue('textarea.walkthrough-text')
check('declining keeps current work', wtKept === 'The lobby is clean.', wtKept)
dialogAction = 'accept'
await page.click('.saved-row button.mini-btn')
await page.waitForTimeout(400)
const wtSwapped = await page.inputValue('textarea.walkthrough-text')
check('accepting swaps in saved inspection', wtSwapped !== 'The lobby is clean.' && wtSwapped.includes('kitchen'), wtSwapped.slice(0, 60))

// 13) Delete saved → panel empties (panel collapsed after open — expand it first)
await page.click('.saved-toggle')
await page.waitForSelector('.saved-row')
dialogs.length = 0
await page.click('.saved-row .icon-btn')
await page.waitForTimeout(400)
const panelGone = await page.$('.saved-toggle')
check('deleting last saved hides panel', panelGone === null)

// 14) Unfiled photo with no narrative → General bucket
await page.click('button.reset-link')
await page.waitForTimeout(300)
const fs = await import('node:fs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
fs.writeFileSync('/tmp/qa2.png', png)
await page.setInputFiles('.unfiled-photo input[type=file]', '/tmp/qa2.png')
await page.waitForTimeout(500)
const genName = await page.$$eval('.area-name', (els) => els.map((e) => e.value))
check('unfiled photo with no areas → General Observations', genName.includes('General Observations'), JSON.stringify(genName))

// 15) Unfiled photo goes to LAST-MENTIONED area, not last section
await page.click('button.reset-link')
await page.waitForTimeout(300)
await page.fill('textarea.walkthrough-text', 'The roof is good. The kitchen is fine. Back on the roof there is moss.')
await page.waitForTimeout(300)
await page.setInputFiles('.unfiled-photo input[type=file]', '/tmp/qa2.png')
await page.waitForTimeout(500)
const areaWithPhoto = await page.$$eval('.area', (els) => els.filter((el) => el.querySelector('.thumb')).map((el) => el.querySelector('.area-name').value))
check('unfiled photo files under last-MENTIONED area (Roof)', JSON.stringify(areaWithPhoto) === '["Roof"]', JSON.stringify(areaWithPhoto))

// 16) Feedback widget: open, esc-close, draft preserved, send disabled when empty
await page.click('.fb-pill')
await page.waitForSelector('.fb-sheet')
const sendDisabled = await page.$eval('.fb-send', (b) => b.disabled)
check('feedback send disabled when empty', sendDisabled)
await page.fill('.fb-text', 'test feedback draft')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Escape closes feedback sheet', (await page.$('.fb-sheet')) === null)
await page.click('.fb-pill')
const draftKept = await page.inputValue('.fb-text')
check('unsent feedback draft preserved on reopen', draftKept === 'test feedback draft', draftKept)
await page.click('.fb-send')
await page.waitForSelector('.fb-done', { timeout: 5000 })
check('feedback sends and confirms', true)
await page.click('.fb-done .fb-send')
check('feedback closes after done', (await page.$('.fb-sheet')) === null)

// 17) Rapid typing race: type fast then reload just after debounce
await page.click('button.reset-link')
await page.waitForTimeout(200)
await page.fill('textarea.walkthrough-text', 'The attic has mold everywhere.')
await page.waitForTimeout(700) // > 400ms debounce
await page.reload()
await page.waitForSelector('.brand-logo')
await page.waitForTimeout(600)
const wtRace = await page.inputValue('textarea.walkthrough-text')
check('debounced save persists before reload', wtRace === 'The attic has mold everywhere.', wtRace)

await browser.close()
const fails = results.filter((r) => !r.ok)
console.log(`\nRUN3: ${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
