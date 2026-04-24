import { getSession } from "@/lib/getSession";
import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import { hasPermission } from "@/lib/rbac";

type ImageAction = "pull" | "tag" | "remove";

type DockerWithModem = typeof docker & {
  modem: {
    followProgress: (
      stream: NodeJS.ReadableStream,
      onFinished: (err?: unknown) => void
    ) => void;
  };
};

function followPullProgress(stream: NodeJS.ReadableStream) {
  return new Promise<void>((resolve, reject) => {
    (docker as DockerWithModem).modem.followProgress(
      stream,
      (err: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
}

function pullImage(imageRef: string) {
  return new Promise<void>((resolve, reject) => {
    docker.pull(imageRef, async (err: unknown, stream: NodeJS.ReadableStream | undefined) => {
      if (err || !stream) {
        reject(err ?? new Error("Image pull stream unavailable"));
        return;
      }

      try {
        await followPullProgress(stream);
        resolve();
      } catch (pullErr) {
        reject(pullErr);
      }
    });
  });
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!hasPermission(session.user.role, ["ADMIN", "MOD"])) {
    return new Response("Forbidden - MOD or ADMIN only", { status: 403 });
  }

  try {
    const body = await request.json();
    const action = body?.action as ImageAction;

    if (action === "pull") {
      const imageRef = body?.imageRef as string | undefined;
      if (!imageRef || typeof imageRef !== "string") {
        return new Response("imageRef required", { status: 400 });
      }

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `requested pull image ${imageRef}`,
      });

      await pullImage(imageRef.trim());

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `pulled image ${imageRef}`,
      });

      return Response.json({ success: true });
    }

    const imageId = body?.imageId as string | undefined;
    if (!imageId || typeof imageId !== "string") {
      return new Response("imageId required", { status: 400 });
    }

    const image = docker.getImage(imageId);
    const inspect = await image.inspect();
    const imageLabel = inspect?.RepoTags?.[0] ?? imageId;

    if (action === "tag") {
      const repo = body?.repo as string | undefined;
      const tag = body?.tag as string | undefined;
      if (!repo || !tag) {
        return new Response("repo and tag required", { status: 400 });
      }

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `requested tag image ${imageLabel}`,
      });

      await image.tag({ repo: repo.trim(), tag: tag.trim() });

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `tagged image ${imageLabel} as ${repo}:${tag}`,
      });

      return Response.json({ success: true });
    }

    if (action === "remove") {
      if (session.user.role !== "ADMIN") {
        return new Response("Forbidden - Admin only", { status: 403 });
      }

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `requested delete image ${imageLabel}`,
      });

      await image.remove({ force: true });

      await recordActivity({
        actorEmail: session.user.email,
        actorRole: session.user.role,
        action: `deleted image ${imageLabel}`,
      });

      return Response.json({ success: true });
    }

    return new Response("Invalid image action", { status: 400 });
  } catch (err) {
    console.error(err);
    return new Response("Docker image action error", { status: 500 });
  }
}
