import { getSession } from "@/lib/getSession";
import { docker } from "@/lib/docker";

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!["ADMIN", "MOD", "USER"].includes(session.user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const containerId = searchParams.get("containerId");
    const tail = searchParams.get("tail") || "100";

    if (!containerId) {
      return new Response("Container ID required", { status: 400 });
    }

    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: parseInt(tail),
      timestamps: true,
    });

    // Convert logs to string and clean up
    const logString = logs.toString('utf-8');
    // Remove docker stream header bytes if present
    const cleanLogs = logString
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      .split('\n')
      .filter(line => line.trim())
      .join('\n');

    return Response.json({ logs: cleanLogs });
  } catch (err) {
    console.error(err);
    return new Response("Docker error", { status: 500 });
  }
}
