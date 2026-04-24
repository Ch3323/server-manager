import { getSession } from "@/lib/getSession";
import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/rbac";

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
    return new Response("Forbidden - MOD or ADMIN only", { status: 403 });
  }

  try {
    const { action } = await request.json();

    if (action === "restart_all") {
      if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
        return new Response("Forbidden - MOD or ADMIN only", { status: 403 });
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

      return Response.json({ success: true, affected: running.length });
    }

    if (action === "cleanup_stopped") {
      if (session.user.role !== "ADMIN") {
        return new Response("Forbidden - Admin only", { status: 403 });
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

      return Response.json({ success: true, affected: stopped.length });
    }

    return new Response("Invalid bulk action", { status: 400 });
  } catch (err) {
    console.error(err);
    return new Response("Bulk action error", { status: 500 });
  }
}
