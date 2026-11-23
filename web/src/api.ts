const TOKEN_KEY = 'token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const logout = () => localStorage.removeItem(TOKEN_KEY)

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error((await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

export async function login(email: string, password: string) {
  const r = await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  localStorage.setItem(TOKEN_KEY, r.accessToken)
}

export const register = (email: string, password: string) =>
  api('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })