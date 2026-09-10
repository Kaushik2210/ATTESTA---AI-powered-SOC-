import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * Presence-only gate — the middleware runtime doesn't carry node:crypto,
 * so full HMAC verification of the session cookie happens where it's
 * actually consumed (lib/auth/session.ts's getSession(), called from
 * server components). This layer only keeps an unauthenticated request
 * from ever rendering a protected route's shell; it is not the security
 * boundary by itself. See session.ts's doc comment for this whole
 * scaffold's DEV-ONLY scope.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");

  if (!hasSession && !isLoginRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && isLoginRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
