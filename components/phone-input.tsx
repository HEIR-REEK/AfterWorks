'use client'

/**
 * Country + dialling-code picker for phone numbers.
 *
 * The profile form used to accept one free-text field, which meant a Kenyan member typing
 * `0712345678` and another typing `+254 712 345 678` were two different strings to every
 * uniqueness check we had — so the same person could hold two accounts. The fix is not a better
 * regex, it is a *structured* input: a country (which owns the flag and the dialling code) and a
 * national number, combined into one E.164 value by `lib/countries`.
 *
 * The flags are Unicode regional-indicator emoji rather than images: no network request, no SVG
 * allow-list, no bundle growth, and they follow the surrounding text colour in dark mode.
 *
 * One flag, once. A native `<select>` paints the selected option's own text in the closed control,
 * so the flag used to be rendered twice — once from the `<option>` label and once from the overlay
 * `<span>` positioned over the control. The emoji is now carried by the option text alone and the
 * overlay is gone; padding follows the text instead of reserving a slot for it.
 *
 * `value` is whatever the member typed (so their half-finished edit is not destroyed by a
 * re-render); `onChange` hands the parent the raw national number plus the selected country, and
 * the parent decides whether it is valid. Switching country keeps the national number and only
 * replaces the code — which is the behaviour somebody re-typing a number expects.
 *
 * `autoDetect` preselects the country from the device (see `detectCountry` in `lib/countries`).
 * It fires once, only while the number is still empty, and only when the parent has not already
 * chosen a country — a preselection must never overwrite a choice somebody has made, nor appear
 * mid-typing. `onCountryDetected` reports it so the form can show what it assumed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, MapPin } from 'lucide-react'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  detectCountry,
  formatPhoneForDisplay,
  isKnownCountry,
  normalisePhone,
  rememberDetectedCountry,
} from '@/lib/countries'
import { cn } from '@/lib/utils'

export type PhoneInputProps = {
  /** Raw text in the national field, as typed. */
  value: string
  /** ISO-3166 alpha-2 of the selected country. Empty/unknown means "not chosen yet". */
  country: string
  onChange: (nationalNumber: string, countryCode: string) => void
  /** Message shown under the field. Errors get the destructive tone automatically. */
  error?: string | null
  required?: boolean
  disabled?: boolean
  id?: string
  name?: string
  placeholder?: string
  /** Rendered under the field when there is no error. */
  hint?: string
  className?: string
  /** Preselect the country from the device's time zone / locale, once, while the field is empty. */
  autoDetect?: boolean
  /** Fires with the ISO code the detector chose, so the parent can label it as an assumption. */
  onCountryDetected?: (countryCode: string) => void
}

