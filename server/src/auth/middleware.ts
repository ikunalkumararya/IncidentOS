import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE } from "../config.js";
import { verifySession, type SessionClaims } from "./tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionClaims;
    }
  }
}

/**
 * Rejects anything without a valid session.
 *
 * This is the real enforcement point. The dashboard also redirects signed-out
 * visitors away from /console, but that is a convenience — a browser is not a
 * security boundary, and the API is reachable directly.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const claims = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (!claims) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  req.session = claims;
  next();
}

/** Attaches the session when present, without requiring one. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const claims = verifySession(req.cookies?.[SESSION_COOKIE]);
  if (claims) req.session = claims;
  next();
}
