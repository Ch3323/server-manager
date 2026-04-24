import { getSession } from "@/lib/getSession";
import { hasPermission } from "@/lib/rbac";

export async function POST() {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
    return new Response("Forbidden", { status: 403 });
  }

  return Response.json({
    message: "Container started",
    by: session.user.email,
  });
}
