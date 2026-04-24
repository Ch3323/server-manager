import { getSession } from "@/lib/getSession";
import { renamePath } from "@/lib/file-manager";

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
    const fromPath = typeof body?.fromPath === "string" ? body.fromPath : "";
    const toPath = typeof body?.toPath === "string" ? body.toPath : "";

    if (!fromPath || !toPath) {
      return new Response("fromPath and toPath required", { status: 400 });
    }

    await renamePath(fromPath, toPath);
    return Response.json({ success: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return new Response("Access denied for this path", { status: 403 });
    }
    console.error(err);
    return new Response("Failed to rename path", { status: 500 });
  }
}
