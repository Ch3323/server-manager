import { getSession } from "@/lib/getSession";
import { createFile } from "@/lib/file-manager";

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
    const targetPath = typeof body?.path === "string" ? body.path : "";

    if (!targetPath) {
      return new Response("path required", { status: 400 });
    }

    await createFile(targetPath);
    return Response.json({ success: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return new Response("Access denied for this path", { status: 403 });
    }
    console.error(err);
    return new Response("Failed to create file", { status: 500 });
  }
}
