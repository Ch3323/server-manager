import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
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
    roles: ["ADMIN"],
    rateLimit: {
      key: "image-bulk-action",
      limit: 10,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const { action } = await request.json();

    if (action !== "prune_dangling") {
      return textResponse(request, "Invalid image bulk action", { status: 400 });
    }

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: "requested prune dangling images",
    });

    const result = await docker.pruneImages({
      filters: {
        dangling: ["true"],
      },
    });

    const deletedImages = result?.ImagesDeleted?.length ?? 0;
    const reclaimedSpace = result?.SpaceReclaimed ?? 0;

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: `pruned dangling images (${deletedImages})`,
    });

    return jsonResponse(request, {
      success: true,
      deletedImages,
      reclaimedSpace,
    });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker image bulk error", { status: 500 });
  }
}
