import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { buildOptionsResponse, enforceRequestSecurity } from "@/lib/api-security";

const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/api/register",
]);

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  return pathname.startsWith("/api/auth/");
}

function buildUnauthorizedApiResponse(request: NextRequest) {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      ...Object.fromEntries(buildOptionsResponse(request).headers.entries()),
    },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");
  const isMutation =
    request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";

  if (isApiRoute && request.method === "OPTIONS") {
    return buildOptionsResponse(request);
  }

  if (isMutation) {
    const securityResponse = enforceRequestSecurity(request, {
      allowMissingOrigin: true,
      rateLimit:
        pathname === "/api/register" || pathname.startsWith("/api/auth/")
          ? {
              key: pathname,
              limit: 10,
              windowMs: 60_000,
            }
          : undefined,
    });

    if (securityResponse) {
      return securityResponse;
    }
  }

  if (isPublicPath(pathname)) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

    if (token && !isApiRoute && (pathname === "/auth/login" || pathname === "/auth/register")) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApiRoute) {
      return buildUnauthorizedApiResponse(request);
    }

    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
