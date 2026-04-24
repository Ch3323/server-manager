import { getSession } from "@/lib/getSession";
import { readTextFile } from "@/lib/file-manager";

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return new Response("Forbidden - Admin only", { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path");

    if (!targetPath) {
      return new Response("path required", { status: 400 });
    }

    const content = await readTextFile(targetPath);
    return Response.json({ path: targetPath, content });
  } catch (err) {
    console.error(err);
    return new Response("Failed to read file", { status: 500 });
  }
}
