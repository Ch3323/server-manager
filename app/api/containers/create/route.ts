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
    const body = await request.json();
    const imageRef = typeof body?.imageRef === "string" ? body.imageRef.trim() : "";
    const containerName = typeof body?.containerName === "string" ? body.containerName.trim() : "";
    const startAfterCreate = Boolean(body?.startAfterCreate);

    if (!imageRef) {
      return new Response("imageRef required", { status: 400 });
    }

    const image = docker.getImage(imageRef);

    try {
      await image.inspect();
    } catch {
      return new Response(`Image not found: ${imageRef}`, { status: 404 });
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

    return Response.json({
      success: true,
      id: container.id,
      name: createdContainerName,
      started: startAfterCreate,
    });
  } catch (err) {
    console.error(err);
    return new Response("Container create error", { status: 500 });
  }
}
