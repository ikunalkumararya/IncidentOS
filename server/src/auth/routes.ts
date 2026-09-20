import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { clearSessionCookie, setSessionCookie, signSession } from "./tokens.js";
import {
  AuthUnavailableError,
  createUser,
  EmailTakenError,
  findUserById,
  verifyCredentials,
} from "./users.js";

const MIN_PASSWORD_LENGTH = 8;

// Mirrors the client-side rules in apps/web/lib/validation.ts. The client
// copy is for feedback while typing; this one is the rule that actually
// holds, since a request can arrive without ever touching the form.
const credentials = z.object({
  email: z.string().trim().min(1, "Enter your email address.").email("That doesn’t look like a valid email address."),
  password: z.string().min(1, "Enter a password."),
});

const signupBody = credentials.extend({
  name: z.string().trim().min(1, "Enter your name."),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
});

/** Turns a zod failure into `{ field: message }` for the form to render. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export const authRouter: Router = Router();

authRouter.post("/signup", async (req, res) => {
  const parsed = signupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid details", fields: fieldErrors(parsed.error) });
    return;
  }

  try {
    const user = await createUser(parsed.data);
    setSessionCookie(res, signSession(user));
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      res.status(409).json({ error: error.message, fields: { email: "That email is already registered." } });
      return;
    }
    if (error instanceof AuthUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
});

authRouter.post("/signin", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid details", fields: fieldErrors(parsed.error) });
    return;
  }

  try {
    const user = await verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      // One message for both a missing account and a wrong password, so the
      // response cannot be used to discover which emails are registered.
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    setSessionCookie(res, signSession(user));
    res.json({ user });
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
});

authRouter.post("/signout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

/**
 * Who the caller is. The claims alone would be enough to answer, but the row
 * is re-read so a deleted account stops being able to act on a token that has
 * not expired yet.
 */
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await findUserById(req.session!.sub);
  if (!user) {
    clearSessionCookie(res);
    res.status(401).json({ error: "authentication required" });
    return;
  }
  res.json({ user });
});
