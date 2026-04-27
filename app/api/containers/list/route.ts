import { docker } from "@/lib/docker";
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

export async function GET(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD", "USER"],
  });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const containers = await docker.listContainers({
      all: true,
    });

    const result = containers.map((c) => ({
      id: c.Id,
      name: normalizeContainerName(c.Names[0]),
      image: c.Image,
      state: c.State,
      status: c.Status,
      isProtected: isProtectedContainerName(c.Names[0]),
    }));

    return jsonResponse(request, result);
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker error", { status: 500 });
  }
}
