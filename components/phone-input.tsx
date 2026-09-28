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
 * `value` is whatever the member typed (so their half-finished edit is not destroyed by a
 * re-render); `onChange` hands the parent the raw national number plus the selected country, and
 * the parent decides whether it is valid. Switching country keeps the national number and only
 * replaces the code — which is the behaviour somebody re-typing a number expects.
 */

import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { COUNTRIES, DEFAULT_COUNTRY, formatPhoneForDisplay, isKnownCountry, normalisePhone } from '@/lib/countries'
import { cn } from '@/lib/utils'

export type PhoneInputProps = {
  /** Raw text in the national field, as typed. */
  value: string
  /** ISO-3166 alpha-2 of the selected country. */
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
}: PhoneInputProps) {
  const selected = isKnownCountry(country) ? country : DEFAULT_COUNTRY
  const meta = useMemo(() => COUNTRIES.find((c) => c.code === selected) ?? COUNTRIES[0]!, [selected])

  // The full international preview, so the member can see exactly what will be stored and
  // compared for uniqueness — which is the thing the old single field never showed them.
  const preview = value.trim() ? normalisePhone(value, selected) : null
  const previewText = preview?.ok ? preview.display : value.trim() ? null : `+${meta.dial} `

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
            focus-trap and aria-listbox work a hand-rolled menu would need. */}
        <div className="relative flex shrink-0 items-center border-r border-border bg-muted/40">
          <span className="pointer-events-none absolute left-2.5 text-base leading-none" aria-hidden="true">
            {meta.flag}
          </span>
          <select
            value={selected}
            disabled={disabled}
            onChange={(e) => onChange(value, e.target.value)}
            aria-label="Country and dialling code"
            className="h-10 cursor-pointer appearance-none bg-transparent py-0 pl-8 pr-7 text-sm outline-none disabled:cursor-not-allowed"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} +{c.dial}
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
          onChange={(e) => onChange(e.target.value, selected)}
          placeholder={placeholder ?? '712 345 678'}
          autoComplete="tel-national"
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {hint ?? (
            <>
              Stored as{' '}
              <span className="font-mono">{previewText || formatPhoneForDisplay(`+${meta.dial}`, selected)}</span>{' '}
              — one number can be linked to one AfterWorks account.
            </>
          )}
        </p>
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
}: {
  value: string
  onChange: (countryName: string) => void
  id?: string
  label?: string
  required?: boolean
  disabled?: boolean
  className?: string
}) {
  const current = COUNTRIES.find((c) => c.name.toLowerCase() === value.trim().toLowerCase())
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label} {required ? <span className="text-destructive">*</span> : null}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base leading-none" aria-hidden="true">
          {current?.flag ?? '🌍'}
        </span>
        <select
          id={id}
          required={required}
          disabled={disabled}
          value={current?.name ?? value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card py-0 pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring"
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
    </div>
  )
}
