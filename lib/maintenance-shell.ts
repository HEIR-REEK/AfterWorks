/**
 * The static maintenance shell.
 *
 * During a blackout the middleware used to rewrite every document request into `/maintenance`, which
 * means Next still had to render the route, load the root layout, ship the client runtime, boot
 * Firebase (which is often the very thing that is degraded), subscribe the app gate to `/api/maintenance`
 * and *then* paint a notice. If the app itself is unhealthy, the "we are down for maintenance" page
 * becomes the thing that is also down — and the worker sees a blank screen or an error overlay.
 *
 * This module returns a complete, self-contained HTML document built in the edge runtime from the
 * cached config alone: no React, no font or JS requests, no datastore read, no client bundle. It uses
 * the same tokens as `app/globals.css` (oklch values copied so the shell matches the product) and the
 * same message, title, ETA and service list, so nothing is invented for the outage page.
 *
 * It is intentionally static text — no script tag — because the production CSP has no
 * `'unsafe-inline'` for scripts. The countdown is therefore computed at render time and the page
 * refreshes itself while a window is open.
 */

import { DEFAULT_MAINTENANCE_CONFIG, MAINTENANCE_REASONS, type MaintenanceStatus } from './maintenance-shared'

export type ShellOptions = {
  siteName: string
  supportEmail: string
  /** Absolute URL for the public status page, if the deployment publishes one. */
  statusPath?: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

function formatEta(estimatedEnd: string | null, remainingMs: number | null): string {
  if (!estimatedEnd) return ''
  const end = new Date(estimatedEnd)
  if (Number.isNaN(end.getTime())) return ''
  const when = end.toLocaleString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Nairobi',
    hour12: false,
  })
  let window = ''
  // "about 3h from now" helps; "about 634174h from now" is noise from a mistyped ETA, so a window
  // longer than a day only shows the date.
  if (remainingMs !== null && remainingMs > 0 && remainingMs <= 86_400_000) {
    const minutes = Math.round(remainingMs / 60_000)
    window = minutes >= 60 ? ` — about ${Math.floor(minutes / 60)}h ${minutes % 60}m from now` : ` — about ${minutes} minute${minutes === 1 ? '' : 's'} from now`
  }
  return `${when} EAT${window}`
}

const STYLES = [
  ':root{color-scheme:light dark;--bg:oklch(0.985 0.004 250);--fg:oklch(0.21 0.02 260);--card:oklch(1 0 0);--muted:oklch(0.53 0.02 258);--border:oklch(0.91 0.006 255);--primary:oklch(0.52 0.2 258);--primaryFg:oklch(0.99 0.005 250);--warn:oklch(0.75 0.15 75);--warnFg:oklch(0.32 0.06 70);--success:oklch(0.62 0.15 155)}',
  '@media (prefers-color-scheme:dark){:root{--bg:oklch(0.145 0 0);--fg:oklch(0.985 0 0);--card:oklch(0.205 0 0);--muted:oklch(0.708 0 0);--border:oklch(0.269 0 0);--primary:oklch(0.922 0 0);--primaryFg:oklch(0.205 0 0);--warnFg:oklch(0.92 0.03 70)}}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font:400 16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:24px 16px;position:relative;overflow-x:hidden}',
  '.grid{position:fixed;inset:0;pointer-events:none;opacity:.05;background-image:radial-gradient(var(--fg) 1px,transparent 1px);background-size:22px 22px}',
  '.wrap{width:100%;max-width:620px;display:flex;flex-direction:column;gap:20px;position:relative}',
  '.brand{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
  '.mark{width:34px;height:34px;border-radius:11px;background:var(--primary);color:var(--primaryFg);display:flex;align-items:center;justify-content:center;flex:none}',
  '.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
  '.icon{width:44px;height:44px;border-radius:14px;background:color-mix(in oklab,var(--warn) 22%,transparent);color:var(--warnFg);display:flex;align-items:center;justify-content:center;margin-bottom:16px}',
  'h1{margin:0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-.01em;text-wrap:balance}',
  'p{margin:12px 0 0;color:var(--muted);font-size:15px;text-wrap:pretty}',
  '.eta{margin-top:18px;padding-top:16px;border-top:1px solid var(--border);font-size:13px;color:var(--muted)}',
  '.eta b{color:var(--fg);font-weight:600}',
  '.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}',
  'ul.svc{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}',
  'ul.svc li{display:flex;align-items:center;gap:9px;font-size:14px}',
  'ul.svc span.dot{width:8px;height:8px;border-radius:999px;flex:none;background:var(--success)}',
  'ul.svc li[data-s="degraded"] span.dot,ul.svc li[data-s="maintenance"] span.dot{background:var(--warn)}',
  'ul.svc li[data-s="outage"] span.dot{background:oklch(0.58 0.22 25)}',
  'ul.svc em{margin-left:auto;font-style:normal;color:var(--muted);font-size:12px;text-transform:capitalize}',
  '.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}',
  '.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;border:1px solid var(--border);color:var(--fg);background:var(--card)}',
  '.btn.primary{background:var(--primary);color:var(--primaryFg);border-color:transparent}',
  '.foot{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
  '.foot a{color:var(--primary);text-decoration:underline}',
  '@media (max-width:420px){.card{padding:22px}h1{font-size:22px}}',
].join('')

