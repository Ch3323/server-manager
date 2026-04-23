import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { docker } from "@/lib/docker";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!["ADMIN", "DEV", "VIEWER"].includes(session.user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const containers = await docker.listContainers({
      all: true,
    });

    const result = containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace("/", ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
    }));

    return Response.json(result);
  } catch (err) {
    console.error(err);
    return new Response("Docker error", { status: 500 });
  }
}