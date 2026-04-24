import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/rbac";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
    return new Response("Forbidden - MOD or ADMIN only", { status: 403 });
  }

  try {
    const { containerId, action, newName } = await request.json();
    const container = docker.getContainer(containerId);
    const inspect = await container.inspect();
    const containerName = inspect.Name?.replace("/", "") || containerId;

    switch (action) {
      case "start":
        await container.start();
        if (!(await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "started container",
          containerName,
        }))) {
          console.warn("Activity log was not recorded for start", { containerName, user: session.user.email });
        }
        break;
      case "stop":
        await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "requested stop container",
          containerName,
        });
        await container.stop();
        if (!(await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "stopped container",
          containerName,
        }))) {
          console.warn("Activity log was not recorded for stop", { containerName, user: session.user.email });
        }
        break;
      case "restart":
        await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "requested restart container",
          containerName,
        });
        await container.restart();
        if (!(await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "restarted container",
          containerName,
        }))) {
          console.warn("Activity log was not recorded for restart", { containerName, user: session.user.email });
        }
        break;
      case "remove":
        // Only ADMIN can delete
        if (session.user.role !== "ADMIN") {
          return new Response("Forbidden - Admin only", { status: 403 });
        }
        await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "requested delete container",
          containerName,
        });
        await container.remove({ force: true });
        if (!(await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "deleted container",
          containerName,
        }))) {
          console.warn("Activity log was not recorded for remove", { containerName, user: session.user.email });
        }
        break;
      case "rename":
        if (session.user.role !== "ADMIN") {
          return new Response("Forbidden - Admin only", { status: 403 });
        }
        if (!newName || typeof newName !== "string") {
          return new Response("New container name required", { status: 400 });
        }
        await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: "requested rename container",
          containerName,
        });
        await container.rename({ name: newName });
        if (!(await recordActivity({
          actorEmail: session.user.email,
          actorRole: session.user.role,
          action: `renamed container to ${newName}`,
          containerName: newName,
        }))) {
          console.warn("Activity log was not recorded for rename", { containerName, newName, user: session.user.email });
        }
        break;
      default:
        return new Response("Invalid action", { status: 400 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error(err);
    return new Response("Docker error", { status: 500 });
  }
}
