'use client'

/**
 * Ask the provider where this request is coming from, for the profile form's country preselection.
 *
 * Why this exists at all, when the browser can already guess a country: it guesses from the IANA
 * time zone, and a time zone is not a location. A member on a US VPN reported `Africa/Nairobi` and
 * was handed a Kenyan flag and a `+254` prefix — the device was right about the clock and useless
 * about the network. Only the server sees the connection, so the answer has to come from there.
 *
 * Failure is a first-class outcome. `/api/geo` returns `country: null` when no proxy reported one
 * and no lookup service is configured — which is the shape of a default deployment, not an error.
 * In that case the caller falls back to the device's own detection, exactly as before. Nothing here
 * ever throws, and nothing here ever invents a country.
 *
 * The request is made once, after sign-in, and never blocks the form: `pending` starts `true` so
 * the phone picker can wait a beat instead of flashing the wrong flag, then settles.
 */

import { useEffect, useRef, useState } from 'react'

export type DetectedCountryState = {
  /** ISO-3166 alpha-2, or null when the provider could not tell (or was never asked). */
  country: string | null
  /** True until the first answer arrives, so callers can defer their own fallback. */
  pending: boolean
  /** Which source answered. `none` means neither the proxy nor a lookup could. */
  source: 'header' | 'lookup' | 'none' | null
}

const EMPTY: DetectedCountryState = { country: null, pending: true, source: null }

/**
 * @param enabled Only fetch when the form is actually editable and the member is signed in — a
 *   read-only profile has nothing to preselect, and the route requires a token.
 */
export function useDetectedCountry(enabled: boolean): DetectedCountryState {
  const [state, setState] = useState<DetectedCountryState>(EMPTY)
  const started = useRef(false)

  useEffect(() => {
    if (!enabled) {
      // Nothing to detect, and nothing to wait for: release the phone picker's fallback.
      setState({ country: null, pending: false, source: null })
      return
    }
    if (started.current) return
    started.current = true

    let cancelled = false
    void (async () => {
      try {
        const { getAuth } = await import('firebase/auth')
        const idToken = await getAuth().currentUser?.getIdToken()
        if (!idToken) {
          if (!cancelled) setState({ country: null, pending: false, source: null })
          return
        }
        const res = await fetch('/api/geo', { headers: { Authorization: `Bearer ${idToken}` } })
        if (!res.ok) {
          if (!cancelled) setState({ country: null, pending: false, source: null })
          return
        }
        const data = (await res.json()) as { country?: unknown; source?: unknown }
        const country = typeof data.country === 'string' && /^[A-Za-z]{2}$/.test(data.country) ? data.country.toUpperCase() : null
        const source =
          data.source === 'header' || data.source === 'lookup' || data.source === 'none'
            ? (data.source as DetectedCountryState['source'])
            : country
              ? 'header'
              : 'none'
        if (!cancelled) setState({ country, pending: false, source })
      } catch {
        // A geo guess is never worth a broken form.
        if (!cancelled) setState({ country: null, pending: false, source: null })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}
