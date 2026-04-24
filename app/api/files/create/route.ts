import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createFile } from "@/lib/file-manager";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

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
    console.error(err);
    return new Response("Failed to create file", { status: 500 });
  }
}
