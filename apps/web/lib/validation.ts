/** Field-level validation shared by the sign-in, sign-up and incident report forms. */

export type Errors<T extends string> = Partial<Record<T, string>>;

// Deliberately permissive. Over-strict email regexes reject valid addresses,
// and the only thing a client-side check can honestly claim is "this looks
// like it has a local part, an @, and a domain".
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (!EMAIL.test(email)) return "That doesn’t look like a valid email address.";
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return "Enter a password.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function validateName(value: string): string | undefined {
  if (!value.trim()) return "Enter your name.";
  return undefined;
}

export interface PasswordStrength {
  /** 0–3. 0 means "too short to score". */
  score: number;
  label: string;
}

/**
 * A rough, honest strength hint: length does most of the work, character
 * variety the rest. It is guidance for the person typing, not a security
 * control.
 */
export function scorePassword(value: string): PasswordStrength {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { score: 0, label: `At least ${MIN_PASSWORD_LENGTH} characters` };
  }

  let score = 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;

  if (value.length >= 12 && variety >= 2) score = 2;
  if (value.length >= 14 && variety >= 3) score = 3;

  return { score, label: ["", "Fair", "Good", "Strong"][score] };
}

/*
 * Incident report fields. These bounds mirror the ones the report proxy
 * enforces in app/api/report/route.ts, which in turn mirror reportSchema on
 * the API server. This copy exists to tell someone what is wrong before they
 * submit — the server's copy is the one that decides.
 */

export function validateReportTitle(value: string): string | undefined {
  const title = value.trim();
  if (!title) return "Give the report a short title.";
  if (title.length < 3) return "Use at least 3 characters.";
  if (title.length > 200) return "Keep the title under 200 characters.";
  return undefined;
}

export function validateService(value: string): string | undefined {
  const service = value.trim();
  if (!service) return "Name the service that is affected.";
  if (service.length > 100) return "Keep the service name under 100 characters.";
  return undefined;
}

export function validateDescription(value: string): string | undefined {
  const description = value.trim();
  if (!description) return "Describe what you saw.";
  if (description.length < 10) return "Use at least 10 characters.";
  if (description.length > 12000) return "Keep the description under 12,000 characters.";
  return undefined;
}
