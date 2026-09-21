import { clearAuth, loadAuth } from './auth'

export const API_BASE = '/api/v1'

// Мок-режим включается VITE_API_MOCKS=true (.env.development).
// Чтобы убрать моки: удалить src/mocks/, этот флаг и блок `if (USE_MOCKS)` ниже.
export const USE_MOCKS = import.meta.env.VITE_API_MOCKS === 'true'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

let authRedirecting = false

/** Ручки под /api/v1. */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return doRequest(method, path, body, API_BASE)
}

/** Ручки, смонтированные на корне бэка (/workspaces, /permissions) — проксируются отдельно от /api/v1. */
export async function requestRoot<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return doRequest(method, path, body, '')
}

async function doRequest<T>(method: Method, path: string, body: unknown, base: string): Promise<T> {
  if (USE_MOCKS) {
    const { handleMock } = await import('../mocks')
    const auth = loadAuth()
    const headers: Record<string, string> = {}
    if (auth?.token) headers.Authorization = `Bearer ${auth.token}`
    const ws = auth?.workspaceId
    if (ws && ws !== 'default') headers['X-Workspace-Id'] = ws
    return handleMock<T>(method, path, body, headers)
  }

  const isForm = body instanceof FormData
  const headers: Record<string, string> = body && !isForm ? { 'Content-Type': 'application/json' } : {}
  const auth = loadAuth()
  if (auth?.token && !path.startsWith('/auth/')) headers.Authorization = `Bearer ${auth.token}`
  // workspace-контекст (change 021): не-default передаётся заголовком на все ручки
  const ws = auth?.workspaceId
  if (auth?.token && ws && ws !== 'default' && !path.startsWith('/auth/')) headers['X-Workspace-Id'] = ws

  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })

  if (res.status === 401 && !authRedirecting) {
    // Просроченный/чужой токен: выходим на экран входа (избегаем цикла редиректов)
    authRedirecting = true
    clearAuth()
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login?expired=1')
    }
    authRedirecting = false
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, detailMessage(data) ?? `HTTP ${res.status}`)
  }
  return data as T
}

function detailMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) return null
  const { detail } = data as { detail: unknown }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join('; ')
  return null
}

export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}
