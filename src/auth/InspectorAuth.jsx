/**
 * src/auth/InspectorAuth.jsx
 *
 * Optional account layer for ChiefEO Inspector. Wraps the app once at the root
 * and adds — and ONLY adds — a signup nudge, a corner account menu, and `?ref=`
 * capture. There is NO gating: anonymous users keep 100% of the app, offline
 * and online. Inspection photos, notes, and drafted reports NEVER touch
 * Supabase; the only thing that does is auth state.
 *
 * This composes the shared module's pieces directly (rather than its AccountShell
 * one-wrap) so the banner can be origin-aware — see the hub/away split below.
 * The vendored module is never edited; look and copy come through theme/brand/
 * copy props (SYNC.md rule).
 *
 * Origin awareness — why:
 *   Supabase sessions live in localStorage, which is per-ORIGIN. A user who
 *   signed in on the hub (chiefeotool.com) has a session on that origin, shared
 *   across every path there including the proxied /chiefeoinspector. But the
 *   bare chiefeo-inspector.vercel.app origin can NEVER see that session. So:
 *     • On a hub host  → offer inline sign-up/sign-in via the modal.
 *     • Anywhere else  → don't pretend inline auth belongs here; show a small
 *       "Sign in at chiefeotool.com" link that points at the real account home.
 *   Either way the account is optional and the app is fully usable logged out;
 *   the away branch simply avoids a confusing modal whose verification/session
 *   would land back on the hub, not here. No redirect, no error, no loop.
 *
 * If auth env is absent (VITE_SUPABASE_* unset), getSupabase() returns null,
 * the provider resolves to clean anon state, and the account UI self-hides —
 * the app runs exactly as it did before this file existed.
 */

import React, { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  AuthProvider,
  ReferralBanner,
  AccountMenu,
  AuthModal,
  useOptionalAuth,
} from '../../shared/chiefeo-auth/react/index.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://chiefeotool.com'

// Hosts where inline auth (the modal) belongs. localhost is included so local
// dev exercises the modal path; the bare vercel.app origin and 127.0.0.1 fall
// through to the "away" branch (which is what the direct production origin is).
const HUB_HOSTS = new Set(['chiefeotool.com', 'www.chiefeotool.com', 'localhost'])
function onHubHost() {
  try {
    return HUB_HOSTS.has(window.location.hostname)
  } catch {
    return true // no window (SSR/tests) → assume hub; never block rendering
  }
}

// Match the Inspector palette (src/styles/app.css :root) so the auth surfaces
// read as part of the same app, not a bolt-on. Passed to the vendored module as
// props — the module files stay byte-for-byte canonical.
const inspectorTheme = {
  ink: '#1c2a3a',
  accent: '#2e7da6',
  border: '#cfe1ea',
  tintBg: '#eef6fb',
  fieldBorder: '#cfe1ea',
}
const inspectorBrand = {
  productName: 'ChiefEO Inspector',
  // Used only as the away-branch link target (no onSignupClick there).
  signupHref: SITE_URL,
}

// Banner container: centered to the app's --maxw with matching side padding so
// the slim nudge lines up with the page content below it.
const bannerWrap = {
  maxWidth: '820px',
  margin: '0 auto',
  padding: '1rem 1.25rem 0',
}

/**
 * Reflects live session state onto <html data-chiefeo-authed> so CSS can reserve
 * clearance for the fixed corner avatar ONLY when it's actually showing. No
 * effect logged out — layout is untouched for anon users. Renders nothing.
 */
function AuthBodyFlag() {
  const { isLoggedIn } = useOptionalAuth()
  useEffect(() => {
    const el = document.documentElement
    if (isLoggedIn) el.setAttribute('data-chiefeo-authed', '1')
    else el.removeAttribute('data-chiefeo-authed')
    return () => el.removeAttribute('data-chiefeo-authed')
  }, [isLoggedIn])
  return null
}

export default function InspectorAuth({ children }) {
  const [showModal, setShowModal] = useState(false)
  const hub = onHubHost()

  return (
    <AuthProvider
      supabaseUrl={SUPABASE_URL}
      supabaseAnonKey={SUPABASE_ANON_KEY}
      siteUrl={SITE_URL}
      createClient={createClient}
      theme={inspectorTheme}
      brand={inspectorBrand}
    >
      {/* Logged-out: dismissible nudge. Logged-in: self-hides; AccountMenu
          takes over. On a hub host the CTA opens the modal; away from the hub
          it's a plain link to the account home at chiefeotool.com. */}
      <div style={bannerWrap}>
        <ReferralBanner
          onSignupClick={hub ? () => setShowModal(true) : undefined}
          signupHref={hub ? undefined : SITE_URL}
          copy={
            hub
              ? undefined
              : { bannerMessage: 'Have a ChiefEO account?', bannerCta: 'Sign in at chiefeotool.com' }
          }
        />
      </div>

      {/* Corner avatar + Sign out — renders only when a live session exists on
          THIS origin. On the bare vercel.app origin that's normally never, so
          it stays hidden and the away link above is what anon users see. */}
      <AccountMenu />
      <AuthBodyFlag />

      {children}

      {hub && showModal && <AuthModal onClose={() => setShowModal(false)} />}
    </AuthProvider>
  )
}
