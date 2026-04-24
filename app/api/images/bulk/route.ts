import { getSession } from "@/lib/getSession";
import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return new Response("Forbidden - Admin only", { status: 403 });
  }

  try {
    const { action } = await request.json();

    if (action !== "prune_dangling") {
      return new Response("Invalid image bulk action", { status: 400 });
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

    return Response.json({
      success: true,
      deletedImages,
      reclaimedSpace,
    });
  } catch (err) {
    console.error(err);
    return new Response("Docker image bulk error", { status: 500 });
  }
}
