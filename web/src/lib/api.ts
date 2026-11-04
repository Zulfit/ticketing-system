const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const tokenKey = 'access_token';

export type Role = 'REPORTER' | 'TECHNICIAN' | 'ADMIN';

export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  department: { id: number; name: string } | null;
};

const roleLabels: Record<Role, string> = {
  REPORTER: 'Reporter',
  TECHNICIAN: 'Technician',
  ADMIN: 'Admin',
};

export function roleLabel(role: Role) {
  return roleLabels[role];
}

export function getToken() {
  return localStorage.getItem(tokenKey);
}

export function setToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  localStorage.removeItem(tokenKey);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return response.json() as Promise<T>;
}

async function errorMessage(response: Response) {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
  } catch {
    return 'Something went wrong';
  }
  return 'Something went wrong';
}