export function PhoneInput({
  value,
  country,
  onChange,
  error,
  required = false,
  disabled = false,
  id = 'phone',
  name = 'phone',
  placeholder,
  hint,
  className,
  autoDetect = false,
  onCountryDetected,
}: PhoneInputProps) {
  // An empty or unrecognised country is a real state ("not chosen yet"), not a licence to paint
  // Kenya on the form — so `selected` is the display fallback while the *stored* value stays empty
  // until either the member or the detector fills it in.
  const chosen = isKnownCountry(country) ? country : ''
  const selected = chosen || DEFAULT_COUNTRY
  const meta = useMemo(() => COUNTRIES.find((c) => c.code === selected) ?? COUNTRIES[0]!, [selected])
  const [detected, setDetected] = useState<string | null>(null)
  const autoDetectDone = useRef(false)

  useEffect(() => {
    if (!autoDetect || disabled || autoDetectDone.current) return
    // Never preselect over a value that already exists, and never interrupt a half-typed number.
    if (chosen || value.trim()) return
    autoDetectDone.current = true
    const guess = detectCountry()
    if (!guess || guess === selected) return
    rememberDetectedCountry(guess)
    setDetected(guess)
    onChange(value, guess)
    onCountryDetected?.(guess)
    // `autoDetectDone` is a ref, not a dependency: it is a latch, not a value to re-run on.
  }, [autoDetect, chosen, disabled, onChange, onCountryDetected, selected, value])

  // The full international preview, so the member can see exactly what will be stored and
  // compared for uniqueness — which is the thing the old single field never showed them.
  const preview = value.trim() ? normalisePhone(value, selected) : null
  const previewText = preview?.ok ? preview.display : value.trim() ? null : `+${meta.dial} `
  const detectedCountry = detected ? COUNTRIES.find((c) => c.code === detected) ?? null : null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Mobile number {required ? <span className="text-destructive">*</span> : null}
      </label>

      <div
        className={cn(
          'flex items-stretch overflow-hidden rounded-lg border bg-card focus-within:ring-2 focus-within:ring-ring',
          error ? 'border-destructive' : 'border-input',
          disabled && 'opacity-60',
        )}
      >
        {/* Country + flag + dialling code. A native <select> rather than a custom listbox: it
            works with a keyboard, a screen reader and a phone's native wheel without any of the
            focus-trap and aria-listbox work a hand-rolled menu would need. The flag comes from the
            option label — the control paints that text itself, which is why nothing is overlaid
            on top of it here. */}
        <div className="relative flex shrink-0 items-center border-r border-border bg-muted/40">
          <select
            value={selected}
            disabled={disabled}
            onChange={(e) => {
              setDetected(null)
              onChange(value, e.target.value)
            }}
            aria-label="Country and dialling code"
            className="h-10 max-w-[10.5rem] cursor-pointer appearance-none bg-transparent py-0 pl-2.5 pr-7 text-sm outline-none disabled:cursor-not-allowed"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" aria-hidden="true" />
        </div>

        {/* National number. The dialling code is shown as a non-editable prefix so the member can
            read the number they are typing exactly as it will be stored. */}
        <span className="flex shrink-0 items-center pl-3 font-mono text-sm text-muted-foreground">+{meta.dial}</span>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          required={required}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            setDetected(null)
            onChange(e.target.value, selected)
          }}
          placeholder={placeholder ?? '712 345 678'}
          autoComplete="tel-national"
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : (
        <>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
          {detectedCountry ? (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden="true" />
              We filled in {detectedCountry.flag} {detectedCountry.name} from this device. Change it above if that is
              wrong.
            </p>
          ) : null}
          {!hint ? (
            <p className="text-[11px] text-muted-foreground">
              Stored as{' '}
              <span className="font-mono">{previewText || formatPhoneForDisplay(`+${meta.dial}`, selected)}</span>{' '}
              — one number can be linked to one AfterWorks account.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/** A country select for the (non-phone) country of residence, sharing the same flag set. */
export function CountrySelect({
  value,
  onChange,
  id = 'country',
  label = 'Country',
  required = false,
  disabled = false,
  className,
  autoDetect = false,
  onCountryDetected,
}: {
  value: string
  onChange: (countryName: string) => void
  id?: string
  label?: string
  required?: boolean
  disabled?: boolean
  className?: string
  /** Preselect from the device's time zone / locale, once, while nothing has been chosen. */
  autoDetect?: boolean
  onCountryDetected?: (countryName: string) => void
}) {
  const current = COUNTRIES.find((c) => c.name.toLowerCase() === value.trim().toLowerCase())
  const [detected, setDetected] = useState<string | null>(null)
  const autoDetectDone = useRef(false)

  useEffect(() => {
    if (!autoDetect || disabled || autoDetectDone.current) return
    // A member who has already picked a country keeps it; the detector only fills a blank.
    if (current || value.trim()) return
    autoDetectDone.current = true
    const guess = detectCountry()
    if (!guess) return
    const meta = COUNTRIES.find((c) => c.code === guess)
    if (!meta || meta.name.toLowerCase() === value.trim().toLowerCase()) return
    rememberDetectedCountry(guess)
    setDetected(guess)
    onChange(meta.name)
    onCountryDetected?.(meta.name)
  }, [autoDetect, current, disabled, onChange, onCountryDetected, value])

  const detectedCountry = detected ? COUNTRIES.find((c) => c.code === detected) ?? null : null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </label>
      <div className="relative">
        <select
          id={id}
          required={required}
          disabled={disabled}
          value={current?.name ?? value}
          onChange={(e) => {
            setDetected(null)
            onChange(e.target.value)
          }}
          className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card py-0 pl-2.5 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {!current && <option value={value}>{value || 'Select a country'}</option>}
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.name}>
              {c.flag} {c.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
      {detectedCountry ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3 shrink-0" aria-hidden="true" />
          Detected {detectedCountry.flag} {detectedCountry.name} — change it if that is wrong.
        </p>
      ) : null}
    </div>
  )
}
