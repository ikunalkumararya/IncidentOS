import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "incidentos_session";

/**
 * Keeps signed-out visitors out of the console without a flash of dashboard.
 *
 * This only checks that a session cookie is present — it does not verify the
 * signature, which would mean shipping the signing key to the edge runtime.
 * That is deliberate: this is a routing convenience, not the security
 * boundary. A forged cookie gets you an empty shell, because every piece of
 * data on the page comes from the API, which does verify. The console also
 * confirms the session with /api/auth/me on mount and bounces if it is not
 * real.
 *
 * Cookies ignore ports, so the cookie the API sets on :4000 is visible here
 * on :3000.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const signin = new URL("/signin", request.url);
  // Preserve where they were heading so sign-in can send them back.
  signin.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signin);
}

export const config = {
  matcher: ["/dashboard/:path*", "/console/:path*"],
};
