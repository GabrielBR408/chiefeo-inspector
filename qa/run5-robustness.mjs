// QA Run 5 — Robustness, a11y basics, mobile layout, offline PWA
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + String(detail).slice(0, 150) : ''}`) }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

// --- Desktop robustness ---
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await ctx.route('**/dsmbppzvembacitwdrsj.supabase.co/**', (r) => r.fulfill({ status: 201, body: '' }))
  await page.goto(BASE)
  await page.waitForSelector('.brand-logo')
  await page.waitForTimeout(1200)
  const realErrors = errors.filter((e) => !/404|Failed to load resource/.test(e))
  check('no JS errors on load (excluding preview-only api 404s)', realErrors.length === 0, realErrors.join(' | '))

  // Draft with empty walkthrough → doesn't crash, produces sane message
  await page.click('button.generate-btn')
  await page.waitForSelector('.generate-msg', { timeout: 10000 })
  const m = await page.textContent('.generate-msg')
  check('draft on empty report does not crash', /Drafted/.test(m), m.trim())

  // Double-click draft — button disables while running
  await page.fill('textarea.walkthrough-text', 'The lobby is clean. The roof is worn.')
  await page.waitForTimeout(200)
  const disabledDuring = await page.evaluate(() => {
    const btn = document.querySelector('button.generate-btn')
    btn.click()
    return btn.disabled
  })
  check('draft button disabled while drafting', disabledDuring === true)
  await page.waitForTimeout(800)

  // Export both while one is in-flight → second click blocked (both disabled)
  const bothDisabled = await page.evaluate(() => {
    const [pdf, docx] = document.querySelectorAll('.export-actions .export-btn')
    pdf.click()
    return pdf.disabled && docx.disabled
  })
  check('both export buttons disable during export', bothDisabled === true)
  await page.waitForTimeout(1500)

  // A11y basics
  const inputsNoLabel = await page.$$eval('input:not([type=hidden]):not([type=file]), textarea, select', (els) =>
    els.filter((el) => {
      const hasAria = el.getAttribute('aria-label')
      const wrapped = el.closest('label')
      const forLabel = el.id && document.querySelector(`label[for="${el.id}"]`)
      return !hasAria && !wrapped && !forLabel && !el.className.includes('fb-')
    }).map((el) => el.className || el.tagName))
  check('all form controls have labels/aria-labels', inputsNoLabel.length === 0, JSON.stringify(inputsNoLabel))
  const btnsNoName = await page.$$eval('button', (els) => els.filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label')).map((b) => b.className))
  check('all buttons have accessible names', btnsNoName.length === 0, JSON.stringify(btnsNoName))
  const h1s = await page.$$eval('h1', (els) => els.length)
  check('exactly one h1', h1s === 1, `${h1s}`)
  const langSet = await page.$eval('html', (el) => el.getAttribute('lang'))
  check('html lang set', langSet === 'en')

  // Update banner dismiss button exists in code path; skip (needs SW update)
  await ctx.close()
}

// --- Mobile layout (iPhone-ish 375x667) ---
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await ctx.route('**/dsmbppzvembacitwdrsj.supabase.co/**', (r) => r.fulfill({ status: 201, body: '' }))
  await page.goto(BASE)
  await page.waitForSelector('.brand-logo')
  await page.fill('textarea.walkthrough-text', 'The kitchen counters are worn. The roof is in good condition. The north stairwell handrail is loose.')
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('no horizontal overflow at 375px', overflow <= 0, `${overflow}px overflow`)
  const pillVisible = await page.isVisible('.fb-pill')
  check('feedback pill visible on mobile', pillVisible)
  // Tap targets ≥ 40px for primary actions
  const targets = await page.$$eval('button.generate-btn, button.export-btn, .voice-btn', (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { c: el.className.split(' ')[0], h: Math.round(r.height) } }))
  check('primary tap targets ≥ 40px tall', targets.every((t) => t.h >= 40), JSON.stringify(targets))
  await page.screenshot({ path: '/tmp/qa-mobile.png', fullPage: true })

  // 320px ultra-narrow
  await page.setViewportSize({ width: 320, height: 640 })
  await page.waitForTimeout(300)
  const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('no horizontal overflow at 320px', overflow320 <= 0, `${overflow320}px overflow`)
  await ctx.close()
}

// --- Offline PWA: after first visit, app loads with network cut ---
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.brand-logo')
  // wait for SW to activate + precache
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise((r) => setTimeout(r, 1500))))
  await ctx.setOffline(true)
  await page.reload()
  const offlineLoads = await page.waitForSelector('.brand-logo', { timeout: 10000 }).then(() => true).catch(() => false)
  check('PWA loads offline after first visit', offlineLoads)
  if (offlineLoads) {
    await page.fill('textarea.walkthrough-text', 'Offline kitchen check, counters are worn.')
    await page.waitForTimeout(700)
    const secs = await page.$$('.area').then((a) => a.length)
    check('segmentation works offline', secs === 1, `${secs}`)
    // Draft offline → deterministic fallback, no crash
    await page.click('button.generate-btn')
    await page.waitForSelector('.generate-msg', { timeout: 10000 })
    const dm = await page.textContent('.generate-msg')
    check('draft offline falls back deterministically', /offline|deterministic/i.test(dm), dm.trim())
  }
  await ctx.close()
}

await browser.close()
const fails = results.filter((r) => !r.ok)
console.log(`\nRUN5: ${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
