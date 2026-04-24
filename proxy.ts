import { withAuth } from "next-auth/middleware";

export default withAuth(
  function proxy() {},
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

// เธเธณเธซเธเธ” path เธ—เธตเนเธ•เนเธญเธเธกเธต session
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

