/**
 * Browser → API transport.
 *
 * Centralised for three reasons: (1) every privileged call must send cookies (`credentials`) and
 * never a token copy, (2) a single place to map server error codes onto worker-facing copy, and
 * (3) one implementation of "don't hang forever, don't retry a POST blindly".
 */

export type ApiError = {
  message: string
  status: number
  code?: string
  retryAfterSec?: number
  /** Wrong-guess budget left on a one-time code, when the server reports it. */
  attemptsLeft?: number
  /** True when the caller should show this verbatim (validation), vs. a generic toast. */
  userFacing: boolean
}

export type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  timeoutMs?: number
  /** Idempotency key: lets a retry after a network blip be recognised by the server. */
  idempotencyKey?: string
  /** Firebase ID token for member-scoped routes (minted by `authedFetch`, never stored). */
  token?: string
}

const GENERIC_BY_STATUS: Record<number, string> = {
  400: 'That did not look right. Check the fields and try again.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have access to that action.',
  404: 'We could not find that record.',
  409: 'That action conflicts with the current state of the record.',
  413: 'That payload is too large.',
  429: 'Too many attempts — please wait a moment before trying again.',
  500: 'Something went wrong on our side. The team has been notified.',
  502: 'A partner service is not responding. Please retry shortly.',
  503: 'That action is unavailable during the maintenance window.',
}

export function buildUrl(path: string, query?: ApiOptions['query']): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

export async function apiFetch<T = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000)
  const externalAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', externalAbort)

  try {
    const res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      credentials: 'same-origin', // the HttpOnly admin cookie is the only credential we have
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    })

    const text = await res.text()
    let data: Record<string, unknown> = {}
    if (text.trim()) {
      try {
        data = JSON.parse(text) as Record<string, unknown>
      } catch {
        data = { raw: text.slice(0, 400) }
      }
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '0')
      const serverMessage = typeof data.error === 'string' ? data.error : ''
      const code = typeof data.code === 'string' ? data.code : undefined
      throw {
        message: serverMessage || GENERIC_BY_STATUS[res.status] || 'Request failed.',
        status: res.status,
        code,
        retryAfterSec: Number.isFinite(retryAfter) ? retryAfter : undefined,
        attemptsLeft: typeof data.attemptsLeft === 'number' ? data.attemptsLeft : undefined,
        // 4xx validation errors from our own routes are written for humans; 5xx details are not.
        userFacing: res.status < 500,
      } satisfies ApiError
    }

    return data as T
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && 'message' in err) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw {
        message: opts.signal?.aborted ? 'Cancelled.' : 'The request timed out. Please check your connection and retry.',
        status: 0,
        code: 'timeout',
        userFacing: true,
      } satisfies ApiError
    }
    throw {
      message: 'Network error. Check your connection and try again.',
      status: 0,
      code: 'network',
      userFacing: true,
    } satisfies ApiError
  } finally {
    clearTimeout(timeout)
    opts.signal?.removeEventListener('abort', externalAbort)
  }
}

/**
 * Current Firebase ID token, or null when signed out.
 *
 * Minted per call and never persisted: the previous prototype had no member-scoped API at all, so
 * nothing checked who was asking. Anything a member can do to their own record now presents this
 * token, and the route re-verifies it with the Admin SDK.
 */
export async function idToken(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await import('firebase/auth')
    const user = getAuth().currentUser
    if (!user) return null
    return await user.getIdToken(forceRefresh)
  } catch {
    return null
  }
}

export async function authedFetch<T = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await idToken()
  if (!token) {
    throw {
      message: 'Sign in to continue.',
      status: 401,
      code: 'auth_required',
      userFacing: true,
    } satisfies ApiError
  }
  return apiFetch<T>(path, { ...opts, token })
}

export function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code)
  return undefined
}

export function errorStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) return Number((err as { status: unknown }).status) || 0
  return 0
}
