import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

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
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD"],
    rateLimit: {
      key: "image-action",
      limit: 30,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const action = body?.action as ImageAction;

    if (action === "pull") {
      const imageRef = body?.imageRef as string | undefined;
      if (!imageRef || typeof imageRef !== "string") {
        return textResponse(request, "imageRef required", { status: 400 });
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

      return jsonResponse(request, { success: true });
    }

    const imageId = body?.imageId as string | undefined;
    if (!imageId || typeof imageId !== "string") {
      return textResponse(request, "imageId required", { status: 400 });
    }

    const image = docker.getImage(imageId);
    const inspect = await image.inspect();
    const imageLabel = inspect?.RepoTags?.[0] ?? imageId;

    if (action === "tag") {
      const repo = body?.repo as string | undefined;
      const tag = body?.tag as string | undefined;
      if (!repo || !tag) {
        return textResponse(request, "repo and tag required", { status: 400 });
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

      return jsonResponse(request, { success: true });
    }

    if (action === "remove") {
      if (session.user.role !== "ADMIN") {
        return textResponse(request, "Forbidden - Admin only", { status: 403 });
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

      return jsonResponse(request, { success: true });
    }

    return textResponse(request, "Invalid image action", { status: 400 });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker image action error", { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}
