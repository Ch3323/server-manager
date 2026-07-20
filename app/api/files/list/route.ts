import {
  listDirectory,
  resolveWorkspacePath,
} from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";
import {
  getFileWorkspaceAccess,
  getScopedWorkspaceRootName,
  resolveScopedWorkspacePath,
  toScopedWorkspaceHostPath,
  toVirtualFileListEntries,
} from "@/lib/workspace-access";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN", "MOD"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const workspaceAccess = await getFileWorkspaceAccess(auth.session);
    if (!workspaceAccess) {
      return textResponse(request, "Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path") ?? "";
    const scopedPath = resolveScopedWorkspacePath(workspaceAccess, targetPath);
    const entries = await listDirectory(scopedPath.actualPath);

    return jsonResponse(request, {
      rootName: getScopedWorkspaceRootName(workspaceAccess),
      accessMode: workspaceAccess.accessMode,
      canWrite: workspaceAccess.canWrite,
      currentPath: scopedPath.virtualPath,
      currentAbsolutePath: resolveWorkspacePath(scopedPath.actualPath),
      currentHostPath: toScopedWorkspaceHostPath(workspaceAccess, scopedPath.virtualPath),
      entries: toVirtualFileListEntries(workspaceAccess, entries),
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
