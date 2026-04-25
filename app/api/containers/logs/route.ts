import { docker } from "@/lib/docker";
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
    const { searchParams } = new URL(request.url);
    const containerId = searchParams.get("containerId");
    const tail = searchParams.get("tail") || "100";

    if (!containerId) {
      return textResponse(request, "Container ID required", { status: 400 });
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

    return jsonResponse(request, { logs: cleanLogs });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker error", { status: 500 });
  }
}
