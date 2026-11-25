const TOKEN_KEY = 'token'
const REFRESH_KEY = 'refreshToken'
const EXPIRES_KEY = 'expiresAt'

interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface RegisterInput {
  email: string
  password: string
  displayName: string
  gitHubUsername?: string
  roleTitle?: string
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)

export const getExpiresAt = () => {
  const raw = localStorage.getItem(EXPIRES_KEY)
  return raw ? Number(raw) : null
}

function saveSession(r: AuthResponse) {
  localStorage.setItem(TOKEN_KEY, r.accessToken)
  localStorage.setItem(REFRESH_KEY, r.refreshToken)
  localStorage.setItem(EXPIRES_KEY, String(Date.now() + r.expiresIn * 1000))
  window.dispatchEvent(new Event('auth-changed'))
}

export const logout = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(EXPIRES_KEY)
  window.dispatchEvent(new Event('auth-changed'))
}

let inFlightRefresh: Promise<boolean> | null = null
let lastRefreshAt = 0

export async function refreshSession(minIntervalMs = 0): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return false

  const now = Date.now()
  if (minIntervalMs > 0 && now - lastRefreshAt < minIntervalMs) return true
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        logout()
        return false
      }
      const r = (await res.json()) as AuthResponse
      lastRefreshAt = Date.now()
      saveSession(r)
      return true
    } catch {
      return false
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const makeRequest = (token: string | null) =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })

  let res = await makeRequest(getToken())

  if (res.status === 401 && path !== '/auth/login' && (await refreshSession())) {
    res = await makeRequest(getToken())
  }

  if (res.status === 401) {
    logout()
    window.location.href = '/auth'
    throw new Error('Unauthorized')
  }
  if (!res.ok) throw new Error((await res.text()) || res.statusText)

  const text = await res.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}

export async function login(email: string, password: string) {
  const r = await api<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  saveSession(r)
}

export const register = (data: RegisterInput) =>
  api('/auth/signup', { method: 'POST', body: JSON.stringify(data) })

export const forgotPassword = (email: string) =>
  api('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })

export const resetPassword = (email: string, resetCode: string, newPassword: string) =>
  api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, resetCode, newPassword }),
  })
  