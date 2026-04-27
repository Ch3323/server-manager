import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import { isProtectedContainerName, normalizeContainerName } from "@/lib/protected-containers";
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
      key: "container-action",
      limit: 60,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const { containerId, action, newName } = await request.json();
    const container = docker.getContainer(containerId);
    const inspect = await container.inspect();
    const containerName = normalizeContainerName(inspect.Name) || containerId;

    if (
      (action === "stop" || action === "restart" || action === "remove" || action === "rename") &&
      isProtectedContainerName(containerName)
    ) {
      return textResponse(request, "This container is protected from stop, restart, delete, and rename", { status: 403 });
    }

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
          return textResponse(request, "Forbidden - Admin only", { status: 403 });
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
          return textResponse(request, "Forbidden - Admin only", { status: 403 });
        }
        if (!newName || typeof newName !== "string") {
          return textResponse(request, "New container name required", { status: 400 });
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
        return textResponse(request, "Invalid action", { status: 400 });
    }

    return jsonResponse(request, { success: true });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker error", { status: 500 });
  }
}
