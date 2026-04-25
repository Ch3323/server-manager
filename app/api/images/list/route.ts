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
    const images = await docker.listImages({ all: true });

    const result = images.map((img) => {
      const repoTags = img.RepoTags?.filter(Boolean) ?? [];
      const primaryTag = repoTags[0] ?? "<none>:<none>";
      const isDangling = repoTags.length === 0 || primaryTag === "<none>:<none>";

      return {
        id: img.Id,
        shortId: img.Id.replace("sha256:", "").slice(0, 12),
        repoTags,
        primaryTag,
        created: img.Created,
        size: img.Size,
        virtualSize: img.VirtualSize,
        containers: img.Containers,
        isDangling,
      };
    });

    return jsonResponse(request, result);
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker image list error", { status: 500 });
  }
}
