import { prisma } from "@/lib/prisma";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD", "USER"],
  });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const activities = await prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    return jsonResponse(request, activities);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);

    // Fallback for environments where migration is not applied yet.
    if (message.includes("ActivityLog") && message.toLowerCase().includes("does not exist")) {
      return jsonResponse(request, []);
    }

    return textResponse(request, "Activity log error", { status: 500 });
  }
}
