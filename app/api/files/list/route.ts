import {
  getWorkspaceRootName,
  listDirectory,
  resolveWorkspacePath,
  toRelativeWorkspacePath,
} from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path") ?? "";
    const normalizedPath = toRelativeWorkspacePath(resolveWorkspacePath(targetPath));
    const entries = await listDirectory(normalizedPath);

    return jsonResponse(request, {
      rootName: getWorkspaceRootName(),
      currentPath: normalizedPath,
      entries,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this directory", { status: 403 });
    }
    if (code === "ENOENT") {
      return textResponse(request, "Directory not found", { status: 404 });
    }
    console.error(err);
    return textResponse(request, "Failed to list files", { status: 500 });
  }
}
