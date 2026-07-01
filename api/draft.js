// Vercel serverless function — POST /api/draft.
// Turns a structured inspection (walkthrough transcript + rated items) into an
// editable report: an overall summary and optional polished per-item notes.
//
// The AI writes PROSE ONLY. It is instructed to echo every item id back and to
// never touch ratings/photos/the item set; the client (src/lib/draft.js
// applyAIDraft) additionally enforces this, so a misbehaving model cannot drop,
// invent, or re-rate an item. When ANTHROPIC_API_KEY is unset or the call
// fails, we return a deterministic summary so the app still works.
//
// Set ANTHROPIC_API_KEY in the Vercel project env for AI drafting.

export const config = { api: { bodyParser: true } }

const SYSTEM_PROMPT =
  'You are drafting a residential/commercial property inspection report from an ' +
  "inspector's spoken walkthrough and a list of already-rated items. " +
  'You write PROSE ONLY. Hard rules: ' +
  '(1) Do NOT invent items, areas, findings, or measurements that are not present in the input. ' +
  '(2) Do NOT change, add, or remove any condition rating — ratings are fixed by the inspector. ' +
  '(3) You may lightly clean up the wording of an item\'s notes for grammar/clarity, but only using ' +
  'information already in that item\'s notes or the walkthrough; never fabricate detail. ' +
  '(4) Reference every item by the exact id given. ' +
  'Return STRICT JSON of the form ' +
  '{"summary": "one short paragraph overview of the property condition based only on the ' +
  'ratings and walkthrough", "items": [{"id": "<id>", "notes": "<cleaned notes or empty>"}]}. ' +
  'The summary must not state a rating the tally does not support.'

function deterministicSummary(body) {
  const t = body.tally || {}
  const areas = Array.isArray(body.areas) ? body.areas : []
  const total = t.total || 0
  const parts = []
  const where = body.address || body.property || 'the property'
  parts.push(`${body.inspector ? `${body.inspector} inspected` : 'Inspection of'} ${where}${body.date ? ` on ${body.date}` : ''}.`)
  parts.push(`${areas.length} area(s) and ${total} item(s) were reviewed.`)
  const flags = []
  if (t.Poor) flags.push(`${t.Poor} rated Poor`)
  if (t.Fair) flags.push(`${t.Fair} rated Fair`)
  if (t.Good) flags.push(`${t.Good} rated Good`)
  if (flags.length) parts.push(`${flags.join(', ')}.`)
  if (t.Poor) parts.push('Items rated Poor should be prioritized for follow-up.')
  return parts.join(' ')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST')
    return res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
  const body = req.body || {}
  const apiKey = process.env.ANTHROPIC_API_KEY

  // Deterministic fallback — no key configured.
  if (!apiKey) {
    return json(res, 200, { summary: deterministicSummary(body), items: [], source: 'deterministic' })
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const userContent =
      JSON.stringify({
        property: body.property, address: body.address, inspector: body.inspector,
        date: body.date, walkthrough: body.walkthrough, tally: body.tally, areas: body.areas
      }) +
      '\n\nReturn ONLY the JSON object described in the system prompt.'

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }]
    })

    const text = (response.content && response.content[0] && response.content[0].text) || ''
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    let parsed
    try { parsed = JSON.parse(jsonText) } catch (_e) { parsed = null }
    if (!parsed || typeof parsed !== 'object') {
      return json(res, 200, { summary: deterministicSummary(body), items: [], source: 'deterministic' })
    }
    return json(res, 200, {
      summary: typeof parsed.summary === 'string' ? parsed.summary : deterministicSummary(body),
      items: Array.isArray(parsed.items) ? parsed.items : [],
      source: 'ai'
    })
  } catch (err) {
    console.log('[draft] API call failed — deterministic fallback:', String(err && err.message ? err.message : err))
    return json(res, 200, { summary: deterministicSummary(body), items: [], source: 'deterministic' })
  }
}

function json(res, status, obj) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(obj))
}
