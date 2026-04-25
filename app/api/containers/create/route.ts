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
  const auth = await requireApiSession(request, { roles: ["ADMIN"] });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const imageRef = typeof body?.imageRef === "string" ? body.imageRef.trim() : "";
    const containerName = typeof body?.containerName === "string" ? body.containerName.trim() : "";
    const startAfterCreate = Boolean(body?.startAfterCreate);

    if (!imageRef) {
      return textResponse(request, "imageRef required", { status: 400 });
    }

    const image = docker.getImage(imageRef);

    try {
      await image.inspect();
    } catch {
      return textResponse(request, `Image not found: ${imageRef}`, { status: 404 });
    }

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: `requested create container from image ${imageRef}`,
    });

    const container = await docker.createContainer({
      Image: imageRef,
      ...(containerName ? { name: containerName } : {}),
    });

    if (startAfterCreate) {
      await container.start();
    }

    const inspect = await container.inspect();
    const createdContainerName = inspect.Name?.replace("/", "") ?? container.id;

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: startAfterCreate ? "created and started container" : "created container",
      containerName: createdContainerName,
    });

    return jsonResponse(request, {
      success: true,
      id: container.id,
      name: createdContainerName,
      started: startAfterCreate,
    });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Container create error", { status: 500 });
  }
}
