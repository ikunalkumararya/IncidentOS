import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "incidentos_session";
const DASHBOARD = "/dashboard/incident-analysis";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const pathname = request.nextUrl.pathname;
  const guestPage = ["/", "/signin", "/signup"].includes(pathname);

  if (guestPage) {
    if (!token) return NextResponse.next();
    // Check the actual account session; an expired or forged cookie must not
    // send the user into a dashboard/sign-in redirect loop.
    try {
      const base = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
      const response = await fetch(`${base}/api/auth/me`, {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) return NextResponse.redirect(new URL(DASHBOARD, request.url));
    } catch {
      // Leave sign-in accessible during an API outage.
    }
    return NextResponse.next();
  }

  // API authorization and the dashboard's fetchMe check verify the cookie.
  if (token) return NextResponse.next();
  const signin = new URL("/signin", request.url);
  signin.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(signin);
}

export const config = {
  matcher: ["/", "/signin", "/signup", "/dashboard/:path*", "/console/:path*"],
};
