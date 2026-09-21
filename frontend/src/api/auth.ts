/**
 * Сессия входа: JWT от /auth/* (эти ручки смонтированы на корне бэка, не в /api/v1),
 * роль и id пользователя — для UI-гейтинга; сервер всё равно проверяет права сам.
 * Активный workspace (change 021) хранится рядом: role — роль в активном контексте
 * (по membership, обновляется при переключении), workspaceId — 'default' или id.
 */
export type AuthRole = 'reader' | 'editor' | 'admin'

export interface AuthSession {
  token: string
  role: AuthRole
  email: string
  userId: string
  /** Активный workspace; 'default' или отсутствие поля = базовый контекст */
  workspaceId?: string
}

const KEY = 'quarter-auth'

export function loadAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    return parsed?.token && parsed.role ? parsed : null
  } catch {
    return null
  }
}

export function saveAuth(session: AuthSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    /* нет доступа к хранилищу — сессия до перезагрузки */
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ок */
  }
}

export function getRole(): AuthRole | null {
  return loadAuth()?.role ?? null
}

/** Активный workspace контекста ('default', если не переключались). */
export function getWorkspaceId(): string {
  return loadAuth()?.workspaceId || 'default'
}

/** Смена workspace: обновляет контекст сессии и роль в нём (по membership из GET /workspaces). */
export function setWorkspace(id: string, role?: AuthRole) {
  const session = loadAuth()
  if (!session) return
  saveAuth({ ...session, workspaceId: id === 'default' ? undefined : id, role: role ?? session.role })
}

/** reader — только просмотр; mutations в UI отключаются (сервер всё равно enforcing). */
export function canEdit(role: AuthRole | null | undefined): boolean {
  return role === 'editor' || role === 'admin'
}

interface AuthPayload {
  access_token: string
  user: { id: string; email: string; role: string }
}

function parse(payload: AuthPayload): AuthSession {
  return {
    token: payload.access_token,
    role: (payload.user.role as AuthRole) || 'reader',
    email: payload.user.email,
    userId: payload.user.id,
  } as AuthSession
}

function detail(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) return String((data as { detail: unknown }).detail)
  return 'Ошибка авторизации'
}

async function authRequest(path: string, body: unknown): Promise<AuthPayload> {
  const res = await fetch(`/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detail(data) || `HTTP ${res.status}`)
  return data as AuthPayload
}

/** Демо-вход (reader|editor|admin); при моках — фиктивная сессия без сети. */
export async function demoLogin(role: AuthRole): Promise<AuthSession> {
  if (import.meta.env.VITE_API_MOCKS === 'true') {
    const session: AuthSession = { token: 'mock', role, email: `demo_${role}@postcode.local`, userId: role }
    saveAuth(session)
    return session
  }
  const payload = await authRequest('/demo-login', { role })
  const session = parse(payload)
  saveAuth(session)
  return session
}

export async function login(email: string, password: string): Promise<AuthSession> {
  if (import.meta.env.VITE_API_MOCKS === 'true') {
    const session: AuthSession = { token: 'mock', role: 'editor', email, userId: 'mock' }
    saveAuth(session)
    return session
  }
  const payload = await authRequest('/login', { email, password })
  const session = parse(payload)
  saveAuth(session)
  return session
}
