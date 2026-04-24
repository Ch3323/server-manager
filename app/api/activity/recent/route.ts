import { getSession } from "@/lib/getSession";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!["ADMIN", "MOD", "USER"].includes(session.user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const activities = await prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    return Response.json(activities);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);

    // Fallback for environments where migration is not applied yet.
    if (message.includes("ActivityLog") && message.toLowerCase().includes("does not exist")) {
      return Response.json([]);
    }

    return new Response("Activity log error", { status: 500 });
  }
}
