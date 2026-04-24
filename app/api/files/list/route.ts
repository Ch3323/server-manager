import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getWorkspaceRootName,
  listDirectory,
  resolveWorkspacePath,
  toRelativeWorkspacePath,
} from "@/lib/file-manager";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return new Response("Forbidden - Admin only", { status: 403 });
  }

  try {
    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path") ?? "";
    const normalizedPath = toRelativeWorkspacePath(resolveWorkspacePath(targetPath));
    const entries = await listDirectory(normalizedPath);

    return Response.json({
      rootName: getWorkspaceRootName(),
      currentPath: normalizedPath,
      entries,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return new Response("Access denied for this directory", { status: 403 });
    }
    if (code === "ENOENT") {
      return new Response("Directory not found", { status: 404 });
    }
    console.error(err);
    return new Response("Failed to list files", { status: 500 });
  }
}
