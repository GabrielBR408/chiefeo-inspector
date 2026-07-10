// Lightweight, privacy-friendly analytics — fire-and-forget, never blocks the UI,
// never throws. `properties` must only ever be counts/booleans/reason strings —
// never dictated narrative text, photos, or any drafted report content. The one
// exception is the `feedback` event, whose `message` is text the user typed
// deliberately in order to send it to us.
//
// APP_TAG identifies this build in the shared analytics dashboard. It is an
// identity/config value (like DB_NAME / the session-id key) — the branded and
// white-label builds set it differently so their events show separately; all
// call sites stay identical (`track(event, props)`).
export const APP_TAG = 'inspector'
const SUPABASE_URL = 'https://dsmbppzvembacitwdrsj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_jqiREpSEu8ItzSEcjTypsQ_41EivRsM'

// Internal-traffic flag: set this localStorage key (any truthy value) in a
// browser to mark its events as internal so dashboards can filter them out.
// Like APP_TAG / the session-id key, the key name is an identity/config value
// that differs between the branded and white-label builds.
const INTERNAL_KEY = 'chiefeo_internal'

export function isInternal() {
  try { return !!localStorage.getItem(INTERNAL_KEY) } catch { return false }
}

function getSessionId() {
  try {
    let id = localStorage.getItem('chiefeo_session_id')
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem('chiefeo_session_id', id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

export function track(event, properties = {}) {
  try {
    const body = JSON.stringify({
      app: APP_TAG,
      event,
      session_id: getSessionId(),
      properties,
      path: window.location.pathname,
      user_agent: navigator.userAgent
    })
    fetch(`${SUPABASE_URL}/rest/v1/app_events`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body,
      keepalive: true
    }).catch(() => {})
  } catch {
    // never throw — analytics must never break the app
  }
}
