import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/rbac";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD"],
    rateLimit: {
      key: "container-bulk-action",
      limit: 20,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const { action } = await request.json();

    if (action === "restart_all") {
      if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
        return textResponse(request, "Forbidden - MOD or ADMIN only", { status: 403 });
      }

      const running = await docker.listContainers({ all: false });
      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: "requested restart all containers",
      });

      await Promise.all(
        running.map(async (item) => {
          const container = docker.getContainer(item.Id);
          await container.restart();
        })
      );

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: "restarted all containers",
      });

      return jsonResponse(request, { success: true, affected: running.length });
    }

    if (action === "cleanup_stopped") {
      if (session.user.role !== "ADMIN") {
        return textResponse(request, "Forbidden - Admin only", { status: 403 });
      }

      const allContainers = await docker.listContainers({ all: true });
      const stopped = allContainers.filter((item) => item.State !== "running");
      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: "requested cleanup stopped containers",
      });

      await Promise.all(
        stopped.map(async (item) => {
          const container = docker.getContainer(item.Id);
          await container.remove({ force: true });
        })
      );

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: "cleaned up stopped containers",
      });

      return jsonResponse(request, { success: true, affected: stopped.length });
    }

    return textResponse(request, "Invalid bulk action", { status: 400 });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Bulk action error", { status: 500 });
  }
}
