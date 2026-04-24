import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { docker } from "@/lib/docker";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!["ADMIN", "MOD", "USER"].includes(session.user.role)) {
    return new Response("Forbidden", { status: 403 });
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

    return Response.json(result);
  } catch (err) {
    console.error(err);
    return new Response("Docker image list error", { status: 500 });
  }
}
