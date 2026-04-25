import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD"],
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  return jsonResponse(request, {
    message: "Container started",
    by: session.user.email,
  });
}
