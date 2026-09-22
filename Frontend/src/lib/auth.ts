const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://mksedfewiimozjyivjqx.supabase.co"
).replace(/\/$/, "");

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rc2VkZmV3aWltb3pqeWl2anF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2NDAyNjEsImV4cCI6MjA3NjIxNjI2MX0.reWGVIp8FW03DqVF_WTxiJ4B_ZTKMcLI9G5hHL2zVR0";

const SESSION_KEY = "cargadero_auth_session";

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user?: {
    id?: string;
    email?: string;
  };
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function getStoredSession(): AuthSession | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function storeSession(session: AuthSession) {
  if (!isBrowser()) return;
  const now = Math.floor(Date.now() / 1000);
  const normalized = {
    ...session,
    expires_at:
      session.expires_at ||
      (session.expires_in ? now + Number(session.expires_in) : undefined),
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
}

export function clearSession() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY);
}

async function authFetch(path: string, init?: RequestInit) {
  return fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const response = await authFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.msg || body?.error_description || body?.message || "Email o contraseña incorrectos");
  }

  const session = (await response.json()) as AuthSession;
  storeSession(session);
  return session;
}

export async function refreshSession(): Promise<AuthSession | null> {
  const current = getStoredSession();
  if (!current?.refresh_token) return null;

  const response = await authFetch("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });

  if (!response.ok) {
    clearSession();
    return null;
  }

  const session = (await response.json()) as AuthSession;
  storeSession(session);
  return session;
}

export async function getValidAccessToken(): Promise<string | null> {
  let session = getStoredSession();
  if (!session?.access_token) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at <= now + 60) {
    session = await refreshSession();
  }

  return session?.access_token || null;
}

export async function signOut() {
  const token = await getValidAccessToken();
  if (token) {
    await authFetch("/auth/v1/logout", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
      },
    }).catch(() => undefined);
  }
  clearSession();
}
