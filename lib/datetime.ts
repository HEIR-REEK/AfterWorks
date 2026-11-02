/**
 * One timestamp format for both renders.
 *
 * The worker app is server-rendered and then hydrated in the browser. A bare
 * `new Date(iso).toLocaleString()` uses the *runtime's* timezone and the browser's locale, so
 * production (UTC) and a member in Nairobi (UTC+3) produce different text for the same instant.
 * React sees that as a hydration mismatch and discards the server markup. A fixed locale and
 * timezone make the two renders identical.
 *
 * East Africa Time is the platform's operating timezone. It is also the timezone of the largest
 * share of the board's workers, so a label like “14:30 EAT” stays meaningful rather than rendering
 * a server's UTC clock to somebody who is not in UTC.
 */
export const DISPLAY_TIME_ZONE = 'Africa/Nairobi'

export function formatTimestamp(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    ...options,
  }).format(date)
}