/**
 * Build the document. Everything shown here comes from the same config the admin console edits, and
 * the whole response is produced from the middleware's cached snapshot — so a blackout does not need
 * the app, the database or the client bundle to be reachable.
 */
export function renderMaintenanceShell(status: MaintenanceStatus, options: ShellOptions): string {
  const config = status.config
  const bannerOnly = status.bannerOnly
  const eta = formatEta(config.estimatedEnd, status.remainingMs)
  const refreshSeconds = status.remainingMs !== null && status.remainingMs > 0 ? Math.min(300, Math.max(30, Math.ceil(status.remainingMs / 1000 / 2))) : 60

  const troubled = config.affectedServices.filter((service) => service.status !== 'operational')
  const services = troubled.length
    ? `<ul class="svc">${troubled
        .map(
          (service) =>
            `<li data-s="${esc(service.status)}"><span class="dot"></span>${esc(service.label)}<em>${esc(
              service.status === 'maintenance' ? 'paused' : service.status,
            )}</em></li>`,
        )
        .join('')}</ul>`
    : ''

  // A scoped window must not read like the whole platform is gone, and an operator who never
  // touched the title field should not be shown the full-site wording.
  const scoped = config.scope === 'sections' && config.blockedPaths.length > 0
  const stockTitle = !config.title.trim() || config.title === DEFAULT_MAINTENANCE_CONFIG.title
  const headline = bannerOnly
    ? `${config.title} — the site is still open`
    : scoped && stockTitle
      ? 'This part of the platform is under maintenance'
      : config.title || 'Under maintenance — we will be back shortly'

  const explanation = bannerOnly
    ? config.banner || config.message
    : config.message || 'We will be back shortly. Your balance, applications and verification status are untouched.'

  const scopeNote =
    !bannerOnly && config.scope === 'sections' && config.blockedPaths.length
      ? `<p>Paused areas: <span class="mono">${config.blockedPaths.map((path) => esc(path)).join(', ')}</span></p>`
      : ''

  const icon =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.3-.6-.6-2.3z"/></svg>'

  const logo =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 18 12 4l8 14"/><path d="M8.5 14h7"/></svg>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(headline)} — ${esc(options.siteName)}</title>
<meta name="description" content="${esc(config.message.slice(0, 150))}">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#2f5fe0">
${bannerOnly || status.remainingMs === null ? '' : `<meta http-equiv="refresh" content="${refreshSeconds}">`}
<style>${STYLES}</style>
</head>
<body>
<div class="grid" aria-hidden="true"></div>
<main class="wrap">
  <div class="brand"><span class="mark">${logo}</span>${esc(options.siteName)}</div>
  <section class="card">
    <div class="icon">${icon}</div>
    <h1>${esc(headline)}</h1>
    <p>${esc(explanation)}</p>
    ${scopeNote}
    ${services}
    ${eta ? `<p class="eta">Expected back online <b>${esc(eta)}</b></p>` : '<p class="eta">We have not published an end time for this window — we will update this page as soon as we do.</p>'}
    <p class="eta">Reason: <b>${esc(MAINTENANCE_REASONS[config.reason] ?? 'Maintenance')}</b>${
      bannerOnly ? ' · the rest of the platform is working' : ''
    }</p>
    <div class="actions">
      <a class="btn primary" href="${esc(options.statusPath ?? '/status')}">Live status</a>
      <a class="btn" href="mailto:${esc(options.supportEmail)}">Contact support</a>
    </div>
  </section>
  <p class="foot">Nothing you submitted was lost — applications, uploaded work and earnings are stored on the server and will be here when you sign back in.
  ${config.updatedAt ? `<span class="mono"> · updated ${esc(new Date(config.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</span>` : ''}</p>
</main>
</body>
</html>`
}
