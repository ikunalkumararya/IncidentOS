"use client";

import { API_BASE } from "./useInvestigation";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/**
 * A failed request carries per-field messages when the server rejected
 * specific inputs, so the form can point at the field that is wrong instead
 * of showing one banner for everything.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * `credentials: "include"` is what carries the session cookie. The API is on
 * a different port, so without it the browser sends nothing and every call
 * comes back 401.
 */
async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Can’t reach the server. Is it running on " + API_BASE + "?");
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    throw new AuthError(
      typeof data.error === "string" ? data.error : "Something went wrong.",
      (data.fields as Record<string, string>) ?? {},
      res.status,
    );
  }
  return data as T;
}

export const signIn = (email: string, password: string) =>
  post<{ user: AuthUser }>("/api/auth/signin", { email, password });

export const signUp = (name: string, email: string, password: string) =>
  post<{ user: AuthUser }>("/api/auth/signup", { name, email, password });

export const signOut = () => post<void>("/api/auth/signout");

/** Returns null when signed out, rather than throwing. */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return ((await res.json()) as { user: AuthUser }).user;
  } catch {
    return null;
  }
}
