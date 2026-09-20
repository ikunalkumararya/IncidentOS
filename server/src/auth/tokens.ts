import type { Response } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../config.js";
import type { User } from "./users.js";

export interface SessionClaims {
  sub: string;
  email: string;
  name: string;
}

export function signSession(user: User): string {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name } satisfies SessionClaims, JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** Returns the claims, or null for anything that does not verify. */
export function verifySession(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "string" || !decoded.sub) return null;
    return { sub: String(decoded.sub), email: String(decoded.email), name: String(decoded.name) };
  } catch {
    // Expired, tampered with, or signed by a different secret — all the same
    // to the caller: there is no session.
    return null;
  }
}

/**
 * The token goes in an httpOnly cookie rather than being handed to JavaScript,
 * so an XSS bug on the dashboard cannot read it.
 *
 * `sameSite: lax` is enough here even though the API and the web app are on
 * different ports: same-site is judged by registrable domain, and both are
 * localhost. Cookies ignore ports entirely, which is also why Next middleware
 * on :3000 can see a cookie set by the API on :4000.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
