import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware() {},
  {
    callbacks: {
      authorized: ({ token }) => {
        return !!token;
      },
    },
    pages: {
      signIn: "/auth/login",
    },
  }
);

// กำหนด path ที่ต้องมี session
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth/login (login page)
     * - auth/register (register page)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|auth/login|auth/register).*)",
  ],
};